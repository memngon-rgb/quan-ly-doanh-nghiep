import { useMemo, useState } from 'react'
import { exportXlsx } from '../../core/excel'
import { money, monthLabel, monthRange, num, pct, shiftMonth, thisMonth } from '../../core/format'
import { ErrorBox, Loading, PageHead } from '../../core/ui'
import { IconDownload } from '../../core/icons'
import { buildForecast, summarize } from './calc'
import { useMonthData } from './data'

interface Line { label: string; actual: number; plan: number; kind?: 'total' | 'sub' }

export default function PnL() {
  const [month, setMonth] = useState(thisMonth())
  const d = useMonthData(month)

  const calc = useMemo(() => {
    if (!d.data) return null
    const { from, to } = monthRange(month)
    const { cats, tx, sales, items } = d.data
    const cur = summarize(tx.filter((t) => t.tx_date >= from && t.tx_date <= to), sales.filter((s) => s.sale_date >= from && s.sale_date <= to), cats)
    const f = buildForecast(month, tx, sales, cats, items)
    const planGroup = (g: string) => f.lines.filter((l) => l.cat.grp === g).reduce((s, l) => s + l.value, 0)
    const planRev = f.revenueMonthly
    const planCogs = planRev * f.cogsPct
    const lines: Line[] = [
      { label: 'Doanh thu', actual: cur.revenue, plan: planRev, kind: 'total' },
      { label: 'Giá vốn / nguyên vật liệu', actual: cur.byGroup.cogs, plan: planCogs },
      { label: 'Lãi gộp', actual: cur.revenue - cur.byGroup.cogs, plan: planRev - planCogs, kind: 'total' },
      { label: 'Lương nhân sự', actual: cur.byGroup.payroll, plan: planGroup('payroll') },
      { label: 'Chi phí cố định', actual: cur.byGroup.fixed, plan: planGroup('fixed') },
      { label: 'Chi phí khác', actual: cur.byGroup.other, plan: planGroup('other') },
    ]
    const actualProfit = cur.revenue - cur.expense
    const planProfit = planRev - planCogs - f.fixedMonthly
    lines.push({ label: 'Lợi nhuận', actual: actualProfit, plan: planProfit, kind: 'total' })
    return { cur, f, lines }
  }, [d.data, month])

  if (d.loading) return <Loading />
  if (d.error || !calc || !d.data) return <ErrorBox error={d.error} retry={d.reload} />
  const { cur, f, lines } = calc
  const catName = new Map(d.data.cats.map((c) => [c.id, c.name]))
  const detail = Object.entries(cur.byCategory)
    .map(([id, v]) => ({ id, name: catName.get(id) ?? 'Chưa phân loại', actual: v, plan: f.lines.find((l) => l.cat.id === id)?.value }))
    .filter((r) => d.data!.cats.find((c) => c.id === r.id)?.type !== 'income')
    .sort((a, b) => b.actual - a.actual)

  async function exportFile() {
    await exportXlsx(`pnl-${month}`, ['Khoản mục', 'Thực tế', 'Dự tính', 'Chênh lệch'], lines.map((l) => [l.label, l.actual, Math.round(l.plan), Math.round(l.actual - l.plan)]))
  }

  return (
    <div className="stack">
      <PageHead
        eyebrow="Tài chính"
        title="Báo cáo lãi lỗ (P&L)"
        sub="So sánh số thực tế với số dự tính của tháng."
        right={
          <>
            <button className="mem-btn mem-btn-sm" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Tháng trước">‹</button>
            <b>{monthLabel(month)}</b>
            <button className="mem-btn mem-btn-sm" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Tháng sau">›</button>
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
          Dự tính: doanh thu = trung bình 3 tháng trước, giá vốn = {pct(f.cogsPct)} doanh thu, các khoản còn lại theo mục Dự tính.
        </div>
      </div>

      <div className="mem-card stack">
        <div className="section-title">Chi tiết các khoản chi</div>
        {detail.length === 0 ? <div className="mem-caption">Tháng này chưa có khoản chi.</div> : (
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
