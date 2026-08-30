import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { api } from "../lib/api"
import type { AuthRole, AuthUser, TemporaryPasswordResponse } from "../lib/types"
import { useAuth } from "../features/auth/AuthProvider"
import { AdminDialog } from "../features/admin/AdminDialog"

function message(error: unknown) { return error instanceof Error ? error.message : "操作暂时无法完成，请稍后重试。" }

export function AdminUsersPage() { const { user, csrfToken } = useAuth(); return user ? <main id="main-content" tabIndex={-1} className="admin-page"><AdminUsersWorkspace currentUser={user} csrfToken={csrfToken ?? ""} /></main> : null }

export function AdminUsersWorkspace({ currentUser, csrfToken }: { currentUser: AuthUser; csrfToken: string }) {
  const client = useQueryClient(), [username, setUsername] = useState(""), [role, setRole] = useState<AuthRole>("contributor"), [temporary, setTemporary] = useState<TemporaryPasswordResponse | null>(null), [confirmReset, setConfirmReset] = useState<AuthUser | null>(null), [error, setError] = useState("")
  const users = useQuery({ queryKey: ["admin", "users"], queryFn: api.listAdminUsers })
  const refresh = () => client.invalidateQueries({ queryKey: ["admin", "users"] })
  const create = useMutation({ mutationFn: () => api.createAdminUser({ username: username.trim(), role }, csrfToken), onSuccess: (result) => { setUsername(""); setTemporary(result); void refresh() }, onError: (e) => setError(message(e)) })
  const update = useMutation({ mutationFn: ({ id, active }: { id: string; active: boolean }) => api.updateAdminUser(id, { is_active: active }, csrfToken), onSuccess: refresh, onError: (e) => setError(message(e)) })
  const reset = useMutation({ mutationFn: (id: string) => api.resetAdminUserPassword(id, csrfToken), onSuccess: (result) => { setConfirmReset(null); setTemporary(result); void refresh() }, onError: (e) => setError(message(e)) })
  const activeAdmins = users.data?.filter((item) => item.role === "admin" && item.is_active).length ?? 0
  return <><p className="kicker">ADMINISTRATION · ACCOUNTS</p><h1>用户</h1><nav className="admin-local-nav"><a href="/admin/reviews">审核卷宗</a><a href="/admin/users">用户</a><a href="/admin/audit">审计</a></nav>
    {error && <p role="alert" className="admin-message admin-message--error">{error}</p>}
    <form className="admin-create" onSubmit={(event) => { event.preventDefault(); setError(""); if (!username.trim()) return setError("请填写用户名。"); create.mutate() }}><label>用户名<input value={username} maxLength={128} onChange={(e) => setUsername(e.target.value)} /></label><label>角色<select value={role} onChange={(e) => setRole(e.target.value as AuthRole)}><option value="contributor">投稿人</option><option value="admin">管理员</option></select></label><button className="admin-primary" disabled={create.isPending} type="submit">{create.isPending ? "创建中…" : "创建账户"}</button></form>
    {users.isPending ? <p role="status">正在调阅用户名册…</p> : users.isError ? <p role="alert">用户名册暂时无法读取，请稍后重试。</p> : <ol className="admin-list">{users.data.map((account) => { const self = account.user_id === currentUser.user_id, lastAdmin = account.role === "admin" && account.is_active && activeAdmins <= 1; const blocked = self || lastAdmin; return <li key={account.user_id}><div><h2>{account.username}</h2><p>{account.role === "admin" ? "管理员" : "投稿人"} · {account.is_active ? "启用" : "已停用"}{account.must_change_password ? " · 需改密" : ""}</p>{self && <small>当前账户不能停用</small>}{lastAdmin && !self && <small>最后一位启用管理员不能停用</small>}</div><div className="admin-actions"><button type="button" disabled={reset.isPending || update.isPending} onClick={() => setConfirmReset(account)}>重置{account.username}的密码</button><button type="button" disabled={blocked || reset.isPending || update.isPending} onClick={() => update.mutate({ id: account.user_id, active: !account.is_active })}>{account.is_active ? `停用${account.username}` : `启用${account.username}`}</button></div></li> })}</ol>}
    {confirmReset && <AdminDialog title={`重置${confirmReset.username}的密码？`} onClose={() => setConfirmReset(null)}><p>将生成一次性临时密码，关闭提示后不会再显示。</p><div className="admin-dialog__actions"><button disabled={reset.isPending} type="button" onClick={() => setConfirmReset(null)}>取消</button><button disabled={reset.isPending} className="ink-danger" type="button" onClick={() => reset.mutate(confirmReset.user_id)}>确认重置</button></div></AdminDialog>}
    {temporary && <AdminDialog title="请立即安全转交临时密码" onClose={() => setTemporary(null)}><p role="status">临时密码：{temporary.temporary_password}</p><button type="button" onClick={() => void navigator.clipboard?.writeText(temporary.temporary_password)}>复制密码</button></AdminDialog>}
  </>
}
