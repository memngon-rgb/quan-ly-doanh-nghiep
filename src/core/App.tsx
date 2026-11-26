import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './auth'
import { Layout } from './Layout'
import { Login } from './Login'
import { Loading, ToastProvider } from './ui'
import { modules } from '../modules/registry'
import type { ReactNode } from 'react'

function Guard({ perm, children }: { perm: string; children: ReactNode }) {
  const { can } = useAuth()
  if (!can(perm)) {
    return <div className="mem-card empty"><b>Bạn chưa có quyền dùng mục này</b>Liên hệ chủ doanh nghiệp để được cấp quyền.</div>
  }
  return <>{children}</>
}

function Routed() {
  const { loading, loggedIn, blocked, can, signOut } = useAuth()
  if (loading) return <Loading />
  if (!loggedIn) return <Login />
  if (blocked) {
    return (
      <div className="login-wrap">
        <div className="mem-card login-card stack">
          <h1 className="page-title" style={{ fontSize: 22 }}>Tài khoản chưa được kích hoạt</h1>
          <p className="mem-caption">Tài khoản của bạn chưa có hồ sơ hoặc đã bị khóa. Hãy báo chủ doanh nghiệp.</p>
          <button className="mem-btn" onClick={() => void signOut()}>Đăng xuất</button>
        </div>
      </div>
    )
  }
  const first = modules.flatMap((m) => m.nav).find((n) => can(n.perm))
  return (
    <Routes>
      <Route element={<Layout modules={modules} />}>
        {modules.flatMap((m) =>
          m.routes.map((r) => (
            <Route key={r.path} path={r.path} element={<Guard perm={r.perm}>{r.element}</Guard>} />
          )),
        )}
        <Route path="*" element={first ? <Navigate to={first.path} replace /> : <div className="mem-card empty"><b>Chưa có quyền nào</b>Hãy báo chủ doanh nghiệp cấp quyền.</div>} />
      </Route>
    </Routes>
  )
}

export default function App() {
  return (
    <HashRouter>
      <ToastProvider>
        <AuthProvider>
          <Routed />
        </AuthProvider>
      </ToastProvider>
    </HashRouter>
  )
}
