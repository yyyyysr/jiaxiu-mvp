import { useQueryClient } from "@tanstack/react-query"
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { Link, useNavigate } from "react-router-dom"

import { ApiError, api } from "../../lib/api"
import type { AdminSubmission, AdminSubmissionFile, AdminSubmissionPatch, SubmissionStatus } from "../../lib/types"
import { AdminDialog } from "./AdminDialog"

type ReviewEditorProps = { submission: AdminSubmission; csrfToken: string; onCanonical?: (submission: AdminSubmission) => void }
type MetadataDraft = Pick<AdminSubmission, "title" | "authors" | "poem_text" | "genre" | "historical_period" | "notes">
type Decision = "publish" | "revision" | "reject"
const metadataFields: (keyof MetadataDraft)[] = ["title", "authors", "poem_text", "genre", "historical_period", "notes"]
const metadataLimits: Record<keyof MetadataDraft, number> = { title: 500, authors: 500, poem_text: 100_000, genre: 200, historical_period: 200, notes: 20_000 }
const fieldLabels: Record<keyof MetadataDraft, string> = { title: "题名", authors: "作者", poem_text: "诗词正文", genre: "文体", historical_period: "时代", notes: "来源说明" }
const statusLabels: Record<SubmissionStatus, string> = { pending: "待审", needs_revision: "待修订", published: "已发布", rejected: "未采纳" }

function metadataFrom(submission: AdminSubmission): MetadataDraft {
  return Object.fromEntries(metadataFields.map((key) => [key, submission[key]])) as MetadataDraft
}

function visibleError(error: unknown): string {
  if (error instanceof ApiError) return `${error.message}${error.requestId ? `（请求编号：${error.requestId}）` : ""}`
  return "操作暂时无法完成，请稍后重试。"
}

function safeDate(value: string | null): string {
  const date = value ? new Date(value) : null
  return date && !Number.isNaN(date.getTime()) ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(date) : "日期未记录"
}

function usePrivateFolioPreviews(submissionId: string, files: AdminSubmissionFile[]) {
  const [previews, setPreviews] = useState<Record<string, string>>({})
  const [failures, setFailures] = useState<Record<string, true>>({})
  const shown = useRef<Record<string, string>>({})
  const retired = useRef<string[]>([])
  const owned = useRef(new Set<string>())
  const revoked = useRef(new Set<string>())
  const mounted = useRef(false)
  const generation = useRef(0)
  const filesRef = useRef(files)
  const pendingAdoption = useRef<{ urls: Set<string>; adopted: boolean } | null>(null)
  const fingerprint = files.map((file) => `${file.file_id}:${file.sha256}`).join("|")

  const revoke = (url: string) => {
    owned.current.delete(url)
    if (!revoked.current.has(url)) { revoked.current.add(url); URL.revokeObjectURL?.(url) }
  }

  useLayoutEffect(() => {
    const old = shown.current
    shown.current = previews
    retired.current.splice(0).forEach(revoke)
    Object.values(old).filter((url) => !Object.values(previews).includes(url)).forEach(revoke)
    const adoption = pendingAdoption.current
    if (adoption && Object.values(previews).some((url) => adoption.urls.has(url))) { adoption.adopted = true; pendingAdoption.current = null }
  }, [previews])

  useLayoutEffect(() => { filesRef.current = files }, [fingerprint, files])
  useEffect(() => {
    mounted.current = true
    const ownership = owned.current
    return () => { mounted.current = false; generation.current += 1; queueMicrotask(() => { if (!mounted.current) ownership.forEach(revoke) }) }
  }, [])

  useEffect(() => {
    const current = ++generation.current
    const currentFiles = filesRef.current
    const run = { urls: new Set<string>(), adopted: false, active: true }
    const next: Record<string, string> = {}, failed: Record<string, true> = {}
    void Promise.allSettled(currentFiles.map(async (file) => {
      const blob = await api.getAdminSubmissionFile(submissionId, file.file_id)
      if (typeof URL.createObjectURL !== "function") throw new Error("object URL unavailable")
      const url = URL.createObjectURL(blob)
      owned.current.add(url)
      if (!run.active || current !== generation.current || !mounted.current) { revoke(url); throw new Error("stale preview") }
      run.urls.add(url)
      return { file, url }
    })).then((results) => {
      results.forEach((result, index) => {
        if (result.status === "fulfilled") next[result.value.file.file_id] = result.value.url
        else if (currentFiles[index]) failed[currentFiles[index].file_id] = true
      })
      if (!run.active || current !== generation.current || !mounted.current) { run.urls.forEach(revoke); return }
      pendingAdoption.current = run
      retired.current.push(...Object.values(shown.current))
      setFailures(failed)
      setPreviews(next)
    })
    return () => { run.active = false; if (!run.adopted) run.urls.forEach(revoke) }
  }, [submissionId, fingerprint])
  return { previews, failures }
}

export function ReviewEditor({ submission: initialSubmission, csrfToken, onCanonical }: ReviewEditorProps) {
  const client = useQueryClient(), navigate = useNavigate()
  const [submission, setSubmission] = useState(initialSubmission)
  const [draft, setDraft] = useState(() => metadataFrom(initialSubmission))
  const [order, setOrder] = useState(() => [...initialSubmission.files].sort((a, b) => a.sequence - b.sequence).map((file) => file.file_id))
  const [removed, setRemoved] = useState<string[]>([])
  const [selected, setSelected] = useState(initialSubmission.files[0]?.file_id ?? "")
  const [reason, setReason] = useState("")
  const [confirmDecision, setConfirmDecision] = useState<Decision | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<AdminSubmissionFile | null>(null)
  const [pendingNavigation, setPendingNavigation] = useState<string | null>(null)
  const [busy, setBusy] = useState<"save" | Decision | null>(null)
  const [notice, setNotice] = useState("")
  const [error, setError] = useState("")
  const mounted = useRef(false), operation = useRef(0), bypassNavigation = useRef(false), errorRef = useRef<HTMLParagraphElement>(null)
  const activeFiles = useMemo(() => order.filter((id) => !removed.includes(id)).map((id) => submission.files.find((file) => file.file_id === id)).filter((file): file is AdminSubmissionFile => Boolean(file)), [order, removed, submission.files])
  const previews = usePrivateFolioPreviews(submission.submission_id, activeFiles)
  const dirty = metadataFields.some((key) => draft[key] !== submission[key]) || removed.length > 0 || activeFiles.some((file, index) => file.file_id !== [...submission.files].sort((a, b) => a.sequence - b.sequence)[index]?.file_id)
  const editable = submission.status === "pending"

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; operation.current += 1 } }, [])
  useEffect(() => { if (error) errorRef.current?.focus() }, [error])
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = "" }
    const guardLink = (event: MouseEvent) => {
      if (bypassNavigation.current || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const anchor = (event.target as Element | null)?.closest("a[href]") as HTMLAnchorElement | null
      if (!anchor || anchor.target || anchor.origin !== window.location.origin) return
      event.preventDefault(); event.stopPropagation(); setPendingNavigation(`${anchor.pathname}${anchor.search}${anchor.hash}`)
    }
    window.addEventListener("beforeunload", warn)
    document.addEventListener("click", guardLink, true)
    return () => { window.removeEventListener("beforeunload", warn); document.removeEventListener("click", guardLink, true) }
  }, [dirty])

  function installCanonical(next: AdminSubmission) {
    if (!mounted.current) return
    setSubmission(next); setDraft(metadataFrom(next)); setOrder([...next.files].sort((a, b) => a.sequence - b.sequence).map((file) => file.file_id)); setRemoved([])
    if (!next.files.some((file) => file.file_id === selected)) setSelected(next.files[0]?.file_id ?? "")
    client.setQueryData(["admin", "submissions", next.submission_id], next)
    onCanonical?.(next)
  }

  async function invalidate(next?: AdminSubmission) {
    const keys = [["admin", "submissions"], ["private", "submissions"], ["works"], ["search"], ["season"]]
    if (next?.published_work_id) keys.push(["work", next.published_work_id])
    await Promise.allSettled(keys.map((queryKey) => client.invalidateQueries({ queryKey, refetchType: "all" })))
  }

  async function reconcile(result: AdminSubmission | undefined, version: number) {
    if (result && mounted.current && operation.current === version) installCanonical(result)
    let canonical: AdminSubmission | undefined
    try { canonical = await api.getAdminSubmission(submission.submission_id) } catch { /* retain the known response */ }
    if (canonical && mounted.current && operation.current === version) installCanonical(canonical)
    await invalidate(canonical ?? result)
    return canonical ?? result
  }

  async function save() {
    if (busy || !editable) return
    const invalid = metadataFields.find((key) => [...draft[key]].length > metadataLimits[key])
    if (invalid) { setError(`${fieldLabels[invalid]}不得超过 ${metadataLimits[invalid]} 个字符。`); return }
    const version = ++operation.current
    setBusy("save"); setError(""); setNotice("")
    const payload: AdminSubmissionPatch = { ...draft, file_order: activeFiles.map((file) => file.file_id), remove_file_ids: removed }
    try {
      const result = await api.updateAdminSubmission(submission.submission_id, payload, csrfToken)
      await reconcile(result, version)
      if (mounted.current && operation.current === version) setNotice("著录与扫描次序已保存。")
    } catch (failure) {
      await reconcile(undefined, version)
      if (mounted.current && operation.current === version) setError(visibleError(failure))
    } finally { if (mounted.current && operation.current === version) setBusy(null) }
  }

  function askDecision(decision: Decision) {
    if (busy || !editable) return
    if (decision !== "publish") {
      const trimmed = reason.trim()
      if (trimmed.length < 3) { setError(decision === "revision" ? "请填写退回原因（至少 3 个字符）。" : "请填写不采纳原因（至少 3 个字符）。"); return }
      if ([...trimmed].length > 1000) { setError("裁决原因不得超过 1000 个字符。"); return }
    }
    setError(""); setConfirmDecision(decision)
  }

  async function decide(decision: Decision) {
    if (busy || !editable) return
    const version = ++operation.current
    setBusy(decision); setConfirmDecision(null); setError(""); setNotice("")
    const desired: SubmissionStatus = decision === "publish" ? "published" : decision === "revision" ? "needs_revision" : "rejected"
    try {
      const result = decision === "publish" ? await api.publishSubmission(submission.submission_id, csrfToken) : decision === "revision" ? await api.requestSubmissionRevision(submission.submission_id, { reason: reason.trim() }, csrfToken) : await api.rejectSubmission(submission.submission_id, { reason: reason.trim() }, csrfToken)
      await reconcile(result, version)
      if (mounted.current && operation.current === version) setNotice(decision === "publish" ? "投稿已发布入藏。" : decision === "revision" ? "修订意见已送交投稿人。" : "投稿已标记为不采纳。")
    } catch (failure) {
      const canonical = await reconcile(undefined, version)
      if (mounted.current && operation.current === version) {
        if (canonical?.status === desired) setNotice("裁决已完成，并已从档案服务核对最新状态。")
        else setError(visibleError(failure))
      }
    } finally { if (mounted.current && operation.current === version) setBusy(null) }
  }

  const selectedFile = activeFiles.find((file) => file.file_id === selected) ?? activeFiles[0]
  const move = (fileId: string, by: -1 | 1) => setOrder((current) => { const retained = current.filter((id) => !removed.includes(id)); const from = retained.indexOf(fileId), to = from + by; if (from < 0 || to < 0 || to >= retained.length) return current; const next = [...current], currentFrom = next.indexOf(fileId), swapId = retained[to], currentTo = next.indexOf(swapId); [next[currentFrom], next[currentTo]] = [next[currentTo], next[currentFrom]]; return next })
  const field = (key: keyof MetadataDraft, rows?: number) => <label className={rows ? "review-field review-field--wide" : "review-field"}><span>{fieldLabels[key]}</span>{rows ? <textarea rows={rows} disabled={!editable || Boolean(busy)} value={draft[key]} onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.value }))} /> : <input disabled={!editable || Boolean(busy)} value={draft[key]} onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.value }))} />}<small>{[...draft[key]].length} / {metadataLimits[key]}</small></label>

  return (
    <article className="review-editor">
      <header className="review-editor__heading">
        <div><p className="kicker">REVIEW FOLIO · {submission.submission_id}</p><h1>{submission.title || "未题名投稿"}</h1><p>投稿人 <b>{submission.owner_username}</b> · 送交 {safeDate(submission.submitted_at)} · 更新 {safeDate(submission.updated_at)}</p></div>
        <span className={`review-seal review-seal--${submission.status}`}>{statusLabels[submission.status]}</span>
      </header>
      <nav className="admin-local-nav" aria-label="管理员工作区"><Link to="/admin/reviews" aria-current="page">审核卷宗</Link><Link to="/admin/users">用户</Link><Link to="/admin/audit">审计</Link></nav>
      {submission.decision_reason && <aside className="review-annotation"><b>裁决批注</b><p>{submission.decision_reason}</p></aside>}
      {!editable && <p className="review-readonly">此卷已定稿，著录与裁决均为只读。</p>}
      {error && <p ref={errorRef} tabIndex={-1} role="alert" className="admin-message admin-message--error">{error}</p>}
      {notice && <p role="status" className="admin-message">{notice}</p>}
      <div className="review-editor__desk">
        <section className="review-folio-viewer" aria-labelledby="folio-heading">
          <div className="review-section-heading"><p>01</p><div><h2 id="folio-heading">扫描卷页</h2><span>{activeFiles.length} 页保留</span></div></div>
          {selectedFile ? <div className="review-folio-viewer__stage">{previews.previews[selectedFile.file_id] ? <img src={previews.previews[selectedFile.file_id]} alt={`扫描预览：${selectedFile.original_name}`} /> : previews.failures[selectedFile.file_id] ? <p role="alert">此页影像暂时无法读取。</p> : <p role="status">正在调阅影像…</p>}</div> : <p className="review-empty">本卷未附扫描影像。</p>}
          {activeFiles.length > 0 && <ol className="review-thumbnails">{activeFiles.map((file, index) => <li key={file.file_id}><button type="button" aria-pressed={selectedFile?.file_id === file.file_id} onClick={() => setSelected(file.file_id)}>{previews.previews[file.file_id] ? <img src={previews.previews[file.file_id]} alt="" /> : <span>{index + 1}</span>}<b>第 {index + 1} 页</b><small>{file.original_name}</small></button><div><button disabled={!editable || Boolean(busy) || index === 0} type="button" aria-label={`上移扫描 ${file.original_name}`} onClick={() => move(file.file_id, -1)}>上移</button><button disabled={!editable || Boolean(busy) || index === activeFiles.length - 1} type="button" aria-label={`下移扫描 ${file.original_name}`} onClick={() => move(file.file_id, 1)}>下移</button><button disabled={!editable || Boolean(busy)} className="ink-danger" type="button" aria-label={`删除扫描 ${file.original_name}`} onClick={() => setDeleteTarget(file)}>删除</button></div></li>)}</ol>}
        </section>
        <section className="review-catalogue" aria-labelledby="catalogue-heading">
          <div className="review-section-heading"><p>02</p><div><h2 id="catalogue-heading">著录校订</h2><span>{submission.submission_type === "new_work" ? "新作品著录" : `已有作品扫描 · ${submission.existing_work_id ?? "未关联"}`}</span></div></div>
          <div className="review-catalogue__fields">{field("title")}{field("authors")}{field("genre")}{field("historical_period")}{field("poem_text", 9)}{field("notes", 5)}</div>
          {editable && <button className="admin-primary" disabled={Boolean(busy) || !dirty} type="button" onClick={save}>{busy === "save" ? "保存中…" : "保存著录"}</button>}
        </section>
      </div>
      <section className="review-history"><div className="review-section-heading"><p>03</p><div><h2>修订轨迹</h2><span>{submission.revisions.length} 条留痕</span></div></div>{submission.revisions.length ? <ol>{submission.revisions.map((revision) => <li key={revision.revision_id}><time>{safeDate(revision.created_at)}</time><b>{revision.actor_username || "系统"}</b><span>{revision.action}</span></li>)}</ol> : <p>尚无历史修订。</p>}</section>
      {editable && <section className="review-decisions" aria-labelledby="decision-heading"><div><p className="kicker">FINAL ANNOTATION</p><h2 id="decision-heading">裁决此卷</h2><p>发布、不采纳与退回修改均会写入不可变更的审计记录。</p></div><label>裁决说明<textarea rows={4} maxLength={1000} disabled={Boolean(busy)} value={reason} onChange={(event) => setReason(event.target.value)} /><small>退回或不采纳时必填，3–1000 字。</small></label><div><button disabled={Boolean(busy)} type="button" onClick={() => askDecision("revision")}>退回修改</button><button disabled={Boolean(busy)} className="ink-danger" type="button" onClick={() => askDecision("reject")}>不予采纳</button><button disabled={Boolean(busy) || dirty} className="decision-publish" type="button" onClick={() => askDecision("publish")}>发布入藏</button>{dirty && <small>请先保存著录，再发布。</small>}</div></section>}
      {deleteTarget && <AdminDialog title="删除这页扫描？" onClose={() => setDeleteTarget(null)}><p>将从投稿卷宗移除“{deleteTarget.original_name}”。保存著录后才会提交删除。</p><div className="admin-dialog__actions"><button type="button" onClick={() => setDeleteTarget(null)}>保留扫描</button><button className="ink-danger" type="button" onClick={() => { setRemoved((current) => [...current, deleteTarget.file_id]); setDeleteTarget(null); if (selected === deleteTarget.file_id) setSelected(activeFiles.find((file) => file.file_id !== deleteTarget.file_id)?.file_id ?? "") }}>确认删除</button></div></AdminDialog>}
      {confirmDecision && <AdminDialog title={confirmDecision === "publish" ? "确认发布入藏？" : confirmDecision === "revision" ? "确认退回修改？" : "确认不予采纳？"} onClose={() => setConfirmDecision(null)}><p>{confirmDecision === "publish" ? "发布后将形成公开档案，且此投稿不可继续编辑。" : "此项裁决会连同说明送交投稿人，并结束当前审核。"}</p><div className="admin-dialog__actions"><button type="button" onClick={() => setConfirmDecision(null)}>取消</button><button className={confirmDecision === "publish" ? "decision-publish" : "ink-danger"} type="button" onClick={() => decide(confirmDecision)}>确认{confirmDecision === "publish" ? "发布" : confirmDecision === "revision" ? "退回" : "不采纳"}</button></div></AdminDialog>}
      {pendingNavigation && <AdminDialog title="尚有未保存的校订" onClose={() => setPendingNavigation(null)}><p>离开将丢失本页的著录、排序或删除标记。</p><div className="admin-dialog__actions"><button type="button" onClick={() => setPendingNavigation(null)}>继续校订</button><button className="ink-danger" type="button" onClick={() => { const destination = pendingNavigation; setPendingNavigation(null); bypassNavigation.current = true; navigate(destination) }}>放弃并离开</button></div></AdminDialog>}
    </article>
  )
}
