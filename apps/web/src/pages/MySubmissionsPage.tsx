import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { FormEvent, useEffect, useLayoutEffect, useRef, useState } from "react"
import { Link, useParams } from "react-router-dom"

import { ApiError, api } from "../lib/api"
import type { Submission, SubmissionPatch } from "../lib/types"

const labels: Record<Submission["status"], string> = { pending: "审核中", needs_revision: "需修订", published: "已发布", rejected: "未采纳" }
const dateLabel = (value: string | null) => { const date = value ? new Date(value) : null; return date && !Number.isNaN(date.getTime()) ? `${date.getUTCFullYear()}年${date.getUTCMonth() + 1}月${date.getUTCDate()}日` : "未记录" }
class ResubmitError extends Error { constructor(readonly original: unknown, readonly known: Submission) { super("resubmission failed") } }
const errorText = (error: unknown): string => error instanceof ResubmitError ? errorText(error.original) : error instanceof ApiError && typeof error.detail === "object" && error.detail !== null ? String((error.detail as { message?: string }).message ?? "操作暂时无法完成。") : "操作暂时无法完成。"
const submissionsKey = ["private", "submissions"] as const
const submissionKey = (submissionId: string) => [...submissionsKey, submissionId] as const
type RevisionAttempt = { payload: SubmissionPatch; submissionId: string; generation: number }
function SubmissionSeal({ status }: { status: Submission["status"] }) { return <span className={`submission-seal submission-seal--${status}`}>{labels[status]}</span> }

export function MySubmissionsPage() {
  const query = useQuery({ queryKey: submissionsKey, queryFn: api.listSubmissions })
  return <main className="page-shell submissions-page" id="main-content" tabIndex={-1}>{query.isLoading && <p role="status">正在调阅投稿记录…</p>}{query.isError && <p role="alert">投稿记录暂时无法读取。</p>}{query.data && <><header className="submissions-page__heading"><p className="kicker">PRIVATE · ACCESSION LOG</p><h1>我的投稿</h1><p>审核进度与修订意见仅对投稿人可见。</p></header><ol className="submission-list">{query.data.map((submission) => <li key={submission.submission_id}><div><SubmissionSeal status={submission.status} /><p>{submission.submission_type === "existing_work_scan" ? "补充扫描" : "新作品著录"}</p></div><div><h2>{submission.title || "为已有作品补充扫描"}</h2><p>送交：{dateLabel(submission.submitted_at)} 更新：{dateLabel(submission.updated_at)}</p>{submission.decision_reason && <p className="submission-list__reason">{submission.decision_reason}</p>}{submission.published_work_id && <Link to={`/works/${encodeURIComponent(submission.published_work_id)}`}>查看已发布作品</Link>}</div><Link aria-label={`查看投稿：${submission.title || "补充扫描"}`} to={`/my-submissions/${encodeURIComponent(submission.submission_id)}`}>查阅卷宗 →</Link></li>)}</ol></>}</main>
}

function ReadOnlyFolios({ submission }: { submission: Submission }) {
  const [previews, setPreviews] = useState<Record<string, string>>({}), [failures, setFailures] = useState<Record<string, string>>({})
  const shown = useRef<Record<string, string>>({}), retired = useRef<string[]>([]), revoked = useRef(new Set<string>()), owned = useRef(new Set<string>()), mounted = useRef(false), generation = useRef(0), filesRef = useRef(submission.files), pendingAdoption = useRef<{ urls: Set<string>; adopted: boolean } | null>(null)
  const revoke = (url: string) => { owned.current.delete(url); if (!revoked.current.has(url)) { revoked.current.add(url); URL.revokeObjectURL(url) } }
  useLayoutEffect(() => {
    const old = shown.current
    shown.current = previews
    retired.current.splice(0).forEach(revoke)
    Object.values(old).filter((url) => !Object.values(previews).includes(url)).forEach(revoke)
    if (pendingAdoption.current && Object.values(previews).some((url) => pendingAdoption.current?.urls.has(url))) {
      pendingAdoption.current.adopted = true
      pendingAdoption.current = null
    }
  }, [previews])
  const fingerprint = submission.files.map((file) => `${file.file_id}:${file.sha256}`).join("|")
  useLayoutEffect(() => { filesRef.current = submission.files }, [fingerprint, submission.files])
  useEffect(() => {
    mounted.current = true
    const sequence = generation, ownership = owned.current
    return () => { mounted.current = false; sequence.current++; queueMicrotask(() => { if (!mounted.current) ownership.forEach(revoke) }) }
  }, [])
  useEffect(() => {
    const current = ++generation.current; const files = filesRef.current, run = { urls: new Set<string>(), adopted: false, active: true }; const next: Record<string, string> = {}; const failed: Record<string, string> = {}
    void Promise.allSettled(files.map(async (file) => {
      const url = URL.createObjectURL(await api.getSubmissionFile(submission.submission_id, file.file_id))
      owned.current.add(url)
      if (!run.active || current !== generation.current || !mounted.current) { revoke(url); throw new Error("stale preview") }
      run.urls.add(url)
      return { file, url }
    })).then((results) => {
      results.forEach((result, index) => { if (result.status === "fulfilled") next[result.value.file.file_id] = result.value.url; else if (files[index]) failed[files[index].file_id] = "影像暂时无法读取。" })
      if (!run.active || current !== generation.current) { run.urls.forEach(revoke); return }
      pendingAdoption.current = run; retired.current.push(...Object.values(shown.current)); setFailures(failed); setPreviews(next)
    })
    return () => { run.active = false; if (!run.adopted) run.urls.forEach(revoke) }
  }, [submission.submission_id, fingerprint])
  return <section className="submission-folios"><h2>已送交扫描</h2>{submission.files.length === 0 ? <p>本卷未附影像。</p> : <ol>{[...submission.files].sort((a, b) => a.sequence - b.sequence).map((file, index) => <li key={file.file_id}>{previews[file.file_id] ? <img src={previews[file.file_id]} alt={`第 ${index + 1} 张扫描：${file.original_name}`} /> : failures[file.file_id] ? <p role="alert">第 {index + 1} 张影像暂时无法读取。</p> : <span>正在调阅第 {index + 1} 张…</span>}<p>第 {index + 1} 张 · {file.original_name}</p></li>)}</ol>}<p className="submission-folios__note">扫描页已封存；如需补充，请在修订说明中注明。</p></section>
}

export function SubmissionDetailPage({ csrfToken }: { csrfToken: string }) {
  const { submissionId = "" } = useParams(); const client = useQueryClient(); const query = useQuery({ queryKey: submissionKey(submissionId), queryFn: () => api.getSubmission(submissionId), enabled: Boolean(submissionId) })
  const [draft, setDraft] = useState<SubmissionPatch>({}), [notice, setNotice] = useState("")
  const detailMounted = useRef(false), activeSubmissionId = useRef(submissionId), reconciliationGeneration = useRef(0)
  useLayoutEffect(() => {
    detailMounted.current = true
    activeSubmissionId.current = submissionId
    reconciliationGeneration.current++
    return () => { detailMounted.current = false }
  }, [submissionId])
  const isCurrent = (attempt: RevisionAttempt) => detailMounted.current && activeSubmissionId.current === attempt.submissionId && reconciliationGeneration.current === attempt.generation
  const installKnown = (attempt: RevisionAttempt, result?: Submission) => { if (result && isCurrent(attempt)) client.setQueryData(submissionKey(attempt.submissionId), result) }
  const reconcile = async (result: Submission | undefined, attempt: RevisionAttempt) => {
    installKnown(attempt, result)
    void client.invalidateQueries({ queryKey: submissionsKey, exact: true, refetchType: "all" }).catch(() => undefined)
    let canonical: Submission
    try { canonical = await api.getSubmission(attempt.submissionId) } catch { installKnown(attempt, result); return }
    if (!isCurrent(attempt)) return
    client.setQueryData(submissionKey(attempt.submissionId), canonical)
    if (canonical.published_work_id) void client.invalidateQueries({ queryKey: ["work", canonical.published_work_id] }).catch(() => undefined)
  }
  const revise = useMutation({ mutationFn: async (attempt: RevisionAttempt) => {
    const updated = await api.updateSubmission(attempt.submissionId, attempt.payload, csrfToken)
    installKnown(attempt, updated)
    try { const resubmitted = await api.resubmitSubmission(updated.submission_id, csrfToken); installKnown(attempt, resubmitted); return resubmitted } catch (error) { throw new ResubmitError(error, updated) }
  }, onSuccess: async (result, attempt) => { await reconcile(result, attempt); if (isCurrent(attempt)) setNotice("已重新送交审核。") }, onError: async (error, attempt) => { await reconcile(error instanceof ResubmitError ? error.known : undefined, attempt); if (isCurrent(attempt)) setNotice(errorText(error)) } })
  if (query.isLoading) return <main className="page-shell" id="main-content"><p role="status">正在调阅卷宗…</p></main>
  if (query.isError || !query.data) return <main className="page-shell" id="main-content"><p role="alert">此投稿卷宗暂时无法读取。</p></main>
  const submission = query.data, editable = submission.status === "needs_revision", scanOnly = submission.submission_type === "existing_work_scan"
  const payload = (): SubmissionPatch => scanOnly ? { notes: draft.notes ?? submission.notes } : { title: draft.title ?? submission.title, authors: draft.authors ?? submission.authors, poem_text: draft.poem_text ?? submission.poem_text, genre: draft.genre ?? submission.genre, historical_period: draft.historical_period ?? submission.historical_period, notes: draft.notes ?? submission.notes }
  function save(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const next = payload(); const bounds: Record<string, number> = { title: 500, authors: 500, poem_text: 100_000, genre: 200, historical_period: 200, notes: 20_000 }; const invalid = Object.entries(next).find(([key, value]) => [...(value ?? "")].length > bounds[key]); if (invalid) { setNotice(`${({ title: "题名", authors: "作者", poem_text: "诗词正文", genre: "文体", historical_period: "时代", notes: "来源说明" } as Record<string, string>)[invalid[0]]}不得超过 ${bounds[invalid[0]]} 个字符。`); return } if (!revise.isPending) { setNotice(""); revise.mutate({ payload: next, submissionId, generation: ++reconciliationGeneration.current }) } }
  const field = (key: keyof SubmissionPatch, label: string, value: string, multiline = false) => <label className={multiline ? "submission-detail__wide" : ""}>{label}{multiline ? <textarea rows={key === "poem_text" ? 7 : 4} value={draft[key] as string ?? value} onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.value }))} /> : <input value={draft[key] as string ?? value} onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.value }))} />}</label>
  return <main className="page-shell submission-detail" id="main-content" tabIndex={-1}><Link className="breadcrumb" to="/my-submissions">我的投稿／卷宗</Link><header><p className="kicker">SUBMISSION · {submission.submission_id}</p><SubmissionSeal status={submission.status} /><h1>{submission.title || "补充已有作品扫描"}</h1><p>送交：{dateLabel(submission.submitted_at)} 最近更新：{dateLabel(submission.updated_at)}</p>{submission.published_work_id && <Link to={`/works/${encodeURIComponent(submission.published_work_id)}`}>查看已发布作品</Link>}{submission.decision_reason && <aside className="submission-detail__reason"><b>馆员修订意见</b><p>{submission.decision_reason}</p></aside>}</header>{editable ? <form className="submission-detail__form" onSubmit={save}>{scanOnly ? field("notes", "来源说明", submission.notes, true) : <>{field("title", "题名", submission.title)}{field("authors", "作者", submission.authors)}{field("genre", "文体", submission.genre)}{field("historical_period", "时代", submission.historical_period)}{field("poem_text", "诗词正文", submission.poem_text, true)}{field("notes", "来源说明", submission.notes, true)}</>}<button disabled={revise.isPending} type="submit">{revise.isPending ? "送交中…" : "重新提交审核"}</button></form> : <section className="submission-detail__readonly"><h2>著录内容</h2><dl><div><dt>作者</dt><dd>{submission.authors || "未详"}</dd></div><div><dt>文体／时代</dt><dd>{[submission.genre, submission.historical_period].filter(Boolean).join(" · ") || "未详"}</dd></div><div><dt>正文</dt><dd>{submission.poem_text || "未著录"}</dd></div><div><dt>来源说明</dt><dd>{submission.notes || "未著录"}</dd></div></dl></section>}<ReadOnlyFolios submission={submission} />{notice && <p role={notice.startsWith("已重新") ? "status" : "alert"}>{notice}</p>}</main>
}
