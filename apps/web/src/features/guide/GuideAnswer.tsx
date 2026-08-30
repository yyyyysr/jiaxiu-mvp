import { Link } from "react-router-dom"

import type { ChatResponse } from "../../lib/types"
import { ResearchStatus } from "../works/ResearchStatus"

type GuideAnswerProps = {
  response: ChatResponse
  onApplyScene: () => void
}

const METADATA_LABELS: Record<string, string> = { authors: "作者", notes: "备注", facsimiles: "影像" }

export function GuideAnswer({ response, onApplyScene }: GuideAnswerProps) {
  return (
    <div className="guide-answer" aria-live="polite">
      <div className="guide-answer__mode">
        <span>{response.mode === "demo" ? "演示模式" : "AI 模式"}</span>
        <span>{response.mode === "demo" ? "DATABASE / TEMPLATE" : "MODEL / GROUNDED"}</span>
      </div>
      <p className="guide-answer__intro">{response.poetic_intro}</p>
      <p className="guide-answer__body">{response.answer}</p>
      {response.citations.length > 0 && (
        <section className="guide-citations" aria-label="回答引证">
          <p>据此作答</p>
          <ol>
            {response.citations.map((citation) => (
              <li key={citation.work_id}>
                <div className="guide-citations__excerpt" role="group" aria-label="正文摘引">
                  <span>{citation.authors || "作者待考"}</span>
                  <q>{citation.excerpt}</q>
                </div>
                {citation.season_association && (
                  <div className={`guide-season-association guide-season-association--${citation.season_association.review_status}`} role="group" aria-label="季候关联依据">
                    <p>
                      <span>{citation.season_association.review_status === "candidate" ? "关联推荐" : "季候关联"}</span>
                      <span>{citation.season_association.review_status === "candidate" ? "候选证据" : "已审核"}</span>
                    </p>
                    <q>{citation.season_association.evidence_quote}</q>
                  </div>
                )}
                {citation.metadata_field && citation.metadata_evidence && (
                  <div className={`guide-metadata guide-metadata--${citation.metadata_field}`} role="group" aria-label="著录命中依据">
                    <p><span>{METADATA_LABELS[citation.metadata_field] ?? citation.metadata_field}依据</span><span>著录命中</span></p>
                    <q>{citation.metadata_evidence}</q>
                  </div>
                )}
                <ResearchStatus status={citation.research_status} expanded />
                <Link to={`/works/${encodeURIComponent(citation.work_id)}`} aria-label={`查看作品《${citation.title}》`}>
                  《{citation.title}》
                </Link>
              </li>
            ))}
          </ol>
        </section>
      )}
      <p className="guide-answer__uncertainty">{response.uncertainty}</p>
      {response.scene_action && (
        <button className="guide-action guide-action--apply guide-hit-target" type="button" onClick={onApplyScene}>
          应用此季景
        </button>
      )}
    </div>
  )
}
