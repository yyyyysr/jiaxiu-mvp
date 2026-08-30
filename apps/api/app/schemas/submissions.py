from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

SubmissionType = Literal["new_work", "existing_work_scan"]
SubmissionStatus = Literal["pending", "needs_revision", "published", "rejected"]


class SubmissionFileResponse(BaseModel):
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


class SubmissionResponse(BaseModel):
    submission_id: str
    submission_type: SubmissionType
    existing_work_id: str | None
    status: SubmissionStatus
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
    files: list[SubmissionFileResponse]


class SubmissionCreateFields(BaseModel):
    model_config = ConfigDict(extra="forbid")

    submission_type: str = Field(max_length=30)
    existing_work_id: str | None = Field(default=None, max_length=200)
    title: str = Field(default="", max_length=500)
    authors: str = Field(default="", max_length=500)
    poem_text: str = Field(default="", max_length=100_000)
    genre: str = Field(default="", max_length=200)
    historical_period: str = Field(default="", max_length=200)
    notes: str = Field(default="", max_length=20_000)


class SubmissionPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    existing_work_id: str | None = Field(default=None, max_length=200)
    title: str = Field(default="", max_length=500)
    authors: str = Field(default="", max_length=500)
    poem_text: str = Field(default="", max_length=100_000)
    genre: str = Field(default="", max_length=200)
    historical_period: str = Field(default="", max_length=200)
    notes: str = Field(default="", max_length=20_000)

    @model_validator(mode="after")
    def contains_a_change(self):
        if not self.model_fields_set:
            raise ValueError("至少提供一个要修改的字段。")
        return self
