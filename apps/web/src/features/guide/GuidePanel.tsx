import { useEffect, useRef, useState } from "react"

import { useSceneStore } from "../../scene/store"
import type { SceneAction } from "../../scene/store"
import { GuideConsole } from "./GuideConsole"

const SEASON_OPENINGS = {
  spring: "春水新涨，宜从河岸听一阙新晴。",
  summer: "夏树含风，可向桥畔问一声水阔。",
  autumn: "秋光入槛，且从题咏辨一城高爽。",
  winter: "冬水含烟，且循霁色访一段旧题。",
} as const

function GuidePortrait() {
  return (
    <svg className="guide-portrait" viewBox="0 0 128 176" role="img" aria-label="浮玉客水墨剪影">
      <path className="guide-portrait__wash" d="M19 157c17-22 15-48 31-62 8-7 18-8 27-3 17 10 18 41 36 65-22 11-73 11-94 0Z" />
      <path className="guide-portrait__robe" d="M38 157c7-22 9-45 24-55l8-2c17 9 18 33 28 57M46 123c13 7 31 6 43-2M57 105c-2 15 0 36 7 52" />
      <path className="guide-portrait__head" d="M50 70c0-16 9-28 22-28 12 0 21 11 21 27 0 17-8 30-21 30-12 0-22-13-22-29Z" />
      <path className="guide-portrait__hair" d="M49 65c4-27 36-36 45-8 3 10-3 18-4 26-4-7-7-15-7-25-8 8-17 12-34 7Z" />
      <path className="guide-portrait__hat" d="M49 43c7-6 14-9 22-9 8 0 16 3 23 9M58 34c0-9 5-15 13-15 7 0 12 6 12 15M71 19V7" />
      <path className="guide-portrait__face" d="M61 70h3m14 0h3M66 84c5 2 9 2 14 0" />
      <path className="guide-portrait__fan" d="M19 139c17-9 31-9 45 1l-4 17c-15-7-28-7-41 0v-18Zm2 1 38 15" />
      <circle className="guide-portrait__seal" cx="106" cy="31" r="10" />
      <path className="guide-portrait__seal-mark" d="m101 27 5 8 5-8m-10 8h10" />
    </svg>
  )
}

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
          <span aria-hidden="true">客</span>
          <span><b>唤出浮玉客</b><small>问楼 · 问水 · 问诗</small></span>
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
