import { useEffect, useRef, useState, type KeyboardEvent } from "react"
import { NavLink } from "react-router-dom"

import { useAuth } from "../features/auth/AuthProvider"
import { ApiError } from "../lib/api"

function logoutFailure(error: unknown): string {
  if (error instanceof ApiError) {
    return error.requestId ? `${error.message} 支持请求编号：${error.requestId}` : error.message
  }
  return "退出时未能联系档案服务，本机登录信息已清除。"
}

export function SiteHeader() {
  const { user, loading, logout } = useAuth()
  const [loggingOut, setLoggingOut] = useState(false)
  const [notice, setNotice] = useState<{ kind: "status" | "error"; message: string } | null>(null)
  const loggingOutRef = useRef(false)
  const mountedRef = useRef(false)
  const accountDetailsRef = useRef<HTMLDetailsElement>(null)
  const accountSummaryRef = useRef<HTMLElement>(null)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  function handleAccountKeyDown(event: KeyboardEvent<HTMLDetailsElement>) {
    if (event.key !== "Escape" || !accountDetailsRef.current?.open) return
    event.preventDefault()
    accountDetailsRef.current.open = false
    accountSummaryRef.current?.focus()
  }

  async function handleLogout() {
    if (loggingOutRef.current) return
    loggingOutRef.current = true
    setLoggingOut(true)
    setNotice(null)
    try {
      await logout()
      if (mountedRef.current) setNotice({ kind: "status", message: "已安全退出登录。" })
    } catch (error) {
      if (mountedRef.current) setNotice({ kind: "error", message: logoutFailure(error) })
    } finally {
      loggingOutRef.current = false
      if (mountedRef.current) setLoggingOut(false)
    }
  }

  return (
    <header className="site-header">
      <nav className="site-header__nav" aria-label="主导航">
        <NavLink to="/" end>首页</NavLink>
        <NavLink to="/works">题咏志</NavLink>
        <NavLink to="/methodology">研究说明</NavLink>
        {!loading && !user && <NavLink to="/login">登录</NavLink>}
        {!loading && user?.must_change_password && <NavLink to="/change-password">改密码</NavLink>}
        {!loading && user && !user.must_change_password && user.role === "contributor" && (
          <NavLink to="/contribute">投稿中心</NavLink>
        )}
        {!loading && user && !user.must_change_password && user.role === "admin" && (
          <NavLink to="/admin/reviews">审核管理</NavLink>
        )}
      </nav>
      <div className="site-header__account">
        {loading && <span className="site-header__session" role="status">登录状态确认中</span>}
        {!loading && user && (
          <details ref={accountDetailsRef} onKeyDown={handleAccountKeyDown}>
            <summary ref={accountSummaryRef}>
              <span>{user.username}</span>
              <small>{user.role === "admin" ? "管理员" : "投稿人"}</small>
            </summary>
            <div className="site-header__account-panel">
              <p>{user.must_change_password ? "请先完成密码更换" : "档案协作账号"}</p>
              <button type="button" disabled={loggingOut} aria-busy={loggingOut} onClick={handleLogout}>
                {loggingOut ? "正在退出…" : "退出登录"}
              </button>
            </div>
          </details>
        )}
        {notice?.kind === "status" && <p className="site-header__notice" role="status">{notice.message}</p>}
        {notice?.kind === "error" && <p className="site-header__notice site-header__notice--error" role="alert">{notice.message}</p>}
      </div>
    </header>
  )
}
