import { FormEvent, useEffect, useRef, useState } from "react"

import { ApiError, api } from "../../lib/api"
import type { ChatHistoryItem, ChatResponse } from "../../lib/types"
import { useSceneStore } from "../../scene/store"
import type { SceneAction } from "../../scene/store"
import { GuideAnswer } from "./GuideAnswer"

const QUICK_PROMPTS = ["秋日登楼", "四季何景", "诗中甲秀", "从河岸看"] as const
const SEASON_OPENINGS = {
  spring: "春水新涨，宜从河岸听一阙新晴。",
  summer: "夏树含风，可向桥畔问一声水阔。",
  autumn: "秋光入槛，且从题咏辨一城高爽。",
  winter: "冬水含烟，且循霁色访一段旧题。",
} as const
const MAX_MESSAGE_LENGTH = 1_000
const MAX_HISTORY_ITEMS = 8

type GuideStatus = "idle" | "pending" | "ready" | "cancelled" | "rate-limited" | "error"

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError"
}

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
  const applySceneAction = useSceneStore((state) => state.applySceneAction)
  const [open, setOpen] = useState(() => window.innerWidth > 760)
  const [input, setInput] = useState("")
  const [response, setResponse] = useState<ChatResponse>()
  const [history, setHistory] = useState<ChatHistoryItem[]>([])
  const [lastQuestion, setLastQuestion] = useState("")
  const [status, setStatus] = useState<GuideStatus>("idle")
  const requestRef = useRef<AbortController | null>(null)
  const requestIdRef = useRef(0)
  const mountedRef = useRef(true)
  const entryRef = useRef<HTMLButtonElement>(null)
  const restoreFocusRef = useRef(false)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      requestIdRef.current += 1
      requestRef.current?.abort()
    }
  }, [])

  useEffect(() => {
    if (!open && restoreFocusRef.current) {
      restoreFocusRef.current = false
      entryRef.current?.focus()
    }
  }, [open])

  const ask = async (rawMessage: string) => {
    const message = rawMessage.trim().slice(0, MAX_MESSAGE_LENGTH)
    if (!message) return

    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    requestRef.current?.abort()
    const controller = new AbortController()
    requestRef.current = controller
    setLastQuestion(message)
    setResponse(undefined)
    setStatus("pending")

    try {
      const next = await api.chat({ message, season, history: history.slice(-MAX_HISTORY_ITEMS) }, controller.signal)
      if (!mountedRef.current || requestId !== requestIdRef.current) return
      setResponse(next)
      setHistory((current) => [
        ...current,
        { role: "user", content: message } as const,
        { role: "assistant", content: next.answer.slice(0, MAX_MESSAGE_LENGTH) } as const,
      ].slice(-MAX_HISTORY_ITEMS))
      setStatus("ready")
      setInput("")
    } catch (error) {
      if (!mountedRef.current || requestId !== requestIdRef.current) return
      if (isAbortError(error)) setStatus("cancelled")
      else if (error instanceof ApiError && error.status === 429) setStatus("rate-limited")
      else setStatus("error")
    } finally {
      if (requestId === requestIdRef.current) requestRef.current = null
    }
  }

  const cancel = () => {
    requestIdRef.current += 1
    requestRef.current?.abort()
    requestRef.current = null
    setResponse(undefined)
    setStatus("cancelled")
  }

  const close = () => {
    requestIdRef.current += 1
    requestRef.current?.abort()
    requestRef.current = null
    setOpen(false)
    setInput("")
    setHistory([])
    setResponse(undefined)
    setStatus("idle")
    restoreFocusRef.current = true
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void ask(input)
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
        <p className="guide-panel__invitation">{SEASON_OPENINGS[season]}</p>
        <div className="guide-prompts" aria-label="快捷提问">
          {QUICK_PROMPTS.map((prompt, index) => (
            <button className="guide-hit-target" type="button" key={prompt} onClick={() => { void ask(prompt) }}>
              <span aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>{prompt}
            </button>
          ))}
        </div>
        <form className="guide-form" aria-label="向浮玉客提问" onSubmit={submit}>
          <label htmlFor="guide-question">向浮玉客提问</label>
          <div>
            <input
              id="guide-question"
              value={input}
              maxLength={MAX_MESSAGE_LENGTH}
              onChange={(event) => setInput(event.target.value)}
              placeholder="留一行问句……"
              autoComplete="off"
            />
            <button className="guide-hit-target" type="submit" disabled={!input.trim()}>送出问题</button>
          </div>
          <span aria-live="polite">{input.length} / {MAX_MESSAGE_LENGTH}</span>
        </form>

        {status === "pending" && (
          <div className="guide-notice guide-notice--pending">
            <p role="status">浮玉客正在循诗检索</p>
            <button className="guide-hit-target" type="button" onClick={cancel}>取消本次提问</button>
          </div>
        )}
        {status === "cancelled" && <p className="guide-notice" role="status">已取消本次寻访，可换一问。</p>}
        {status === "rate-limited" && <p className="guide-notice guide-notice--error" role="alert">问得太密，且在水边稍候片刻再来。</p>}
        {status === "error" && (
          <div className="guide-notice guide-notice--error" role="alert">
            <p>问句未能抵达，网络或服务暂时不可用。</p>
            <button className="guide-hit-target" type="button" onClick={() => { void ask(lastQuestion) }}>再循此问</button>
          </div>
        )}
        {response && (
          <GuideAnswer
            response={response}
            onApplyScene={() => {
              if (!response.scene_action) return
              if (onSceneAction) onSceneAction(response.scene_action)
              else applySceneAction(response.scene_action)
            }}
          />
        )}
      </div>
    </aside>
  )
}
