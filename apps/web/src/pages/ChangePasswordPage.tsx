import { FormEvent, useEffect, useRef, useState } from "react"
import { Navigate, useLocation, useNavigate } from "react-router-dom"

import { useAuth } from "../features/auth/AuthProvider"
import { safePostAuthDestination } from "../features/auth/ProtectedRoute"
import { ApiError } from "../lib/api"
import type { AuthRole } from "../lib/types"

function roleDestination(role: AuthRole): string {
  return role === "admin" ? "/admin/reviews" : "/contribute"
}

function passwordDestination(state: unknown, role: AuthRole): string {
  const from = typeof state === "object" && state !== null && "from" in state
    ? state.from
    : undefined
  return safePostAuthDestination(from, roleDestination(role))
}

function visibleFailure(error: unknown, secrets: string[]): { message: string; requestId: string | null } {
  if (!(error instanceof ApiError)) {
    return { message: "密码暂时无法更新，请稍后重试。", requestId: null }
  }
  const messages: Record<string, string> = {
    invalid_current_password: "当前密码不正确。",
    invalid_password: "新密码不符合安全要求，请按页面要求重试。",
    authentication_required: "登录状态已失效，请重新登录。",
    csrf_token_missing: "登录状态已失效，请重新登录。",
  }
  const requestId = error.requestId && !secrets.some((secret) => secret && error.requestId?.includes(secret))
    ? error.requestId
    : null
  return { message: messages[error.code] ?? "密码暂时无法更新，请稍后重试。", requestId }
}

function validateNewPassword(password: string, confirmation: string): string | null {
  const length = [...password].length
  if (length < 12 || length > 256) return "密码长度需为 12 至 256 个字符。"
  if (password.trim().length === 0) return "密码不能只包含空白字符。"
  if (password !== confirmation) return "两次输入的新密码不一致。"
  return null
}

export function ChangePasswordPage() {
  const { user, loading, changePassword } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmation, setConfirmation] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [failure, setFailure] = useState<{ message: string; requestId: string | null } | null>(null)
  const submittingRef = useRef(false)
  const errorRef = useRef<HTMLDivElement>(null)

  function clearPasswordFields() {
    setCurrentPassword("")
    setNewPassword("")
    setConfirmation("")
  }

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
  if (!user) return <Navigate to="/login" replace state={{ from: "/change-password" }} />

  const destination = passwordDestination(location.state, user.role)
  if (!user.must_change_password) return <Navigate to={destination} replace />

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submittingRef.current) return
    const validationMessage = validateNewPassword(newPassword, confirmation)
    if (validationMessage) {
      clearPasswordFields()
      setFailure({ message: validationMessage, requestId: null })
      return
    }
    submittingRef.current = true
    setSubmitting(true)
    setFailure(null)
    try {
      await changePassword(currentPassword, newPassword)
      clearPasswordFields()
      navigate(destination, { replace: true })
    } catch (error) {
      const nextFailure = visibleFailure(error, [currentPassword, newPassword, confirmation])
      clearPasswordFields()
      setFailure(nextFailure)
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  return (
    <main id="main-content" tabIndex={-1} className="auth-page">
      <section className="auth-sheet auth-sheet--password" aria-labelledby="password-title">
        <div className="auth-sheet__heading">
          <p className="kicker">FIRST ENTRY · 初次入卷</p>
          <h1 id="password-title">修改初始密码</h1>
          <p>首次进入工作台前，请换用仅你知晓的新密码。完成后将返回原来的工作位置。</p>
        </div>
        <form aria-labelledby="password-title" aria-busy={submitting} noValidate onSubmit={handleSubmit}>
          {failure && (
            <div className="auth-error" role="alert" tabIndex={-1} ref={errorRef}>
              <p>{failure.message}</p>
              {failure.requestId && <small>支持请求编号：{failure.requestId}</small>}
            </div>
          )}
          <label>
            <span>当前密码</span>
            <input
              type="password"
              name="current-password"
              autoComplete="current-password"
              value={currentPassword}
              disabled={submitting}
              required
              onChange={(event) => setCurrentPassword(event.target.value)}
            />
          </label>
          <label>
            <span>新密码</span>
            <input
              type="password"
              name="new-password"
              autoComplete="new-password"
              aria-describedby="password-requirements"
              value={newPassword}
              disabled={submitting}
              required
              onChange={(event) => setNewPassword(event.target.value)}
            />
          </label>
          <label>
            <span>确认新密码</span>
            <input
              type="password"
              name="new-password-confirmation"
              autoComplete="new-password"
              value={confirmation}
              disabled={submitting}
              required
              onChange={(event) => setConfirmation(event.target.value)}
            />
          </label>
          <p id="password-requirements" className="auth-sheet__requirements">12–256 个字符，不能只包含空白字符。</p>
          <button type="submit" disabled={submitting || !currentPassword || !newPassword || !confirmation}>
            {submitting ? "正在更换…" : "保存新密码"}
          </button>
        </form>
        <p className="auth-sheet__footnote"><span aria-hidden="true">安</span> 密码更新会同时轮换当前会话</p>
      </section>
    </main>
  )
}
