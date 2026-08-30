from typing import Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.schemas.works import WorkSummary

Season = Literal["spring", "summer", "autumn", "winter"]
EvidenceType = Literal["explicit_title", "explicit_date", "explicit_text"]
ReviewStatus = Literal["reviewed", "candidate"]


class SeasonAnnotation(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    work_id: str
    season: Season
    is_primary: bool
    evidence_type: EvidenceType
    evidence_quote: str = Field(min_length=1)
    review_status: ReviewStatus


class SeasonWork(WorkSummary):
    season: Season
    is_primary: bool
    evidence_type: EvidenceType
    evidence_quote: str
    review_status: ReviewStatus


class SeasonWorksResponse(BaseModel):
    season: Season
    items: list[SeasonWork]
    related_items: list[SeasonWork]


class SceneSeason(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    id: Season
    label: str
    sky: str
    fog: str
    foliage: str
    water: str
    particles: Literal["rain", "mist", "leaves", "snow"]
    ambience: str


class SceneConfig(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    version: Literal[1]
    seasons: list[SceneSeason]

    @model_validator(mode="after")
    def exact_season_whitelist(self) -> Self:
        season_ids = [season.id for season in self.seasons]
        if season_ids != ["spring", "summer", "autumn", "winter"]:
            raise ValueError("Scene config must declare each season exactly once in canonical order")
        return self
