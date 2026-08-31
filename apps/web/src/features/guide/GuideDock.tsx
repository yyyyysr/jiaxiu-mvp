import { useEffect, useRef, useState } from "react"
import { useLocation } from "react-router-dom"

import { GuideConsole } from "./GuideConsole"
import { GuidePortrait } from "./GuidePortrait"

/**
 * The guide follows the reader through the archive as a folded rail, carrying the same ink-wash
 * figure it has on the scene home — folded into the rail, or standing beside the conversation.
 */
export function GuideDock() {
  const { pathname } = useLocation()
  const [open, setOpen] = useState(false)
  const railRef = useRef<HTMLButtonElement>(null)
  const restoreFocusRef = useRef(false)

  useEffect(() => {
    if (!open && restoreFocusRef.current) {
      restoreFocusRef.current = false
      railRef.current?.focus()
    }
  }, [open])

  useEffect(() => {
    if (!open) return undefined
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      restoreFocusRef.current = true
      setOpen(false)
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [open])

  if (pathname === "/") return null

  if (!open) {
    return (
      <aside className="guide-dock guide-dock--closed" aria-label="浮玉客随行导览">
        <button
          ref={railRef}
          className="guide-dock__rail guide-hit-target"
          type="button"
          aria-label="唤出浮玉客"
          onClick={() => setOpen(true)}
        >
          <GuidePortrait className="guide-dock__rail-figure" decorative />
          <span className="guide-dock__rail-label">浮玉客</span>
        </button>
      </aside>
    )
  }

  return (
    <aside className="guide-dock guide-dock--open" aria-label="浮玉客随行导览">
      <div className="guide-dock__panel">
        <div className="guide-dock__figure"><GuidePortrait ground="light" decorative /></div>
        <div className="guide-dock__sheet">
          <header className="guide-dock__header">
            <div>
              <p>AI 辅助导览 · 随页可问</p>
              <h2>浮玉客</h2>
            </div>
            <button
              className="guide-hit-target"
              type="button"
              onClick={() => { restoreFocusRef.current = true; setOpen(false) }}
            >
              隐藏导览
            </button>
          </header>
          <div className="guide-dock__body">
            <GuideConsole />
          </div>
        </div>
      </div>
    </aside>
  )
}
