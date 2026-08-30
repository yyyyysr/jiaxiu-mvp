import sqlite3
from typing import Any

from fastapi import APIRouter, Request

from app.core.config import Settings
from app.core.errors import DatabaseUnavailableError
from app.db import connect_readonly

router = APIRouter()
_EXPECTED_SCHEMA_VERSION = "1.1.0"
_REQUIRED_OBJECTS = {
    "metadata": "table",
    "works": "table",
    "works_fts": "table",
    "v_works_full": "view",
}


def validate_database(settings: Settings) -> str:
    try:
        with connect_readonly(settings) as connection:
            objects = {
                row["name"]: row["type"]
                for row in connection.execute(
                    "SELECT name, type FROM sqlite_master WHERE name IN (?, ?, ?, ?)",
                    tuple(_REQUIRED_OBJECTS),
                )
            }
            schema_row = connection.execute(
                "SELECT value FROM metadata WHERE key = ?", ("schema_version",)
            ).fetchone()
    except sqlite3.Error as error:
        raise DatabaseUnavailableError from error
    if objects != _REQUIRED_OBJECTS or schema_row is None:
        raise DatabaseUnavailableError
    if schema_row["value"] != _EXPECTED_SCHEMA_VERSION:
        raise DatabaseUnavailableError
    return schema_row["value"]


@router.get("/health")
def health(request: Request) -> dict[str, Any]:
    settings: Settings = request.app.state.settings
    try:
        schema_version = validate_database(settings)
    except DatabaseUnavailableError:
        request.app.state.database_ready = False
        raise
    request.app.state.database_ready = True

    return {
        "status": "ok",
        "database": "ready",
        "schema_version": schema_version,
        "fts5": True,
    }
