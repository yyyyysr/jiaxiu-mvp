import hashlib
import sqlite3
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Literal
from uuid import uuid4

from app.app_db import connect_app_db, transaction
from app.core.config import Settings

Role = Literal["user", "assistant"]

# A thread long enough to argue a reading through, short enough that the prompt window and the
# database both stay bounded no matter how long a reader stays.
MAX_STORED_MESSAGES = 40
MAX_CONTENT_LENGTH = 4_000
MAX_RESPONSE_JSON_LENGTH = 16_000
GUEST_RETENTION = timedelta(days=7)
ACCOUNT_RETENTION = timedelta(days=180)


@dataclass(frozen=True)
class StoredMessage:
    role: Role
    content: str
    response_json: str
    created_at: str


class ConversationKeyError(ValueError):
    pass


def guest_digest(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def load_messages(
    settings: Settings,
    *,
    user_id: str | None = None,
    digest: str | None = None,
) -> list[StoredMessage]:
    _validate_key(user_id=user_id, digest=digest)
    now = datetime.now(UTC).isoformat()
    with connect_app_db(settings) as connection:
        row = _find_conversation(connection, user_id=user_id, digest=digest, now=now)
        if row is None:
            return []
        rows = connection.execute(
            """
            SELECT role, content, response_json, created_at
            FROM guide_messages
            WHERE conversation_id = ?
            ORDER BY message_sequence DESC
            LIMIT ?
            """,
            (row["conversation_id"], MAX_STORED_MESSAGES),
        ).fetchall()
    rows.reverse()
    return [
        StoredMessage(
            role=entry["role"],
            content=entry["content"],
            response_json=entry["response_json"],
            created_at=entry["created_at"],
        )
        for entry in rows
    ]


def append_exchange(
    settings: Settings,
    *,
    user_id: str | None = None,
    digest: str | None = None,
    question: str,
    answer: str,
    response_json: str,
) -> None:
    """Record one question/answer pair, creating the thread on first use.

    Persistence is best effort from the caller's perspective: a reader who has just been answered
    should never see an error only because the transcript could not be filed.
    """
    _validate_key(user_id=user_id, digest=digest)
    question = question.strip()[:MAX_CONTENT_LENGTH]
    answer = answer.strip()[:MAX_CONTENT_LENGTH]
    if not question or not answer:
        return
    if len(response_json) > MAX_RESPONSE_JSON_LENGTH:
        response_json = ""
    now_at = datetime.now(UTC)
    now = now_at.isoformat()
    retention = ACCOUNT_RETENTION if user_id is not None else GUEST_RETENTION
    expires_at = (now_at + retention).isoformat()
    with transaction(settings) as connection:
        _delete_expired(connection, now=now)
        row = _find_conversation(connection, user_id=user_id, digest=digest, now=now)
        if row is None:
            conversation_id = uuid4().hex
            connection.execute(
                """
                INSERT INTO guide_conversations (
                    conversation_id, user_id, guest_digest, created_at, updated_at, expires_at
                ) VALUES (?, ?, ?, ?, ?, ?)
                """,
                (conversation_id, user_id, digest, now, now, expires_at),
            )
        else:
            conversation_id = row["conversation_id"]
            connection.execute(
                "UPDATE guide_conversations SET updated_at = ?, expires_at = ? WHERE conversation_id = ?",
                (now, expires_at, conversation_id),
            )
        connection.executemany(
            """
            INSERT INTO guide_messages (conversation_id, role, content, response_json, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                (conversation_id, "user", question, "", now),
                (conversation_id, "assistant", answer, response_json, now),
            ),
        )
        _trim_thread(connection, conversation_id=conversation_id)


def clear_conversation(
    settings: Settings,
    *,
    user_id: str | None = None,
    digest: str | None = None,
) -> None:
    _validate_key(user_id=user_id, digest=digest)
    now = datetime.now(UTC).isoformat()
    with transaction(settings) as connection:
        _delete_expired(connection, now=now)
        if user_id is not None:
            connection.execute("DELETE FROM guide_conversations WHERE user_id = ?", (user_id,))
        else:
            connection.execute("DELETE FROM guide_conversations WHERE guest_digest = ?", (digest,))


def _validate_key(*, user_id: str | None, digest: str | None) -> None:
    if (user_id is None) == (digest is None):
        raise ConversationKeyError("A guide thread belongs to exactly one account or one guest cookie")


def _find_conversation(
    connection: sqlite3.Connection,
    *,
    user_id: str | None,
    digest: str | None,
    now: str,
) -> sqlite3.Row | None:
    if user_id is not None:
        return connection.execute(
            "SELECT conversation_id FROM guide_conversations WHERE user_id = ? AND expires_at > ?",
            (user_id, now),
        ).fetchone()
    return connection.execute(
        "SELECT conversation_id FROM guide_conversations WHERE guest_digest = ? AND expires_at > ?",
        (digest, now),
    ).fetchone()


def _delete_expired(connection: sqlite3.Connection, *, now: str) -> None:
    connection.execute("DELETE FROM guide_conversations WHERE expires_at <= ?", (now,))


def _trim_thread(connection: sqlite3.Connection, *, conversation_id: str) -> None:
    connection.execute(
        """
        DELETE FROM guide_messages
        WHERE conversation_id = ?
          AND message_sequence <= COALESCE(
            (
              SELECT message_sequence FROM guide_messages
              WHERE conversation_id = ?
              ORDER BY message_sequence DESC
              LIMIT 1 OFFSET ?
            ),
            -1
          )
        """,
        (conversation_id, conversation_id, MAX_STORED_MESSAGES),
    )
