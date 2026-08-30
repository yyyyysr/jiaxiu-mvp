import sqlite3
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict

from app.repositories.works import get_work_summary
from app.schemas.scene import Season, SeasonAnnotation, SeasonWork

ANNOTATION_PATH = Path(__file__).resolve().parents[1] / "content" / "season_annotations.json"
_SEASONS: tuple[Season, ...] = ("spring", "summer", "autumn", "winter")


class _AnnotationFile(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version: Literal[1]
    annotations: list[SeasonAnnotation]


def load_annotations(path: Path) -> dict[Season, list[SeasonAnnotation]]:
    payload = _AnnotationFile.model_validate_json(path.read_text(encoding="utf-8"))
    grouped: dict[Season, list[SeasonAnnotation]] = {season: [] for season in _SEASONS}
    seen: set[tuple[str, Season, bool]] = set()
    for annotation in payload.annotations:
        key = (annotation.work_id, annotation.season, annotation.is_primary)
        if key in seen:
            raise ValueError(f"Duplicate season annotation: {key}")
        if annotation.is_primary and annotation.review_status != "reviewed":
            raise ValueError("Primary season annotations must be reviewed")
        seen.add(key)
        grouped[annotation.season].append(annotation)
    return grouped


def get_season_works(
    connection: sqlite3.Connection, season: Season, path: Path = ANNOTATION_PATH
) -> list[SeasonWork]:
    works = []
    for annotation in load_annotations(path)[season]:
        summary = get_work_summary(connection, annotation.work_id)
        if summary is None:
            raise ValueError(f"Season annotation references unknown work: {annotation.work_id}")
        works.append(SeasonWork(**summary.model_dump(), **annotation.model_dump(exclude={"work_id"})))
    return works
