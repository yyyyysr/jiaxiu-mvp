import { useQuery, useQueryClient } from "@tanstack/react-query"
import { FormEvent, useEffect, useLayoutEffect, useRef, useState } from "react"

import { ApiError, api } from "../../lib/api"
import type { WorkDetail } from "../../lib/types"

type Folio = { file: File; preview: string; digest: string }
type ContributionFormProps = { csrfToken: string; initialWork?: WorkDetail }
const MAX_FILES = 10, MAX_FILE_BYTES = 25 * 1024 * 1024, MAX_TOTAL_BYTES = 100 * 1024 * 1024
const limits = { title: 500, authors: 500, poem: 100_000, genre: 200, period: 200, notes: 20_000 }
const count = (value: string) => [...value].length
const fileSize = (size: number) => size >= 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(1)} MiB` : `${Math.ceil(size / 1024)} KiB`
const messageFor = (error: unknown) => error instanceof ApiError && typeof error.detail === "object" && error.detail !== null ? String((error.detail as { message?: string }).message ?? "投稿暂时无法送交，请稍后重试。") : "投稿暂时无法送交，请稍后重试。"

async function digest(file: File): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error("当前浏览器无法核验影像内容，请更新浏览器后重试。")
  const bytes = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", await file.arrayBuffer()))
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("")
}

export function ContributionForm({ csrfToken, initialWork }: ContributionFormProps) {
  const client = useQueryClient()
  const [mode, setMode] = useState<"new" | "existing">(initialWork ? "existing" : "new")
  const [selectedWork, setSelectedWork] = useState<WorkDetail | undefined>(initialWork)
  const [search, setSearch] = useState("")
  const [fields, setFields] = useState({ title: "", authors: "", genre: "", period: "", poem: "", notes: "" })
  const [folios, setFolios] = useState<Folio[]>([])
  const [message, setMessage] = useState(""); const [success, setSuccess] = useState(""); const [submitting, setSubmitting] = useState(false); const [processing, setProcessing] = useState(false); const [selecting, setSelecting] = useState(false)
  const foliosRef = useRef<Folio[]>([]), retired = useRef(new Set<string>()), revoked = useRef(new Set<string>()), owned = useRef(new Set<string>()), mounted = useRef(false), intakeGeneration = useRef(0), processingRef = useRef(false)
  const alertRef = useRef<HTMLParagraphElement>(null), selection = useRef(0), selectionController = useRef<AbortController | null>(null)
  const workSearch = useQuery({ queryKey: ["public-work-search", search.trim()], queryFn: () => api.searchWorks(search.trim()), enabled: mode === "existing" && search.trim().length >= 2, staleTime: 30_000 })
  const revoke = (url: string) => { owned.current.delete(url); if (!revoked.current.has(url)) { revoked.current.add(url); URL.revokeObjectURL(url) } }
  useLayoutEffect(() => { foliosRef.current = folios; for (const url of retired.current) if (!folios.some((folio) => folio.preview === url)) revoke(url); retired.current.clear() }, [folios])
  useEffect(() => {
    mounted.current = true
    const intake = intakeGeneration, choosing = selection, controller = selectionController, ownership = owned.current
    return () => { mounted.current = false; intake.current++; choosing.current++; controller.current?.abort(); queueMicrotask(() => { if (!mounted.current) ownership.forEach(revoke) }) }
  }, [])
  useEffect(() => { if (message) alertRef.current?.focus() }, [message])
  useEffect(() => () => selectionController.current?.abort(), [])
  function retire(items: Folio[]) { items.forEach((folio) => retired.current.add(folio.preview)) }
  function reset() { intakeGeneration.current++; processingRef.current = false; setProcessing(false); selectionController.current?.abort(); setSelecting(false); setSelectedWork(undefined); setSearch(""); setFields({ title: "", authors: "", genre: "", period: "", poem: "", notes: "" }); retire(foliosRef.current); setFolios([]) }
  function selectMode(next: "new" | "existing") { if (processingRef.current) return; selectionController.current?.abort(); selection.current++; setSelecting(false); setMode(next); setMessage(""); setSuccess(""); if (next === "new") setSelectedWork(undefined) }
  async function addFolios(files: File[]) {
    if (processingRef.current || files.length === 0) return
    processingRef.current = true; setProcessing(true); setMessage(""); const generation = intakeGeneration.current
    try {
      const candidates: Array<{ file: File; digest: string }> = []
      for (const file of files) {
        if (!['image/jpeg', 'image/png'].includes(file.type)) throw new Error("仅支持 JPG 或 PNG 影像。")
        if (file.size > MAX_FILE_BYTES) throw new Error("单张影像不得超过 25 MiB。")
        candidates.push({ file, digest: await digest(file) })
      }
      if (!mounted.current || generation !== intakeGeneration.current) return
      const base = foliosRef.current; const known = new Set(base.map((folio) => folio.digest)); const unique = candidates.filter((candidate) => !known.has(candidate.digest) && (known.add(candidate.digest), true))
      const proposed = [...base, ...unique]
      if (proposed.length > MAX_FILES) throw new Error("最多上传 10 张影像扫描。")
      if (proposed.reduce((total, item) => total + item.file.size, 0) > MAX_TOTAL_BYTES) throw new Error("影像总大小不得超过 100 MiB。")
      if (unique.length < candidates.length) setMessage("重复影像不会再次加入卷宗。")
      const additions = unique.map((item) => { const preview = URL.createObjectURL(item.file); owned.current.add(preview); return { ...item, preview } })
      if (!mounted.current || generation !== intakeGeneration.current) { additions.forEach((folio) => revoke(folio.preview)); return }
      if (additions.length) setFolios([...base, ...additions])
    } catch (error) { if (mounted.current && generation === intakeGeneration.current) setMessage(error instanceof Error && error.message.startsWith("当前浏览器") ? error.message : error instanceof Error && ["仅支持 JPG 或 PNG 影像。", "单张影像不得超过 25 MiB。", "最多上传 10 张影像扫描。", "影像总大小不得超过 100 MiB。"].includes(error.message) ? error.message : "影像内容核验失败，请重新选择。") } finally { if (generation === intakeGeneration.current) { processingRef.current = false; if (mounted.current) setProcessing(false) } }
  }
  function move(index: number, offset: -1 | 1) { const target = index + offset; if (target < 0 || target >= folios.length) return; const next = [...folios]; [next[index], next[target]] = [next[target], next[index]]; setFolios(next) }
  function remove(index: number) { const item = foliosRef.current[index]; if (!item) return; retired.current.add(item.preview); setFolios(foliosRef.current.filter((_, current) => current !== index)) }
  function invalidField(): string | null { for (const [key, maximum] of Object.entries(limits)) if (count(fields[key as keyof typeof fields]) > maximum) return `${({ title: "题名", authors: "作者", poem: "诗词正文", genre: "文体", period: "时代", notes: "来源说明" } as Record<string, string>)[key]}不得超过 ${maximum} 个字符。`; return null }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setMessage(""); setSuccess("")
    if (processingRef.current) return setMessage("影像正在核验，请完成后再提交。")
    if (selecting) return setMessage("正在核对所选公开作品，请稍候。")
    const issue = invalidField(); if (issue) return setMessage(issue)
    if (mode === "new" && !fields.title.trim() && !fields.poem.trim()) return setMessage("新作品至少需要题名或诗词正文。")
    if (mode === "existing" && !selectedWork) return setMessage("请先从公开目录选择一篇作品。")
    if (mode === "existing" && folios.length === 0) return setMessage("至少上传 1 张影像扫描。")
    const form = new FormData(); form.set("submission_type", mode === "existing" ? "existing_work_scan" : "new_work")
    if (mode === "existing") form.set("existing_work_id", selectedWork!.work_id); else { if (fields.title.trim()) form.set("title", fields.title.trim()); if (fields.authors.trim()) form.set("authors", fields.authors.trim()); if (fields.genre.trim()) form.set("genre", fields.genre.trim()); if (fields.period.trim()) form.set("historical_period", fields.period.trim()); if (fields.poem.trim()) form.set("poem_text", fields.poem.trim()); if (fields.notes.trim()) form.set("notes", fields.notes.trim()) }
    folios.forEach((folio) => form.append("files", folio.file)); setSubmitting(true)
    try { await api.createSubmission(form, csrfToken); await client.invalidateQueries({ queryKey: ["private", "submissions"] }); reset(); setSuccess("已送交审核，可在“我的投稿”查看进度。") } catch (error) { setMessage(messageFor(error)) } finally { setSubmitting(false) }
  }
  function choose(item: { work_id: string }) { selectionController.current?.abort(); setSelectedWork(undefined); setSelecting(true); const controller = new AbortController(); selectionController.current = controller; const generation = ++selection.current; void api.getWork(item.work_id, false, controller.signal).then((work) => { if (generation === selection.current && !controller.signal.aborted) { setSelectedWork(work); setSelecting(false) } }).catch(() => { if (generation === selection.current && !controller.signal.aborted) { setSelecting(false); setMessage("该公开作品暂时无法核对，请重新选择。") } }) }
  const set = (key: keyof typeof fields) => (value: string) => setFields((current) => ({ ...current, [key]: value }))
  return <section className="contribution-desk" aria-labelledby="contribution-desk-heading"><header className="contribution-desk__heading"><p className="kicker">ACCESSION · CONTRIBUTION</p><h1 id="contribution-desk-heading">投稿著录台</h1><p>请按卷页次序归档；提交后由馆员审核，原件不会直接公开。</p></header><div className="contribution-tabs" role="group" aria-label="投稿类型"><button type="button" disabled={processing} aria-pressed={mode === "new"} onClick={() => selectMode("new")}>著录新作品</button><button type="button" disabled={processing} aria-pressed={mode === "existing"} onClick={() => selectMode("existing")}>补充已有作品扫描</button></div><form onSubmit={submit} noValidate>{mode === "existing" ? <section className="contribution-desk__work" aria-label="关联公开作品"><label>检索公开目录<input value={search} onChange={(event) => { selectionController.current?.abort(); selection.current++; setSelecting(false); setSearch(event.target.value); setSelectedWork(undefined) }} placeholder="输入题名或作者" /></label>{selecting && <p role="status">正在核对所选公开作品…</p>}{selectedWork && <div className="contribution-desk__selected"><span aria-hidden="true">已选</span><b>{selectedWork.title}</b><small>{selectedWork.authors || "作者未详"} · {selectedWork.historical_period || "时代未详"}</small></div>}{workSearch.isFetching && <p role="status">正在检索公开目录…</p>}{workSearch.data && <ul className="contribution-desk__search" aria-label="公开作品检索结果">{workSearch.data.items.map((item) => <li key={item.work_id}><button type="button" onClick={() => choose(item)}>{item.title}<small>{item.authors || "作者未详"}</small></button></li>)}</ul>}{workSearch.isError && <p role="alert">公开目录暂时无法检索，请稍后重试。</p>}</section> : <div className="contribution-desk__fields"><label>题名<input value={fields.title} onChange={(event) => set("title")(event.target.value)} /></label><label>作者<input value={fields.authors} onChange={(event) => set("authors")(event.target.value)} /></label><label>文体<input value={fields.genre} onChange={(event) => set("genre")(event.target.value)} /></label><label>时代<input value={fields.period} onChange={(event) => set("period")(event.target.value)} /></label><label className="contribution-desk__wide">诗词正文<textarea value={fields.poem} onChange={(event) => set("poem")(event.target.value)} rows={7} /></label><label className="contribution-desk__wide">来源说明<textarea value={fields.notes} onChange={(event) => set("notes")(event.target.value)} rows={3} /></label></div>}<section className="folio-intake" aria-label="扫描卷页"><div><p className="kicker">FOLIOS</p><h2>影像扫描</h2><p>JPG / PNG；每张不超过 25 MiB，最多 10 张，总计不超过 100 MiB。</p></div><label className="folio-intake__picker">选择影像<input disabled={processing} aria-label="影像扫描" type="file" accept="image/jpeg,image/png" multiple onChange={(event) => { void addFolios(Array.from(event.currentTarget.files ?? [])); event.currentTarget.value = "" }} /></label>{processing && <p role="status">正在核验影像内容…</p>}{folios.length > 0 && <ol className="folio-intake__list" aria-label="影像扫描顺序">{folios.map((folio, index) => <li key={folio.preview}><img src={folio.preview} alt="" /><div><b>第 {index + 1} 张 · {folio.file.name}</b><small>{fileSize(folio.file.size)}</small></div><div className="folio-intake__actions"><button type="button" aria-label={`将 ${folio.file.name} 上移`} disabled={index === 0 || processing} onClick={() => move(index, -1)}>上移</button><button type="button" aria-label={`将 ${folio.file.name} 下移`} disabled={index === folios.length - 1 || processing} onClick={() => move(index, 1)}>下移</button><button type="button" aria-label={`移除 ${folio.file.name}`} disabled={processing} onClick={() => remove(index)}>移除</button></div></li>)}</ol>}</section><div className="contribution-desk__footer"><button type="submit" disabled={submitting || processing || selecting}>{submitting ? "送交中…" : processing ? "核验中…" : "提交审核"}</button><a href="/my-submissions">查看我的投稿</a></div>{message && <p className="contribution-desk__message contribution-desk__message--error" role="alert" tabIndex={-1} ref={alertRef}>{message}</p>}{success && <p className="contribution-desk__message" role="status">{success}</p>}</form></section>
}
