import { useQuery } from "@tanstack/react-query"
import { useSearchParams } from "react-router-dom"

import { ContributionForm } from "../features/contributions/ContributionForm"
import { api } from "../lib/api"

export function ContributionPage({ csrfToken }: { csrfToken: string }) {
  const [searchParams] = useSearchParams()
  const workId = searchParams.get("work_id")?.trim() ?? ""
  const workQuery = useQuery({ queryKey: ["public-work-preselection", workId], queryFn: () => api.getWork(workId, false), enabled: Boolean(workId), retry: false })
  if (workId && workQuery.isLoading) return <main className="page-shell contribution-page" id="main-content" tabIndex={-1}><p role="status" className="system-message">正在核对公开作品…</p></main>
  return <main className="page-shell contribution-page" id="main-content" tabIndex={-1}>
    {workId && workQuery.isError && <p className="contribution-page__notice" role="alert">无法核对要补充的公开作品；请从公开目录重新选择。</p>}
    <ContributionForm key={workId || "new"} csrfToken={csrfToken} initialWork={workQuery.data} />
  </main>
}
