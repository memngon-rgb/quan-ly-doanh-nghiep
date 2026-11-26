import { useEffect, useState } from 'react'
import { useAuth } from '../../core/auth'
import { money, monthLabel, monthRange, num, pct, shiftMonth, thisMonth, short } from '../../core/format'
import { Empty, ErrorBox, Loading, MoneyInput, PageHead, errText, useToast } from '../../core/ui'
import { removeForecast, saveForecast } from './api'
import { buildForecast, simulate } from './calc'
import { useMonthData } from './data'
import { GROUP_LABEL } from './types'

export default function Forecast() {
  const { branchId, can } = useAuth()
  const toast = useToast()
  const [month, setMonth] = useState(thisMonth())
  const d = useMonthData(month)
  const [target, setTarget] = useState(10_000_000)
  const [pctInput, setPctInput] = useState<number | null>(null)
  const [edits, setEdits] = useState<Record<string, number>>({})

  const days = monthRange(month).days
  const f = d.data ? buildForecast(month, d.data.tx, d.data.sales, d.data.cats, d.data.items) : null
  useEffect(() => { setPctInput(null) }, [month, branchId, d.data])

  if (d.loading) return <Loading />
  if (d.error || !f || !d.data) return <ErrorBox error={d.error} retry={d.reload} />

  const cogsPct = pctInput ?? f.cogsPct
  const sim = simulate(target, cogsPct, f.fixedMonthly, days)
  const editable = can('finance.settings') && !!branchId

  async function saveOverride(catId: string | null, kind: 'monthly' | 'cogs_pct', value: number) {
    try {
      await saveForecast({ branch_id: branchId, category_id: catId, kind, value })
      toast('Đã lưu số dự tính')
      setEdits({})
      d.reload()
    } catch (e) { toast(errText(e), true) }
  }
  async function clearOverride(catId: string | null, kind: 'monthly' | 'cogs_pct') {
    try {
      await removeForecast({ branch_id: branchId, category_id: catId, kind })
      toast('Đã quay về số tự tính')
      d.reload()
    } catch (e) { toast(errText(e), true) }
  }

  const noHistory = f.revenueMonthly === 0 && f.fixedMonthly === 0

  return (
    <div className="stack">
      <PageHead
        eyebrow="Tài chính"
        title="Dự tính chi phí"
        sub="Chi phí cố định lấy trung bình 3 tháng trước, giá vốn tính theo % doanh thu. Chỉnh được số liệu tay nếu cần."
        right={
          <div className="row">
            <button className="mem-btn mem-btn-sm" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Tháng trước">‹</button>
            <b>{monthLabel(month)}</b>
            <button className="mem-btn mem-btn-sm" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Tháng sau">›</button>
          </div>
        }
      />

      {noHistory && <div className="alert warn">Chưa có số liệu của 3 tháng trước ({f.histMonths.map(monthLabel).join(', ')}). Hãy nhập sổ thu chi hoặc nhập file Excel để dự tính chính xác hơn.</div>}

      <div className="mem-grid-main">
        <div className="mem-card stack">
          <div>
            <div className="section-title">Bán trong 1 ngày được bao nhiêu?</div>
            <div className="mem-caption">Nhập doanh thu dự kiến mỗi ngày, hệ thống tính chi phí và xem có đủ chi trả không.</div>
          </div>
          <div className="form-grid">
            <div className="field"><label htmlFor="tg">Doanh thu 1 ngày (đ)</label><MoneyInput id="tg" value={target} onChange={setTarget} /></div>
            <div className="field"><label htmlFor="cp">Giá vốn / doanh thu (%)</label>
              <input id="cp" className="input" inputMode="decimal" value={Math.round(cogsPct * 1000) / 10}
                onChange={(e) => setPctInput(Math.min(100, Math.max(0, Number(e.target.value.replace(',', '.')) || 0)) / 100)} />
              <span className="mem-caption">
                {f.cogsPctSource === 'manual' ? 'Số bạn đã chỉnh tay' : f.cogsPctSource === 'history' ? `Tự tính từ 3 tháng trước (${pct(f.cogsPctAuto ?? 0)})` : 'Chưa có dữ liệu, đang dùng 35% mặc định'}
              </span></div>
          </div>

          <div className={`alert ${sim.ok ? 'good' : 'bad'}`} role="status">
            <div>
              <div className="t">{sim.ok ? `Đủ chi trả: lãi dự kiến ${money(sim.profit)} mỗi ngày` : `Chưa đủ chi trả: thiếu ${money(-sim.profit)} mỗi ngày`}</div>
              <div>Cần bán tối thiểu <b>{money(sim.breakeven)}</b> mỗi ngày để hòa vốn. Cả tháng ({days} ngày) dự kiến {sim.ok ? 'lãi' : 'lỗ'} {money(Math.abs(sim.profit * days))}.</div>
            </div>
          </div>

          <div className="mem-grid-3">
            <div><div className="mem-caption">Giá vốn / ngày</div><div className="mem-kpi" style={{ fontSize: 22 }}>{money(sim.cogs)}</div></div>
            <div><div className="mem-caption">Chi phí cố định / ngày</div><div className="mem-kpi" style={{ fontSize: 22 }}>{money(sim.fixedDaily)}</div></div>
            <div><div className="mem-caption">Tổng chi / ngày</div><div className="mem-kpi" style={{ fontSize: 22 }}>{money(sim.totalCost)}</div></div>
          </div>

          <div>
            <div className="lbl" style={{ marginBottom: 6 }}>So sánh các mức doanh thu</div>
            <div className="table-wrap">
              <table className="tbl">
                <thead><tr><th className="num">Bán / ngày</th><th className="num">Tổng chi</th><th className="num">Lãi / ngày</th><th className="num">Lãi cả tháng</th><th>Kết quả</th></tr></thead>
                <tbody>
                  {[5, 8, 10, 12, 15, 20].map((m) => {
                    const s = simulate(m * 1_000_000, cogsPct, f.fixedMonthly, days)
                    return (
                      <tr key={m} style={m * 1_000_000 === target ? { background: '#f3f8f4' } : undefined}>
                        <td className="num">{short(m * 1_000_000)}</td><td className="num">{short(s.totalCost)}</td>
                        <td className={`num ${s.ok ? 'pos' : 'neg'}`}>{short(s.profit)}</td><td className="num">{short(s.profit * days)}</td>
                        <td><span className={`mem-tag ${s.ok ? 'mem-tag-success' : 'mem-tag-danger'}`}>{s.ok ? 'Đủ chi trả' : 'Thiếu'}</span></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="mem-card stack">
          <div>
            <div className="section-title">Chi phí cố định dự tính / tháng</div>
            <div className="mem-caption">Tổng: <b>{money(f.fixedMonthly)}</b> · Doanh thu TB 3 tháng trước: {money(f.revenueMonthly)}</div>
            {!editable && <div className="mem-caption" style={{ marginTop: 4 }}>{branchId ? 'Bạn không có quyền chỉnh số dự tính.' : 'Chọn một chi nhánh cụ thể để chỉnh số dự tính.'}</div>}
          </div>
          {f.lines.length === 0 ? <Empty title="Chưa có danh mục chi" /> : (
            <div className="table-wrap">
              <table className="tbl">
                <thead><tr><th>Khoản</th><th className="num">TB 3 tháng</th><th className="num">Dự tính</th></tr></thead>
                <tbody>
                  {f.lines.map((l) => {
                    const cur = edits[l.cat.id]
                    return (
                      <tr key={l.cat.id}>
                        <td>{l.cat.name}<div className="mem-caption">{GROUP_LABEL[l.cat.grp]}</div></td>
                        <td className="num">{num(l.auto)}</td>
                        <td className="num" style={{ minWidth: 150 }}>
                          {editable ? (
                            <div className="row" style={{ flexWrap: 'nowrap', justifyContent: 'flex-end' }}>
                              <div style={{ width: 110 }}><MoneyInput value={cur ?? l.value} onChange={(n) => setEdits({ ...edits, [l.cat.id]: n })} /></div>
                              {cur !== undefined && cur !== l.value && <button className="mem-btn mem-btn-sm mem-btn-primary" onClick={() => void saveOverride(l.cat.id, 'monthly', cur)}>Lưu</button>}
                              {l.override !== null && cur === undefined && <button className="mem-btn mem-btn-sm" title="Quay về số tự tính" onClick={() => void clearOverride(l.cat.id, 'monthly')}>Bỏ chỉnh</button>}
                            </div>
                          ) : <>{num(l.value)}{l.override !== null && <span className="mem-caption"> (chỉnh tay)</span>}</>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          {editable && pctInput !== null && pctInput !== f.cogsPct && (
            <div className="row">
              <button className="mem-btn mem-btn-sm mem-btn-primary" onClick={() => void saveOverride(null, 'cogs_pct', pctInput)}>Lưu tỉ lệ giá vốn {pct(pctInput)} làm mặc định</button>
            </div>
          )}
          {editable && f.cogsPctSource === 'manual' && (
            <button className="mem-btn mem-btn-sm" onClick={() => void clearOverride(null, 'cogs_pct')}>Bỏ tỉ lệ giá vốn chỉnh tay</button>
          )}
        </div>
      </div>
    </div>
  )
}
