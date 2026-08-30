from pydantic import BaseModel

from app.schemas.works import Facsimile


class ContributionResponse(BaseModel):
    work_id: str
    created_work: bool
    facsimile: Facsimile | None = None
