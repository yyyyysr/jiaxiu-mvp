import json
import re
import sqlite3
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Literal
from uuid import uuid4

from app.app_db import connect_app_db
from app.core.config import Settings

_PUBLIC_REQUEST_REF_V1 = re.compile(r"(?:[0-9a-f]{32}|cli-[0-9a-f]{32}|repository-[0-9a-f]{32})")


@dataclass(frozen=True)
class AccountCreatedAuditDetail:
    """The complete allowlisted detail shape for an account-created event."""

    role: Literal["contributor", "admin"]

    def __post_init__(self) -> None:
        if self.role not in {"contributor", "admin"}:
            raise ValueError("审计账户角色无效。")


@dataclass(frozen=True)
class AccountStatusAuditDetail:
    is_active: bool


@dataclass(frozen=True)
class PasswordChangedAuditDetail:
    pass


@dataclass(frozen=True)
class PasswordResetAuditDetail:
    pass


@dataclass(frozen=True)
class LoginSucceededAuditDetail:
    pass


@dataclass(frozen=True)
class LoginFailedAuditDetail:
    pass


@dataclass(frozen=True)
class LoginRateLimitedAuditDetail:
    pass


@dataclass(frozen=True)
class LogoutAuditDetail:
    pass


@dataclass(frozen=True)
class SubmissionResubmittedAuditDetail:
    pass


@dataclass(frozen=True)
class SubmissionEditedAuditDetail:
    changed_fields: tuple[str, ...]
    removed_file_ids: tuple[str, ...]


@dataclass(frozen=True)
class RevisionRequestedAuditDetail:
    pass


@dataclass(frozen=True)
class SubmissionRejectedAuditDetail:
    pass


@dataclass(frozen=True)
class SubmissionPublishedAuditDetail:
    published_work_id: str


@dataclass(frozen=True)
class StoredAuditEvent:
    event_id: str
    actor_username: str | None
    action: str
    target_type: str
    target_id: str
    detail_json: str
    public_request_ref_v1: str | None
    created_at: str
    user_target_exists: bool
    submission_target_exists: bool


AuditDetail = (
    AccountCreatedAuditDetail
    | AccountStatusAuditDetail
    | PasswordChangedAuditDetail
    | PasswordResetAuditDetail
    | LoginSucceededAuditDetail
    | LoginFailedAuditDetail
    | LoginRateLimitedAuditDetail
    | LogoutAuditDetail
    | SubmissionResubmittedAuditDetail
    | SubmissionEditedAuditDetail
    | RevisionRequestedAuditDetail
    | SubmissionRejectedAuditDetail
    | SubmissionPublishedAuditDetail
)


def read_audit_event_page(
    settings: Settings, *, page: int, page_size: int
) -> tuple[list[StoredAuditEvent], int]:
    with connect_app_db(settings) as connection:
        connection.execute("BEGIN")
        total = connection.execute("SELECT count(*) FROM audit_events").fetchone()[0]
        rows = connection.execute(
            """
            SELECT e.event_id, u.username AS actor_username, e.action,
                   e.target_type, e.target_id, e.detail_json,
                   e.public_request_ref_v1, e.created_at,
                   EXISTS (
                     SELECT 1 FROM users AS target_user
                     WHERE target_user.user_id = e.target_id
                   ) AS user_target_exists,
                   EXISTS (
                     SELECT 1 FROM submissions AS target_submission
                     WHERE target_submission.submission_id = e.target_id
                   ) AS submission_target_exists
            FROM audit_events AS e
            LEFT JOIN users AS u ON u.user_id = e.actor_user_id
            ORDER BY e.created_at DESC, e.event_id DESC
            LIMIT ? OFFSET ?
            """,
            (page_size, (page - 1) * page_size),
        ).fetchall()
    events: list[StoredAuditEvent] = []
    for row in rows:
        payload = dict(row)
        payload["user_target_exists"] = bool(payload["user_target_exists"])
        payload["submission_target_exists"] = bool(payload["submission_target_exists"])
        events.append(StoredAuditEvent(**payload))
    return events, total


def write_audit_event(
    connection: sqlite3.Connection,
    *,
    actor_user_id: str | None,
    action: str,
    target_type: str,
    target_id: str,
    detail: AuditDetail,
    request_id: str,
) -> str:
    detail_json = _serialize_detail(detail)
    event_id = uuid4().hex
    public_request_ref = (
        request_id if _PUBLIC_REQUEST_REF_V1.fullmatch(request_id) is not None else None
    )
    connection.execute(
        """
        INSERT INTO audit_events (
            event_id, actor_user_id, action, target_type, target_id,
            detail_json, request_id, public_request_ref_v1, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            event_id,
            actor_user_id,
            action,
            target_type,
            target_id,
            detail_json,
            request_id,
            public_request_ref,
            datetime.now(UTC).isoformat(),
        ),
    )
    return event_id


def _serialize_detail(detail: AuditDetail) -> str:
    if type(detail) is AccountCreatedAuditDetail:
        safe_detail = {"role": detail.role}
    elif type(detail) is AccountStatusAuditDetail:
        safe_detail = {"is_active": detail.is_active}
    elif type(detail) in {
        PasswordChangedAuditDetail,
        PasswordResetAuditDetail,
        LoginSucceededAuditDetail,
        LoginFailedAuditDetail,
        LoginRateLimitedAuditDetail,
        LogoutAuditDetail,
        SubmissionResubmittedAuditDetail,
        RevisionRequestedAuditDetail,
        SubmissionRejectedAuditDetail,
    }:
        safe_detail = {}
    elif type(detail) is SubmissionEditedAuditDetail:
        safe_detail = {
            "changed_fields": list(detail.changed_fields),
            "removed_file_ids": list(detail.removed_file_ids),
        }
    elif type(detail) is SubmissionPublishedAuditDetail:
        safe_detail = {"published_work_id": detail.published_work_id}
    else:
        raise TypeError("审计详情必须使用已审核的数据类型。")
    return json.dumps(
        safe_detail,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    )
