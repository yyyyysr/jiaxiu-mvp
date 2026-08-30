export type ResearchStatus = {
  authenticity_status: string
  completeness: string
  transcription_status: string
  date_certainty: string
  relation_scope: string
}

export type WorkSummary = {
  work_id: string
  title: string
  alternate_titles: string
  genre: string
  historical_period: string
  era: string
  date_original: string
  year_start: number | null
  year_end: number | null
  authors: string
  facsimile_count: number
  research_status: ResearchStatus
  match_type?: "title" | "text" | "metadata"
  match_field?: string
  excerpt?: string
}

export type Source = {
  source_id: string
  title: string
  source_type: string
  author_editor: string
  compilation_date: string
  publication_date: string
  publication_year: number | null
  publisher: string
  volume: string
  pages: string
  url: string
  access_date: string
  archive_path: string
  reliability: string
  language: string
  bibliographic_note: string
  source_notes: string
  role: string
  locator: string
  is_primary: boolean
  evidence_note: string
}

export type AuthorDetail = {
  author_id: string
  name: string
  name_traditional: string
  courtesy_name: string
  art_name: string
  other_names: string
  dynasty: string
  birth_year: number | null
  death_year: number | null
  biography: string
  notes: string
  role: string
  position: number
  certainty: string
  attribution_note: string
}

export type TextVariant = {
  variant_id: string
  label: string
  variant_type: string
  full_text: string
  text_script: string
  transcription_status: string
  completeness: string
  source_id: string | null
  locator: string
  is_canonical: boolean
  notes: string
}

export type WorkDetail = WorkSummary & {
  author_roles: string
  canonical_text: string
  text_script: string
  year_start: number | null
  year_end: number | null
  first_publication_date: string
  first_publication_year: number | null
  inscription_number: string
  location_context: string
  lineation_note: string
  notes: string
  sources: Source[]
  authors_detail: AuthorDetail[]
  text_variants: TextVariant[]
  season_associations: SeasonAssociation[]
}

export type Facsimile = {
  image_id: string
  source_id: string | null
  public_url: string | null
  scan_page: number | null
  print_page: string
  image_role: string
  file_format: string
  pixel_width: number
  pixel_height: number
  file_bytes: number
  sha256: string
  capture_method: string
  quality_note: string
  notes: string
  sequence: number
  locator: string
  association_notes: string
  listed: true
  deployed: boolean
}

export type WorkListResponse = {
  items: WorkSummary[]
  total: number
  page: number
  page_size: number
  pages: number
}

export type WorkSort = "relevance" | "date_asc" | "date_desc" | "title_asc" | "title_desc"

export type SearchHit = {
  work_id: string
  title: string
  authors: string
  match_type: "title" | "text" | "metadata"
  excerpt: string
}

export type SearchResponse = { items: SearchHit[] }

export type Season = "spring" | "summer" | "autumn" | "winter"
export type SeasonWork = WorkSummary & {
  season: Season
  is_primary: boolean
  evidence_type: "explicit_title" | "explicit_date" | "explicit_text"
  evidence_quote: string
  review_status: "reviewed" | "candidate"
}
export type SeasonWorksResponse = {
  season: Season
  items: SeasonWork[]
  related_items: SeasonWork[]
}

export type SceneAction = { season: Season }
export type ChatMode = "demo" | "model"
export type ChatHistoryItem = { role: "user" | "assistant"; content: string }
export type ChatRequest = { message: string; season?: Season | null; history?: ChatHistoryItem[] }
export type SeasonAssociation = {
  season: Season
  is_primary: boolean
  evidence_type: "explicit_title" | "explicit_date" | "explicit_text"
  evidence_quote: string
  review_status: "reviewed" | "candidate"
}
export type GuideCitation = {
  work_id: string
  title: string
  authors: string
  excerpt: string
  metadata_field: "authors" | "notes" | "facsimiles" | null
  metadata_evidence: string | null
  research_status: ResearchStatus
  season_association: SeasonAssociation | null
}
export type ChatResponse = {
  poetic_intro: string
  answer: string
  citations: GuideCitation[]
  scene_action: SceneAction | null
  uncertainty: string
  mode: ChatMode
}

export type WorkFilters = {
  q?: string
  page?: number
  page_size?: number
  author?: string
  period?: string
  date_from?: number
  date_to?: number
  genre?: string
  season?: Season
  relation_scope?: "strict_jiaxiu" | "site_origin" | "nearby_prebuild" | "adjacent_complex" | "all"
  authenticity?: string
  completeness?: string
  has_facsimile?: boolean
  sort?: WorkSort
  include_related?: boolean
}

export type SearchFilters = {
  limit?: number
  scope?: "strict_jiaxiu" | "site_origin" | "nearby_prebuild" | "adjacent_complex" | "all"
}

export type AuthRole = "contributor" | "admin"

export type AuthUser = {
  user_id: string
  username: string
  role: AuthRole
  is_active: boolean
  must_change_password: boolean
}

export type AuthSession = {
  user: AuthUser
  csrf_token: string
}

export type LoginRequest = {
  username: string
  password: string
}

export type ChangePasswordRequest = {
  current_password: string
  new_password: string
}

export type CreateUserRequest = {
  username: string
  role: AuthRole
}

export type UpdateUserRequest = {
  is_active: boolean
}

export type TemporaryPasswordResponse = {
  user: AuthUser
  temporary_password: string
}

export type SubmissionType = "new_work" | "existing_work_scan"
export type SubmissionStatus = "pending" | "needs_revision" | "published" | "rejected"

export type SubmissionFile = {
  file_id: string
  original_name: string
  file_format: "jpg" | "png"
  media_type: "image/jpeg" | "image/png"
  file_bytes: number
  pixel_width: number
  pixel_height: number
  sha256: string
  sequence: number
  public_url: null
}

export type Submission = {
  submission_id: string
  submission_type: SubmissionType
  existing_work_id: string | null
  status: SubmissionStatus
  title: string
  authors: string
  poem_text: string
  genre: string
  historical_period: string
  notes: string
  decision_reason: string
  published_work_id: string | null
  created_at: string
  updated_at: string
  submitted_at: string
  published_at: string | null
  files: SubmissionFile[]
}

export type SubmissionPatch = {
  existing_work_id?: string | null
  title?: string
  authors?: string
  poem_text?: string
  genre?: string
  historical_period?: string
  notes?: string
}

export type AdminSubmissionFile = SubmissionFile & {
  preview_url: string
}

export type SubmissionRevision = {
  revision_id: string
  action: string
  actor_username: string
  snapshot: Record<string, unknown>
  created_at: string
}

export type AdminSubmissionSummary = {
  submission_id: string
  submission_type: SubmissionType
  status: SubmissionStatus
  owner_username: string
  title: string
  submitted_at: string
  updated_at: string
  file_count: number
}

export type AdminSubmissionQueue = {
  page: number
  page_size: number
  total: number
  submissions: AdminSubmissionSummary[]
}

export type AdminSubmission = Omit<Submission, "files"> & {
  owner_username: string
  files: AdminSubmissionFile[]
  revisions: SubmissionRevision[]
}

export type AdminSubmissionPatch = {
  title?: string
  authors?: string
  poem_text?: string
  genre?: string
  historical_period?: string
  notes?: string
  file_order?: string[] | null
  remove_file_ids?: string[] | null
}

export type AdminSubmissionFilters = {
  status?: SubmissionStatus
  submission_type?: SubmissionType
  owner_username?: string
  submitted_from?: string
  submitted_to?: string
  page?: number
  page_size?: number
}

export type ModerationReasonRequest = {
  reason: string
}

export type AuditEvent = {
  event_id: string
  actor_username: string | null
  action: string
  target_type: string
  target_id: string
  detail: Record<string, unknown>
  request_id: string
  created_at: string
}

export type AuditEventPage = {
  page: number
  page_size: number
  total: number
  events: AuditEvent[]
}

export type AuditEventFilters = {
  page?: number
  page_size?: number
}
