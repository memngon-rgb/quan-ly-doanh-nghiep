import { useState, type ReactNode } from 'react'
import { useAuth } from '../../core/auth'
import { DateRangePicker, useDateRange } from '../../core/DateRange'
import { Empty, PageHead } from '../../core/ui'
import { ActualsPanel } from '../finance/Actuals'
import AppReviews from './AppReviews'
import ShiftReports from './ShiftReports'
import Utilities from './Utilities'

function Revenue() {
  const { branchId } = useAuth()
  const [range, setRange] = useDateRange()
  return (
    <div className="stack">
      <div className="mem-caption">Báo số tiền thực nhận trên từng app, đính ảnh chụp màn hình và giải trình nếu thiếu so với POS.</div>
      <DateRangePicker value={range} onChange={setRange} />
      <ActualsPanel range={range} branchId={branchId} />
    </div>
  )
}

const TABS: { key: string; label: string; perm: string; el: () => ReactNode }[] = [
  { key: 'shift', label: 'Báo cáo ca', perm: 'store.shift', el: () => <ShiftReports /> },
  { key: 'review', label: 'Đánh giá food app', perm: 'store.review', el: () => <AppReviews /> },
  { key: 'revenue', label: 'Số thực nhận', perm: 'store.revenue', el: () => <Revenue /> },
  { key: 'utility', label: 'Điện nước', perm: 'store.utility', el: () => <Utilities /> },
]

/** Báo cáo cửa hàng: mỗi tab một quyền riêng, người nào chỉ thấy tab được cấp. */
export default function StoreHub() {
  const { can } = useAuth()
  const tabs = TABS.filter((t) => can(t.perm))
  const [key, setKey] = useState('')
  const cur = tabs.find((t) => t.key === key) ?? tabs[0]
  return (
    <div className="stack">
      <PageHead eyebrow="Cửa hàng" title="Báo cáo cửa hàng" sub="Báo cáo ca, đánh giá food app, số thực nhận và điện nước, thay cho tin nhắn Zalo và Google Sheet." />
      {!cur ? <Empty title="Bạn chưa được cấp mục nào" hint="Nhờ chủ cấp quyền ở Quản trị → Người dùng." /> : (
        <>
          <div className="seg" role="tablist" aria-label="Mục báo cáo" style={{ flexWrap: 'wrap' }}>
            {tabs.map((t) => <button key={t.key} role="tab" aria-selected={t.key === cur.key} className={t.key === cur.key ? 'on' : ''} onClick={() => setKey(t.key)}>{t.label}</button>)}
          </div>
          {cur.el()}
        </>
      )}
    </div>
  )
}
