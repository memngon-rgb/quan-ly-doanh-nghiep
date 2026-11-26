import { useState } from 'react'
import { useAuth } from '../../core/auth'
import { Empty, ErrorBox, Loading, Modal, PageHead, errText, useAsync, useToast } from '../../core/ui'
import { isDemo } from '../../core/supabase'
import { listUsers, saveBranch, updateUser, type UserRow } from '../../core/api'
import { ROLE_LABEL, type Role } from '../../core/types'

export default function Users() {
  const { branches, reloadBranches } = useAuth()
  const toast = useToast()
  const users = useAsync(listUsers, [])
  const [edit, setEdit] = useState<UserRow | null>(null)
  const [bname, setBname] = useState('')

  async function addBranch() {
    if (!bname.trim()) return
    try { await saveBranch({ name: bname.trim() }); setBname(''); await reloadBranches(); toast('Đã thêm chi nhánh') } catch (e) { toast(errText(e), true) }
  }
  async function renameBranch(id: string, current: string) {
    const n = prompt('Tên chi nhánh mới', current)
    if (!n || !n.trim() || n === current) return
    try { await saveBranch({ id, name: n.trim() }); await reloadBranches() } catch (e) { toast(errText(e), true) }
  }
  async function archiveBranch(id: string, name: string) {
    if (!confirm(`Ẩn chi nhánh “${name}”? Dữ liệu cũ vẫn được giữ nguyên.`)) return
    try { await saveBranch({ id, name, is_active: false }); await reloadBranches() } catch (e) { toast(errText(e), true) }
  }

  return (
    <div className="stack">
      <PageHead eyebrow="Quản trị" title="Người dùng và chi nhánh" sub="Chủ gán vai trò và chi nhánh cho từng người. Mỗi người chỉ thấy dữ liệu của chi nhánh được gán." />

      <div className="mem-card stack">
        <div className="section-title">Chi nhánh</div>
        {branches.map((b) => (
          <div key={b.id} className="list-item">
            <b>{b.name}</b>
            <div className="row">
              <button className="mem-btn mem-btn-sm" onClick={() => void renameBranch(b.id, b.name)}>Đổi tên</button>
              <button className="mem-btn mem-btn-sm mem-btn-danger" onClick={() => void archiveBranch(b.id, b.name)}>Ẩn</button>
            </div>
          </div>
        ))}
        <div className="row">
          <input className="input" style={{ flex: 1, minWidth: 180 }} placeholder="Tên chi nhánh mới" value={bname} onChange={(e) => setBname(e.target.value)} aria-label="Tên chi nhánh mới" />
          <button className="mem-btn mem-btn-primary" onClick={() => void addBranch()}>Thêm chi nhánh</button>
        </div>
      </div>

      <div className="mem-card stack">
        <div className="section-title">Người dùng</div>
        {!isDemo && <div className="alert warn"><div><span className="t">Cách tạo tài khoản mới:</span> vào Supabase → Authentication → Users → Add user (nhập email và mật khẩu). Tài khoản vừa tạo sẽ hiện ở đây, hãy gán vai trò và chi nhánh cho họ.</div></div>}
        {users.loading ? <Loading /> : users.error ? <ErrorBox error={users.error} retry={users.reload} /> : !users.data?.length ? <Empty title="Chưa có người dùng" /> : (
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>Tên</th><th>Vai trò</th><th>Chi nhánh</th><th>Trạng thái</th><th /></tr></thead>
              <tbody>
                {users.data.map((u) => (
                  <tr key={u.id}>
                    <td><b>{u.full_name || '(chưa đặt tên)'}</b></td>
                    <td>{ROLE_LABEL[u.role]}</td>
                    <td>{u.role === 'owner' ? 'Tất cả' : u.branch_ids.map((id) => branches.find((b) => b.id === id)?.name).filter(Boolean).join(', ') || <span className="mem-caption">Chưa gán</span>}</td>
                    <td><span className={`mem-tag ${u.is_active ? 'mem-tag-success' : 'mem-tag-danger'}`}>{u.is_active ? 'Đang dùng' : 'Đã khóa'}</span></td>
                    <td className="num"><button className="mem-btn mem-btn-sm" onClick={() => setEdit(u)}>Sửa</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {edit && <UserForm user={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); users.reload() }} />}
    </div>
  )
}

function UserForm({ user, onClose, onSaved }: { user: UserRow; onClose: () => void; onSaved: () => void }) {
  const { branches, access } = useAuth()
  const toast = useToast()
  const [name, setName] = useState(user.full_name)
  const [role, setRole] = useState<Role>(user.role)
  const [active, setActive] = useState(user.is_active)
  const [bids, setBids] = useState<string[]>(user.branch_ids)
  const [busy, setBusy] = useState(false)
  const self = access?.profile.id === user.id

  async function save() {
    setBusy(true)
    try { await updateUser(user.id, { full_name: name.trim(), role, is_active: active }, bids); toast('Đã lưu'); onSaved() } catch (e) { toast(errText(e), true) } finally { setBusy(false) }
  }

  return (
    <Modal title="Sửa người dùng" onClose={onClose}>
      <div className="stack">
        <div className="field"><label htmlFor="un">Tên hiển thị</label><input id="un" className="input" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="field"><label htmlFor="ur">Vai trò</label>
          <select id="ur" className="input" value={role} disabled={self} onChange={(e) => setRole(e.target.value as Role)}>
            {(Object.keys(ROLE_LABEL) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select>
          <span className="mem-caption">Chủ xem mọi thứ. Quản lý và Kế toán xem báo cáo, nhập thu chi. Nhân viên chỉ nhập và chỉ xem khoản mình nhập.</span></div>
        <div className="field"><span className="lbl">Chi nhánh được xem</span>
          <div className="chip-row">
            {branches.map((b) => {
              const on = bids.includes(b.id)
              return <button key={b.id} type="button" className={`chip ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => setBids(on ? bids.filter((x) => x !== b.id) : [...bids, b.id])}>{b.name}</button>
            })}
          </div>
          {role === 'owner' && <span className="mem-caption">Chủ luôn xem được tất cả chi nhánh.</span>}</div>
        <label className="row" style={{ cursor: self ? 'not-allowed' : 'pointer' }}><input type="checkbox" checked={active} disabled={self} onChange={(e) => setActive(e.target.checked)} /> Cho phép đăng nhập</label>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="mem-btn" onClick={onClose}>Hủy</button>
          <button className="mem-btn mem-btn-primary" disabled={busy} onClick={() => void save()}>{busy ? 'Đang lưu...' : 'Lưu'}</button>
        </div>
      </div>
    </Modal>
  )
}
