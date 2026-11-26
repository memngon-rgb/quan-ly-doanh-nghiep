import { useMemo } from 'react'
import { useAuth } from '../../core/auth'
import { DateRangePicker, useDateRange } from '../../core/DateRange'
import { addDays, money, monthRange, pct, short, today, vnDate } from '../../core/format'
import { BranchSelect } from '../../core/BranchSelect'
import { ErrorBox, Loading, PageHead } from '../../core/ui'
import { IconTrend, IconWallet, IconChart } from '../../core/icons'
import { rangePlan, simulate, summarize } from './calc'
import { useRangeData } from './data'
import { GROUP_LABEL, type Group } from './types'

export default function Dashboard() {
  const { can } = useAuth()
  const [range, setRange] = useDateRange()
  const d = useRangeData(range)

  const v = useMemo(() => {
    if (!d.data) return null
    const { cats, tx, sales, items } = d.data
    const { from, to } = range
    const inMonth = summarize(tx.filter((t) => t.tx_date >= from && t.tx_date <= to), sales.filter((s) => s.sale_date >= from && s.sale_date <= to), cats)
    const t = today()
    // Chưa có số liệu hôm nay (thường do chưa nhập/import) thì hiện ngày gần nhất có doanh thu
    const lastSale = sales.reduce((m, s) => (s.sale_date <= t && s.sale_date > m ? s.sale_date : m), '')
    const dayShown = !sales.some((s) => s.sale_date === t) && lastSale ? lastSale : t
    const todaySum = summarize(tx.filter((x) => x.tx_date === dayShown), sales.filter((s) => s.sale_date === dayShown), cats)
    const plan = rangePlan(from, to, tx, sales, cats, items)
    const f = plan.last
    const days = monthRange(to.slice(0, 7)).days
    // Tối đa 31 ngày cuối của khoảng đang xem
    const n = Math.min(31, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86_400_000) + 1)
    const series = Array.from({ length: n }, (_, i) => {
      const day = addDays(to, i - (n - 1))
      const s = summarize(tx.filter((x) => x.tx_date === day), sales.filter((x) => x.sale_date === day), cats)
      return { day, rev: s.revenue, exp: s.expense }
    })
    const last7 = series.slice(-7)
    const avgRev = last7.reduce((s, x) => s + x.rev, 0) / Math.max(1, last7.length)
    const sim = simulate(avgRev, f.cogsPct, f.fixedMonthly, days)
    const alerts: { cls: string; title: string; text: string }[] = []
    if (avgRev > 0 && !sim.ok) alerts.push({ cls: 'bad', title: 'Doanh thu 7 ngày cuối kỳ chưa đủ chi trả', text: `Trung bình ${money(avgRev)}/ngày, cần tối thiểu ${money(sim.breakeven)}/ngày để hòa vốn.` })
    if (inMonth.revenue > 0 && f.cogsPctAuto !== null && inMonth.byGroup.cogs / inMonth.revenue > plan.cogsPct + 0.05)
      alerts.push({ cls: 'warn', title: 'Giá vốn cao hơn dự tính', text: `Hiện ${pct(inMonth.byGroup.cogs / inMonth.revenue)} doanh thu, dự tính ${pct(plan.cogsPct)}.` })
    if (to === t && todaySum.expense === 0 && new Date().getHours() >= 18) alerts.push({ cls: 'warn', title: 'Hôm nay chưa có khoản chi nào được ghi', text: 'Kiểm tra xem kế toán đã nhập chi hôm nay chưa.' })
    return { dayShown, inMonth, todaySum, plan, series, alerts, avgRev, days, sim }
  }, [d.data, range.from, range.to])

  if (d.loading) return <Loading />
  if (d.error || !v || !d.data) return <ErrorBox error={d.error} retry={d.reload} />
  const { dayShown, inMonth, todaySum, plan, series, alerts, sim } = v
  const maxBar = Math.max(1, ...series.flatMap((s) => [s.rev, s.exp]))
  const afterVat = inMonth.revenue - inMonth.vat
  const gross = afterVat - inMonth.byGroup.cogs
  const planProfitMonth = plan.revenue * (1 - plan.cogsPct) - plan.fixed
  const progress = plan.revenue > 0 ? Math.min(1, inMonth.revenue / plan.revenue) : 0
  const groups = (['cogs', 'payroll', 'fixed', 'other'] as Group[]).map((g) => ({ g, v: inMonth.byGroup[g] }))
  const maxG = Math.max(1, ...groups.map((x) => x.v))

  return (
    <div className="stack">
      <PageHead title="Tổng quan tài chính" controls={<><DateRangePicker value={range} onChange={setRange} /><BranchSelect /></>} />

      <div className="hero">
        <div>
          <div className="kicker">Doanh thu trong kỳ</div>
          <div style={{ fontSize: 40, fontWeight: 850, letterSpacing: -1.5, marginTop: 6 }}>{money(inMonth.revenue)}</div>
          {inMonth.vat > 0 && (
            <div style={{ fontSize: 15, color: '#cfe5d9', marginTop: 4 }}>
              Trừ thuế VAT {money(inMonth.vat)} còn lại <b style={{ color: '#fff' }}>{money(inMonth.revenue - inMonth.vat)}</b>
            </div>
          )}
        </div>
        <div className="hero-card">
          <div className="mem-caption" style={{ color: '#b9d8c9' }}>So với dự tính của kỳ ({short(plan.revenue)})</div>
          <div className="bar"><span style={{ width: `${progress * 100}%` }} /></div>
          <div style={{ fontWeight: 800 }}>{plan.revenue > 0 ? pct(inMonth.revenue / plan.revenue) : 'Chưa có dữ liệu so sánh'}</div>
        </div>
      </div>

      <div className="mem-grid-4">
        <Metric label={dayShown === today() ? 'Doanh thu hôm nay' : `Doanh thu ngày ${vnDate(dayShown)}`} value={money(todaySum.revenue)} note={`${dayShown === today() ? 'Chi hôm nay' : 'Chi cùng ngày'} ${money(todaySum.expense)}`} icon={<IconWallet />} bg="var(--mem-green-soft)" />
        <Metric label="Tổng chi trong kỳ" value={money(inMonth.expense)} note={inMonth.revenue > 0 ? `${pct(inMonth.expense / inMonth.revenue)} doanh thu` : ''} icon={<IconChart />} bg="var(--mem-peach)" />
        <Metric label="Lãi gộp" value={money(gross)} note={inMonth.revenue > 0 ? `Biên ${pct(gross / inMonth.revenue)}` : ''} icon={<IconTrend />} bg="var(--mem-blue)" />
        <Metric label="Dòng tiền (thu − chi)" value={money(inMonth.income - inMonth.expense)} note={`Thu ${short(inMonth.income)} · Chi ${short(inMonth.expense)}`} icon={<IconWallet />} bg="var(--mem-green-soft)" tone={inMonth.income - inMonth.expense >= 0 ? 'pos' : 'neg'} />
      </div>

      <div className="mem-grid-main">
        <div className="mem-card stack">
          <div className="spread">
            <div><div className="section-title">Theo ngày</div><div className="mem-caption">Doanh thu và chi, tối đa 31 ngày cuối của kỳ</div></div>
            <div className="legend"><span><i style={{ background: '#4d9d75' }} />Doanh thu</span><span><i style={{ background: '#e3a89f' }} />Chi</span></div>
          </div>
          <div className="bars" role="img" aria-label="Biểu đồ doanh thu và chi theo ngày">
            {series.map((s) => (
              <div className="col" key={s.day} title={`${s.day}: doanh thu ${money(s.rev)}, chi ${money(s.exp)}`}>
                <div className="pair">
                  <div className="b rev" style={{ height: `${(s.rev / maxBar) * 100}%` }} />
                  <div className="b exp" style={{ height: `${(s.exp / maxBar) * 100}%` }} />
                </div>
                <div className="x">{s.day.slice(8)}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="mem-card stack">
          <div className="section-title">Chi theo nhóm</div>
          {groups.map(({ g, v: val }) => (
            <div key={g}>
              <div className="spread" style={{ fontSize: 13 }}><span>{GROUP_LABEL[g]}</span><b>{money(val)}</b></div>
              <div className="mem-progress" style={{ marginTop: 5 }}><span style={{ width: `${(val / maxG) * 100}%` }} /></div>
            </div>
          ))}
        </div>
      </div>

      <div className="mem-grid-2">
        <div className="mem-card stack">
          <div className="section-title">Cảnh báo</div>
          {alerts.length === 0 ? <div className="alert good"><div><span className="t">Chưa có cảnh báo.</span> Mọi chỉ số đang trong mức dự tính.</div></div> :
            alerts.map((a, i) => <div key={i} className={`alert ${a.cls}`}><div><div className="t">{a.title}</div>{a.text}</div></div>)}
        </div>
        {can('finance.report') && (
          <div className="mem-card stack">
            <div className="section-title">Dự tính trong kỳ</div>
            <div className="list-item"><span>Lợi nhuận dự tính</span><b className={planProfitMonth >= 0 ? 'pos' : 'neg'}>{money(planProfitMonth)}</b></div>
            <div className="list-item"><span>Chi phí cố định / ngày</span><b>{money(sim.fixedDaily)}</b></div>
            <div className="list-item"><span>Doanh thu hòa vốn / ngày</span><b>{money(sim.breakeven)}</b></div>
            <div className="mem-caption">Chi tiết tại mục “Dự tính”.</div>
          </div>
        )}
      </div>
    </div>
  )
}

function Metric({ label, value, note, icon, bg, tone }: { label: string; value: string; note?: string; icon: React.ReactNode; bg: string; tone?: 'pos' | 'neg' }) {
  return (
    <div className="mem-card metric">
      <div className="icon" style={{ background: bg, color: 'var(--mem-green)' }}>{icon}</div>
      <div className="label">{label}</div>
      <div className={`mem-kpi ${tone ?? ''}`} style={{ marginTop: 8 }}>{value}</div>
      <div className="note">{note}</div>
    </div>
  )
}
