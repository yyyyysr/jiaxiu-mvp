import { useQuery } from "@tanstack/react-query"
import { Link, useParams, useSearchParams } from "react-router-dom"

import { api } from "../lib/api"
import type { AdminSubmissionFilters, SubmissionStatus } from "../lib/types"
import { useAuth } from "../features/auth/AuthProvider"
import { ReviewEditor } from "../features/admin/ReviewEditor"

const statuses: Array<[SubmissionStatus, string]> = [["pending", "待审"], ["needs_revision", "待修订"], ["published", "已发布"], ["rejected", "未采纳"]]

function AdminNav() { return <nav className="admin-local-nav" aria-label="管理员工作区"><Link to="/admin/reviews">审核卷宗</Link><Link to="/admin/users">用户</Link><Link to="/admin/audit">审计</Link></nav> }

export function AdminReviewsPage() {
  const { submissionId } = useParams()
  if (submissionId) return <AdminReviewDetailWithAuth submissionId={submissionId} />
  return <AdminReviewQueue />
}

function AdminReviewQueue() {
  const [params, setParams] = useSearchParams()
  const status = (params.get("status") as SubmissionStatus | null) ?? "pending"
  const filters: AdminSubmissionFilters = { status, page: 1, page_size: 20 }
  const query = useQuery({ queryKey: ["admin", "submissions", filters], queryFn: () => api.listAdminSubmissions(filters) })
  return <main id="main-content" tabIndex={-1} className="admin-page"><p className="kicker">ADMINISTRATION · REVIEW QUEUE</p><h1>审核卷宗</h1><AdminNav />
    <label className="admin-filter">队列状态<select aria-label="队列状态" value={status} onChange={(event) => setParams({ status: event.target.value })}>{statuses.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    {query.isPending ? <p role="status">正在调阅审核队列…</p> : query.isError ? <p role="alert">审核队列暂时无法读取，请稍后重试。</p> : <><p className="admin-count">待审 {query.data.total} 卷</p>{query.data.submissions.length ? <ol className="admin-list">{query.data.submissions.map((item) => <li key={item.submission_id}><div><p className="kicker">{item.submission_type === "new_work" ? "新作品" : "补充扫描"} · {item.file_count} 页</p><h2><Link to={`/admin/reviews/${encodeURIComponent(item.submission_id)}`}>{item.title || "未题名投稿"}</Link></h2><p>{item.owner_username} · {new Date(item.submitted_at).toLocaleString("zh-CN")}</p></div><Link className="admin-open" to={`/admin/reviews/${encodeURIComponent(item.submission_id)}`}>打开卷宗</Link></li>)}</ol> : <p className="review-empty">当前筛选没有投稿。</p>}</>}
  </main>
}

function AdminReviewDetailWithAuth({ submissionId }: { submissionId: string }) {
  const { csrfToken } = useAuth()
  return <AdminReviewDetail submissionId={submissionId} csrfToken={csrfToken ?? ""} />
}

function AdminReviewDetail({ submissionId, csrfToken }: { submissionId: string; csrfToken: string }) {
  const query = useQuery({ queryKey: ["admin", "submissions", submissionId], queryFn: () => api.getAdminSubmission(submissionId) })
  if (query.isPending) return <main id="main-content" tabIndex={-1} className="admin-page"><p role="status">正在调阅卷宗…</p></main>
  if (query.isError) return <main id="main-content" tabIndex={-1} className="admin-page"><p role="alert">卷宗暂时无法读取，请返回审核队列后重试。</p></main>
  return <main id="main-content" tabIndex={-1} className="admin-page"><ReviewEditor submission={query.data} csrfToken={csrfToken} /></main>
}
