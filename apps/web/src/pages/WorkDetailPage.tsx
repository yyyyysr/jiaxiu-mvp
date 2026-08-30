import { useQuery } from "@tanstack/react-query"
import { Link, useParams, useSearchParams } from "react-router-dom"

import { FacsimileUpload } from "../features/facsimiles/FacsimileUpload"
import { FacsimileViewer } from "../features/facsimiles/FacsimileViewer"
import { ResearchStatus } from "../features/works/ResearchStatus"
import { api } from "../lib/api"
import type { AuthorDetail, Season, TextVariant } from "../lib/types"

const seasonLabels: Record<Season, string> = { spring: "春", summer: "夏", autumn: "秋", winter: "冬" }
const roleLabels: Record<string, string> = { author: "作者", editor: "编者", translator: "译者", attributed_author: "传称作者" }
const certaintyLabels: Record<string, string> = { confirmed: "归属已确认", attributed: "传为此人", disputed: "归属存疑", unspecified: "归属未详" }

function yearRange(start: number | null, end: number | null, fallback = "未详"): string {
  if (start === null && end === null) return fallback
  if (start === end || end === null) return String(start)
  if (start === null) return `不晚于 ${end}`
  return `${start}—${end}`
}

function authorDisplay(author: AuthorDetail): string {
  return [author.name, author.courtesy_name && `字${author.courtesy_name}`, author.art_name && `号${author.art_name}`].filter(Boolean).join(" · ")
}

function variantLines(variant: TextVariant): string[] {
  return variant.full_text.split(/\r?\n/).filter(Boolean)
}

export function WorkDetailPage() {
  const { workId = "" } = useParams()
  const [searchParams] = useSearchParams()
  const includeRelated = searchParams.get("include_related") === "true"
  const workQuery = useQuery({ queryKey: ["work", workId, includeRelated], queryFn: () => api.getWork(workId, includeRelated) })
  const facsimileQuery = useQuery({ queryKey: ["facsimiles", workId, includeRelated], queryFn: () => api.getFacsimiles(workId, includeRelated), enabled: Boolean(workQuery.data) })

  if (workQuery.isLoading) return <main className="page-shell" id="main-content" tabIndex={-1}><p className="system-message">展卷中，请稍候。</p></main>
  if (workQuery.isError || !workQuery.data) return <main className="page-shell" id="main-content" tabIndex={-1}><p role="alert" className="system-message system-message--error">此篇暂不可读取，或不在当前收录范围。</p><Link to="/works">返回题咏志</Link></main>

  const work = workQuery.data
  const lines = work.canonical_text.split(/\r?\n/).filter(Boolean)
  const selectedSeason = work.season_associations.find((association) => association.is_primary && association.review_status === "reviewed")
    ?? work.season_associations.find((association) => association.review_status === "reviewed")
    ?? work.season_associations[0]
  const sceneSeason: Season = selectedSeason?.season ?? "autumn"
  const scenePath = `/?season=${sceneSeason}`

  return (
    <main className="detail-page page-shell" id="main-content" tabIndex={-1}>
      <nav className="breadcrumb" aria-label="面包屑"><Link to="/works">题咏志</Link><span>／</span><span>正文</span></nav>
      <header className="detail-heading">
        <div>
          <p className="kicker">{work.historical_period || "时代未详"} · {work.genre || "文体未详"}</p>
          <h1>{work.title || "无题"}</h1>
          {work.alternate_titles && <p className="detail-heading__aliases">又题：{work.alternate_titles}</p>}
          <p>{work.authors || "作者未详"}</p>
        </div>
        <div className="detail-heading__actions">
          <span className="detail-seal" aria-hidden="true">读本</span>
          <Link className="scene-context-link" to={scenePath}>在场景中观看<span aria-hidden="true">↗</span></Link>
        </div>
      </header>

      <div className="reading-grid">
        <article className="poem-sheet">
          <p className="poem-sheet__date">{work.date_original || "纪年未详"}</p>
          <div className="poem-text" lang="zh-Hans">{lines.map((line, index) => <p key={`${index}-${line}`}>{line}</p>)}</div>
          {work.lineation_note && <p className="editorial-note">校录说明：{work.lineation_note}</p>}
        </article>

        <aside className="research-margin">
          <section><h2>研究状态</h2><ResearchStatus status={work.research_status} expanded /></section>
          {work.authors_detail.length > 0 && (
            <section>
              <h2>作者身份</h2>
              <ol className="author-records">{work.authors_detail.map((author) => (
                <li key={`${author.author_id}-${author.role}`}>
                  <h3>{authorDisplay(author)}</h3>
                  <p>{author.dynasty || "时代未详"} · {yearRange(author.birth_year, author.death_year, "生卒未详")}</p>
                  <p>{roleLabels[author.role] ?? author.role} · {certaintyLabels[author.certainty] ?? author.certainty}</p>
                  {author.other_names && <p>别名：{author.other_names}</p>}
                  {author.attribution_note && <p>{author.attribution_note}</p>}
                </li>
              ))}</ol>
            </section>
          )}
          <section><h2>影像记录</h2>
            <FacsimileUpload workId={workId} />
            {facsimileQuery.isLoading && <p>正在核对影像清单…</p>}
            {facsimileQuery.data?.length === 0 && <p>本篇尚无影像记录。</p>}
            {facsimileQuery.data && facsimileQuery.data.length > 0 && <FacsimileViewer items={facsimileQuery.data} workTitle={work.title} workText={work.canonical_text} />}
            {facsimileQuery.isError && <p role="alert">影像清单暂不可读取。</p>}
          </section>
          <section>
            <h2>著录信息</h2>
            <dl className="metadata-list">
              <div><dt>时代</dt><dd>{work.historical_period || "未详"}</dd></div>
              <div><dt>年号</dt><dd>{work.era || "未详"}</dd></div>
              <div><dt>推定年代</dt><dd>{yearRange(work.year_start, work.year_end)}</dd></div>
              <div><dt>原始纪年</dt><dd>{work.date_original || "未详"}</dd></div>
              <div><dt>作者角色</dt><dd>{work.author_roles || "未详"}</dd></div>
              <div><dt>文字形态</dt><dd>{work.text_script || "未详"}</dd></div>
              {work.inscription_number && <div><dt>碑刻编号</dt><dd>{work.inscription_number}</dd></div>}
            </dl>
          </section>
        </aside>
      </div>

      <div className="research-interpretation-grid">
        <section>
          <p className="kicker">INTERPRETATION</p>
          <h2>研究释读</h2>
          <p>{work.notes || "本篇尚无补充研究附记。"}</p>
          {work.lineation_note && <p>校录说明：{work.lineation_note}</p>}
        </section>
        <section>
          <p className="kicker">SPATIAL RELATION</p>
          <h2>景观与四时关系</h2>
          <p>{work.location_context || "地点语境尚待进一步著录。"}</p>
          <ResearchStatus status={work.research_status} />
          {work.season_associations.length > 0 ? (
            <ul className="season-evidence-list">{work.season_associations.map((association, index) => (
              <li key={`${association.season}-${index}`}><b>{seasonLabels[association.season]}景</b><span>{association.review_status === "reviewed" ? "已审核" : "候选"}</span><blockquote>{association.evidence_quote}</blockquote></li>
            ))}</ul>
          ) : <p>尚无经审核的四时关联。</p>}
        </section>
      </div>

      <section className="variants-section">
        <div><p className="kicker">VARIANTS</p><h2>文本异文</h2><p>主文本之外的转录与版本差异，不静默合并。</p></div>
        {work.text_variants.length > 0 ? (
          <div className="variant-list">{work.text_variants.map((variant) => (
            <details key={variant.variant_id}>
              <summary><span>{variant.label}</span><small>{variant.is_canonical ? "主文本" : "异文"} · {variant.locator || "位置未详"}</small></summary>
              <div className="variant-sheet" lang="zh-Hans">{variantLines(variant).map((line, index) => <p key={`${index}-${line}`}>{line}</p>)}</div>
              <p>{variant.variant_type || "类型未详"} · {variant.transcription_status} · {variant.completeness}</p>
              {variant.notes && <p>{variant.notes}</p>}
            </details>
          ))}</div>
        ) : <p className="system-message">当前未著录独立异文。</p>}
      </section>

      <section className="sources-section">
        <div><p className="kicker">EVIDENCE</p><h2>版本与来源</h2></div>
        {work.sources.length > 0 ? (
          <ol>{work.sources.map((source) => <li key={`${source.source_id}-${source.role}`}><p>{source.is_primary ? "原始来源" : "参考来源"} · {source.role}</p><h3>{source.title}</h3><span>{[source.author_editor, source.publisher, source.publication_year, source.locator].filter(Boolean).join(" · ")}</span>{source.evidence_note && <blockquote>{source.evidence_note}</blockquote>}{source.url && <a href={source.url} rel="noreferrer" target="_blank">访问来源</a>}</li>)}</ol>
        ) : <p className="system-message">来源条目尚待补充。</p>}
      </section>
    </main>
  )
}
