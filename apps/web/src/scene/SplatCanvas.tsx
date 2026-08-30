import { useEffect, useRef, useState } from "react"

import { createSplatScene } from "./createSplatScene"
import { SceneFallback } from "./SceneFallback"
import type { QualityLevel, SceneConfig, SceneController, SeasonId, SplatAssetManifest } from "./types"

type SplatCanvasProps = {
  manifest: SplatAssetManifest
  config: SceneConfig
  season: SeasonId
  quality?: QualityLevel
  reducedMotion: boolean
}

type CanvasState = { mode: "loading"; progress: number | null } | { mode: "ready" } | { mode: "error"; detail: string }

export function SplatCanvas({ manifest, config, season, quality, reducedMotion }: SplatCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const controllerRef = useRef<SceneController | undefined>(undefined)
  const currentValues = useRef({ season, quality, reducedMotion })
  const [state, setState] = useState<CanvasState>({ mode: "loading", progress: null })

  useEffect(() => { currentValues.current = { season, quality, reducedMotion } }, [season, quality, reducedMotion])
  useEffect(() => { controllerRef.current?.setReducedMotion(reducedMotion) }, [reducedMotion])
  useEffect(() => { controllerRef.current?.setSeason(season) }, [season])
  useEffect(() => { if (quality) controllerRef.current?.setQuality(quality) }, [quality])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return undefined
    let cancelled = false
    let activeController: SceneController | undefined
    const initialization = new AbortController()
    setState({ mode: "loading", progress: null })

    queueMicrotask(() => {
      if (cancelled) return
      void createSplatScene(canvas, {
        manifest,
        initialSeason: currentValues.current.season,
        quality: currentValues.current.quality,
        reducedMotion: currentValues.current.reducedMotion,
        signal: initialization.signal,
        onProgress(progress) {
          if (!cancelled) setState({ mode: "loading", progress: progress === null ? null : Math.min(1, Math.max(0, progress)) })
        },
      }).then((scene) => {
        activeController = scene
        if (cancelled) {
          scene.dispose()
          return
        }
        controllerRef.current = scene
        scene.setReducedMotion(currentValues.current.reducedMotion)
        scene.setSeason(currentValues.current.season)
        if (currentValues.current.quality) scene.setQuality(currentValues.current.quality)
        setState({ mode: "ready" })
      }).catch((error: unknown) => {
        if (!cancelled) setState({ mode: "error", detail: error instanceof Error ? error.message : "初始化失败" })
      })
    })

    return () => {
      cancelled = true
      initialization.abort()
      if (controllerRef.current === activeController) controllerRef.current = undefined
      activeController?.dispose()
    }
  }, [config, manifest])

  return (
    <div className="splat-canvas-shell">
      <canvas ref={canvasRef} className="splat-canvas" aria-label="甲秀楼实景高斯泼溅浏览器" />
      {state.mode === "loading" && <p className="scene-status" aria-live="polite">{state.progress === null ? "正在载入高斯资产" : `载入 ${Math.round(state.progress * 100)}%`}</p>}
      {state.mode === "ready" && <p className="scene-status scene-status--ready" aria-live="polite">场景就绪</p>}
      {state.mode === "error" && <SceneFallback detail={state.detail} season={season} />}
    </div>
  )
}
