import { useEffect } from 'react'
import { Link, NavLink, Outlet } from 'react-router-dom'
import { useAuth } from './auth'
import { IconLogout } from './icons'
import { isDemo } from './supabase'
import { fetchCompanyTheme, useTheme } from './theme'
import { resetDemo } from './demo'
import { ROLE_LABEL, type AppModule } from './types'

/** Thứ tự các nhóm trong thanh bên ('' = mục đứng riêng ở trên cùng). Nhóm lạ tự xếp ngay trước Quản trị. */
const GROUP_ORDER = ['', 'Dòng tiền', 'Chi phí & công nợ', 'Phân tích', 'Cửa hàng', 'Kho', 'Quản trị']

export function Layout({ modules }: { modules: AppModule[] }) {
  const { access, can, signOut, branches } = useAuth()
  const theme = useTheme()
  useEffect(() => { void fetchCompanyTheme().catch(() => undefined) }, [])
  // Gom các mục theo nhóm (mỗi mục tự khai báo nhóm), sắp nhóm theo thứ tự cố định bên dưới
  const items = modules.flatMap((m) => m.nav.filter((n) => can(n.perm)).map((n) => ({ ...n, group: n.group ?? m.title })))
  const rank = (g: string) => { const i = GROUP_ORDER.indexOf(g); return i >= 0 ? i : GROUP_ORDER.indexOf('Quản trị') - 0.5 }
  const groups = [...new Set(items.map((i) => i.group))].sort((a, b) => rank(a) - rank(b))

  return (
    <div className="mem-app">
      <nav className="mem-sidebar" aria-label="Điều hướng chính">
        <div className="brand">
          <div className="brand-logo" style={theme.logo ? { background: 'none' } : undefined}>
            {theme.logo
              ? <img src={theme.logo} alt="" style={{ width: 32, height: 32, objectFit: 'contain', borderRadius: 9 }} />
              : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round"><path d="M6 19v-7M12 19V6M18 19v-4" /></svg>}
          </div>
          <span>{theme.name}</span>
        </div>
        {groups.map((g) => (
          <div key={g || 'top'} style={{ display: 'contents' }}>
            {g && <div className="nav-group">{g}</div>}
            {items.filter((n) => n.group === g).map((n) => (
              <NavLink key={n.path} to={n.path} end className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
                {n.icon}
                <span>{n.label}</span>
              </NavLink>
            ))}
          </div>
        ))}
        <div className="side-foot">
          <div style={{ fontWeight: 800 }}>{access?.profile.full_name}</div>
          <div className="mem-caption">{access ? ROLE_LABEL[access.profile.role] : ''}</div>
          {!isDemo && (
            <button className="mem-btn mem-btn-sm" style={{ marginTop: 10 }} onClick={() => void signOut()}>
              <IconLogout /> Đăng xuất
            </button>
          )}
        </div>
      </nav>

      <main className="mem-content">
        {isDemo && (
          <div className="banner">
            DỮ LIỆU MINH HỌA · Bản xem thử, chưa kết nối Supabase. Dữ liệu chỉ lưu trong trình duyệt này.{' '}
            <button className="mem-btn mem-btn-sm" onClick={() => { resetDemo(); location.reload() }}>Đặt lại dữ liệu mẫu</button>
          </div>
        )}
        {branches.length === 0 && can('admin.users') && (
          <div className="banner">Bước đầu tiên: bạn chưa có chi nhánh nào. <Link to="/admin/users">Bấm vào đây để thêm chi nhánh</Link> (ví dụ tên cửa hàng), sau đó mới nhập được thu chi.</div>
        )}
        <Outlet />
      </main>
    </div>
  )
}
