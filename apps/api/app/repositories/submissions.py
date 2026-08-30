import json
import re
import sqlite3
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import uuid4

from app.app_db import connect_app_db, transaction
from app.core.config import Settings
from app.db import connect_readonly
from app.repositories.works import get_work
from app.schemas.admin import (
    AdminSubmissionDetail,
    AdminSubmissionFile,
    AdminSubmissionQueueResponse,
    AdminSubmissionSummary,
    SubmissionRevisionResponse,
)
from app.schemas.submissions import SubmissionFileResponse, SubmissionResponse, SubmissionType
from app.services.audit import (
    RevisionRequestedAuditDetail,
    SubmissionEditedAuditDetail,
    SubmissionPublishedAuditDetail,
    SubmissionRejectedAuditDetail,
    SubmissionResubmittedAuditDetail,
    write_audit_event,
)
from app.services.submission_files import (
    StagedFile,
    remove_staged_file,
    staged_file_identity_is_valid,
    staged_file_is_absent,
)

_ENTITY_ID = re.compile(r"[0-9a-f]{32}")
_MAX_LEGACY_SNAPSHOT_CHARS = 262_144
_MAX_LEGACY_SNAPSHOT_BYTES = 262_144
_MAX_LEGACY_SNAPSHOT_PROJECTION_CHARS = _MAX_LEGACY_SNAPSHOT_CHARS + 1
_LEGACY_SNAPSHOT_KEYS = frozenset(
    {
        "submission_id",
        "submission_type",
        "existing_work_id",
        "status",
        "title",
        "authors",
        "poem_text",
        "genre",
        "historical_period",
        "notes",
        "decision_reason",
        "published_work_id",
        "created_at",
        "updated_at",
        "submitted_at",
        "published_at",
        "files",
    }
)
_LEGACY_FILE_KEYS = frozenset(
    {
        "file_id",
        "original_name",
        "file_format",
        "media_type",
        "file_bytes",
        "pixel_width",
        "pixel_height",
        "sha256",
        "sequence",
        "public_url",
    }
)


class SubmissionNotFoundError(Exception):
    pass


class SubmissionNotEditableError(Exception):
    pass


class SubmissionAlreadyDecidedError(Exception):
    pass


class InvalidFileSelectionError(Exception):
    pass


class PublishValidationError(Exception):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class StoredSubmissionFile:
    file_id: str
    storage_name: str
    original_name: str
    file_format: str
    media_type: str
    file_bytes: int
    pixel_width: int
    pixel_height: int
    sha256: str
    sequence: int


@dataclass(frozen=True)
class CleanupSubmissionFile:
    cleanup_id: str
    submission_id: str
    file_id: str
    storage_name: str
    file_format: str


@dataclass(frozen=True)
class LegacyReconciliationState:
    generation: int
    revision_id_cursor: str
    snapshot_file_cursor: int


@dataclass(frozen=True)
class LegacyRevisionSource:
    revision_id: str
    submission_id: str
    snapshot_json: str


@dataclass(frozen=True)
class LegacySnapshotCandidate:
    revision_id: str
    submission_id: str
    file_id: str
    storage_name: str
    file_format: str


class _StaleLegacyReconciliationState(Exception):
    pass


def _file_from_row(row: sqlite3.Row) -> StoredSubmissionFile:
    return StoredSubmissionFile(**dict(row))


def _public_file(record: StoredSubmissionFile) -> SubmissionFileResponse:
    return SubmissionFileResponse(
        file_id=record.file_id,
        original_name=record.original_name,
        file_format=record.file_format,
        media_type=record.media_type,
        file_bytes=record.file_bytes,
        pixel_width=record.pixel_width,
        pixel_height=record.pixel_height,
        sha256=record.sha256,
        sequence=record.sequence,
        public_url=None,
    )


def _response(connection: sqlite3.Connection, row: sqlite3.Row) -> SubmissionResponse:
    file_rows = connection.execute(
        """
        SELECT file_id, storage_name, original_name, file_format, media_type,
               file_bytes, pixel_width, pixel_height, sha256, sequence
        FROM submission_files WHERE submission_id = ? ORDER BY sequence
        """,
        (row["submission_id"],),
    ).fetchall()
    return SubmissionResponse(
        **dict(row),
        files=[_public_file(_file_from_row(file_row)) for file_row in file_rows],
    )


def create_submission(
    settings: Settings,
    *,
    submission_id: str,
    owner_user_id: str,
    submission_type: SubmissionType,
    existing_work_id: str | None,
    title: str,
    authors: str,
    poem_text: str,
    genre: str,
    historical_period: str,
    notes: str,
    files: list[StagedFile],
) -> SubmissionResponse:
    now = datetime.now(UTC).isoformat()
    with transaction(settings) as connection:
        connection.execute(
            """
            INSERT INTO submissions (
                submission_id, owner_user_id, submission_type, existing_work_id,
                status, title, authors, poem_text, genre, historical_period, notes,
                created_at, updated_at, submitted_at
            ) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                submission_id,
                owner_user_id,
                submission_type,
                existing_work_id,
                title,
                authors,
                poem_text,
                genre,
                historical_period,
                notes,
                now,
                now,
                now,
            ),
        )
        for file in files:
            connection.execute(
                """
                INSERT INTO submission_files (
                    file_id, submission_id, storage_name, original_name, file_format,
                    media_type, file_bytes, pixel_width, pixel_height, sha256,
                    sequence, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    file.file_id,
                    submission_id,
                    file.storage_name,
                    file.original_name,
                    file.file_format,
                    file.media_type,
                    file.file_bytes,
                    file.pixel_width,
                    file.pixel_height,
                    file.sha256,
                    file.sequence,
                    now,
                ),
            )
            connection.execute(
                """
                DELETE FROM submission_file_staging_inventory
                WHERE submission_id = ? AND file_id = ?
                  AND storage_name = ? AND file_format = ?
                """,
                (submission_id, file.file_id, file.storage_name, file.file_format),
            )
        row = connection.execute(
            "SELECT * FROM submissions WHERE submission_id = ?", (submission_id,)
        ).fetchone()
        return _response(connection, row)


def list_owned_submissions(settings: Settings, owner_user_id: str) -> list[SubmissionResponse]:
    with connect_app_db(settings) as connection:
        rows = connection.execute(
            "SELECT * FROM submissions WHERE owner_user_id = ? ORDER BY updated_at DESC, submission_id",
            (owner_user_id,),
        ).fetchall()
        return [_response(connection, row) for row in rows]


def get_owned_submission(
    settings: Settings, submission_id: str, owner_user_id: str
) -> SubmissionResponse | None:
    with connect_app_db(settings) as connection:
        row = connection.execute(
            "SELECT * FROM submissions WHERE submission_id = ? AND owner_user_id = ?",
            (submission_id, owner_user_id),
        ).fetchone()
        return _response(connection, row) if row is not None else None


def get_owned_submission_file(
    settings: Settings, submission_id: str, file_id: str, owner_user_id: str
) -> StoredSubmissionFile | None:
    with connect_app_db(settings) as connection:
        row = connection.execute(
            """
            SELECT f.file_id, f.storage_name, f.original_name, f.file_format, f.media_type,
                   f.file_bytes, f.pixel_width, f.pixel_height, f.sha256, f.sequence
            FROM submission_files AS f
            JOIN submissions AS s USING (submission_id)
            WHERE f.submission_id = ? AND f.file_id = ? AND s.owner_user_id = ?
            """,
            (submission_id, file_id, owner_user_id),
        ).fetchone()
    return _file_from_row(row) if row is not None else None


def _owned_for_update(
    connection: sqlite3.Connection, submission_id: str, owner_user_id: str
) -> sqlite3.Row:
    row = connection.execute(
        "SELECT * FROM submissions WHERE submission_id = ? AND owner_user_id = ?",
        (submission_id, owner_user_id),
    ).fetchone()
    if row is None:
        raise SubmissionNotFoundError
    if row["status"] != "needs_revision":
        raise SubmissionNotEditableError
    return row


def _snapshot(connection: sqlite3.Connection, row: sqlite3.Row) -> str:
    return json.dumps(
        _response(connection, row).model_dump(mode="json"),
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    )


def update_owned_submission(
    settings: Settings,
    *,
    submission_id: str,
    owner_user_id: str,
    changes: dict[str, Any],
) -> SubmissionResponse:
    allowed = {
        "existing_work_id",
        "title",
        "authors",
        "poem_text",
        "genre",
        "historical_period",
        "notes",
    }
    if not changes or not changes.keys() <= allowed:
        raise ValueError("投稿修改字段无效。")
    now = datetime.now(UTC).isoformat()
    with transaction(settings) as connection:
        row = _owned_for_update(connection, submission_id, owner_user_id)
        connection.execute(
            """
            INSERT INTO submission_revisions (
                revision_id, submission_id, actor_user_id, action, snapshot_json, created_at
            ) VALUES (?, ?, ?, 'submission_updated', ?, ?)
            """,
            (uuid4().hex, submission_id, owner_user_id, _snapshot(connection, row), now),
        )
        assignments = ", ".join(f"{field} = ?" for field in changes)
        connection.execute(
            f"UPDATE submissions SET {assignments}, updated_at = ? WHERE submission_id = ?",
            [*changes.values(), now, submission_id],
        )
        updated = connection.execute(
            "SELECT * FROM submissions WHERE submission_id = ?", (submission_id,)
        ).fetchone()
        return _response(connection, updated)


def resubmit_owned_submission(
    settings: Settings,
    *,
    submission_id: str,
    owner_user_id: str,
    request_id: str,
) -> SubmissionResponse:
    now = datetime.now(UTC).isoformat()
    with transaction(settings) as connection:
        row = _owned_for_update(connection, submission_id, owner_user_id)
        snapshot = _snapshot(connection, row)
        connection.execute(
            """
            INSERT INTO submission_revisions (
                revision_id, submission_id, actor_user_id, action, snapshot_json, created_at
            ) VALUES (?, ?, ?, 'submission_resubmitted', ?, ?)
            """,
            (uuid4().hex, submission_id, owner_user_id, snapshot, now),
        )
        connection.execute(
            """
            UPDATE submissions
            SET status = 'pending', decision_reason = '', updated_at = ?, submitted_at = ?
            WHERE submission_id = ?
            """,
            (now, now, submission_id),
        )
        write_audit_event(
            connection,
            actor_user_id=owner_user_id,
            action="submission_resubmitted",
            target_type="submission",
            target_id=submission_id,
            detail=SubmissionResubmittedAuditDetail(),
            request_id=request_id,
        )
        updated = connection.execute(
            "SELECT * FROM submissions WHERE submission_id = ?", (submission_id,)
        ).fetchone()
        return _response(connection, updated)


def _admin_file(submission_id: str, record: StoredSubmissionFile) -> AdminSubmissionFile:
    return AdminSubmissionFile(
        **_public_file(record).model_dump(),
        preview_url=(f"/api/v1/admin/submissions/{submission_id}/files/{record.file_id}"),
    )


def _safe_snapshot(raw_snapshot: str) -> dict[str, object]:
    try:
        value = json.loads(raw_snapshot)
    except (json.JSONDecodeError, TypeError):
        return {}
    return value if isinstance(value, dict) else {}


def _admin_response(connection: sqlite3.Connection, row: sqlite3.Row) -> AdminSubmissionDetail:
    file_rows = connection.execute(
        """
        SELECT file_id, storage_name, original_name, file_format, media_type,
               file_bytes, pixel_width, pixel_height, sha256, sequence
        FROM submission_files WHERE submission_id = ? ORDER BY sequence
        """,
        (row["submission_id"],),
    ).fetchall()
    revision_rows = connection.execute(
        """
        SELECT r.revision_id, r.action, r.snapshot_json, r.created_at,
               u.username AS actor_username
        FROM submission_revisions AS r
        JOIN users AS u ON u.user_id = r.actor_user_id
        WHERE r.submission_id = ?
        ORDER BY r.created_at DESC, r.revision_id DESC
        """,
        (row["submission_id"],),
    ).fetchall()
    payload = dict(row)
    payload.pop("owner_user_id", None)
    payload.pop("reviewer_user_id", None)
    return AdminSubmissionDetail(
        **payload,
        files=[
            _admin_file(row["submission_id"], _file_from_row(file_row)) for file_row in file_rows
        ],
        revisions=[
            SubmissionRevisionResponse(
                revision_id=revision["revision_id"],
                action=revision["action"],
                actor_username=revision["actor_username"],
                snapshot=_safe_snapshot(revision["snapshot_json"]),
                created_at=revision["created_at"],
            )
            for revision in revision_rows
        ],
    )


def list_admin_submissions(
    settings: Settings,
    *,
    status: str,
    submission_type: str | None,
    owner_username_normalized: str | None,
    submitted_from: str | None,
    submitted_to: str | None,
    page: int,
    page_size: int,
) -> AdminSubmissionQueueResponse:
    clauses = ["s.status = ?"]
    parameters: list[object] = [status]
    if submission_type is not None:
        clauses.append("s.submission_type = ?")
        parameters.append(submission_type)
    if owner_username_normalized is not None:
        clauses.append("u.username_normalized = ?")
        parameters.append(owner_username_normalized)
    if submitted_from is not None:
        clauses.append("s.submitted_at >= ?")
        parameters.append(submitted_from)
    if submitted_to is not None:
        clauses.append("s.submitted_at <= ?")
        parameters.append(submitted_to)
    where = " AND ".join(clauses)
    with connect_app_db(settings) as connection:
        connection.execute("BEGIN")
        total = connection.execute(
            f"""
            SELECT count(*) FROM submissions AS s
            JOIN users AS u ON u.user_id = s.owner_user_id
            WHERE {where}
            """,
            parameters,
        ).fetchone()[0]
        rows = connection.execute(
            f"""
            SELECT s.submission_id, s.submission_type, s.status, u.username AS owner_username,
                   s.title, s.submitted_at, s.updated_at,
                   count(f.file_id) AS file_count
            FROM submissions AS s
            JOIN users AS u ON u.user_id = s.owner_user_id
            LEFT JOIN submission_files AS f ON f.submission_id = s.submission_id
            WHERE {where}
            GROUP BY s.submission_id
            ORDER BY s.submitted_at ASC, s.submission_id ASC
            LIMIT ? OFFSET ?
            """,
            [*parameters, page_size, (page - 1) * page_size],
        ).fetchall()
    return AdminSubmissionQueueResponse(
        page=page,
        page_size=page_size,
        total=total,
        submissions=[AdminSubmissionSummary(**dict(row)) for row in rows],
    )


def get_admin_submission(settings: Settings, submission_id: str) -> AdminSubmissionDetail | None:
    with connect_app_db(settings) as connection:
        row = connection.execute(
            """
            SELECT s.*, u.username AS owner_username
            FROM submissions AS s
            JOIN users AS u ON u.user_id = s.owner_user_id
            WHERE s.submission_id = ?
            """,
            (submission_id,),
        ).fetchone()
        return _admin_response(connection, row) if row is not None else None


def get_admin_submission_file(
    settings: Settings, submission_id: str, file_id: str
) -> StoredSubmissionFile | None:
    with connect_app_db(settings) as connection:
        row = connection.execute(
            """
            SELECT file_id, storage_name, original_name, file_format, media_type,
                   file_bytes, pixel_width, pixel_height, sha256, sequence
            FROM submission_files
            WHERE submission_id = ? AND file_id = ?
            """,
            (submission_id, file_id),
        ).fetchone()
    return _file_from_row(row) if row is not None else None


def _pending_admin_row(connection: sqlite3.Connection, submission_id: str) -> sqlite3.Row:
    row = connection.execute(
        """
        SELECT s.*, u.username AS owner_username
        FROM submissions AS s
        JOIN users AS u ON u.user_id = s.owner_user_id
        WHERE s.submission_id = ?
        """,
        (submission_id,),
    ).fetchone()
    if row is None:
        raise SubmissionNotFoundError
    if row["status"] != "pending":
        raise SubmissionAlreadyDecidedError
    return row


def update_admin_submission(
    settings: Settings,
    *,
    submission_id: str,
    actor_user_id: str,
    metadata_changes: dict[str, str],
    file_order: list[str] | None,
    remove_file_ids: list[str] | None,
    changed_fields: tuple[str, ...],
    request_id: str,
) -> tuple[AdminSubmissionDetail, list[StoredSubmissionFile]]:
    now = datetime.now(UTC).isoformat()
    with transaction(settings) as connection:
        row = _pending_admin_row(connection, submission_id)
        existing_files = [
            _file_from_row(file_row)
            for file_row in connection.execute(
                """
                SELECT file_id, storage_name, original_name, file_format, media_type,
                       file_bytes, pixel_width, pixel_height, sha256, sequence
                FROM submission_files WHERE submission_id = ? ORDER BY sequence
                """,
                (submission_id,),
            ).fetchall()
        ]
        current_ids = [record.file_id for record in existing_files]
        removals = remove_file_ids or []
        if len(removals) != len(set(removals)) or not set(removals) <= set(current_ids):
            raise InvalidFileSelectionError
        retained_ids = [file_id for file_id in current_ids if file_id not in set(removals)]
        resolved_order = file_order if file_order is not None else retained_ids
        if len(resolved_order) != len(set(resolved_order)) or set(resolved_order) != set(
            retained_ids
        ):
            raise InvalidFileSelectionError

        connection.execute(
            """
            INSERT INTO submission_revisions (
                revision_id, submission_id, actor_user_id, action, snapshot_json, created_at
            ) VALUES (?, ?, ?, 'submission_edited', ?, ?)
            """,
            (uuid4().hex, submission_id, actor_user_id, _snapshot(connection, row), now),
        )
        if metadata_changes:
            assignments = ", ".join(f"{field} = ?" for field in metadata_changes)
            connection.execute(
                f"UPDATE submissions SET {assignments}, updated_at = ? WHERE submission_id = ?",
                [*metadata_changes.values(), now, submission_id],
            )
        else:
            connection.execute(
                "UPDATE submissions SET updated_at = ? WHERE submission_id = ?",
                (now, submission_id),
            )
        removed_records = [record for record in existing_files if record.file_id in set(removals)]
        if removals:
            for record in removed_records:
                connection.execute(
                    """
                    INSERT INTO submission_file_cleanup (
                        cleanup_id, submission_id, file_id, storage_name, file_format,
                        attempt_count, created_at
                    ) VALUES (?, ?, ?, ?, ?, 0, ?)
                    """,
                    (
                        uuid4().hex,
                        submission_id,
                        record.file_id,
                        record.storage_name,
                        record.file_format,
                        now,
                    ),
                )
            placeholders = ", ".join("?" for _ in removals)
            connection.execute(
                f"DELETE FROM submission_files WHERE submission_id = ? "
                f"AND file_id IN ({placeholders})",
                [submission_id, *removals],
            )
        for temporary_sequence, file_id in enumerate(resolved_order, start=1):
            connection.execute(
                "UPDATE submission_files SET sequence = ? WHERE submission_id = ? AND file_id = ?",
                (-temporary_sequence, submission_id, file_id),
            )
        for sequence, file_id in enumerate(resolved_order, start=1):
            connection.execute(
                "UPDATE submission_files SET sequence = ? WHERE submission_id = ? AND file_id = ?",
                (sequence, submission_id, file_id),
            )
        write_audit_event(
            connection,
            actor_user_id=actor_user_id,
            action="submission_edited",
            target_type="submission",
            target_id=submission_id,
            detail=SubmissionEditedAuditDetail(
                changed_fields=changed_fields,
                removed_file_ids=tuple(removals),
            ),
            request_id=request_id,
        )
        updated = connection.execute(
            """
            SELECT s.*, u.username AS owner_username
            FROM submissions AS s
            JOIN users AS u ON u.user_id = s.owner_user_id
            WHERE s.submission_id = ?
            """,
            (submission_id,),
        ).fetchone()
        response = _admin_response(connection, updated)
    return response, removed_records


def sweep_submission_file_cleanup(
    settings: Settings,
    *,
    limit: int = 100,
    file_ids: tuple[str, ...] | None = None,
) -> int:
    """Retry a bounded batch of durable, DB-first private-file removals."""
    if limit < 1 or limit > 100:
        raise ValueError("Cleanup batch limit must be between 1 and 100")
    parameters: list[object] = []
    where = ""
    if file_ids is not None:
        if not file_ids:
            return 0
        placeholders = ", ".join("?" for _ in file_ids)
        where = f"WHERE file_id IN ({placeholders})"
        parameters.extend(file_ids)
    with connect_app_db(settings) as connection:
        rows = connection.execute(
            f"""
            SELECT cleanup_id, submission_id, file_id, storage_name, file_format
            FROM submission_file_cleanup
            {where}
            ORDER BY created_at, cleanup_id
            LIMIT ?
            """,
            [*parameters, limit],
        ).fetchall()
    completed = 0
    for row in rows:
        cleanup_id = row["cleanup_id"]
        with transaction(settings) as connection:
            current = connection.execute(
                """
                SELECT cleanup_id, submission_id, file_id, storage_name, file_format
                FROM submission_file_cleanup WHERE cleanup_id = ?
                """,
                (cleanup_id,),
            ).fetchone()
            if current is None:
                continue
            record = CleanupSubmissionFile(**dict(current))
            if not staged_file_identity_is_valid(
                record.submission_id,
                record.file_id,
                record.storage_name,
                record.file_format,
            ):
                connection.execute(
                    "DELETE FROM submission_file_cleanup WHERE cleanup_id = ?",
                    (record.cleanup_id,),
                )
                continue
            live = connection.execute(
                """
                SELECT 1 FROM submission_files
                WHERE submission_id = ? AND file_id = ?
                  AND storage_name = ? AND file_format = ?
                """,
                (
                    record.submission_id,
                    record.file_id,
                    record.storage_name,
                    record.file_format,
                ),
            ).fetchone()
            if live is not None:
                connection.execute(
                    "DELETE FROM submission_file_cleanup WHERE cleanup_id = ?",
                    (record.cleanup_id,),
                )
                continue
            removed = remove_staged_file(settings, record.submission_id, record)
            cleaned = removed or staged_file_is_absent(settings, record.submission_id, record)
            if cleaned:
                connection.execute(
                    "DELETE FROM submission_file_cleanup WHERE cleanup_id = ?",
                    (record.cleanup_id,),
                )
                completed += 1
            else:
                connection.execute(
                    """
                    UPDATE submission_file_cleanup
                    SET attempt_count = min(attempt_count + 1, 1000000),
                        last_attempt_at = ?
                    WHERE cleanup_id = ?
                    """,
                    (datetime.now(UTC).isoformat(), record.cleanup_id),
                )
    return completed


def _read_legacy_revision_batch(
    settings: Settings,
    state: LegacyReconciliationState,
    source_limit: int,
) -> list[LegacyRevisionSource]:
    """Seek through the immutable revision primary key without offset replay."""
    with connect_app_db(settings) as connection:
        rows = connection.execute(
            """
            SELECT revision_id, submission_id,
                   substr(snapshot_json, 1, ?) AS snapshot_json
            FROM submission_revisions
            WHERE (
                (? > 0 AND revision_id >= ?)
                OR (? = 0 AND revision_id > ?)
              )
              AND length(revision_id) = 32
              AND revision_id NOT GLOB '*[^0-9a-f]*'
            ORDER BY revision_id
            LIMIT ?
            """,
            (
                _MAX_LEGACY_SNAPSHOT_PROJECTION_CHARS,
                state.snapshot_file_cursor,
                state.revision_id_cursor,
                state.snapshot_file_cursor,
                state.revision_id_cursor,
                source_limit,
            ),
        ).fetchall()
    return [LegacyRevisionSource(**dict(row)) for row in rows]


def _legacy_snapshot_candidates(
    source: LegacyRevisionSource,
) -> tuple[LegacySnapshotCandidate, ...]:
    raw_snapshot = source.snapshot_json
    if (
        not isinstance(raw_snapshot, str)
        or len(raw_snapshot) > _MAX_LEGACY_SNAPSHOT_CHARS
        or _ENTITY_ID.fullmatch(source.revision_id) is None
        or _ENTITY_ID.fullmatch(source.submission_id) is None
    ):
        return ()
    try:
        if len(raw_snapshot.encode("utf-8")) > _MAX_LEGACY_SNAPSHOT_BYTES:
            return ()
        snapshot = json.loads(raw_snapshot)
    except (json.JSONDecodeError, RecursionError, TypeError, UnicodeEncodeError):
        return ()
    if (
        not isinstance(snapshot, dict)
        or not {"submission_id", "files"} <= snapshot.keys() <= _LEGACY_SNAPSHOT_KEYS
        or snapshot["submission_id"] != source.submission_id
        or not isinstance(snapshot["files"], list)
        or len(snapshot["files"]) > 10
    ):
        return ()
    candidates: list[LegacySnapshotCandidate] = []
    file_ids: set[str] = set()
    for value in snapshot["files"]:
        if (
            not isinstance(value, dict)
            or not {"file_id", "file_format"} <= value.keys() <= _LEGACY_FILE_KEYS
        ):
            return ()
        file_id = value["file_id"]
        file_format = value["file_format"]
        storage_name = (
            f"{file_id}.{file_format}"
            if isinstance(file_id, str) and isinstance(file_format, str)
            else ""
        )
        if (
            not staged_file_identity_is_valid(
                source.submission_id,
                file_id,
                storage_name,
                file_format,
            )
            or file_id in file_ids
        ):
            return ()
        file_ids.add(file_id)
        candidates.append(
            LegacySnapshotCandidate(
                revision_id=source.revision_id,
                submission_id=source.submission_id,
                file_id=file_id,
                storage_name=storage_name,
                file_format=file_format,
            )
        )
    return tuple(candidates)


def _reconcile_staging_inventory(settings: Settings, *, limit: int, now: datetime) -> int:
    cutoff = (now - timedelta(hours=24)).isoformat()
    with connect_app_db(settings) as connection:
        rows = connection.execute(
            """
            SELECT inventory_sequence, submission_id, file_id, storage_name, file_format
            FROM submission_file_staging_inventory
            WHERE created_at <= ?
            ORDER BY inventory_sequence
            LIMIT ?
            """,
            (cutoff, limit),
        ).fetchall()
    queued = 0
    with transaction(settings) as connection:
        for selected in rows:
            current = connection.execute(
                """
                SELECT inventory_sequence, submission_id, file_id, storage_name, file_format
                FROM submission_file_staging_inventory
                WHERE inventory_sequence = ? AND created_at <= ?
                """,
                (selected["inventory_sequence"], cutoff),
            ).fetchone()
            if current is None:
                continue
            if not staged_file_identity_is_valid(
                current["submission_id"],
                current["file_id"],
                current["storage_name"],
                current["file_format"],
            ):
                connection.execute(
                    "DELETE FROM submission_file_staging_inventory WHERE inventory_sequence = ?",
                    (current["inventory_sequence"],),
                )
                continue
            live = connection.execute(
                """
                SELECT 1 FROM submission_files
                WHERE submission_id = ? AND file_id = ?
                  AND storage_name = ? AND file_format = ?
                """,
                (
                    current["submission_id"],
                    current["file_id"],
                    current["storage_name"],
                    current["file_format"],
                ),
            ).fetchone()
            marked = connection.execute(
                "SELECT 1 FROM submission_file_cleanup WHERE file_id = ?",
                (current["file_id"],),
            ).fetchone()
            if live is None and marked is None:
                result = connection.execute(
                    """
                    INSERT INTO submission_file_cleanup (
                        cleanup_id, submission_id, file_id, storage_name, file_format,
                        attempt_count, created_at
                    ) VALUES (?, ?, ?, ?, ?, 0, ?)
                    """,
                    (
                        uuid4().hex,
                        current["submission_id"],
                        current["file_id"],
                        current["storage_name"],
                        current["file_format"],
                        now.isoformat(),
                    ),
                )
                queued += result.rowcount
            connection.execute(
                "DELETE FROM submission_file_staging_inventory WHERE inventory_sequence = ?",
                (current["inventory_sequence"],),
            )
    return queued


def _reconcile_legacy_snapshots(
    settings: Settings,
    *,
    limit: int,
    source_limit: int,
    now: datetime,
) -> int:
    with connect_app_db(settings) as connection:
        row = connection.execute(
            """
            SELECT generation, revision_id_cursor, snapshot_file_cursor
            FROM submission_file_legacy_reconciliation_state WHERE singleton = 1
            """
        ).fetchone()
    state = LegacyReconciliationState(**dict(row))
    sources = _read_legacy_revision_batch(settings, state, source_limit)
    next_generation = state.generation
    next_revision_cursor = state.revision_id_cursor
    next_file_cursor = state.snapshot_file_cursor
    revisions_examined = 0
    candidates_examined = 0
    queued = 0
    stopped_for_limit = False
    try:
        with transaction(settings) as connection:
            for source_index, source in enumerate(sources):
                if queued >= limit:
                    stopped_for_limit = True
                    break
                candidates = _legacy_snapshot_candidates(source)
                start_index = (
                    state.snapshot_file_cursor
                    if source_index == 0 and source.revision_id == state.revision_id_cursor
                    else 0
                )
                revisions_examined += 1
                for candidate_index in range(start_index, len(candidates)):
                    if queued >= limit:
                        stopped_for_limit = True
                        next_revision_cursor = source.revision_id
                        next_file_cursor = candidate_index
                        break
                    candidate = candidates[candidate_index]
                    candidates_examined += 1
                    seen = connection.execute(
                        """
                        SELECT 1 FROM submission_file_legacy_reconciliation_seen
                        WHERE revision_id = ? AND file_id = ?
                        """,
                        (candidate.revision_id, candidate.file_id),
                    ).fetchone()
                    if seen is None:
                        parent = connection.execute(
                            "SELECT 1 FROM submissions WHERE submission_id = ?",
                            (candidate.submission_id,),
                        ).fetchone()
                        live = connection.execute(
                            """
                            SELECT 1 FROM submission_files
                            WHERE submission_id = ? AND file_id = ?
                              AND storage_name = ? AND file_format = ?
                            """,
                            (
                                candidate.submission_id,
                                candidate.file_id,
                                candidate.storage_name,
                                candidate.file_format,
                            ),
                        ).fetchone()
                        marked = connection.execute(
                            "SELECT 1 FROM submission_file_cleanup WHERE file_id = ?",
                            (candidate.file_id,),
                        ).fetchone()
                        if parent is not None and live is None and marked is None:
                            result = connection.execute(
                                """
                                INSERT INTO submission_file_cleanup (
                                    cleanup_id, submission_id, file_id,
                                    storage_name, file_format, attempt_count, created_at
                                ) VALUES (?, ?, ?, ?, ?, 0, ?)
                                """,
                                (
                                    uuid4().hex,
                                    candidate.submission_id,
                                    candidate.file_id,
                                    candidate.storage_name,
                                    candidate.file_format,
                                    now.isoformat(),
                                ),
                            )
                            queued += result.rowcount
                        connection.execute(
                            """
                            INSERT INTO submission_file_legacy_reconciliation_seen (
                                revision_id, file_id, processed_at
                            ) VALUES (?, ?, ?)
                            """,
                            (candidate.revision_id, candidate.file_id, now.isoformat()),
                        )
                    next_file_cursor = candidate_index + 1
                if stopped_for_limit:
                    break
                next_revision_cursor = source.revision_id
                next_file_cursor = 0
            if not stopped_for_limit and len(sources) < source_limit:
                next_generation += 1
                next_revision_cursor = ""
                next_file_cursor = 0
            updated = connection.execute(
                """
                UPDATE submission_file_legacy_reconciliation_state
                SET generation = ?, revision_id_cursor = ?, snapshot_file_cursor = ?,
                    last_revisions_examined = ?, last_candidates_examined = ?, updated_at = ?
                WHERE singleton = 1 AND generation = ?
                  AND revision_id_cursor = ? AND snapshot_file_cursor = ?
                """,
                (
                    next_generation,
                    next_revision_cursor,
                    next_file_cursor,
                    revisions_examined,
                    candidates_examined,
                    now.isoformat(),
                    state.generation,
                    state.revision_id_cursor,
                    state.snapshot_file_cursor,
                ),
            )
            if updated.rowcount != 1:
                raise _StaleLegacyReconciliationState
    except _StaleLegacyReconciliationState:
        return 0
    return queued


def reconcile_submission_file_cleanup(
    settings: Settings,
    *,
    limit: int = 100,
    revision_limit: int = 32,
) -> int:
    """Queue bounded SQL-known cleanup work without directory enumeration.

    One call reads at most ``limit`` aged staging rows and ``revision_limit``
    immutable snapshots (each snapshot is capped at ten file identities), and
    inserts at most ``limit`` cleanup markers. The staging table itself is the
    durable FIFO; legacy snapshot pagination uses its immutable primary key plus
    a generation that changes whenever the cursor resets.
    """
    if limit < 1 or limit > 100:
        raise ValueError("Reconciliation batch limit must be between 1 and 100")
    if revision_limit < 1 or revision_limit > 1000:
        raise ValueError("Legacy revision limit must be between 1 and 1000")
    now = datetime.now(UTC)
    queued = _reconcile_staging_inventory(settings, limit=limit, now=now)
    remaining = limit - queued
    if remaining:
        queued += _reconcile_legacy_snapshots(
            settings,
            limit=remaining,
            source_limit=revision_limit,
            now=now,
        )
    return queued


def decide_admin_submission_with_reason(
    settings: Settings,
    *,
    submission_id: str,
    actor_user_id: str,
    reason: str,
    decision: str,
    request_id: str,
) -> AdminSubmissionDetail:
    if decision == "request_revision":
        status = "needs_revision"
        action = "revision_requested"
        detail = RevisionRequestedAuditDetail()
    elif decision == "reject":
        status = "rejected"
        action = "submission_rejected"
        detail = SubmissionRejectedAuditDetail()
    else:
        raise ValueError("Unknown moderation decision")
    now = datetime.now(UTC).isoformat()
    with transaction(settings) as connection:
        _pending_admin_row(connection, submission_id)
        connection.execute(
            """
            UPDATE submissions
            SET status = ?, decision_reason = ?, reviewer_user_id = ?, updated_at = ?
            WHERE submission_id = ?
            """,
            (status, reason, actor_user_id, now, submission_id),
        )
        write_audit_event(
            connection,
            actor_user_id=actor_user_id,
            action=action,
            target_type="submission",
            target_id=submission_id,
            detail=detail,
            request_id=request_id,
        )
        updated = connection.execute(
            """
            SELECT s.*, u.username AS owner_username
            FROM submissions AS s
            JOIN users AS u ON u.user_id = s.owner_user_id
            WHERE s.submission_id = ?
            """,
            (submission_id,),
        ).fetchone()
        return _admin_response(connection, updated)


def _existing_public_work(settings: Settings, connection: sqlite3.Connection, work_id: str) -> bool:
    contributed = connection.execute(
        """
        SELECT 1 FROM submissions
        WHERE status = 'published' AND submission_type = 'new_work'
          AND published_work_id = ?
        """,
        (work_id,),
    ).fetchone()
    if contributed is not None:
        return True
    with connect_readonly(settings) as curated_connection:
        return (
            get_work(
                curated_connection,
                work_id,
                False,
                settings.facsimile_root,
            )
            is not None
        )


def _validate_publish(settings: Settings, connection: sqlite3.Connection, row: sqlite3.Row) -> str:
    file_count = connection.execute(
        "SELECT count(*) FROM submission_files WHERE submission_id = ?",
        (row["submission_id"],),
    ).fetchone()[0]
    if row["submission_type"] == "new_work":
        if row["existing_work_id"]:
            raise PublishValidationError("existing_work_id_not_allowed")
        if not row["title"].strip() and not row["poem_text"].strip():
            raise PublishValidationError("submission_content_required")
        return f"user-{row['submission_id']}"
    if any(
        str(row[field]).strip()
        for field in ("title", "authors", "poem_text", "genre", "historical_period")
    ):
        raise PublishValidationError("metadata_not_allowed")
    existing_work_id = row["existing_work_id"]
    if not existing_work_id:
        raise PublishValidationError("existing_work_id_required")
    if not _existing_public_work(settings, connection, existing_work_id):
        raise PublishValidationError("work_not_found")
    if file_count == 0:
        raise PublishValidationError("files_required")
    return str(existing_work_id)


def publish_admin_submission(
    settings: Settings,
    *,
    submission_id: str,
    actor_user_id: str,
    request_id: str,
) -> AdminSubmissionDetail:
    now = datetime.now(UTC).isoformat()
    with transaction(settings) as connection:
        row = _pending_admin_row(connection, submission_id)
        published_work_id = _validate_publish(settings, connection, row)
        connection.execute(
            """
            UPDATE submissions
            SET status = 'published', decision_reason = '', published_work_id = ?,
                reviewer_user_id = ?, updated_at = ?, published_at = ?
            WHERE submission_id = ?
            """,
            (published_work_id, actor_user_id, now, now, submission_id),
        )
        write_audit_event(
            connection,
            actor_user_id=actor_user_id,
            action="submission_published",
            target_type="submission",
            target_id=submission_id,
            detail=SubmissionPublishedAuditDetail(published_work_id=published_work_id),
            request_id=request_id,
        )
        updated = connection.execute(
            """
            SELECT s.*, u.username AS owner_username
            FROM submissions AS s
            JOIN users AS u ON u.user_id = s.owner_user_id
            WHERE s.submission_id = ?
            """,
            (submission_id,),
        ).fetchone()
        return _admin_response(connection, updated)
