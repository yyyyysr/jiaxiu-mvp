import { FormEvent, useEffect, useRef, useState } from "react"
import { Navigate, useLocation, useNavigate } from "react-router-dom"

import { useAuth } from "../features/auth/AuthProvider"
import { safePostAuthDestination } from "../features/auth/ProtectedRoute"
import { ApiError } from "../lib/api"
import type { AuthRole } from "../lib/types"

const GENERIC_LOGIN_ERROR = "账号或密码不正确，请重试。"

function roleDestination(role: AuthRole): string {
  return role === "admin" ? "/admin/reviews" : "/contribute"
}

function stateDestination(state: unknown, fallback: string): string {
  const from = typeof state === "object" && state !== null && "from" in state
    ? state.from
    : undefined
  return safePostAuthDestination(from, fallback)
}

function requestId(error: unknown, password: string): string | null {
  if (!(error instanceof ApiError) || !error.requestId) return null
  return password && error.requestId.includes(password) ? null : error.requestId
}

export function LoginPage() {
  const { user, loading, login } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [failure, setFailure] = useState<{ message: string; requestId: string | null } | null>(null)
  const submittingRef = useRef(false)
  const errorRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (failure) errorRef.current?.focus()
  }, [failure])

  if (loading) {
    return (
      <main id="main-content" tabIndex={-1} className="auth-page auth-page--loading">
        <p role="status">正在确认登录状态…</p>
      </main>
    )
  }

  if (user) {
    const destination = stateDestination(location.state, roleDestination(user.role))
    return user.must_change_password
      ? <Navigate to="/change-password" replace state={{ from: destination }} />
      : <Navigate to={destination} replace />
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submittingRef.current) return
    submittingRef.current = true
    setSubmitting(true)
    setFailure(null)
    try {
      const session = await login(username, password)
      const destination = stateDestination(location.state, roleDestination(session.user.role))
      setPassword("")
      if (session.user.must_change_password) {
        navigate("/change-password", { replace: true, state: { from: destination } })
      } else {
        navigate(destination, { replace: true })
      }
    } catch (error) {
      const supportRequestId = requestId(error, password)
      setPassword("")
      setFailure({ message: GENERIC_LOGIN_ERROR, requestId: supportRequestId })
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  return (
    <main id="main-content" tabIndex={-1} className="auth-page">
      <section className="auth-sheet" aria-labelledby="login-title">
        <div className="auth-sheet__heading">
          <p className="kicker">ACCESSION · 入藏凭证</p>
          <h1 id="login-title">账号登录</h1>
          <p>协作者与馆员由此进入档案工作台。凭证仅用于本次安全会话。</p>
        </div>
        <form aria-labelledby="login-title" aria-busy={submitting} noValidate onSubmit={handleSubmit}>
          {failure && (
            <div className="auth-error" role="alert" tabIndex={-1} ref={errorRef}>
              <p>{failure.message}</p>
              {failure.requestId && <small>支持请求编号：{failure.requestId}</small>}
            </div>
          )}
          <label>
            <span>账号</span>
            <input
              name="username"
              autoComplete="username"
              value={username}
              disabled={submitting}
              required
              onChange={(event) => setUsername(event.target.value)}
            />
          </label>
          <label>
            <span>密码</span>
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              disabled={submitting}
              required
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <button type="submit" disabled={submitting || !username || !password}>
            {submitting ? "正在核验…" : "登录"}
          </button>
        </form>
        <p className="auth-sheet__footnote"><span aria-hidden="true">甲</span> 访问记录受档案管理规范保护</p>
      </section>
    </main>
  )
}
