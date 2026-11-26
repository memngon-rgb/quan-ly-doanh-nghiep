import { useMemo } from 'react'
import { DateRangePicker, useDateRange } from '../../core/DateRange'
import { exportXlsx } from '../../core/excel'
import { money, num, pct } from '../../core/format'
import { ErrorBox, Loading, PageHead } from '../../core/ui'
import { IconDownload } from '../../core/icons'
import { rangePlan, summarize } from './calc'
import { useRangeData } from './data'

interface Line { label: string; actual: number; plan: number; kind?: 'total' | 'sub' }

export default function PnL() {
  const [range, setRange] = useDateRange()
  const d = useRangeData(range)

  const calc = useMemo(() => {
    if (!d.data) return null
    const { from, to } = range
    const { cats, tx, sales, items } = d.data
    const cur = summarize(tx.filter((t) => t.tx_date >= from && t.tx_date <= to), sales.filter((s) => s.sale_date >= from && s.sale_date <= to), cats)
    const f = rangePlan(from, to, tx, sales, cats, items)
    const planRev = f.revenue
    const planCogs = planRev * f.cogsPct
    const lines: Line[] = [
      { label: 'Doanh thu', actual: cur.revenue, plan: planRev, kind: 'total' },
      { label: 'Giá vốn / nguyên vật liệu', actual: cur.byGroup.cogs, plan: planCogs },
      { label: 'Lãi gộp', actual: cur.revenue - cur.byGroup.cogs, plan: planRev - planCogs, kind: 'total' },
      { label: 'Lương nhân sự', actual: cur.byGroup.payroll, plan: f.byGroup.payroll },
      { label: 'Chi phí cố định', actual: cur.byGroup.fixed, plan: f.byGroup.fixed },
      { label: 'Chi phí khác', actual: cur.byGroup.other, plan: f.byGroup.other },
    ]
    const actualProfit = cur.revenue - cur.expense
    const planProfit = planRev - planCogs - f.fixed
    lines.push({ label: 'Lợi nhuận', actual: actualProfit, plan: planProfit, kind: 'total' })
    return { cur, f, lines }
  }, [d.data, range.from, range.to])

  if (d.loading) return <Loading />
  if (d.error || !calc || !d.data) return <ErrorBox error={d.error} retry={d.reload} />
  const { cur, f, lines } = calc
  const catName = new Map(d.data.cats.map((c) => [c.id, c.name]))
  const detail = Object.entries(cur.byCategory)
    .map(([id, v]) => ({ id, name: catName.get(id) ?? 'Chưa phân loại', actual: v, plan: f.byCategory[id] }))
    .filter((r) => d.data!.cats.find((c) => c.id === r.id)?.type !== 'income')
    .sort((a, b) => b.actual - a.actual)

  async function exportFile() {
    await exportXlsx(`pnl-${range.from}_${range.to}`, ['Khoản mục', 'Thực tế', 'Dự tính', 'Chênh lệch'], lines.map((l) => [l.label, l.actual, Math.round(l.plan), Math.round(l.actual - l.plan)]))
  }

  return (
    <div className="stack">
      <PageHead
        eyebrow="Tài chính"
        title="Báo cáo lãi lỗ (P&L)"
        sub="So sánh số thực tế với số dự tính, tính theo khoảng ngày đã chọn."
        right={
          <>
            <DateRangePicker value={range} onChange={setRange} />
            <button className="mem-btn" onClick={() => void exportFile()}><IconDownload /> Xuất Excel</button>
          </>
        }
      />
      <div className="mem-card stack">
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>Khoản mục</th><th className="num">Thực tế</th><th className="num">% doanh thu</th><th className="num">Dự tính</th><th className="num">Chênh lệch</th></tr></thead>
            <tbody>
              {lines.map((l) => {
                const diff = l.actual - l.plan
                const isCost = !['Doanh thu', 'Lãi gộp', 'Lợi nhuận'].includes(l.label)
                const good = isCost ? diff <= 0 : diff >= 0
                return (
                  <tr key={l.label} className={l.kind === 'total' ? 'total' : ''}>
                    <td>{l.label}</td>
                    <td className="num">{money(l.actual)}</td>
                    <td className="num">{cur.revenue > 0 ? pct(l.actual / cur.revenue) : '—'}</td>
                    <td className="num">{money(l.plan)}</td>
                    <td className={`num ${Math.round(diff) === 0 ? '' : good ? 'pos' : 'neg'}`}>{diff > 0 ? '+' : ''}{money(diff)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className="mem-caption">
          {cur.revenueFromSales ? 'Doanh thu lấy từ báo cáo bán hàng (iPOS) đã nhập.' : 'Chưa có báo cáo bán hàng, doanh thu đang lấy từ các khoản “Thu từ bán hàng” trong sổ thu chi.'}{' '}
          Dự tính: doanh thu = trung bình 3 tháng trước, giá vốn = {pct(f.cogsPct)} doanh thu, các khoản còn lại theo mục Dự tính. Khoảng ngày không trọn tháng thì dự tính được quy theo số ngày.
        </div>
      </div>

      <div className="mem-card stack">
        <div className="section-title">Chi tiết các khoản chi</div>
        {detail.length === 0 ? <div className="mem-caption">Khoảng ngày này chưa có khoản chi.</div> : (
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>Danh mục</th><th className="num">Thực tế</th><th className="num">Dự tính</th></tr></thead>
              <tbody>{detail.map((r) => <tr key={r.id}><td>{r.name}</td><td className="num">{num(r.actual)}</td><td className="num">{r.plan === undefined ? '—' : num(r.plan)}</td></tr>)}</tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
