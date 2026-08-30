import { useQueryClient } from "@tanstack/react-query"
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"

import { ApiError, api } from "../../lib/api"
import type { AuthSession, AuthUser } from "../../lib/types"

type AuthContextValue = {
  user: AuthUser | null
  csrfToken: string | null
  loading: boolean
  error: Error | null
  login: (username: string, password: string) => Promise<AuthSession>
  logout: () => Promise<void>
  changePassword: (currentPassword: string, newPassword: string) => Promise<AuthSession>
}

const AuthContext = createContext<AuthContextValue | null>(null)

type BootstrapEntry = {
  controller: AbortController
  promise: Promise<AuthSession>
  subscribers: number
  releaseVersion: number
  settled: boolean
}

type BootstrapLease = {
  promise: Promise<AuthSession>
  release: () => void
}

type BootstrapOutcome =
  | { kind: "session"; session: AuthSession }
  | { kind: "anonymous" }
  | { kind: "error"; error: Error }

let bootstrapEntry: BootstrapEntry | null = null

function acquireBootstrapSession(): BootstrapLease {
  let entry = bootstrapEntry
  if (!entry) {
    const controller = new AbortController()
    const createdEntry: BootstrapEntry = {
      controller,
      promise: api.getAuthSession(controller.signal),
      subscribers: 0,
      releaseVersion: 0,
      settled: false,
    }
    entry = createdEntry
    bootstrapEntry = entry
    const settle = () => {
      createdEntry.settled = true
      if (bootstrapEntry === createdEntry) bootstrapEntry = null
    }
    void entry.promise.then(settle, settle)
  }
  entry.subscribers += 1
  entry.releaseVersion += 1
  let released = false
  return {
    promise: entry.promise,
    release: () => {
      if (released) return
      released = true
      entry.subscribers -= 1
      const releaseVersion = ++entry.releaseVersion
      queueMicrotask(() => {
        if (entry.subscribers !== 0 || entry.releaseVersion !== releaseVersion || entry.settled) return
        entry.controller.abort()
        if (bootstrapEntry === entry) bootstrapEntry = null
      })
    },
  }
}

function hasStatus(error: unknown, status: number): boolean {
  return typeof error === "object" && error !== null && "status" in error && error.status === status
}

function visibleError(error: unknown): Error {
  return error instanceof Error ? error : new Error("登录状态暂时无法确认，请稍后重试。")
}

function missingSessionError(): ApiError {
  return new ApiError(401, {
    code: "authentication_required",
    message: "登录状态已失效，请重新登录。",
    request_id: null,
  })
}

function abortedOperationError(): Error {
  const error = new Error("认证操作已取消。")
  error.name = "AbortError"
  return error
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient()
  const [session, setSession] = useState<AuthSession | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const sessionRef = useRef<AuthSession | null>(null)
  const mountedRef = useRef(false)
  const bootstrapVersion = useRef(0)
  const bootstrapOutcomeRef = useRef<Promise<BootstrapOutcome> | null>(null)
  const operationVersion = useRef(0)
  const queueTail = useRef<Promise<void>>(Promise.resolve())
  const activeControllers = useRef(new Set<AbortController>())

  useEffect(() => {
    mountedRef.current = true
    let active = true
    const controllers = activeControllers.current
    const version = bootstrapVersion.current
    const bootstrap = acquireBootstrapSession()
    const outcomePromise = bootstrap.promise.then<BootstrapOutcome, BootstrapOutcome>(
      (nextSession) => ({ kind: "session", session: nextSession }),
      (reason: unknown) => hasStatus(reason, 401)
        ? { kind: "anonymous" }
        : { kind: "error", error: visibleError(reason) },
    )
    bootstrapOutcomeRef.current = outcomePromise
    void outcomePromise.then((outcome) => {
      if (bootstrapOutcomeRef.current === outcomePromise) bootstrapOutcomeRef.current = null
      if (!active || !mountedRef.current || bootstrapVersion.current !== version) return
      if (outcome.kind === "session") {
        sessionRef.current = outcome.session
        setSession(outcome.session)
        setError(null)
      } else {
        sessionRef.current = null
        setSession(null)
        setError(outcome.kind === "error" ? outcome.error : null)
      }
      setLoading(false)
    })
    return () => {
      active = false
      mountedRef.current = false
      bootstrapVersion.current += 1
      bootstrap.release()
      controllers.forEach((controller) => controller.abort())
      controllers.clear()
    }
  }, [])

  const enqueue = useCallback(<T,>(operation: (signal: AbortSignal, version: number) => Promise<T>): Promise<T> => {
    const result = queueTail.current.then(async () => {
      if (!mountedRef.current) throw abortedOperationError()
      const version = ++operationVersion.current
      const controller = new AbortController()
      activeControllers.current.add(controller)
      try {
        return await operation(controller.signal, version)
      } finally {
        activeControllers.current.delete(controller)
      }
    })
    queueTail.current = result.then(() => undefined, () => undefined)
    return result
  }, [])

  const awaitBootstrapOutcome = useCallback(async (): Promise<BootstrapOutcome | null> => {
    if (sessionRef.current) return null
    const outcomePromise = bootstrapOutcomeRef.current
    if (!outcomePromise) return null
    const outcome = await outcomePromise
    if (!mountedRef.current) throw abortedOperationError()
    if (outcome.kind === "session") sessionRef.current = outcome.session
    return outcome
  }, [])

  const login = useCallback((username: string, password: string) => enqueue(async (signal, version) => {
    bootstrapVersion.current += 1
    bootstrapOutcomeRef.current = null
    if (mountedRef.current && operationVersion.current === version) setError(null)
    try {
      const nextSession = await api.login({ username, password }, signal)
      if (mountedRef.current) {
        sessionRef.current = nextSession
        if (operationVersion.current === version) {
          setSession(nextSession)
          setError(null)
          setLoading(false)
        }
      }
      return nextSession
    } catch (reason) {
      const nextError = visibleError(reason)
      if (mountedRef.current) {
        sessionRef.current = null
        if (operationVersion.current === version) {
          setSession(null)
          setError(nextError)
          setLoading(false)
        }
      }
      throw nextError
    }
  }), [enqueue])

  const logout = useCallback(() => enqueue(async (signal, version) => {
    const bootstrapOutcomePromise = bootstrapOutcomeRef.current
    let csrfToken = sessionRef.current?.csrf_token ?? null
    bootstrapVersion.current += 1
    bootstrapOutcomeRef.current = null
    sessionRef.current = null
    if (mountedRef.current && operationVersion.current === version) {
      setSession(null)
      setError(null)
      setLoading(false)
    }
    queryClient.clear()
    try {
      if (bootstrapOutcomePromise) {
        const bootstrapOutcome = await bootstrapOutcomePromise
        if (bootstrapOutcome.kind === "error") throw bootstrapOutcome.error
        if (bootstrapOutcome.kind === "anonymous") return
        csrfToken = bootstrapOutcome.session.csrf_token
      }
      if (!mountedRef.current) throw abortedOperationError()
      if (!csrfToken) return
      await api.logout(csrfToken, signal)
    } catch (reason) {
      const nextError = visibleError(reason)
      if (mountedRef.current && operationVersion.current === version) {
        setError(nextError)
        setLoading(false)
      }
      throw nextError
    }
  }), [enqueue, queryClient])

  const changePassword = useCallback((currentPassword: string, newPassword: string) => enqueue(async (signal, version) => {
    try {
      const bootstrapOutcome = await awaitBootstrapOutcome()
      if (bootstrapOutcome?.kind === "error") throw bootstrapOutcome.error
      const csrfToken = sessionRef.current?.csrf_token
      if (!csrfToken) throw missingSessionError()
      if (mountedRef.current && operationVersion.current === version) setError(null)
      const nextSession = await api.changePassword({
        current_password: currentPassword,
        new_password: newPassword,
      }, csrfToken, signal)
      if (mountedRef.current) {
        sessionRef.current = nextSession
        if (operationVersion.current === version) {
          setSession(nextSession)
          setError(null)
          setLoading(false)
        }
      }
      return nextSession
    } catch (reason) {
      const nextError = visibleError(reason)
      if (mountedRef.current && operationVersion.current === version) {
        setError(nextError)
        setLoading(false)
      }
      throw nextError
    }
  }), [awaitBootstrapOutcome, enqueue])

  const value = useMemo<AuthContextValue>(() => ({
    user: session?.user ?? null,
    csrfToken: session?.csrf_token ?? null,
    loading,
    error,
    login,
    logout,
    changePassword,
  }), [changePassword, error, loading, login, logout, session])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// The hook intentionally shares the provider module so its private context cannot be imported directly.
// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const auth = useContext(AuthContext)
  if (!auth) throw new Error("useAuth 必须在 AuthProvider 内使用。")
  return auth
}
