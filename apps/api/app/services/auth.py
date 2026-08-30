import hashlib
import hmac
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Literal
from uuid import uuid4

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from argon2.low_level import Type

from app.app_db import connect_app_db, transaction
from app.core.config import Settings
from app.services.audit import (
    LoginFailedAuditDetail,
    LoginRateLimitedAuditDetail,
    LoginSucceededAuditDetail,
    LogoutAuditDetail,
    PasswordChangedAuditDetail,
    write_audit_event,
)

_PASSWORD_HASHER = PasswordHasher(type=Type.ID)
_DUMMY_PASSWORD_HASH = _PASSWORD_HASHER.hash("Dummy password that is never accepted 42")


@dataclass(frozen=True)
class Principal:
    user_id: str
    username: str
    role: Literal["contributor", "admin"]
    must_change_password: bool
    session_id: str
    csrf_token: str


class CurrentPasswordInvalidError(Exception):
    pass


def validate_password(password: str) -> None:
    if len(password) < 12 or len(password) > 256:
        raise ValueError("密码长度需为 12 至 256 个字符。")
    if password.isspace():
        raise ValueError("密码不能只包含空白字符。")


def hash_password(password: str) -> str:
    validate_password(password)
    return _PASSWORD_HASHER.hash(password)


def verify_password(encoded: str, password: str) -> bool:
    try:
        return _PASSWORD_HASHER.verify(encoded, password)
    except (InvalidHashError, VerificationError):
        return False


def create_session(settings: Settings, user_id: str) -> tuple[str, str]:
    with transaction(settings) as connection:
        _session_id, raw_token, raw_csrf = _insert_session(
            connection, settings=settings, user_id=user_id
        )
    return raw_token, raw_csrf


def create_session_with_audit(
    settings: Settings, *, user_id: str, request_id: str
) -> tuple[str, str]:
    with transaction(settings) as connection:
        _session_id, raw_token, raw_csrf = _insert_session(
            connection, settings=settings, user_id=user_id
        )
        write_audit_event(
            connection,
            actor_user_id=user_id,
            action="login_succeeded",
            target_type="user",
            target_id=user_id,
            detail=LoginSucceededAuditDetail(),
            request_id=request_id,
        )
    return raw_token, raw_csrf


def resolve_session(settings: Settings, raw_token: str) -> Principal | None:
    return _resolve_session(settings, raw_token, mutate=True)


def resolve_session_readonly(settings: Settings, raw_token: str) -> Principal | None:
    return _resolve_session(settings, raw_token, mutate=False)


def _resolve_session(settings: Settings, raw_token: str, *, mutate: bool) -> Principal | None:
    parsed = _parse_cookie_token(raw_token)
    if parsed is None:
        return None
    raw_session, raw_csrf = parsed
    now = datetime.now(UTC)
    connection_context = transaction(settings) if mutate else connect_app_db(settings)
    with connection_context as connection:
        row = connection.execute(
            """
            SELECT
                sessions.session_id, sessions.csrf_digest, sessions.expires_at,
                users.user_id, users.username, users.role, users.is_active,
                users.must_change_password
            FROM sessions
            JOIN users ON users.user_id = sessions.user_id
            WHERE sessions.token_digest = ?
            """,
            (_digest(raw_session),),
        ).fetchone()
        if row is None:
            return None
        if not hmac.compare_digest(row["csrf_digest"], _digest(raw_csrf)):
            return None
        if datetime.fromisoformat(row["expires_at"]) <= now:
            if mutate:
                connection.execute(
                    "DELETE FROM sessions WHERE session_id = ?", (row["session_id"],)
                )
            return None
        if not row["is_active"]:
            return None
        if mutate:
            connection.execute(
                "UPDATE sessions SET last_seen_at = ? WHERE session_id = ?",
                (now.isoformat(), row["session_id"]),
            )
    return Principal(
        user_id=row["user_id"],
        username=row["username"],
        role=row["role"],
        must_change_password=bool(row["must_change_password"]),
        session_id=row["session_id"],
        csrf_token=row["csrf_digest"],
    )


def revoke_session(settings: Settings, session_id: str) -> bool:
    with transaction(settings) as connection:
        result = connection.execute("DELETE FROM sessions WHERE session_id = ?", (session_id,))
    return result.rowcount > 0


def revoke_user_sessions(settings: Settings, user_id: str) -> int:
    with transaction(settings) as connection:
        result = connection.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
    return result.rowcount


def revoke_session_with_audit(settings: Settings, *, principal: Principal, request_id: str) -> bool:
    with transaction(settings) as connection:
        result = connection.execute(
            "DELETE FROM sessions WHERE session_id = ?", (principal.session_id,)
        )
        if result.rowcount:
            write_audit_event(
                connection,
                actor_user_id=principal.user_id,
                action="logout",
                target_type="user",
                target_id=principal.user_id,
                detail=LogoutAuditDetail(),
                request_id=request_id,
            )
    return result.rowcount > 0


def csrf_token_matches(principal: Principal, raw_csrf_token: str) -> bool:
    return hmac.compare_digest(principal.csrf_token, _digest(raw_csrf_token))


def verify_login_password(encoded: str | None, password: str) -> bool:
    candidate_hash = encoded if encoded is not None else _DUMMY_PASSWORD_HASH
    verified = verify_password(candidate_hash, password)
    return encoded is not None and verified


def record_login_failed(settings: Settings, *, target_user_id: str | None, request_id: str) -> None:
    with transaction(settings) as connection:
        write_audit_event(
            connection,
            actor_user_id=None,
            action="login_failed",
            target_type="user",
            target_id=target_user_id or "unknown",
            detail=LoginFailedAuditDetail(),
            request_id=request_id,
        )


def record_login_rate_limited(settings: Settings, *, request_id: str) -> None:
    with transaction(settings) as connection:
        write_audit_event(
            connection,
            actor_user_id=None,
            action="login_rate_limited",
            target_type="user",
            target_id="unknown",
            detail=LoginRateLimitedAuditDetail(),
            request_id=request_id,
        )


def recover_csrf_token(raw_cookie_token: str) -> str | None:
    parsed = _parse_cookie_token(raw_cookie_token)
    return parsed[1] if parsed is not None else None


def change_password_and_rotate_session(
    settings: Settings,
    *,
    principal: Principal,
    current_password: str,
    new_password: str,
    request_id: str,
) -> tuple[str, str]:
    new_password_hash = hash_password(new_password)
    now = datetime.now(UTC).isoformat()
    with transaction(settings) as connection:
        row = connection.execute(
            """
            SELECT users.password_hash
            FROM sessions
            JOIN users ON users.user_id = sessions.user_id
            WHERE sessions.session_id = ? AND users.user_id = ?
            """,
            (principal.session_id, principal.user_id),
        ).fetchone()
        if row is None or not verify_password(row["password_hash"], current_password):
            raise CurrentPasswordInvalidError
        new_session_id, raw_token, raw_csrf = _insert_session(
            connection, settings=settings, user_id=principal.user_id
        )
        connection.execute(
            """
            UPDATE users
            SET password_hash = ?, must_change_password = 0, updated_at = ?
            WHERE user_id = ?
            """,
            (new_password_hash, now, principal.user_id),
        )
        connection.execute(
            "DELETE FROM sessions WHERE user_id = ? AND session_id != ?",
            (principal.user_id, new_session_id),
        )
        write_audit_event(
            connection,
            actor_user_id=principal.user_id,
            action="password_changed",
            target_type="user",
            target_id=principal.user_id,
            detail=PasswordChangedAuditDetail(),
            request_id=request_id,
        )
    return raw_token, raw_csrf


def _insert_session(connection, *, settings: Settings, user_id: str) -> tuple[str, str, str]:
    session_id = uuid4().hex
    raw_session = secrets.token_urlsafe(32)
    raw_csrf = secrets.token_urlsafe(32)
    now = datetime.now(UTC)
    expires_at = now + timedelta(seconds=settings.session_ttl_seconds)
    connection.execute(
        """
        INSERT INTO sessions (
            session_id, user_id, token_digest, csrf_digest,
            created_at, expires_at, last_seen_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (
            session_id,
            user_id,
            _digest(raw_session),
            _digest(raw_csrf),
            now.isoformat(),
            expires_at.isoformat(),
            now.isoformat(),
        ),
    )
    return session_id, _encode_cookie_token(raw_session, raw_csrf), raw_csrf


def _encode_cookie_token(raw_session: str, raw_csrf: str) -> str:
    return f"v1.{raw_session}.{raw_csrf}"


def _parse_cookie_token(raw_cookie_token: str) -> tuple[str, str] | None:
    parts = raw_cookie_token.split(".")
    if len(parts) != 3 or parts[0] != "v1":
        return None
    if any(
        len(secret) != 43
        or not secret.isascii()
        or not all(character.isalnum() or character in "-_" for character in secret)
        for secret in parts[1:]
    ):
        return None
    return parts[1], parts[2]


def _digest(secret: str) -> str:
    return hashlib.sha256(secret.encode()).hexdigest()
