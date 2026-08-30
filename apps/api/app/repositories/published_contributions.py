from __future__ import annotations

import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager, suppress
from dataclasses import dataclass

from app.app_db import connect_app_db
from app.core.config import Settings
from app.services.submission_files import OpenedStagedFile, open_staged_file


@dataclass(frozen=True)
class PublishedWork:
    submission_id: str
    work_id: str
    title: str
    authors: str
    canonical_text: str
    genre: str
    historical_period: str
    notes: str
    submitted_at: str
    published_at: str
    facsimile_count: int


@dataclass(frozen=True)
class PublishedFacsimile:
    submission_id: str
    file_id: str
    image_id: str
    storage_name: str
    original_name: str
    file_format: str
    media_type: str
    file_bytes: int
    pixel_width: int
    pixel_height: int
    sha256: str
    sequence: int
    notes: str
    deployed: bool


@dataclass(frozen=True)
class PublishedFile:
    record: PublishedFacsimile
    opened: OpenedStagedFile


@dataclass(frozen=True)
class PublishedFacsimileListing:
    records: tuple[PublishedFacsimile, ...]
    claimed_image_ids: frozenset[str]
    target_authorized: bool


@dataclass(frozen=True)
class PublishedFileResolution:
    matched: bool
    file: PublishedFile | None
    target_authorized: bool


_WORK_COLUMNS = """
    s.submission_id, 'user-' || s.submission_id AS work_id,
    s.title, s.authors, s.poem_text AS canonical_text, s.genre,
    s.historical_period, s.notes, s.submitted_at, s.published_at,
    (
        SELECT count(*)
        FROM submissions AS attached
        JOIN submission_files AS attached_file
          ON attached_file.submission_id = attached.submission_id
        WHERE attached.status = 'published'
          AND attached.published_work_id = 'user-' || s.submission_id
          AND (
              attached.submission_type = 'existing_work_scan'
              OR (
                  attached.submission_type = 'new_work'
                  AND attached.published_work_id = 'user-' || attached.submission_id
              )
          )
    ) AS facsimile_count
"""

_FACSIMILE_COLUMNS = """
    s.submission_id, f.file_id, 'user-' || f.file_id AS image_id,
    f.storage_name, f.original_name, f.file_format, f.media_type,
    f.file_bytes, f.pixel_width, f.pixel_height, f.sha256, f.sequence,
    s.notes
"""

_PUBLISHED_FACSIMILE_SOURCE = """
    s.status = 'published'
    AND s.published_work_id = ?
    AND (
        (
            s.submission_type = 'new_work'
            AND s.published_work_id = 'user-' || s.submission_id
        )
        OR (
            s.submission_type = 'existing_work_scan'
            AND (
                NOT EXISTS (
                    SELECT 1
                    FROM submissions AS target_identity
                    WHERE target_identity.submission_type = 'new_work'
                      AND 'user-' || target_identity.submission_id = s.published_work_id
                )
                OR EXISTS (
                    SELECT 1
                    FROM submissions AS target_published
                    WHERE target_published.status = 'published'
                      AND target_published.submission_type = 'new_work'
                      AND target_published.published_work_id =
                          'user-' || target_published.submission_id
                      AND target_published.published_work_id = s.published_work_id
                )
            )
        )
    )
"""


def _work_from_row(row) -> PublishedWork:
    payload = dict(row)
    payload["published_at"] = payload["published_at"] or ""
    return PublishedWork(**payload)


def _facsimile_from_row(row, *, deployed: bool) -> PublishedFacsimile:
    return PublishedFacsimile(**dict(row), deployed=deployed)


@contextmanager
def _read_snapshot(settings: Settings) -> Iterator[sqlite3.Connection]:
    """Hold a deferred read snapshot only through selection and file validation."""
    with connect_app_db(settings) as connection:
        connection.execute("BEGIN")
        try:
            yield connection
        finally:
            connection.rollback()


def _facsimile_rows(
    connection: sqlite3.Connection,
    work_id: str,
    image_id: str | None = None,
) -> list[sqlite3.Row]:
    parameters: list[object] = [work_id]
    image_clause = ""
    if image_id is not None:
        if not image_id.startswith("user-"):
            return []
        image_clause = "AND f.file_id = ?"
        parameters.append(image_id.removeprefix("user-"))
    return connection.execute(
        f"""
        SELECT {_FACSIMILE_COLUMNS}
        FROM submissions AS s
        JOIN submission_files AS f ON f.submission_id = s.submission_id
        WHERE {_PUBLISHED_FACSIMILE_SOURCE}
          {image_clause}
        ORDER BY f.sequence, f.file_id
        """,
        parameters,
    ).fetchall()


def _facsimile_identity(record: PublishedFacsimile) -> tuple[object, ...]:
    return (
        record.submission_id,
        record.file_id,
        record.image_id,
        record.storage_name,
        record.original_name,
        record.file_format,
        record.media_type,
        record.file_bytes,
        record.pixel_width,
        record.pixel_height,
        record.sha256,
        record.sequence,
        record.notes,
    )


def _application_target_is_published(connection: sqlite3.Connection, work_id: str) -> bool:
    return (
        connection.execute(
            """
            SELECT 1
            FROM submissions AS target
            WHERE target.status = 'published'
              AND target.submission_type = 'new_work'
              AND target.published_work_id = 'user-' || target.submission_id
              AND target.published_work_id = ?
            """,
            (work_id,),
        ).fetchone()
        is not None
    )


def list_published_works(settings: Settings) -> list[PublishedWork]:
    with connect_app_db(settings) as connection:
        rows = connection.execute(
            f"""
            SELECT {_WORK_COLUMNS}
            FROM submissions AS s
            WHERE s.status = 'published'
              AND s.submission_type = 'new_work'
              AND s.published_work_id = 'user-' || s.submission_id
            ORDER BY s.submitted_at, s.submission_id
            """
        ).fetchall()
    return [_work_from_row(row) for row in rows]


def get_published_work(settings: Settings, work_id: str) -> PublishedWork | None:
    with connect_app_db(settings) as connection:
        row = connection.execute(
            f"""
            SELECT {_WORK_COLUMNS}
            FROM submissions AS s
            WHERE s.status = 'published'
              AND s.submission_type = 'new_work'
              AND s.published_work_id = 'user-' || s.submission_id
              AND 'user-' || s.submission_id = ?
            """,
            (work_id,),
        ).fetchone()
    return _work_from_row(row) if row is not None else None


def resolve_published_facsimiles(
    settings: Settings,
    work_id: str,
    *,
    require_application_target: bool = False,
) -> PublishedFacsimileListing:
    validated: list[PublishedFacsimile] = []
    with _read_snapshot(settings) as connection:
        target_authorized = not require_application_target or _application_target_is_published(
            connection, work_id
        )
        if not target_authorized:
            return PublishedFacsimileListing(
                records=(),
                claimed_image_ids=frozenset(),
                target_authorized=False,
            )
        rows = _facsimile_rows(connection, work_id)
        claimed_image_ids = frozenset(row["image_id"] for row in rows)
        for row in rows:
            candidate = _facsimile_from_row(row, deployed=False)
            opened = open_staged_file(settings, candidate.submission_id, candidate)
            deployed = opened is not None
            if opened is not None:
                opened.file.close()
            validated.append(_facsimile_from_row(row, deployed=deployed))

    with _read_snapshot(settings) as connection:
        target_authorized = not require_application_target or _application_target_is_published(
            connection, work_id
        )
        current = (
            {
                _facsimile_identity(_facsimile_from_row(row, deployed=False))
                for row in _facsimile_rows(connection, work_id)
            }
            if target_authorized
            else set()
        )
    records = tuple(record for record in validated if _facsimile_identity(record) in current)
    return PublishedFacsimileListing(
        records=records,
        claimed_image_ids=claimed_image_ids,
        target_authorized=target_authorized,
    )


def list_published_facsimiles(settings: Settings, work_id: str) -> list[PublishedFacsimile]:
    return list(resolve_published_facsimiles(settings, work_id).records)


def list_published_facsimile_ids(settings: Settings) -> dict[str, set[str]]:
    with connect_app_db(settings) as connection:
        rows = connection.execute(
            """
            SELECT s.published_work_id AS work_id, 'user-' || f.file_id AS image_id
            FROM submissions AS s
            JOIN submission_files AS f ON f.submission_id = s.submission_id
            WHERE s.status = 'published' AND s.published_work_id IS NOT NULL
              AND (
                  (
                      s.submission_type = 'new_work'
                      AND s.published_work_id = 'user-' || s.submission_id
                  )
                  OR (
                      s.submission_type = 'existing_work_scan'
                      AND (
                          NOT EXISTS (
                              SELECT 1 FROM submissions AS target_identity
                              WHERE target_identity.submission_type = 'new_work'
                                AND 'user-' || target_identity.submission_id =
                                    s.published_work_id
                          )
                          OR EXISTS (
                              SELECT 1 FROM submissions AS target_published
                              WHERE target_published.status = 'published'
                                AND target_published.submission_type = 'new_work'
                                AND target_published.published_work_id =
                                    'user-' || target_published.submission_id
                                AND target_published.published_work_id = s.published_work_id
                          )
                      )
                  )
              )
            ORDER BY s.published_work_id, f.sequence, f.file_id
            """
        ).fetchall()
    result: dict[str, set[str]] = {}
    for row in rows:
        result.setdefault(row["work_id"], set()).add(row["image_id"])
    return result


def resolve_published_file(
    settings: Settings,
    work_id: str,
    image_id: str,
    *,
    require_application_target: bool = False,
) -> PublishedFileResolution:
    opened: OpenedStagedFile | None = None
    try:
        with _read_snapshot(settings) as connection:
            target_authorized = not require_application_target or _application_target_is_published(
                connection, work_id
            )
            if not target_authorized:
                return PublishedFileResolution(
                    matched=False,
                    file=None,
                    target_authorized=False,
                )
            rows = _facsimile_rows(connection, work_id, image_id)
            if len(rows) != 1:
                matched = bool(rows)
                record = None
            else:
                record = _facsimile_from_row(rows[0], deployed=False)
                opened = open_staged_file(settings, record.submission_id, record)

        with _read_snapshot(settings) as connection:
            target_authorized = not require_application_target or _application_target_is_published(
                connection, work_id
            )
            current_rows = _facsimile_rows(connection, work_id, image_id)

        if not target_authorized:
            resolution = PublishedFileResolution(
                matched=matched if record is None else True,
                file=None,
                target_authorized=False,
            )
        elif record is None:
            resolution = PublishedFileResolution(
                matched=matched,
                file=None,
                target_authorized=True,
            )
        elif (
            opened is None
            or len(current_rows) != 1
            or _facsimile_identity(_facsimile_from_row(current_rows[0], deployed=False))
            != _facsimile_identity(record)
        ):
            resolution = PublishedFileResolution(
                matched=True,
                file=None,
                target_authorized=True,
            )
        else:
            resolution = PublishedFileResolution(
                matched=True,
                target_authorized=True,
                file=PublishedFile(
                    record=PublishedFacsimile(**{**record.__dict__, "deployed": True}),
                    opened=opened,
                ),
            )

        if resolution.file is None and opened is not None:
            owned, opened = opened, None
            owned.file.close()
        elif resolution.file is not None:
            opened = None
        return resolution
    except BaseException:
        if opened is not None:
            owned, opened = opened, None
            with suppress(BaseException):
                owned.file.close()
        raise


def get_published_file(settings: Settings, work_id: str, image_id: str) -> PublishedFile | None:
    return resolve_published_file(settings, work_id, image_id).file
