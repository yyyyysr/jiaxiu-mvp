import { useCallback, useEffect, useState } from "react"
import { Link, useSearchParams } from "react-router-dom"

import { GuidePanel } from "../features/guide/GuidePanel"
import { api } from "../lib/api"
import type { SeasonWork, SeasonWorksResponse } from "../lib/types"
import { detectSceneCapability } from "../scene/capability"
import { LOCAL_SCENE_CONFIG, SEASON_IDS, loadSceneConfig } from "../scene/config"
import { AmbientSoundControl } from "../scene/AmbientSoundControl"
import { SceneControls } from "../scene/SceneControls"
import { SceneFallback } from "../scene/SceneFallback"
import { SeasonAtmosphere } from "../scene/SeasonAtmosphere"
import { SplatCanvas } from "../scene/SplatCanvas"
import { readSplatManifest } from "../scene/splatManifest"
import { useSceneStore } from "../scene/store"
import type { SceneAction } from "../scene/store"
import type { SceneConfig, SeasonId, SplatAssetManifest } from "../scene/types"
import "../scene/scene.css"

type SeasonPoemState =
  | { season: SeasonId; mode: "loading" }
  | { season: SeasonId; mode: "ready"; response: SeasonWorksResponse }
  | { season: SeasonId; mode: "error" }

const SEASON_NAMES = {
  spring: "春季",
  summer: "夏季",
  autumn: "秋季",
  winter: "冬季",
} as const

function initialReducedMotion(): boolean {
  return typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches)
}

function SeasonPoemPanel({ season, state }: { season: keyof typeof SEASON_NAMES; state: SeasonPoemState }) {
  const title = `${SEASON_NAMES[season]}题咏`
  const renderWork = (work: SeasonWork, kind: "reviewed" | "related") => (
    <article className="season-poem-panel__work">
      <p className="season-poem-panel__status">{kind === "reviewed" ? "经审核题咏" : "关联推荐"}</p>
      <h2><Link to={`/works/${encodeURIComponent(work.work_id)}`}>{work.title}</Link></h2>
      <p className="season-poem-panel__author">{work.authors || "作者待考"}</p>
      <blockquote>“{work.evidence_quote}”</blockquote>
      <Link className="season-poem-panel__read" to={`/works/${encodeURIComponent(work.work_id)}`}>阅读题咏</Link>
    </article>
  )

  return (
    <section className="season-poem-panel" aria-label={title} aria-live="polite">
      <p className="season-poem-panel__eyebrow">季候题咏</p>
      {state.mode === "loading" && <p>正在检索{SEASON_NAMES[season]}题咏</p>}
      {state.mode === "error" && <p role="alert">季候题咏暂不可用；仍可浏览题咏志。</p>}
      {state.mode === "ready" && (() => {
        const reviewed = state.response.items.find((work) => work.review_status === "reviewed")
        if (reviewed) return renderWork(reviewed, "reviewed")
        const related = state.response.related_items[0]
        if (related) return renderWork(related, "related")
        return <p>暂无经审核的{SEASON_NAMES[season]}题咏。<Link to="/works">查看全部题咏</Link></p>
      })()}
    </section>
  )
}

export function HomePage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const season = useSceneStore((state) => state.season)
  const quality = useSceneStore((state) => state.quality)
  const setSeason = useSceneStore((state) => state.setSeason)
  const applySceneAction = useSceneStore((state) => state.applySceneAction)
  const [manifest, setManifest] = useState<SplatAssetManifest>()
  const [config, setConfig] = useState<SceneConfig>(LOCAL_SCENE_CONFIG)
  const [configReady, setConfigReady] = useState(false)
  const [seasonPoems, setSeasonPoems] = useState<SeasonPoemState>(() => ({ season, mode: "loading" }))
  const [manifestError, setManifestError] = useState<string>()
  const [reducedMotion, setReducedMotion] = useState(initialReducedMotion)
  const [capability] = useState(detectSceneCapability)
  const [sceneMode, setSceneMode] = useState(capability.mode)

  useEffect(() => {
    const querySeason = searchParams.get("season")
    if (SEASON_IDS.includes(querySeason as SeasonId)) setSeason(querySeason)
  }, [searchParams, setSeason])

  const writeSceneUrl = useCallback((nextSeason: SeasonId) => {
    const next = new URLSearchParams(searchParams)
    next.set("season", nextSeason)
    setSearchParams(next, { replace: false })
  }, [searchParams, setSearchParams])

  const chooseSeason = useCallback((nextSeason: SeasonId) => {
    setSeason(nextSeason)
    writeSceneUrl(nextSeason)
  }, [setSeason, writeSceneUrl])

  const applyGuideSceneAction = useCallback((action: SceneAction) => {
    applySceneAction(action)
    const next = useSceneStore.getState()
    writeSceneUrl(next.season)
  }, [applySceneAction, writeSceneUrl])

  useEffect(() => {
    const media = window.matchMedia?.("(prefers-reduced-motion: reduce)")
    const update = () => setReducedMotion(Boolean(media?.matches))
    update()
    media?.addEventListener?.("change", update)
    return () => media?.removeEventListener?.("change", update)
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    queueMicrotask(() => {
      if (controller.signal.aborted) return
      void api.getSeasonWorks(season, controller.signal).then((response) => {
        if (!controller.signal.aborted && response.season === season) setSeasonPoems({ season, mode: "ready", response })
      }).catch(() => {
        if (!controller.signal.aborted) setSeasonPoems({ season, mode: "error" })
      })
    })
    return () => controller.abort()
  }, [season])

  useEffect(() => {
    let active = true
    queueMicrotask(() => {
      if (!active) return
      void loadSceneConfig().then((next) => {
        if (active) {
          setConfig(next)
          setConfigReady(true)
        }
      })
    })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (sceneMode !== "3d" || manifest) return undefined
    const controller = new AbortController()
    queueMicrotask(() => {
      if (controller.signal.aborted) return
      void readSplatManifest(controller.signal).then((asset) => {
        if (!controller.signal.aborted) {
          setManifest(asset)
          setManifestError(undefined)
        }
      }).catch((error: unknown) => {
        if (!controller.signal.aborted) setManifestError(error instanceof Error ? error.message : "资产清单不可用")
      })
    })
    return () => controller.abort()
  }, [manifest, sceneMode])

  const poemPanelState: SeasonPoemState = seasonPoems.season === season ? seasonPoems : { season, mode: "loading" }
  const capabilityDetail = capability.mode === "2d"
    ? capability.reason === "low-memory"
      ? "设备资源较紧张，已优先使用轻量二维影像；可由读者主动尝试三维。"
      : capability.reason === "data-saver"
        ? "浏览器已启用节省流量，未自动下载 17.8 MB 实景资产。"
        : "当前浏览器未提供稳定的 WebGL2，已使用二维影像导览。"
    : "读者已选择轻量二维影像；四时与题咏控制仍然可用。"

  return (
    <main className={`scene-home scene-home--${season}`} id="main-content" tabIndex={-1}>
      <section className="scene-home__stage" aria-label="甲秀楼实景高斯泼溅">
        {sceneMode === "2d"
          ? <SceneFallback title="二维影像导览" detail={capabilityDetail} season={season} />
          : manifest && configReady
            ? <SplatCanvas manifest={manifest} config={config} season={season} quality={quality} reducedMotion={reducedMotion} />
            : manifestError
              ? <SceneFallback detail={manifestError} season={season} />
              : <div className="scene-home__loading" aria-live="polite">实景资产正在校验</div>}
        <SeasonAtmosphere season={season} reducedMotion={reducedMotion} />
        <div className="scene-home__veil" aria-hidden="true" />
        <div className={`scene-mode-switch scene-mode-switch--${sceneMode}`}>
          <p>VIEW MODE · 观看方式</p>
          <button
            type="button"
            aria-pressed={sceneMode === "2d"}
            onClick={() => setSceneMode((mode) => mode === "3d" ? "2d" : "3d")}
          >
            {sceneMode === "3d" ? "查看二维影像" : "返回实景三维"}
          </button>
          <span>{sceneMode === "3d" ? "实景采集 · 17.8 MB" : "二维影像 · 轻量模式"}</span>
        </div>
      </section>
      <section className="scene-home__copy">
        <p className="kicker">GUIYANG · NANMING RIVER · FIELD CAPTURE</p>
        <h1><span>浮玉</span><span>四时</span></h1>
        <p className="scene-home__lede">甲秀楼的有限实景采集，在河水、季候与题咏之间缓慢展开。</p>
        <SeasonPoemPanel season={season} state={poemPanelState} />
        <p className="scene-home__links"><Link to="/works">进入题咏志</Link><Link to="/methodology">研究说明</Link></p>
      </section>
      <aside className="scene-home__rail">
        <SceneControls config={config} season={season} onSeason={chooseSeason} />
        <AmbientSoundControl season={season} />
      </aside>
      <GuidePanel onSceneAction={applyGuideSceneAction} />
    </main>
  )
}
