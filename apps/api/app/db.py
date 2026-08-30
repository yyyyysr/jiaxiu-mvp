import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager

from app.core.config import Settings


@contextmanager
def connect_readonly(settings: Settings) -> Iterator[sqlite3.Connection]:
    uri = f"file:{settings.database_path.as_posix()}?mode=ro&immutable=1"
    connection = sqlite3.connect(uri, uri=True, check_same_thread=False)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA query_only = ON")
    try:
        yield connection
    finally:
        connection.close()
