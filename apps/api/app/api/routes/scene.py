from pathlib import Path

from fastapi import APIRouter, Request

from app.db import connect_readonly
from app.schemas.scene import SceneConfig, Season, SeasonWorksResponse
from app.services.seasons import get_season_works

router = APIRouter(tags=["scene"])
SCENE_CONFIG_PATH = Path(__file__).resolve().parents[2] / "content" / "scene_config.json"


@router.get("/scene/config", response_model=SceneConfig)
def read_scene_config() -> SceneConfig:
    return SceneConfig.model_validate_json(SCENE_CONFIG_PATH.read_text(encoding="utf-8"))


@router.get("/seasons/{season}/works", response_model=SeasonWorksResponse)
def read_season_works(request: Request, season: Season) -> SeasonWorksResponse:
    with connect_readonly(request.app.state.settings) as connection:
        works = get_season_works(connection, season)
    return SeasonWorksResponse(
        season=season,
        items=[work for work in works if work.is_primary and work.review_status == "reviewed"],
        related_items=[
            work for work in works if not (work.is_primary and work.review_status == "reviewed")
        ],
    )
