import { useQuery } from "@tanstack/react-query"
import { useState, type FormEvent } from "react"
import { Link, useSearchParams } from "react-router-dom"

import { WorkCard } from "../features/works/WorkCard"
import { api } from "../lib/api"
import type { Season, WorkFilters, WorkSort } from "../lib/types"

const PAGE_SIZE = 12
const SCOPES = ["strict_jiaxiu", "site_origin", "nearby_prebuild", "adjacent_complex", "all"] as const
const SEASONS = ["spring", "summer", "autumn", "winter"] as const
const SORTS = ["relevance", "date_asc", "date_desc", "title_asc", "title_desc"] as const

const scopeLabels: Record<(typeof SCOPES)[number], string> = {
  strict_jiaxiu: "直接题咏甲秀楼",
  site_origin: "旧址营建文本",
  nearby_prebuild: "同址前史",
  adjacent_complex: "毗邻景观",
  all: "全部研究范围",
}

function positiveInteger(value: string | null, fallback: number): number {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function optionalInteger(value: string | null): number | undefined {
  if (!value) return undefined
  const parsed = Number(value)
  return Number.isInteger(parsed) ? parsed : undefined
}

function oneOf<T extends string>(value: string | null, options: readonly T[], fallback: T): T {
  return options.includes(value as T) ? value as T : fallback
}

function matchLabel(matchType?: string): string | undefined {
  if (matchType === "text") return "正文命中"
  if (matchType === "title") return "题名命中"
  if (matchType === "metadata") return "著录命中"
  return undefined
}

function ArchiveSearch({ queryText, onSubmit }: { queryText: string; onSubmit: (query: string) => void }) {
  const [draft, setDraft] = useState(queryText)

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    onSubmit(draft.trim())
  }

  return (
    <form className="search-form" onSubmit={submit}>
      <label htmlFor="archive-search">检索题名、正文或作者</label>
      <div>
        <input id="archive-search" name="q" value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={200} placeholder="如：重阳" />
        <button>检索</button>
      </div>
    </form>
  )
}

export function WorksPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [filtersOpen, setFiltersOpen] = useState(false)
  const queryText = searchParams.get("q")?.trim() ?? ""
  const page = positiveInteger(searchParams.get("page"), 1)
  const legacyExpanded = searchParams.get("include_related") === "true"
  const relationScope = oneOf(searchParams.get("relation_scope"), SCOPES, legacyExpanded ? "all" : "strict_jiaxiu")
  const season = oneOf(searchParams.get("season"), SEASONS, "spring")
  const hasSeason = SEASONS.includes(searchParams.get("season") as Season)
  const defaultSort: WorkSort = queryText ? "relevance" : "date_asc"
  const sort = oneOf(searchParams.get("sort"), SORTS, defaultSort)
  const view = searchParams.get("view") === "compact" ? "compact" : "card"

  const filters: WorkFilters = {
    q: queryText || undefined,
    author: searchParams.get("author")?.trim() || undefined,
    period: searchParams.get("period")?.trim() || undefined,
    date_from: optionalInteger(searchParams.get("date_from")),
    date_to: optionalInteger(searchParams.get("date_to")),
    genre: searchParams.get("genre")?.trim() || undefined,
    season: hasSeason ? season : undefined,
    relation_scope: relationScope,
    authenticity: searchParams.get("authenticity")?.trim() || undefined,
    completeness: searchParams.get("completeness")?.trim() || undefined,
    has_facsimile: searchParams.get("has_facsimile") === "true"
      ? true
      : searchParams.get("has_facsimile") === "false" ? false : undefined,
    sort,
    page,
    page_size: PAGE_SIZE,
  }

  const worksQuery = useQuery({
    queryKey: ["works", filters],
    queryFn: () => api.listWorks(filters),
  })

  function updateParams(updates: Record<string, string | undefined>, resetPage = true) {
    const next = new URLSearchParams(searchParams)
    Object.entries(updates).forEach(([key, value]) => {
      if (value) next.set(key, value)
      else next.delete(key)
    })
    if (resetPage) next.delete("page")
    setSearchParams(next)
  }

  function pageHref(target: number): string {
    const next = new URLSearchParams(searchParams)
    next.set("page", String(target))
    return `?${next.toString()}`
  }

  function clearFilters() {
    const next = new URLSearchParams()
    if (view === "compact") next.set("view", "compact")
    setSearchParams(next)
  }

  const response = worksQuery.data
  const total = response?.total
  const totalPages = response ? Math.max(1, response.pages) : 1
  const countLabel = queryText
    ? `检索“${queryText}”${total === undefined ? "" : ` · ${total} 件`}`
    : `${relationScope === "strict_jiaxiu" ? "直接题咏" : "扩展范围"} ${total === undefined ? "正在校理…" : `${total} 件`}`

  return (
    <main className="works-page page-shell" id="main-content" tabIndex={-1}>
      <header className="page-intro">
        <div className="vertical-slip" aria-hidden="true">题咏志</div>
        <div>
          <p className="kicker">ARCHIVE · 典籍与碑刻</p>
          <h1>水光之上的<br />文字遗痕</h1>
          <p className="page-intro__lede">沿版本、作者与影像线索，阅读围绕甲秀楼生长的诗文。</p>
        </div>
      </header>

      <section className="archive-tools" aria-label="检索与筛选">
        <ArchiveSearch key={queryText} queryText={queryText} onSubmit={(query) => updateParams({ q: query || undefined })} />
        <button className="filter-trigger" type="button" aria-expanded={filtersOpen} onClick={() => setFiltersOpen((open) => !open)}>
          {filtersOpen ? "收起筛选" : "展开筛选"}<span aria-hidden="true">{filtersOpen ? "－" : "＋"}</span>
        </button>
      </section>

      {filtersOpen && (
        <aside className="filter-drawer" aria-label="作品筛选">
          <p className="filter-drawer__note">关键词、年代、作者、文体、季节与研究状态可交叉使用；系统不会自动扩大收录范围。</p>
          <label>作者<input value={searchParams.get("author") ?? ""} onChange={(event) => updateParams({ author: event.target.value || undefined })} placeholder="如：洪亮吉" /></label>
          <label>时代<select value={searchParams.get("period") ?? ""} onChange={(event) => updateParams({ period: event.target.value || undefined })}><option value="">全部时代</option><option>明</option><option>明（传）</option><option>清</option><option>清末民初（民国初刊）</option><option>民国</option></select></label>
          <label>起始年<input type="number" inputMode="numeric" min="1400" max="1950" value={searchParams.get("date_from") ?? ""} onChange={(event) => updateParams({ date_from: event.target.value || undefined })} placeholder="1500" /></label>
          <label>结束年<input type="number" inputMode="numeric" min="1400" max="1950" value={searchParams.get("date_to") ?? ""} onChange={(event) => updateParams({ date_to: event.target.value || undefined })} placeholder="1949" /></label>
          <label>文体<input list="genre-options" value={searchParams.get("genre") ?? ""} onChange={(event) => updateParams({ genre: event.target.value || undefined })} placeholder="如：七言律诗" /><datalist id="genre-options">{["七言律诗", "七言律诗二首", "七言绝句", "七言绝句二首", "七言绝句二首并跋", "七言绝句四首", "五言古诗", "五言律诗", "五言排律", "五言排律并序", "五言排律联句并跋", "古体诗", "旅行散文", "旅行记", "楹联", "游记", "碑记", "碑铭", "赋并序"].map((genre) => <option value={genre} key={genre} />)}</datalist></label>
          <label>季节<select value={hasSeason ? season : ""} onChange={(event) => updateParams({ season: event.target.value || undefined })}><option value="">全部四时</option><option value="spring">春</option><option value="summer">夏</option><option value="autumn">秋</option><option value="winter">冬</option></select></label>
          <label>收录范围<select value={relationScope} onChange={(event) => updateParams({ relation_scope: event.target.value, include_related: undefined })}>{SCOPES.map((scope) => <option key={scope} value={scope}>{scopeLabels[scope]}</option>)}</select></label>
          <label>真实性<select value={searchParams.get("authenticity") ?? ""} onChange={(event) => updateParams({ authenticity: event.target.value || undefined })}><option value="">全部状态</option><option value="confirmed">已确认</option><option value="attributed">传为此作</option><option value="disputed">归属存疑</option></select></label>
          <label>文本完整度<select value={searchParams.get("completeness") ?? ""} onChange={(event) => updateParams({ completeness: event.target.value || undefined })}><option value="">全部文本</option><option value="complete">全文</option><option value="fragment">残篇或节录</option></select></label>
          <label>影像状态<select value={searchParams.get("has_facsimile") ?? ""} onChange={(event) => updateParams({ has_facsimile: event.target.value || undefined })}><option value="">不限</option><option value="true">有影像著录</option><option value="false">暂无影像著录</option></select></label>
          <label>排序方式<select value={sort} onChange={(event) => updateParams({ sort: event.target.value })}><option value="relevance">相关度</option><option value="date_asc">年代：早至晚</option><option value="date_desc">年代：晚至早</option><option value="title_asc">题名：正序</option><option value="title_desc">题名：倒序</option></select></label>
          <button className="filter-reset" type="button" onClick={clearFilters}>清除检索与筛选</button>
        </aside>
      )}

      <div className="archive-layout">
        <aside className="archive-margin">
          <span>收录原则</span>
          <p>默认呈现 41 件直接题咏。所有扩展范围均由读者主动选择，并在作品详情中保留关系说明。</p>
          <span>当前范围</span>
          <p>{scopeLabels[relationScope]}</p>
        </aside>
        <section className="works-results" aria-live="polite" aria-busy={worksQuery.isLoading}>
          <div className="results-heading">
            <h2 className="result-count">{countLabel}</h2>
            <div className="view-switcher" role="group" aria-label="结果显示方式">
              <button type="button" aria-label="卡片视图" aria-pressed={view === "card"} onClick={() => updateParams({ view: undefined }, false)}>卡</button>
              <button type="button" aria-label="紧凑列表" aria-pressed={view === "compact"} onClick={() => updateParams({ view: "compact" }, false)}>目</button>
            </div>
          </div>

          {worksQuery.isLoading && <p className="system-message">墨迹正在显影，请稍候。</p>}
          {worksQuery.isError && <p role="alert" className="system-message system-message--error">资料暂不可读取，请确认研究服务已启动后重试。</p>}

          {response?.items.map((work) => <WorkCard key={work.work_id} work={work} view={view} matchLabel={matchLabel(work.match_type)} />)}
          {response?.items.length === 0 && <p className="system-message">当前条件下未见作品。可清除筛选，或主动扩大收录范围。</p>}

          {response && totalPages > 1 && (
            <nav className="archive-pagination" aria-label="档案分页">
              <span className="archive-pagination__status">第 {response.page} / {totalPages} 页</span>
              <div>
                {response.page > 1 ? <Link to={pageHref(response.page - 1)} aria-label="上一页">前</Link> : <span aria-hidden="true">前</span>}
                {Array.from({ length: totalPages }, (_, index) => index + 1).map((number) => number === response.page
                  ? <span className="is-current" aria-current="page" aria-label={`第 ${number} 页`} key={number}>{String(number).padStart(2, "0")}</span>
                  : <Link to={pageHref(number)} aria-label={`第 ${number} 页`} key={number}>{String(number).padStart(2, "0")}</Link>)}
                {response.page < totalPages ? <Link to={pageHref(response.page + 1)} aria-label="下一页">后</Link> : <span aria-hidden="true">后</span>}
              </div>
            </nav>
          )}
        </section>
      </div>
    </main>
  )
}
