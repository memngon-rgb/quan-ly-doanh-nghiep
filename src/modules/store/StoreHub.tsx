import { useState, type ReactNode } from 'react'
import { useAuth } from '../../core/auth'
import { DateRangePicker, useDateRange, type Range } from '../../core/DateRange'
import { BranchSelect } from '../../core/BranchSelect'
import { Empty, PageHead } from '../../core/ui'
import { ActualsPanel } from '../finance/Actuals'
import AppReviews from './AppReviews'
import ShiftReports from './ShiftReports'
import Utilities from './Utilities'

function Revenue({ range, setRange }: { range: Range; setRange: (r: Range) => void }) {
  const { branchId } = useAuth()
  return <ActualsPanel range={range} branchId={branchId} onRange={setRange} />
}

const TABS: { key: string; label: string; perm: string; el: (range: Range, setRange: (r: Range) => void) => ReactNode }[] = [
  { key: 'shift', label: 'Báo cáo ca', perm: 'store.shift', el: (r) => <ShiftReports range={r} /> },
  { key: 'review', label: 'Đánh giá food app', perm: 'store.review', el: (r) => <AppReviews range={r} /> },
  { key: 'revenue', label: 'Số thực nhận', perm: 'store.revenue', el: (r, set) => <Revenue range={r} setRange={set} /> },
  { key: 'utility', label: 'Điện nước', perm: 'store.utility', el: () => <Utilities /> },
]

/** Báo cáo cửa hàng: mỗi tab một quyền riêng, người nào chỉ thấy tab được cấp. */
export default function StoreHub() {
  const { can } = useAuth()
  const tabs = TABS.filter((t) => can(t.perm))
  const [key, setKey] = useState('')
  const cur = tabs.find((t) => t.key === key) ?? tabs[0]
  const [range, setRange] = useDateRange()
  const withRange = cur?.key === 'shift' || cur?.key === 'review'
  return (
    <div className="stack">
      <PageHead title="Báo cáo cửa hàng" sub="Báo cáo ca, đánh giá food app, số thực nhận và điện nước, thay cho tin nhắn Zalo và Google Sheet." controls={<>{withRange && <DateRangePicker value={range} onChange={setRange} />}<BranchSelect /></>} />
      {!cur ? <Empty title="Bạn chưa được cấp mục nào" hint="Nhờ chủ cấp quyền ở Quản trị → Người dùng." /> : (
        <>
          <div className="seg" role="tablist" aria-label="Mục báo cáo" style={{ flexWrap: 'wrap' }}>
            {tabs.map((t) => <button key={t.key} role="tab" aria-selected={t.key === cur.key} className={t.key === cur.key ? 'on' : ''} onClick={() => setKey(t.key)}>{t.label}</button>)}
          </div>
          {cur.el(range, setRange)}
        </>
      )}
    </div>
  )
}
