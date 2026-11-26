import { useMemo } from 'react'
import { useAuth } from '../../core/auth'
import { addDays, money, monthLabel, monthRange, pct, short, thisMonth, today } from '../../core/format'
import { ErrorBox, Loading, PageHead } from '../../core/ui'
import { IconTrend, IconWallet, IconChart } from '../../core/icons'
import { buildForecast, simulate, summarize } from './calc'
import { useMonthData } from './data'
import { GROUP_LABEL, type Group } from './types'

export default function Dashboard() {
  const { can } = useAuth()
  const month = thisMonth()
  const d = useMonthData(month)

  const v = useMemo(() => {
    if (!d.data) return null
    const { cats, tx, sales, items } = d.data
    const { from, to, days } = monthRange(month)
    const inMonth = summarize(tx.filter((t) => t.tx_date >= from && t.tx_date <= to), sales.filter((s) => s.sale_date >= from && s.sale_date <= to), cats)
    const t = today()
    const todaySum = summarize(tx.filter((x) => x.tx_date === t), sales.filter((s) => s.sale_date === t), cats)
    const f = buildForecast(month, tx, sales, cats, items)
    // 14 ngày gần nhất
    const series = Array.from({ length: 14 }, (_, i) => {
      const day = addDays(t, i - 13)
      const s = summarize(tx.filter((x) => x.tx_date === day), sales.filter((x) => x.sale_date === day), cats)
      return { day, rev: s.revenue, exp: s.expense }
    })
    // 7 ngày gần nhất để so với dự tính
    const last7 = series.slice(-7)
    const avgRev = last7.reduce((s, x) => s + x.rev, 0) / 7
    const sim = simulate(avgRev, f.cogsPct, f.fixedMonthly, days)
    const alerts: { cls: string; title: string; text: string }[] = []
    if (avgRev > 0 && !sim.ok) alerts.push({ cls: 'bad', title: 'Doanh thu 7 ngày gần đây chưa đủ chi trả', text: `Trung bình ${money(avgRev)}/ngày, cần tối thiểu ${money(sim.breakeven)}/ngày để hòa vốn.` })
    if (inMonth.revenue > 0 && f.cogsPctAuto !== null && inMonth.byGroup.cogs / inMonth.revenue > f.cogsPct + 0.05)
      alerts.push({ cls: 'warn', title: 'Giá vốn tháng này cao hơn dự tính', text: `Hiện ${pct(inMonth.byGroup.cogs / inMonth.revenue)} doanh thu, dự tính ${pct(f.cogsPct)}.` })
    if (todaySum.expense === 0 && new Date().getHours() >= 18) alerts.push({ cls: 'warn', title: 'Hôm nay chưa có khoản chi nào được ghi', text: 'Kiểm tra xem kế toán đã nhập chi hôm nay chưa.' })
    return { inMonth, todaySum, f, series, alerts, avgRev, days, sim }
  }, [d.data, month])

  if (d.loading) return <Loading />
  if (d.error || !v || !d.data) return <ErrorBox error={d.error} retry={d.reload} />
  const { inMonth, todaySum, f, series, alerts, sim } = v
  const maxBar = Math.max(1, ...series.flatMap((s) => [s.rev, s.exp]))
  const gross = inMonth.revenue - inMonth.byGroup.cogs
  const planProfitMonth = f.revenueMonthly * (1 - f.cogsPct) - f.fixedMonthly
  const progress = f.revenueMonthly > 0 ? Math.min(1, inMonth.revenue / f.revenueMonthly) : 0
  const groups = (['cogs', 'payroll', 'fixed', 'other'] as Group[]).map((g) => ({ g, v: inMonth.byGroup[g] }))
  const maxG = Math.max(1, ...groups.map((x) => x.v))

  return (
    <div className="stack">
      <PageHead eyebrow={monthLabel(month)} title="Tổng quan tài chính" />

      <div className="hero">
        <div>
          <div className="kicker">Doanh thu tháng này</div>
          <div style={{ fontSize: 40, fontWeight: 850, letterSpacing: -1.5, marginTop: 6 }}>{money(inMonth.revenue)}</div>
          <h2 style={{ fontSize: 18, fontWeight: 600, color: '#cfe5d9' }}>
            {inMonth.revenue - inMonth.expense >= 0 ? 'Đang có lãi' : 'Đang lỗ'} {money(Math.abs(inMonth.revenue - inMonth.expense))} sau khi trừ mọi khoản chi
          </h2>
        </div>
        <div className="hero-card">
          <div className="mem-caption" style={{ color: '#b9d8c9' }}>So với doanh thu TB 3 tháng trước ({short(f.revenueMonthly)})</div>
          <div className="bar"><span style={{ width: `${progress * 100}%` }} /></div>
          <div style={{ fontWeight: 800 }}>{f.revenueMonthly > 0 ? pct(inMonth.revenue / f.revenueMonthly) : 'Chưa có dữ liệu so sánh'}</div>
        </div>
      </div>

      <div className="mem-grid-4">
        <Metric label="Doanh thu hôm nay" value={money(todaySum.revenue)} note={`Chi hôm nay ${money(todaySum.expense)}`} icon={<IconWallet />} bg="var(--mem-green-soft)" />
        <Metric label="Tổng chi tháng này" value={money(inMonth.expense)} note={inMonth.revenue > 0 ? `${pct(inMonth.expense / inMonth.revenue)} doanh thu` : ''} icon={<IconChart />} bg="var(--mem-peach)" />
        <Metric label="Lãi gộp" value={money(gross)} note={inMonth.revenue > 0 ? `Biên ${pct(gross / inMonth.revenue)}` : ''} icon={<IconTrend />} bg="var(--mem-blue)" />
        <Metric label="Dòng tiền (thu − chi)" value={money(inMonth.income - inMonth.expense)} note={`Thu ${short(inMonth.income)} · Chi ${short(inMonth.expense)}`} icon={<IconWallet />} bg="var(--mem-green-soft)" tone={inMonth.income - inMonth.expense >= 0 ? 'pos' : 'neg'} />
      </div>

      <div className="mem-grid-main">
        <div className="mem-card stack">
          <div className="spread">
            <div><div className="section-title">14 ngày gần nhất</div><div className="mem-caption">Doanh thu và chi theo ngày</div></div>
            <div className="legend"><span><i style={{ background: '#4d9d75' }} />Doanh thu</span><span><i style={{ background: '#e3a89f' }} />Chi</span></div>
          </div>
          <div className="bars" role="img" aria-label="Biểu đồ doanh thu và chi 14 ngày gần nhất">
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
            <div className="section-title">Dự tính tháng này</div>
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
