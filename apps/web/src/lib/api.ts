import type {
  AdminSubmission,
  AdminSubmissionFilters,
  AdminSubmissionPatch,
  AdminSubmissionQueue,
  AuditEventFilters,
  AuditEventPage,
  AuthSession,
  AuthUser,
  Facsimile,
  ChatRequest,
  ChatResponse,
  ChangePasswordRequest,
  CreateUserRequest,
  GuideCitation,
  GuideConversation,
  GuideTurn,
  LoginRequest,
  ModerationReasonRequest,
  ResearchStatus,
  SceneAction,
  SeasonAssociation,
  SearchFilters,
  SearchResponse,
  Season,
  SeasonWorksResponse,
  Submission,
  SubmissionPatch,
  TemporaryPasswordResponse,
  UpdateUserRequest,
  WorkDetail,
  WorkFilters,
  WorkListResponse,
  WorkSummary,
} from "./types"
import type { SceneConfig } from "../scene/types"

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000/api/v1").replace(/\/$/, "")

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint <= 31 || codePoint >= 127 && codePoint <= 159
  })
}

export function resolveMediaUrl(publicUrl: string | null, apiBaseUrl = API_BASE_URL): string | null {
  if (!publicUrl || !publicUrl.startsWith("/") && !/^https?:\/\//i.test(publicUrl)) return null
  if (publicUrl.includes("\\") || hasControlCharacter(publicUrl)) return null

  try {
    const decodedPublicUrl = decodeURIComponent(publicUrl)
    if (decodedPublicUrl.includes("\\") || hasControlCharacter(decodedPublicUrl)) return null
    if (/%[0-9a-f]{2}/i.test(decodedPublicUrl)) return null
    if (decodedPublicUrl.split("/").some((part) => part === "." || part === "..")) return null

    const apiBase = new URL(apiBaseUrl)
    if (apiBase.protocol !== "http:" && apiBase.protocol !== "https:") return null
    const media = new URL(publicUrl, apiBase.origin)
    if (media.protocol !== apiBase.protocol || media.origin !== apiBase.origin) return null
    if (media.username || media.password || media.search || media.hash) return null

    const decodedPath = decodeURIComponent(media.pathname)
    const apiPath = apiBase.pathname.replace(/\/$/, "")
    if (decodedPath.includes("\\") || hasControlCharacter(decodedPath)) return null
    if (decodedPath.split("/").some((part) => part === "." || part === "..")) return null
    if (decodedPath !== apiPath && !decodedPath.startsWith(`${apiPath}/`)) return null
    return media.toString()
  } catch {
    return null
  }
}

export class ApiError extends Error {
  public readonly code: string
  public readonly requestId: string | null
  public readonly request_id: string | null
  public readonly detail: ApiErrorDetail

  constructor(
    public readonly status: number,
    detail: unknown,
  ) {
    const normalizedDetail = safeErrorDetail(detail, null) ?? {
      code: isRecord(detail) && typeof detail.code === "string" ? detail.code : "request_failed",
      message: "请求暂时无法完成，请稍后重试。",
      request_id: null,
    }
    super(normalizedDetail.message)
    this.name = "ApiError"
    this.code = normalizedDetail.code
    this.requestId = normalizedDetail.request_id
    this.request_id = normalizedDetail.request_id
    this.detail = normalizedDetail
  }
}

export type ApiErrorDetail = {
  code: string
  message: string
  request_id: string | null
}

function safeErrorDetail(value: unknown, fallbackRequestId: string | null): ApiErrorDetail | null {
  if (!isRecord(value) || typeof value.code !== "string" || typeof value.message !== "string") return null
  const requestId = typeof value.request_id === "string" ? value.request_id : fallbackRequestId
  return { code: value.code, message: value.message, request_id: requestId }
}

function isAbortError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "name" in error && error.name === "AbortError"
}

async function responseError(response: Response): Promise<ApiError> {
  const requestId = response.headers.get("X-Request-ID")
  let value: unknown
  try {
    value = await response.json()
  } catch (error) {
    if (isAbortError(error)) throw error
    value = null
  }
  return new ApiError(
    response.status,
    safeErrorDetail(value, requestId) ?? {
      code: "request_failed",
      message: "请求暂时无法完成，请稍后重试。",
      request_id: requestId,
    },
  )
}

async function fetchResponse(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers)
  if (!headers.has("Accept")) headers.set("Accept", "application/json")
  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      credentials: "include",
      headers,
    })
  } catch (error) {
    if (isAbortError(error)) throw error
    throw new ApiError(0, {
      code: "network_error",
      message: "无法连接档案服务，请检查网络后重试。",
      request_id: null,
    })
  }
  if (!response.ok) throw await responseError(response)
  return response
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetchResponse(path, init)
  if (response.status === 204) return undefined as T
  try {
    return await response.json() as T
  } catch (error) {
    if (isAbortError(error)) throw error
    throw new ApiError(response.status, {
      code: "invalid_response",
      message: "档案服务返回了无法读取的响应。",
      request_id: response.headers.get("X-Request-ID"),
    })
  }
}

async function requestBlob(path: string, init?: RequestInit): Promise<Blob> {
  return (await fetchResponse(path, init)).blob()
}

type AuthenticatedMethod = "POST" | "PATCH" | "DELETE"

function authenticatedRequest<T>(
  path: string,
  method: AuthenticatedMethod,
  csrfToken: string,
  init?: Omit<RequestInit, "method">,
): Promise<T> {
  if (!csrfToken) {
    throw new ApiError(0, {
      code: "csrf_token_missing",
      message: "登录状态已失效，请重新登录。",
      request_id: null,
    })
  }
  const headers = new Headers(init?.headers)
  headers.set("X-CSRF-Token", csrfToken)
  return request<T>(path, { ...init, method, headers })
}

const CHAT_RESPONSE_KEYS = ["poetic_intro", "answer", "citations", "scene_action", "uncertainty", "mode"] as const
const CITATION_KEYS = ["work_id", "title", "authors", "excerpt", "metadata_field", "metadata_evidence", "research_status", "season_association"] as const
const METADATA_FIELDS = ["authors", "notes", "facsimiles"] as const
const RESEARCH_STATUS_KEYS = ["authenticity_status", "completeness", "transcription_status", "date_certainty", "relation_scope"] as const
const SEASON_ASSOCIATION_KEYS = ["season", "is_primary", "evidence_type", "evidence_quote", "review_status"] as const
const CHAT_SEASONS = ["spring", "summer", "autumn", "winter"] as const
const SEASON_EVIDENCE_TYPES = ["explicit_title", "explicit_date", "explicit_text"] as const
const GUIDE_TURN_KEYS = ["role", "content", "created_at", "response"] as const
const GUIDE_CONVERSATION_KEYS = ["scope", "messages"] as const
const MAX_GUIDE_TURNS = 40

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value)
  return keys.length === expected.length && keys.every((key) => expected.includes(key))
}

function isBoundedString(value: unknown, maximum: number, allowEmpty = false): value is string {
  return typeof value === "string" && value.length <= maximum && (allowEmpty || value.trim().length > 0)
}

function invalidChatResponse(detail: string): never {
  throw new Error(`Invalid chat response: ${detail}`)
}

function parseResearchStatus(value: unknown): ResearchStatus {
  if (!isRecord(value) || !hasExactKeys(value, RESEARCH_STATUS_KEYS)) invalidChatResponse("invalid research status")
  if (!RESEARCH_STATUS_KEYS.every((key) => isBoundedString(value[key], 96))) invalidChatResponse("invalid research status value")
  return {
    authenticity_status: value.authenticity_status as string,
    completeness: value.completeness as string,
    transcription_status: value.transcription_status as string,
    date_certainty: value.date_certainty as string,
    relation_scope: value.relation_scope as string,
  }
}

function parseCitation(value: unknown): GuideCitation {
  if (!isRecord(value) || !hasExactKeys(value, CITATION_KEYS)) invalidChatResponse("invalid citation")
  if (!isBoundedString(value.work_id, 128) || !isBoundedString(value.title, 500, true) || !isBoundedString(value.authors, 500, true) || !isBoundedString(value.excerpt, 240)) {
    invalidChatResponse("invalid citation text")
  }
  const metadataField = value.metadata_field
  const metadataEvidence = value.metadata_evidence
  if (metadataField !== null && !METADATA_FIELDS.includes(metadataField as (typeof METADATA_FIELDS)[number])) {
    invalidChatResponse("invalid citation metadata field")
  }
  if (metadataEvidence !== null && !isBoundedString(metadataEvidence, 240)) {
    invalidChatResponse("invalid citation metadata evidence")
  }
  if ((metadataField === null) !== (metadataEvidence === null)) {
    invalidChatResponse("invalid citation metadata pairing")
  }
  return {
    work_id: value.work_id,
    title: value.title,
    authors: value.authors,
    excerpt: value.excerpt,
    metadata_field: metadataField as GuideCitation["metadata_field"],
    metadata_evidence: metadataEvidence as string | null,
    research_status: parseResearchStatus(value.research_status),
    season_association: value.season_association === null ? null : parseSeasonAssociation(value.season_association),
  }
}

function parseSeasonAssociation(value: unknown): SeasonAssociation {
  if (!isRecord(value) || !hasExactKeys(value, SEASON_ASSOCIATION_KEYS)) invalidChatResponse("invalid season association")
  if (!CHAT_SEASONS.includes(value.season as SeasonAssociation["season"]) || typeof value.is_primary !== "boolean") {
    invalidChatResponse("invalid season association identity")
  }
  if (!SEASON_EVIDENCE_TYPES.includes(value.evidence_type as SeasonAssociation["evidence_type"]) || !isBoundedString(value.evidence_quote, 240)) {
    invalidChatResponse("invalid season association evidence")
  }
  if (value.review_status !== "reviewed" && value.review_status !== "candidate") invalidChatResponse("invalid season review status")
  return {
    season: value.season as SeasonAssociation["season"],
    is_primary: value.is_primary,
    evidence_type: value.evidence_type as SeasonAssociation["evidence_type"],
    evidence_quote: value.evidence_quote,
    review_status: value.review_status,
  }
}

function parseSceneAction(value: unknown): SceneAction | null {
  if (!isRecord(value) || !hasExactKeys(value, ["season"])) return null
  if (!CHAT_SEASONS.includes(value.season as SceneAction["season"])) return null
  return { season: value.season as SceneAction["season"] }
}

export function validateChatResponse(value: unknown): ChatResponse {
  if (!isRecord(value) || !hasExactKeys(value, CHAT_RESPONSE_KEYS)) invalidChatResponse("unexpected fields")
  if (!isBoundedString(value.poetic_intro, 240) || !isBoundedString(value.answer, 4_000) || !isBoundedString(value.uncertainty, 500)) {
    invalidChatResponse("invalid answer text")
  }
  if (value.mode !== "demo" && value.mode !== "model") invalidChatResponse("invalid mode")
  if (!Array.isArray(value.citations) || value.citations.length > 5) invalidChatResponse("invalid citation list")
  return {
    poetic_intro: value.poetic_intro,
    answer: value.answer,
    citations: value.citations.map(parseCitation),
    scene_action: value.scene_action === null ? null : parseSceneAction(value.scene_action),
    uncertainty: value.uncertainty,
    mode: value.mode,
  }
}

function parseGuideTurn(value: unknown): GuideTurn {
  if (!isRecord(value) || !hasExactKeys(value, GUIDE_TURN_KEYS)) invalidChatResponse("invalid guide turn")
  if (value.role !== "user" && value.role !== "assistant") invalidChatResponse("invalid guide turn role")
  if (!isBoundedString(value.content, 4_000)) invalidChatResponse("invalid guide turn text")
  if (!isBoundedString(value.created_at, 64)) invalidChatResponse("invalid guide turn timestamp")
  return {
    role: value.role,
    content: value.content,
    created_at: value.created_at,
    response: value.response === null ? null : validateChatResponse(value.response),
  }
}

export function validateGuideConversation(value: unknown): GuideConversation {
  if (!isRecord(value) || !hasExactKeys(value, GUIDE_CONVERSATION_KEYS)) invalidChatResponse("unexpected conversation fields")
  if (value.scope !== "account" && value.scope !== "guest") invalidChatResponse("invalid conversation scope")
  if (!Array.isArray(value.messages) || value.messages.length > MAX_GUIDE_TURNS) invalidChatResponse("invalid conversation length")
  return { scope: value.scope, messages: value.messages.map(parseGuideTurn) }
}

function queryString(values: Record<string, string | number | boolean | null | undefined>): string {
  const params = new URLSearchParams()
  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined && value !== "") params.set(key, String(value))
  })
  return params.toString()
}

function invalidWorksResponse(detail: string): never {
  throw new Error(`Invalid works response: ${detail}`)
}

function parseWorkResearchStatus(value: unknown): ResearchStatus {
  if (!isRecord(value)) invalidWorksResponse("research status is not an object")
  const parsed: Record<string, string> = {}
  for (const key of RESEARCH_STATUS_KEYS) {
    if (!isBoundedString(value[key], 96)) invalidWorksResponse(`invalid research status ${key}`)
    parsed[key] = value[key]
  }
  return parsed as ResearchStatus
}

function parseWorkSummary(value: unknown): WorkSummary {
  if (!isRecord(value)) invalidWorksResponse("work is not an object")
  const requiredStrings = [
    "work_id", "title", "alternate_titles", "genre", "historical_period", "era", "date_original", "authors",
  ] as const
  for (const key of requiredStrings) {
    if (!isBoundedString(value[key], key === "work_id" ? 128 : 1_000, key !== "work_id")) {
      invalidWorksResponse(`invalid work field ${key}`)
    }
  }
  if (!Number.isInteger(value.facsimile_count) || (value.facsimile_count as number) < 0) {
    invalidWorksResponse("invalid facsimile count")
  }
  if (value.match_type !== undefined && value.match_type !== null && !["title", "text", "metadata"].includes(value.match_type as string)) {
    invalidWorksResponse("invalid match type")
  }
  if (value.excerpt !== undefined && value.excerpt !== null && !isBoundedString(value.excerpt, 1_000, true)) {
    invalidWorksResponse("invalid excerpt")
  }
  for (const key of ["year_start", "year_end"] as const) {
    if (value[key] === undefined || value[key] !== null && !Number.isInteger(value[key])) {
      invalidWorksResponse(`invalid ${key}`)
    }
  }
  if (value.match_field !== undefined && value.match_field !== null && !isBoundedString(value.match_field, 96, true)) {
    invalidWorksResponse("invalid match field")
  }
  return {
    work_id: value.work_id as string,
    title: value.title as string,
    alternate_titles: value.alternate_titles as string,
    genre: value.genre as string,
    historical_period: value.historical_period as string,
    era: value.era as string,
    date_original: value.date_original as string,
    year_start: value.year_start as number | null,
    year_end: value.year_end as number | null,
    authors: value.authors as string,
    facsimile_count: value.facsimile_count as number,
    research_status: parseWorkResearchStatus(value.research_status),
    ...(value.match_type === undefined || value.match_type === null ? {} : { match_type: value.match_type as WorkSummary["match_type"] }),
    ...(value.match_field === undefined || value.match_field === null ? {} : { match_field: value.match_field as string }),
    ...(value.excerpt === undefined || value.excerpt === null ? {} : { excerpt: value.excerpt as string }),
  }
}

export function validateWorkListResponse(value: unknown): WorkListResponse {
  if (!isRecord(value) || !Array.isArray(value.items)) invalidWorksResponse("expected a paginated object")
  if (!Number.isInteger(value.total) || (value.total as number) < 0) invalidWorksResponse("invalid total")
  if (!Number.isInteger(value.page) || (value.page as number) < 1) invalidWorksResponse("invalid page")
  if (!Number.isInteger(value.page_size) || (value.page_size as number) < 1 || (value.page_size as number) > 100) {
    invalidWorksResponse("invalid page size")
  }
  if (!Number.isInteger(value.pages) || (value.pages as number) < 0) {
    invalidWorksResponse("invalid page count")
  }
  if (value.items.length > 100) invalidWorksResponse("too many items")
  return {
    items: value.items.map(parseWorkSummary),
    total: value.total as number,
    page: value.page as number,
    page_size: value.page_size as number,
    pages: value.pages as number,
  }
}

export const api = {
  getAuthSession(signal?: AbortSignal): Promise<AuthSession> {
    return request<AuthSession>("/auth/me", { signal })
  },

  login(payload: LoginRequest, signal?: AbortSignal): Promise<AuthSession> {
    return request<AuthSession>("/auth/login", {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
  },

  logout(csrfToken: string, signal?: AbortSignal): Promise<void> {
    return authenticatedRequest<void>("/auth/logout", "POST", csrfToken, { signal })
  },

  changePassword(payload: ChangePasswordRequest, csrfToken: string, signal?: AbortSignal): Promise<AuthSession> {
    return authenticatedRequest<AuthSession>("/auth/change-password", "POST", csrfToken, {
      signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
  },

  async listWorks(params: WorkFilters = {}): Promise<WorkListResponse> {
    const query = queryString({ page: 1, page_size: 20, ...params })
    return validateWorkListResponse(await request<unknown>(`/works?${query}`))
  },

  getWork(id: string, includeRelated = false, signal?: AbortSignal): Promise<WorkDetail> {
    const query = queryString({ include_related: includeRelated })
    return request<WorkDetail>(`/works/${encodeURIComponent(id)}?${query}`, { signal })
  },

  getFacsimiles(id: string, includeRelated = false): Promise<Facsimile[]> {
    const query = queryString({ include_related: includeRelated })
    return request<Facsimile[]>(`/works/${encodeURIComponent(id)}/facsimiles?${query}`)
  },

  searchWorks(q: string, filters: SearchFilters = {}): Promise<SearchResponse> {
    const query = queryString({ q, limit: 20, scope: "strict_jiaxiu", ...filters })
    return request<SearchResponse>(`/search?${query}`)
  },

  getSeasonWorks(season: Season, signal?: AbortSignal): Promise<SeasonWorksResponse> {
    return request<SeasonWorksResponse>(`/seasons/${season}/works`, { signal })
  },

  getSceneConfig(): Promise<SceneConfig> {
    return request<SceneConfig>("/scene/config")
  },


  createSubmission(form: FormData, csrfToken: string): Promise<Submission> {
    return authenticatedRequest<Submission>("/submissions", "POST", csrfToken, { body: form })
  },

  listSubmissions(): Promise<Submission[]> {
    return request<Submission[]>("/submissions")
  },

  getSubmission(submissionId: string): Promise<Submission> {
    return request<Submission>(`/submissions/${encodeURIComponent(submissionId)}`)
  },

  updateSubmission(submissionId: string, payload: SubmissionPatch, csrfToken: string): Promise<Submission> {
    return authenticatedRequest<Submission>(
      `/submissions/${encodeURIComponent(submissionId)}`,
      "PATCH",
      csrfToken,
      { headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) },
    )
  },

  resubmitSubmission(submissionId: string, csrfToken: string): Promise<Submission> {
    return authenticatedRequest<Submission>(
      `/submissions/${encodeURIComponent(submissionId)}/resubmit`,
      "POST",
      csrfToken,
    )
  },

  getSubmissionFile(submissionId: string, fileId: string): Promise<Blob> {
    return requestBlob(`/submissions/${encodeURIComponent(submissionId)}/files/${encodeURIComponent(fileId)}`)
  },

  listAdminUsers(): Promise<AuthUser[]> {
    return request<AuthUser[]>("/admin/users")
  },

  createAdminUser(payload: CreateUserRequest, csrfToken: string): Promise<TemporaryPasswordResponse> {
    return authenticatedRequest<TemporaryPasswordResponse>("/admin/users", "POST", csrfToken, {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
  },

  updateAdminUser(userId: string, payload: UpdateUserRequest, csrfToken: string): Promise<AuthUser> {
    return authenticatedRequest<AuthUser>(
      `/admin/users/${encodeURIComponent(userId)}`,
      "PATCH",
      csrfToken,
      { headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) },
    )
  },

  resetAdminUserPassword(userId: string, csrfToken: string): Promise<TemporaryPasswordResponse> {
    return authenticatedRequest<TemporaryPasswordResponse>(
      `/admin/users/${encodeURIComponent(userId)}/reset-password`,
      "POST",
      csrfToken,
    )
  },

  listAdminSubmissions(filters: AdminSubmissionFilters = {}): Promise<AdminSubmissionQueue> {
    const query = queryString({ status: "pending", page: 1, page_size: 20, ...filters })
    return request<AdminSubmissionQueue>(`/admin/submissions?${query}`)
  },

  getAdminSubmission(submissionId: string): Promise<AdminSubmission> {
    return request<AdminSubmission>(`/admin/submissions/${encodeURIComponent(submissionId)}`)
  },

  updateAdminSubmission(submissionId: string, payload: AdminSubmissionPatch, csrfToken: string): Promise<AdminSubmission> {
    return authenticatedRequest<AdminSubmission>(
      `/admin/submissions/${encodeURIComponent(submissionId)}`,
      "PATCH",
      csrfToken,
      { headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) },
    )
  },

  getAdminSubmissionFile(submissionId: string, fileId: string): Promise<Blob> {
    return requestBlob(`/admin/submissions/${encodeURIComponent(submissionId)}/files/${encodeURIComponent(fileId)}`)
  },

  requestSubmissionRevision(submissionId: string, payload: ModerationReasonRequest, csrfToken: string): Promise<AdminSubmission> {
    return authenticatedRequest<AdminSubmission>(
      `/admin/submissions/${encodeURIComponent(submissionId)}/request-revision`,
      "POST",
      csrfToken,
      { headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) },
    )
  },

  rejectSubmission(submissionId: string, payload: ModerationReasonRequest, csrfToken: string): Promise<AdminSubmission> {
    return authenticatedRequest<AdminSubmission>(
      `/admin/submissions/${encodeURIComponent(submissionId)}/reject`,
      "POST",
      csrfToken,
      { headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) },
    )
  },

  publishSubmission(submissionId: string, csrfToken: string): Promise<AdminSubmission> {
    return authenticatedRequest<AdminSubmission>(
      `/admin/submissions/${encodeURIComponent(submissionId)}/publish`,
      "POST",
      csrfToken,
    )
  },

  listAuditEvents(filters: AuditEventFilters = {}): Promise<AuditEventPage> {
    const query = queryString({ page: 1, page_size: 20, ...filters })
    return request<AuditEventPage>(`/admin/audit-events?${query}`)
  },

  async chat(payload: ChatRequest, signal?: AbortSignal): Promise<ChatResponse> {
    const value = await request<unknown>("/agent/chat", {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
    return validateChatResponse(value)
  },

  async getGuideConversation(signal?: AbortSignal): Promise<GuideConversation> {
    return validateGuideConversation(await request<unknown>("/agent/conversation", { signal }))
  },

  clearGuideConversation(csrfToken: string | null, signal?: AbortSignal): Promise<void> {
    // Guests hold no CSRF token; the server only demands one once a thread belongs to an account.
    const headers = new Headers()
    if (csrfToken) headers.set("X-CSRF-Token", csrfToken)
    return request<void>("/agent/conversation", { method: "DELETE", signal, headers })
  },
}
