import { useEffect, useRef, useState } from "react"

import { useSceneStore } from "../../scene/store"
import type { SceneAction } from "../../scene/store"
import { GuideConsole } from "./GuideConsole"
import { GuidePortrait } from "./GuidePortrait"

const SEASON_OPENINGS = {
  spring: "春水新涨，宜从河岸听一阙新晴。",
  summer: "夏树含风，可向桥畔问一声水阔。",
  autumn: "秋光入槛，且从题咏辨一城高爽。",
  winter: "冬水含烟，且循霁色访一段旧题。",
} as const

type GuidePanelProps = {
  onSceneAction?: (action: SceneAction) => void
}

export function GuidePanel({ onSceneAction }: GuidePanelProps = {}) {
  const season = useSceneStore((state) => state.season)
  const [open, setOpen] = useState(() => window.innerWidth > 760)
  const entryRef = useRef<HTMLButtonElement>(null)
  const restoreFocusRef = useRef(false)

  useEffect(() => {
    if (!open && restoreFocusRef.current) {
      restoreFocusRef.current = false
      entryRef.current?.focus()
    }
  }, [open])

  // Folding the panel away only hides it: the thread itself belongs to the reader, not to the panel.
  const close = () => {
    restoreFocusRef.current = true
    setOpen(false)
  }

  if (!open) {
    return (
      <aside className="guide-panel guide-panel--closed" aria-label="浮玉客诗人导游">
        <button ref={entryRef} className="guide-entry guide-hit-target" type="button" aria-label="唤出浮玉客" onClick={() => setOpen(true)}>
          <GuidePortrait className="guide-entry__figure" decorative />
          <span className="guide-entry__label"><b>唤出浮玉客</b><small>问楼 · 问水 · 问诗</small></span>
        </button>
      </aside>
    )
  }

  return (
    <aside className="guide-panel" aria-label="浮玉客诗人导游">
      <div className="guide-panel__portrait"><GuidePortrait /></div>
      <div className="guide-panel__sheet">
        <header className="guide-panel__header">
          <div>
            <p>AI 辅助导览 · 有据可循</p>
            <h2>浮玉客</h2>
          </div>
          <button className="guide-panel__close guide-hit-target" type="button" onClick={close}>收起导览</button>
        </header>
        <GuideConsole invitation={SEASON_OPENINGS[season]} onSceneAction={onSceneAction} />
      </div>
    </aside>
  )
}
