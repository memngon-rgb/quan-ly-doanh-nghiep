import { useAuth } from './auth'

/** Ô chọn chi nhánh dùng chung (đổi chi nhánh áp dụng cho mọi trang). Chỉ hiện khi có từ 2 chi nhánh. */
export function BranchSelect() {
  const { branches, branchId, setBranchId } = useAuth()
  if (branches.length < 2) return null
  return (
    <select className="input" style={{ width: 'auto', minHeight: 40 }} value={branchId} onChange={(e) => setBranchId(e.target.value)} aria-label="Chọn chi nhánh">
      <option value="">Tất cả chi nhánh</option>
      {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
    </select>
  )
}
