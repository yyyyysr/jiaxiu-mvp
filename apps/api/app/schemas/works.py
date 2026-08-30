from typing import Literal

from pydantic import BaseModel, Field

MatchField = Literal["title", "alternate_titles", "canonical_text", "authors", "notes"]


class ResearchStatus(BaseModel):
    authenticity_status: str
    completeness: str
    transcription_status: str
    date_certainty: str
    relation_scope: str


class WorkSummary(BaseModel):
    work_id: str
    title: str
    alternate_titles: str
    genre: str
    historical_period: str
    era: str
    date_original: str
    year_start: int | None
    year_end: int | None
    authors: str
    facsimile_count: int
    research_status: ResearchStatus
    match_type: Literal["title", "text", "metadata"] | None = None
    match_field: MatchField | None = None
    excerpt: str | None = None

    @property
    def relation_scope(self) -> str:
        return self.research_status.relation_scope


class Source(BaseModel):
    source_id: str
    title: str
    source_type: str
    author_editor: str
    compilation_date: str
    publication_date: str
    publication_year: int | None
    publisher: str
    volume: str
    pages: str
    url: str
    access_date: str
    archive_path: str
    reliability: str
    language: str
    bibliographic_note: str
    source_notes: str
    role: str
    locator: str
    is_primary: bool
    evidence_note: str


class AuthorDetail(BaseModel):
    author_id: str
    name: str
    name_traditional: str
    courtesy_name: str
    art_name: str
    other_names: str
    dynasty: str
    birth_year: int | None
    death_year: int | None
    biography: str
    notes: str
    role: str
    position: int
    certainty: str
    attribution_note: str


class TextVariant(BaseModel):
    variant_id: str
    label: str
    variant_type: str
    full_text: str
    text_script: str
    transcription_status: str
    completeness: str
    source_id: str | None
    locator: str
    is_canonical: bool
    notes: str


class WorkSeasonAssociation(BaseModel):
    season: Literal["spring", "summer", "autumn", "winter"]
    is_primary: bool
    evidence_type: Literal["explicit_title", "explicit_date", "explicit_text"]
    evidence_quote: str
    review_status: Literal["reviewed", "candidate"]


class WorkDetail(WorkSummary):
    author_roles: str
    canonical_text: str
    text_script: str
    first_publication_date: str
    first_publication_year: int | None
    inscription_number: str
    location_context: str
    lineation_note: str
    notes: str
    sources: list[Source]
    authors_detail: list[AuthorDetail] = Field(default_factory=list)
    text_variants: list[TextVariant] = Field(default_factory=list)
    season_associations: list[WorkSeasonAssociation] = Field(default_factory=list)


class Facsimile(BaseModel):
    image_id: str
    source_id: str | None
    public_url: str | None
    scan_page: int | None
    print_page: str
    image_role: str
    file_format: str
    pixel_width: int
    pixel_height: int
    file_bytes: int
    sha256: str
    capture_method: str
    quality_note: str
    notes: str
    sequence: int
    locator: str
    association_notes: str
    listed: Literal[True] = True
    deployed: bool


class SearchHit(BaseModel):
    work_id: str
    title: str
    authors: str
    match_type: Literal["title", "text", "metadata"]
    match_field: MatchField
    match_fields: list[MatchField]
    excerpt: str
    canonical_excerpt: str | None
    metadata_field: Literal["authors", "notes"] | None
    metadata_evidence: str | None


class WorkListResponse(BaseModel):
    items: list[WorkSummary]
    total: int
    page: int
    page_size: int
    pages: int


class SearchResponse(BaseModel):
    items: list[SearchHit]
