import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager

from app.core.config import Settings
from app.migrations.app_schema import migrate_schema


@contextmanager
def connect_app_db(settings: Settings) -> Iterator[sqlite3.Connection]:
    settings.app_database_path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(settings.app_database_path, check_same_thread=False)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA journal_mode = WAL")
    connection.execute("PRAGMA busy_timeout = 5000")
    try:
        yield connection
    finally:
        connection.close()


@contextmanager
def transaction(settings: Settings) -> Iterator[sqlite3.Connection]:
    with connect_app_db(settings) as connection:
        connection.execute("BEGIN IMMEDIATE")
        try:
            yield connection
        except BaseException:
            connection.rollback()
            raise
        else:
            connection.commit()


def migrate_app_db(settings: Settings) -> None:
    with transaction(settings) as connection:
        migrate_schema(connection)
