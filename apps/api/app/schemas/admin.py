from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.schemas.submissions import SubmissionStatus, SubmissionType


class AdminSubmissionFile(BaseModel):
    file_id: str
    original_name: str
    file_format: Literal["jpg", "png"]
    media_type: Literal["image/jpeg", "image/png"]
    file_bytes: int
    pixel_width: int
    pixel_height: int
    sha256: str
    sequence: int
    public_url: None = None
    preview_url: str


class SubmissionRevisionResponse(BaseModel):
    revision_id: str
    action: str
    actor_username: str
    snapshot: dict[str, object]
    created_at: datetime


class AdminSubmissionSummary(BaseModel):
    submission_id: str
    submission_type: SubmissionType
    status: SubmissionStatus
    owner_username: str
    title: str
    submitted_at: datetime
    updated_at: datetime
    file_count: int


class AdminSubmissionQueueResponse(BaseModel):
    page: int
    page_size: int
    total: int
    submissions: list[AdminSubmissionSummary]


class AdminSubmissionDetail(BaseModel):
    submission_id: str
    submission_type: SubmissionType
    existing_work_id: str | None
    status: SubmissionStatus
    owner_username: str
    title: str
    authors: str
    poem_text: str
    genre: str
    historical_period: str
    notes: str
    decision_reason: str
    published_work_id: str | None
    created_at: datetime
    updated_at: datetime
    submitted_at: datetime
    published_at: datetime | None
    files: list[AdminSubmissionFile]
    revisions: list[SubmissionRevisionResponse]


class AdminSubmissionPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str = Field(default="", max_length=500)
    authors: str = Field(default="", max_length=500)
    poem_text: str = Field(default="", max_length=100_000)
    genre: str = Field(default="", max_length=200)
    historical_period: str = Field(default="", max_length=200)
    notes: str = Field(default="", max_length=20_000)
    file_order: list[str] | None = Field(default=None, max_length=10)
    remove_file_ids: list[str] | None = Field(default=None, max_length=10)

    @model_validator(mode="after")
    def contains_a_change(self):
        if not self.model_fields_set:
            raise ValueError("至少提供一个要修改的字段。")
        return self


class ModerationReasonRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reason: str = Field(min_length=3, max_length=1000)

    @field_validator("reason", mode="before")
    @classmethod
    def trim_reason(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value


class AuditEventResponse(BaseModel):
    event_id: str
    actor_username: str | None
    action: str
    target_type: str
    target_id: str
    detail: dict[str, object]
    request_id: str
    created_at: datetime


class AuditEventPage(BaseModel):
    page: int
    page_size: int
    total: int
    events: list[AuditEventResponse]
