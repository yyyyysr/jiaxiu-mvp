import sqlite3
import unicodedata
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Literal
from uuid import uuid4

from app.app_db import connect_app_db, transaction
from app.core.config import Settings
from app.services.audit import (
    AccountCreatedAuditDetail,
    AccountStatusAuditDetail,
    PasswordResetAuditDetail,
    write_audit_event,
)
from app.services.auth import hash_password

Role = Literal["contributor", "admin"]


@dataclass(frozen=True)
class UserRecord:
    user_id: str
    username: str
    role: Role
    is_active: bool
    must_change_password: bool


@dataclass(frozen=True)
class UserCredentials:
    user: UserRecord
    password_hash: str


class UserNotFoundError(Exception):
    pass


class LastAdminRequiredError(Exception):
    pass


class SelfDisableForbiddenError(Exception):
    pass


def normalize_username(username: str) -> str:
    return unicodedata.normalize("NFKC", username).casefold()


def create_user(
    settings: Settings,
    *,
    username: str,
    password: str,
    role: Role,
    must_change_password: bool = True,
    actor_user_id: str | None = None,
    request_id: str | None = None,
    audit_action: Literal["user.created", "user_created"] = "user.created",
) -> UserRecord:
    normalized = normalize_username(username)
    if not normalized:
        raise ValueError("用户名不能为空。")
    password_hash = hash_password(password)
    user_id = uuid4().hex
    now = datetime.now(UTC).isoformat()
    try:
        with transaction(settings) as connection:
            connection.execute(
                """
                INSERT INTO users (
                    user_id, username, username_normalized, password_hash, role,
                    is_active, must_change_password, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)
                """,
                (
                    user_id,
                    username,
                    normalized,
                    password_hash,
                    role,
                    int(must_change_password),
                    now,
                    now,
                ),
            )
            write_audit_event(
                connection,
                actor_user_id=actor_user_id,
                action=audit_action,
                target_type="user",
                target_id=user_id,
                detail=AccountCreatedAuditDetail(role=role),
                request_id=request_id or f"repository-{uuid4().hex}",
            )
    except sqlite3.IntegrityError as exc:
        if "users.username_normalized" in str(exc):
            raise ValueError("用户名已存在。") from exc
        raise
    return UserRecord(
        user_id=user_id,
        username=username,
        role=role,
        is_active=True,
        must_change_password=must_change_password,
    )


def get_user_by_id(settings: Settings, user_id: str) -> UserRecord | None:
    with connect_app_db(settings) as connection:
        row = connection.execute(
            """
            SELECT user_id, username, role, is_active, must_change_password
            FROM users WHERE user_id = ?
            """,
            (user_id,),
        ).fetchone()
    return _user_from_row(row) if row is not None else None


def get_user_credentials(settings: Settings, normalized_username: str) -> UserCredentials | None:
    with connect_app_db(settings) as connection:
        row = connection.execute(
            """
            SELECT user_id, username, password_hash, role, is_active,
                   must_change_password
            FROM users WHERE username_normalized = ?
            """,
            (normalized_username,),
        ).fetchone()
    if row is None:
        return None
    return UserCredentials(user=_user_from_row(row), password_hash=row["password_hash"])


def list_users(settings: Settings) -> list[UserRecord]:
    with connect_app_db(settings) as connection:
        rows = connection.execute(
            """
            SELECT user_id, username, role, is_active, must_change_password
            FROM users ORDER BY username_normalized, user_id
            """
        ).fetchall()
    return [_user_from_row(row) for row in rows]


def set_user_active(
    settings: Settings,
    *,
    user_id: str,
    is_active: bool,
    actor_user_id: str,
    request_id: str,
) -> UserRecord:
    now = datetime.now(UTC).isoformat()
    with transaction(settings) as connection:
        row = connection.execute(
            """
            SELECT user_id, username, role, is_active, must_change_password
            FROM users WHERE user_id = ?
            """,
            (user_id,),
        ).fetchone()
        if row is None:
            raise UserNotFoundError
        current = _user_from_row(row)
        if current.is_active == is_active:
            return current
        if not is_active:
            if current.role == "admin":
                active_admins = connection.execute(
                    "SELECT COUNT(*) FROM users WHERE role = 'admin' AND is_active = 1"
                ).fetchone()[0]
                if active_admins <= 1:
                    raise LastAdminRequiredError
            if user_id == actor_user_id:
                raise SelfDisableForbiddenError
        connection.execute(
            "UPDATE users SET is_active = ?, updated_at = ? WHERE user_id = ?",
            (int(is_active), now, user_id),
        )
        if not is_active:
            connection.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
        write_audit_event(
            connection,
            actor_user_id=actor_user_id,
            action="user_enabled" if is_active else "user_disabled",
            target_type="user",
            target_id=user_id,
            detail=AccountStatusAuditDetail(is_active=is_active),
            request_id=request_id,
        )
    return UserRecord(
        user_id=current.user_id,
        username=current.username,
        role=current.role,
        is_active=is_active,
        must_change_password=current.must_change_password,
    )


def reset_user_password(
    settings: Settings,
    *,
    user_id: str,
    temporary_password: str,
    actor_user_id: str,
    request_id: str,
) -> UserRecord:
    password_hash = hash_password(temporary_password)
    now = datetime.now(UTC).isoformat()
    with transaction(settings) as connection:
        row = connection.execute(
            """
            SELECT user_id, username, role, is_active, must_change_password
            FROM users WHERE user_id = ?
            """,
            (user_id,),
        ).fetchone()
        if row is None:
            raise UserNotFoundError
        current = _user_from_row(row)
        connection.execute(
            """
            UPDATE users
            SET password_hash = ?, must_change_password = 1, updated_at = ?
            WHERE user_id = ?
            """,
            (password_hash, now, user_id),
        )
        connection.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
        write_audit_event(
            connection,
            actor_user_id=actor_user_id,
            action="password_reset",
            target_type="user",
            target_id=user_id,
            detail=PasswordResetAuditDetail(),
            request_id=request_id,
        )
    return UserRecord(
        user_id=current.user_id,
        username=current.username,
        role=current.role,
        is_active=current.is_active,
        must_change_password=True,
    )


def disable_user(settings: Settings, user_id: str) -> bool:
    now = datetime.now(UTC).isoformat()
    with transaction(settings) as connection:
        result = connection.execute(
            "UPDATE users SET is_active = 0, updated_at = ? WHERE user_id = ?",
            (now, user_id),
        )
    return result.rowcount > 0


def _user_from_row(row: sqlite3.Row) -> UserRecord:
    return UserRecord(
        user_id=row["user_id"],
        username=row["username"],
        role=row["role"],
        is_active=bool(row["is_active"]),
        must_change_password=bool(row["must_change_password"]),
    )
