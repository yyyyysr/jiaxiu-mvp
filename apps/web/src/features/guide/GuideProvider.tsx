import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import type { ReactNode } from "react"

import { ApiError, api } from "../../lib/api"
import type { ChatHistoryItem, ChatResponse, GuideScope } from "../../lib/types"
import { useSceneStore } from "../../scene/store"
import { useAuth } from "../auth/AuthProvider"

export const MAX_MESSAGE_LENGTH = 1_000
/** How much of the thread travels back to the model: enough to argue a reading, not the whole visit. */
const HISTORY_WINDOW = 12
/** The server keeps forty messages; the client holds a little more so a failed turn stays visible. */
const MAX_TURNS = 60

export type GuideStatus = "idle" | "loading" | "pending" | "ready" | "cancelled" | "rate-limited" | "error"

export type GuideTurnView = {
  id: string
  role: "user" | "assistant"
  content: string
  response: ChatResponse | null
}

/** The work a page has put in front of the reader, so a bare "这首诗" still resolves. */
export type GuideSubject = {
  workId: string
  title: string
  authors: string
}

type GuideContextValue = {
  turns: GuideTurnView[]
  status: GuideStatus
  scope: GuideScope | null
  lastQuestion: string
  subject: GuideSubject | null
  publishSubject: (subject: GuideSubject | null) => void
  ask: (message: string) => void
  cancel: () => void
  reset: () => void
}

const GuideContext = createContext<GuideContextValue | null>(null)

function isAbortError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "name" in error && error.name === "AbortError"
}

export function GuideProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading, csrfToken } = useAuth()
  const season = useSceneStore((state) => state.season)
  const [turns, setTurns] = useState<GuideTurnView[]>([])
  const [status, setStatus] = useState<GuideStatus>("idle")
  const [scope, setScope] = useState<GuideScope | null>(null)
  const [lastQuestion, setLastQuestion] = useState("")
  const [subject, setSubject] = useState<GuideSubject | null>(null)
  const turnsRef = useRef<GuideTurnView[]>([])
  const subjectRef = useRef<GuideSubject | null>(null)
  const requestRef = useRef<AbortController | null>(null)
  const requestIdRef = useRef(0)
  const localIdRef = useRef(0)
  const pendingIdRef = useRef("")
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      requestIdRef.current += 1
      requestRef.current?.abort()
    }
  }, [])

  useEffect(() => { turnsRef.current = turns }, [turns])
  useEffect(() => { subjectRef.current = subject }, [subject])

  // Replay the filed thread whenever the reader's identity settles: signing in or out swaps whose
  // transcript this is, and a reload should not look like the conversation never happened.
  useEffect(() => {
    if (authLoading) return undefined
    const controller = new AbortController()
    queueMicrotask(() => {
      if (controller.signal.aborted) return
      setStatus("loading")
      void api.getGuideConversation(controller.signal).then((conversation) => {
        if (controller.signal.aborted || !mountedRef.current) return
        setScope(conversation.scope)
        setTurns(conversation.messages.map((message, index) => ({
          id: `filed-${index}-${message.created_at}`,
          role: message.role,
          content: message.content,
          response: message.response,
        })))
        setStatus("idle")
      }).catch(() => {
        if (!controller.signal.aborted && mountedRef.current) setStatus("idle")
      })
    })
    return () => controller.abort()
  }, [authLoading, user?.user_id])

  const publishSubject = useCallback((next: GuideSubject | null) => {
    setSubject((current) => {
      if (current === next) return current
      if (current && next && current.workId === next.workId) return current
      return next
    })
  }, [])

  const ask = useCallback((rawMessage: string) => {
    const message = rawMessage.trim().slice(0, MAX_MESSAGE_LENGTH)
    if (!message) return

    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    requestRef.current?.abort()
    const controller = new AbortController()
    requestRef.current = controller

    const history: ChatHistoryItem[] = turnsRef.current
      .slice(-HISTORY_WINDOW)
      .map((turn) => ({ role: turn.role, content: turn.content.slice(0, MAX_MESSAGE_LENGTH) }))
      .filter((item) => item.content.trim().length > 0)

    const pendingId = `asked-${(localIdRef.current += 1)}`
    pendingIdRef.current = pendingId
    setLastQuestion(message)
    setStatus("pending")
    const asked: GuideTurnView = { id: pendingId, role: "user", content: message, response: null }
    setTurns((current) => [...current, asked].slice(-MAX_TURNS))

    void api.chat(
      { message, season, history, context_work_id: subjectRef.current?.workId ?? null },
      controller.signal,
    ).then((answer) => {
      if (!mountedRef.current || requestId !== requestIdRef.current) return
      const replied: GuideTurnView = {
        id: `${pendingId}-reply`,
        role: "assistant",
        content: answer.answer,
        response: answer,
      }
      setTurns((current) => [...current, replied].slice(-MAX_TURNS))
      setStatus("ready")
    }).catch((error: unknown) => {
      if (!mountedRef.current || requestId !== requestIdRef.current) return
      if (isAbortError(error)) {
        setTurns((current) => current.filter((turn) => turn.id !== pendingId))
        setStatus("cancelled")
      } else if (error instanceof ApiError && error.status === 429) {
        setStatus("rate-limited")
      } else {
        setStatus("error")
      }
    }).finally(() => {
      if (requestId === requestIdRef.current) requestRef.current = null
    })
  }, [season])

  const cancel = useCallback(() => {
    const pendingId = pendingIdRef.current
    requestIdRef.current += 1
    requestRef.current?.abort()
    requestRef.current = null
    setTurns((current) => current.filter((turn) => turn.id !== pendingId))
    setStatus("cancelled")
  }, [])

  const reset = useCallback(() => {
    requestIdRef.current += 1
    requestRef.current?.abort()
    requestRef.current = null
    setTurns([])
    setLastQuestion("")
    setStatus("idle")
    void api.clearGuideConversation(csrfToken).catch(() => undefined)
  }, [csrfToken])

  const value = useMemo<GuideContextValue>(() => ({
    turns,
    status,
    scope,
    lastQuestion,
    subject,
    publishSubject,
    ask,
    cancel,
    reset,
  }), [ask, cancel, lastQuestion, publishSubject, reset, scope, status, subject, turns])

  return <GuideContext.Provider value={value}>{children}</GuideContext.Provider>
}

// The hook shares the provider module so the private context cannot be imported on its own.
// eslint-disable-next-line react-refresh/only-export-components
export function useGuide(): GuideContextValue {
  const guide = useContext(GuideContext)
  if (!guide) throw new Error("useGuide 必须在 GuideProvider 内使用。")
  return guide
}

/** Declare the work a page is showing; the guide drops it again when the page unmounts. */
// eslint-disable-next-line react-refresh/only-export-components
export function useGuideSubject(subject: GuideSubject | null) {
  const { publishSubject } = useGuide()
  const workId = subject?.workId ?? ""
  const title = subject?.title ?? ""
  const authors = subject?.authors ?? ""

  useEffect(() => {
    publishSubject(workId ? { workId, title, authors } : null)
    return () => publishSubject(null)
  }, [authors, publishSubject, title, workId])
}
