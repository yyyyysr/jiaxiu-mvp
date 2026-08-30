import { Link } from "react-router-dom"

import type { WorkSummary } from "../../lib/types"
import { ResearchStatus } from "./ResearchStatus"

type WorkCardProps = {
  work: WorkSummary
  view?: "card" | "compact"
  matchLabel?: string
}

export function WorkCard({ work, view = "card", matchLabel }: WorkCardProps) {
  const isRelated = work.research_status.relation_scope !== "strict_jiaxiu"
  const detailPath = `/works/${encodeURIComponent(work.work_id)}${isRelated ? "?include_related=true" : ""}`

  return (
    <article className={`work-card${view === "compact" ? " work-card--compact" : ""}`} aria-label={work.title || "无题"}>
      <span className="work-card__index" aria-hidden="true">文</span>
      <div className="work-card__body">
        <p className="work-card__eyebrow">{matchLabel && <span>{matchLabel} · </span>}{work.historical_period || "年代未详"} · {work.genre || "文体未详"}</p>
        <h2><Link to={detailPath}>{work.title || "无题"}</Link></h2>
        <p className="work-card__author">{work.authors || "作者未详"}</p>
        <ResearchStatus status={work.research_status} />
        {work.excerpt && <blockquote className="work-card__excerpt">{work.excerpt}</blockquote>}
      </div>
      <div className="work-card__folio" aria-label={`影像记录 ${work.facsimile_count} 项`}>
        <b>{String(work.facsimile_count).padStart(2, "0")}</b>
        <span>影像</span>
      </div>
    </article>
  )
}
