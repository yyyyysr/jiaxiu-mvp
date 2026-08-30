import { Link, Navigate, Outlet, useLocation } from "react-router-dom"

import type { AuthRole } from "../../lib/types"
import { useAuth } from "./AuthProvider"

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint <= 31 || codePoint >= 127 && codePoint <= 159
  })
}

// The sanitizer is exported for login/password pages to restore only vetted internal destinations.
// eslint-disable-next-line react-refresh/only-export-components
export function safeInternalDestination(value: unknown, fallback = "/"): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return fallback
  if (value.includes("\\") || hasControlCharacter(value)) return fallback
  try {
    const decoded = decodeURIComponent(value)
    if (decoded.startsWith("//") || decoded.includes("\\") || hasControlCharacter(decoded)) return fallback
    const destination = new URL(value, "https://archive.local")
    if (destination.origin !== "https://archive.local") return fallback
    return `${destination.pathname}${destination.search}${destination.hash}`
  } catch {
    return fallback
  }
}

function canonicalInternalPathname(value: string): string | null {
  try {
    const pathname = decodeURIComponent(new URL(value, "https://archive.local").pathname)
    return (pathname.replace(/\/+$/, "") || "/").toLowerCase()
  } catch {
    return null
  }
}

function isPasswordChangePath(value: string): boolean {
  return canonicalInternalPathname(value) === "/change-password"
}

// Auth pages are valid internal URLs but never valid post-authentication destinations.
// eslint-disable-next-line react-refresh/only-export-components
export function safePostAuthDestination(value: unknown, fallback: string): string {
  const destination = safeInternalDestination(value, fallback)
  const pathname = canonicalInternalPathname(destination)
  return pathname === "/login" || pathname === "/change-password" ? fallback : destination
}

function ForbiddenPage() {
  return (
    <main id="main-content" tabIndex={-1} className="not-found-page">
      <p className="kicker">403 · RESTRICTED FOLIO</p>
      <h1>无权查阅此页</h1>
      <p>此卷仅向获授权的档案协作者开放。你仍可继续浏览公开题咏与影像。</p>
      <nav aria-label="权限受限后的去向"><Link to="/">返回数字档案</Link></nav>
    </main>
  )
}

function SessionUnavailable({ message }: { message: string }) {
  return (
    <main id="main-content" tabIndex={-1} className="app-error">
      <p className="kicker">SESSION · 暂不可用</p>
      <h1>暂时无法确认登录状态</h1>
      <p role="alert">{message}</p>
      <Link to="/">返回数字档案</Link>
    </main>
  )
}

export function ProtectedRoute({ role }: { role?: AuthRole }) {
  const { user, loading, error } = useAuth()
  const location = useLocation()
  const destination = safeInternalDestination(`${location.pathname}${location.search}${location.hash}`)

  if (loading) return <p role="status">正在确认登录状态…</p>
  if (error && !user) return <SessionUnavailable message={error.message} />
  if (!user) {
    const stateFrom = (location.state as { from?: unknown } | null)?.from
    const loginDestination = isPasswordChangePath(location.pathname)
      ? safePostAuthDestination(stateFrom, destination)
      : destination
    return <Navigate to="/login" replace state={{ from: loginDestination }} />
  }
  if (user.must_change_password && !isPasswordChangePath(location.pathname)) {
    return <Navigate to="/change-password" replace state={{ from: destination }} />
  }
  if (role && user.role !== role) return <ForbiddenPage />
  return <Outlet />
}
