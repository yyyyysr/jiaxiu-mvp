from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from app.schemas.scene import EvidenceType, ReviewStatus, Season

ChatRole = Literal["user", "assistant"]
ResponseMode = Literal["demo", "model"]
GuideScope = Literal["account", "guest"]

MessageText = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=1000)
]
AnswerText = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=4000)
]
BoundedStatus = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=96)
]
WorkId = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=128)]
Timestamp = Annotated[str, StringConstraints(min_length=1, max_length=64)]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class AgentResearchStatus(StrictModel):
    authenticity_status: BoundedStatus
    completeness: BoundedStatus
    transcription_status: BoundedStatus
    date_certainty: BoundedStatus
    relation_scope: BoundedStatus


class SeasonAssociation(StrictModel):
    season: Season
    is_primary: bool
    evidence_type: EvidenceType
    evidence_quote: Annotated[str, StringConstraints(min_length=1, max_length=240)]
    review_status: ReviewStatus


class ChatMessage(StrictModel):
    role: ChatRole
    content: MessageText


class ChatRequest(StrictModel):
    message: MessageText
    season: Season | None = None
    history: list[ChatMessage] = Field(default_factory=list, max_length=16)
    # The work the reader currently has open, so "这首诗" resolves without them naming it again.
    context_work_id: WorkId | None = None


class SceneAction(StrictModel):
    season: Season


class Citation(StrictModel):
    work_id: Annotated[str, StringConstraints(min_length=1, max_length=128)]
    title: Annotated[str, StringConstraints(max_length=500)]
    authors: Annotated[str, StringConstraints(max_length=500)]
    excerpt: Annotated[str, StringConstraints(min_length=1, max_length=240)]
    metadata_field: Literal["authors", "notes", "facsimiles"] | None = None
    metadata_evidence: Annotated[
        str, StringConstraints(min_length=1, max_length=240)
    ] | None = None
    research_status: AgentResearchStatus
    season_association: SeasonAssociation | None


class ChatResponse(StrictModel):
    poetic_intro: Annotated[str, StringConstraints(min_length=1, max_length=240)]
    answer: AnswerText
    citations: list[Citation] = Field(max_length=5)
    scene_action: SceneAction | None
    uncertainty: Annotated[str, StringConstraints(min_length=1, max_length=500)]
    mode: ResponseMode


class Evidence(StrictModel):
    """A bounded, untrusted database record passed through the provider user channel."""

    evidence_id: Annotated[str, StringConstraints(min_length=1, max_length=128)]
    work_id: Annotated[str, StringConstraints(min_length=1, max_length=128)]
    title: Annotated[str, StringConstraints(max_length=500)]
    authors: Annotated[str, StringConstraints(max_length=500)]
    canonical_text: Annotated[str, StringConstraints(min_length=1, max_length=6000)]
    research_status: AgentResearchStatus
    excerpt: Annotated[str, StringConstraints(min_length=1, max_length=240)] | None = None
    metadata_field: Literal["authors", "notes", "facsimiles"] | None = None
    metadata_evidence: Annotated[
        str, StringConstraints(min_length=1, max_length=240)
    ] | None = None
    season_association: SeasonAssociation | None
    page_context: bool = False


class ProviderAnswer(StrictModel):
    """Model-authored fields. Citation metadata is deliberately absent."""

    answer: AnswerText
    evidence_ids: list[
        Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=128)]
    ] = Field(max_length=5)
    scene_action: dict[str, str] | None


class GuideTurn(StrictModel):
    """One filed exchange, replayed when a reader returns to the guide."""

    role: ChatRole
    content: AnswerText
    created_at: Timestamp
    response: ChatResponse | None = None


class GuideConversation(StrictModel):
    scope: GuideScope
    messages: list[GuideTurn] = Field(default_factory=list, max_length=40)
