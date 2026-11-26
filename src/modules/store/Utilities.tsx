import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useAuth } from '../../core/auth'
import { addDays, monthLabel, monthRange, money, num, shiftMonth, thisMonth, today, vnDate } from '../../core/format'
import { compressImage } from '../../core/image'
import { isDemo, sb } from '../../core/supabase'
import { Empty, ErrorBox, Loading, Modal, MoneyInput, errText, useAsync, useToast } from '../../core/ui'
import { PhotoLinks, isStore } from './PhotoBits'
import { listMeters, listUtilityMonths, saveMeter, saveUtilityMonth, uploadPhoto, type Meter } from './api'
import { DEFAULT_ELECTRIC_TIERS, DEFAULT_WATER_TIERS, VAT_UTILITY, dailyUse, tierCost, type Tier } from './utility'

interface Tariff { electric: Tier[]; water: Tier[]; vat: number }
const DEFAULT_TARIFF: Tariff = { electric: DEFAULT_ELECTRIC_TIERS, water: DEFAULT_WATER_TIERS, vat: VAT_UTILITY }
const LS = 'qltc-utility-tariff'

async function loadTariff(): Promise<Tariff> {
  try {
    if (!isDemo) {
      const { data } = await sb().from('app_settings').select('value').eq('key', 'utility_tariff').maybeSingle()
      if (data?.value) return data.value as Tariff
    } else {
      const s = localStorage.getItem(LS)
      if (s) return JSON.parse(s) as Tariff
    }
  } catch { /* dùng mặc định */ }
  return DEFAULT_TARIFF
}
async function saveTariff(t: Tariff): Promise<void> {
  if (isDemo) return localStorage.setItem(LS, JSON.stringify(t))
  const { error } = await sb().from('app_settings').upsert({ key: 'utility_tariff', value: t, updated_at: new Date().toISOString() })
  if (error) throw error
}

/** Điện nước: ghi chỉ số cuối ca tối, ước tính tiền trong tháng theo bậc thang, chốt số thật cuối tháng. */
export default function Utilities() {
  const { branches: all, branchId, can } = useAuth()
  const branches = all.filter(isStore)
  const [br, setBr] = useState(branches.find((b) => b.id === branchId)?.id || branches[0]?.id || '')
  useEffect(() => { if (!br && branches[0]) setBr(branches[0].id) }, [br, branches])
  const [ym, setYm] = useState(thisMonth())
  const [adding, setAdding] = useState(false)
  const [closing, setClosing] = useState(false)
  const [tariffOpen, setTariffOpen] = useState(false)
  const m = monthRange(ym)
  const from = addDays(m.from, -40)
  const meters = useAsync(() => (br ? listMeters(br, from, m.to) : Promise.resolve([] as Meter[])), [br, ym])
  const months = useAsync(() => (br ? listUtilityMonths(br) : Promise.resolve([])), [br, ym])
  const tariff = useAsync(loadTariff, [])
  const t = tariff.data ?? DEFAULT_TARIFF

  const calc = useMemo(() => {
    const all = meters.data ?? []
    const inMonth = all.filter((r) => r.read_date >= m.from && r.read_date <= m.to)
    const series = (key: 'electric' | 'water') => {
      const base = all.filter((r) => r.read_date < m.from && r[key] !== null).slice(-1)[0]
      const rs = [...(base ? [base] : []), ...inMonth].map((r) => ({ date: r.read_date, value: r[key] }))
      const du = dailyUse(rs).filter((x) => x.date >= m.from)
      const used = du.reduce((s, x) => s + x.use, 0)
      const dayCount = du.reduce((s, x) => s + x.days, 0)
      return { du, used, perDay: dayCount ? used / dayCount : 0, dayCount }
    }
    const e = series('electric'); const w = series('water')
    const estE = tierCost(e.perDay * m.days, t.electric) * (1 + t.vat)
    const estW = tierCost(w.perDay * m.days, t.water) * (1 + t.vat)
    return { inMonth, e, w, estE, estW, projE: e.perDay * m.days, projW: w.perDay * m.days }
  }, [meters.data, ym, t])
  const actual = (months.data ?? []).find((x) => x.month === ym)

  return (
    <div className="stack">
      <div className="spread">
        <div className="row">
          {branches.length > 1 && <select className="input" aria-label="Cửa hàng" value={br} onChange={(e) => setBr(e.target.value)}>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>}
          <button className="mem-btn mem-btn-sm" onClick={() => setYm(shiftMonth(ym, -1))} aria-label="Tháng trước">‹</button>
          <b>{monthLabel(ym)}</b>
          <button className="mem-btn mem-btn-sm" onClick={() => setYm(shiftMonth(ym, 1))} aria-label="Tháng sau">›</button>
        </div>
        <div className="row">
          {can('admin.users') && <button className="mem-btn" onClick={() => setTariffOpen(true)}>Biểu giá</button>}
          <button className="mem-btn" onClick={() => setClosing(true)} disabled={!br}>Chốt số thật cuối tháng</button>
          <button className="mem-btn mem-btn-primary" onClick={() => setAdding(true)} disabled={!br}>Ghi chỉ số hôm nay</button>
        </div>
      </div>

      {meters.loading ? <Loading /> : meters.error ? <ErrorBox error={meters.error} retry={meters.reload} /> : (
        <>
          <div className="mem-grid-2">
            <Kpi title="Điện" unit="kWh" used={calc.e.used} perDay={calc.e.perDay} proj={calc.projE} est={calc.estE} actualUse={actual?.kwh ?? null} actualCost={actual?.electric_cost ?? null} />
            <Kpi title="Nước" unit="m³" used={calc.w.used} perDay={calc.w.perDay} proj={calc.projW} est={calc.estW} actualUse={actual?.m3 ?? null} actualCost={actual?.water_cost ?? null} />
          </div>
          <div className="mem-caption">Tiền ước tính = lượng dùng bình quân mỗi ngày × số ngày trong tháng, tính theo bậc thang, cộng VAT {Math.round(t.vat * 100)}%. Cuối tháng bấm “Chốt số thật” để thay bằng số trên hóa đơn.</div>
          <div className="mem-card">
            <div className="section-title">Chỉ số đã ghi</div>
            {calc.inMonth.length === 0 ? <Empty title="Tháng này chưa có chỉ số nào" hint="Cuối ca tối, chụp đồng hồ điện, nước rồi bấm “Ghi chỉ số hôm nay”." /> : (
              <div className="table-wrap"><table className="tbl">
                <thead><tr><th>Ngày</th><th className="num">Điện (kWh)</th><th className="num">Nước (m³)</th><th>Ghi chú</th><th /></tr></thead>
                <tbody>{[...calc.inMonth].reverse().map((r) => (
                  <tr key={r.id}><td>{vnDate(r.read_date)}</td><td className="num">{r.electric ?? '—'}</td><td className="num">{r.water ?? '—'}</td><td>{r.note || '—'}</td>
                    <td><PhotoLinks paths={[r.electric_photo ?? '', r.water_photo ?? ''].filter(Boolean)} /></td></tr>
                ))}</tbody>
              </table></div>
            )}
          </div>
        </>
      )}
      {adding && <MeterForm branch={br} onClose={() => setAdding(false)} onSaved={meters.reload} />}
      {closing && <CloseMonthForm branch={br} ym={ym} cur={actual} estKwh={calc.projE} estM3={calc.projW} onClose={() => setClosing(false)} onSaved={months.reload} />}
      {tariffOpen && <TariffForm tariff={t} onClose={() => setTariffOpen(false)} onSaved={tariff.reload} />}
    </div>
  )
}

function Kpi(p: { title: string; unit: string; used: number; perDay: number; proj: number; est: number; actualUse: number | null; actualCost: number | null }) {
  const real = p.actualCost !== null
  return (
    <div className="mem-card stack">
      <div className="mem-caption">{p.title} trong tháng</div>
      <div className="mem-kpi">{real ? money(p.actualCost as number) : p.est ? `≈ ${money(p.est)}` : '—'}</div>
      <div className="mem-caption">{real ? `Số thật theo hóa đơn${p.actualUse !== null ? `, ${num(p.actualUse)} ${p.unit}` : ''}` : 'Ước tính cả tháng'}</div>
      <div className="mem-caption">Đã dùng {num(p.used)} {p.unit} · bình quân {p.perDay.toFixed(1)} {p.unit}/ngày · dự kiến cả tháng {num(p.proj)} {p.unit}</div>
    </div>
  )
}

function MeterForm({ branch, onClose, onSaved }: { branch: string; onClose: () => void; onSaved: () => void }) {
  const toast = useToast()
  const [date, setDate] = useState(today())
  const [e, setE] = useState(''); const [w, setW] = useState(''); const [note, setNote] = useState('')
  const [ef, setEf] = useState<File | null>(null); const [wf, setWf] = useState<File | null>(null)
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  async function submit(ev: FormEvent) {
    ev.preventDefault()
    const en = e.trim() === '' ? null : Number(e.replace(',', '.')); const wn = w.trim() === '' ? null : Number(w.replace(',', '.'))
    if ((en !== null && !Number.isFinite(en)) || (wn !== null && !Number.isFinite(wn))) return setErr('Chỉ số phải là số.')
    if (en === null && wn === null) return setErr('Nhập ít nhất chỉ số điện hoặc nước.')
    setBusy(true); setErr('')
    try {
      const ep = ef ? await uploadPhoto(branch, await compressImage(ef)) : null
      const wp = wf ? await uploadPhoto(branch, await compressImage(wf)) : null
      await saveMeter({ branch_id: branch, read_date: date, electric: en, water: wn, electric_photo: ep || null, water_photo: wp || null, note: note.trim() })
      toast('Đã ghi chỉ số'); onSaved(); onClose()
    } catch (e2) { setErr(errText(e2)) } finally { setBusy(false) }
  }
  return (
    <Modal title="Ghi chỉ số điện nước" onClose={onClose}>
      <form className="stack" onSubmit={(ev) => void submit(ev)}>
        <div className="field"><label htmlFor="mt-d">Ngày</label><input id="mt-d" className="input" type="date" value={date} onChange={(x) => setDate(x.target.value)} /></div>
        <div className="form-grid">
          <div className="field"><label htmlFor="mt-e">Chỉ số điện (kWh)</label><input id="mt-e" className="input" inputMode="decimal" value={e} onChange={(x) => setE(x.target.value)} /></div>
          <div className="field"><label htmlFor="mt-w">Chỉ số nước (m³)</label><input id="mt-w" className="input" inputMode="decimal" value={w} onChange={(x) => setW(x.target.value)} /></div>
          <div className="field"><label htmlFor="mt-ef">Ảnh đồng hồ điện</label><input id="mt-ef" className="input" type="file" accept="image/*" onChange={(x) => setEf(x.target.files?.[0] ?? null)} /></div>
          <div className="field"><label htmlFor="mt-wf">Ảnh đồng hồ nước</label><input id="mt-wf" className="input" type="file" accept="image/*" onChange={(x) => setWf(x.target.files?.[0] ?? null)} /></div>
        </div>
        <div className="field"><label htmlFor="mt-n">Ghi chú</label><input id="mt-n" className="input" value={note} onChange={(x) => setNote(x.target.value)} /></div>
        <div className="mem-caption">Ghi chỉ số hiện trên đồng hồ (số cộng dồn), app tự tính lượng dùng mỗi ngày. Ghi lại cùng ngày thì số cũ được thay.</div>
        {err && <div className="alert bad" role="alert">{err}</div>}
        <div className="row" style={{ justifyContent: 'flex-end' }}><button type="button" className="mem-btn" onClick={onClose}>Hủy</button><button className="mem-btn mem-btn-primary" disabled={busy}>{busy ? 'Đang lưu...' : 'Lưu'}</button></div>
      </form>
    </Modal>
  )
}

function CloseMonthForm({ branch, ym, cur, estKwh, estM3, onClose, onSaved }: { branch: string; ym: string; cur?: { kwh: number | null; m3: number | null; electric_cost: number | null; water_cost: number | null; note: string }; estKwh: number; estM3: number; onClose: () => void; onSaved: () => void }) {
  const toast = useToast()
  const [kwh, setKwh] = useState(cur?.kwh ?? Math.round(estKwh)); const [m3, setM3] = useState(cur?.m3 ?? Math.round(estM3))
  const [ec, setEc] = useState(cur?.electric_cost ?? 0); const [wc, setWc] = useState(cur?.water_cost ?? 0)
  const [note, setNote] = useState(cur?.note ?? '')
  async function go() {
    try { await saveUtilityMonth({ branch_id: branch, month: ym, kwh, m3, electric_cost: ec, water_cost: wc, note: note.trim() }); toast('Đã chốt số thật'); onSaved(); onClose() } catch (e) { toast(errText(e), true) }
  }
  return (
    <Modal title={`Chốt số thật ${monthLabel(ym)}`} onClose={onClose}>
      <div className="stack">
        <div className="form-grid">
          <div className="field"><label htmlFor="cm-k">Điện tiêu thụ (kWh)</label><input id="cm-k" className="input" type="number" value={kwh} onChange={(e) => setKwh(Number(e.target.value))} /></div>
          <div className="field"><label htmlFor="cm-m">Nước tiêu thụ (m³)</label><input id="cm-m" className="input" type="number" value={m3} onChange={(e) => setM3(Number(e.target.value))} /></div>
          <div className="field"><label htmlFor="cm-ec">Tiền điện trên hóa đơn</label><MoneyInput id="cm-ec" value={ec} onChange={setEc} /></div>
          <div className="field"><label htmlFor="cm-wc">Tiền nước trên hóa đơn</label><MoneyInput id="cm-wc" value={wc} onChange={setWc} /></div>
        </div>
        <div className="field"><label htmlFor="cm-n">Ghi chú</label><input id="cm-n" className="input" value={note} onChange={(e) => setNote(e.target.value)} /></div>
        <div className="row" style={{ justifyContent: 'flex-end' }}><button className="mem-btn" onClick={onClose}>Hủy</button><button className="mem-btn mem-btn-primary" onClick={() => void go()}>Lưu</button></div>
      </div>
    </Modal>
  )
}

function TariffForm({ tariff, onClose, onSaved }: { tariff: Tariff; onClose: () => void; onSaved: () => void }) {
  const toast = useToast()
  const [t, setT] = useState<Tariff>(JSON.parse(JSON.stringify(tariff)))
  const edit = (k: 'electric' | 'water', i: number, p: Partial<Tier>) => setT({ ...t, [k]: t[k].map((x, j) => (j === i ? { ...x, ...p } : x)) })
  async function go() { try { await saveTariff(t); toast('Đã lưu biểu giá'); onSaved(); onClose() } catch (e) { toast(errText(e), true) } }
  const block = (k: 'electric' | 'water', title: string, unit: string) => (
    <div className="stack"><div className="section-title">{title}</div>
      {t[k].map((x, i) => (
        <div key={i} className="row">
          <span style={{ width: 120 }}>{x.upTo === null ? 'Bậc cuối' : <>đến <input className="input" style={{ width: 70 }} type="number" aria-label="Đến mức" value={x.upTo} onChange={(e) => edit(k, i, { upTo: Number(e.target.value) })} /> {unit}</>}</span>
          <input className="input" style={{ width: 110 }} type="number" aria-label="Đơn giá" value={x.price} onChange={(e) => edit(k, i, { price: Number(e.target.value) })} /> đ/{unit}
        </div>
      ))}</div>
  )
  return (
    <Modal title="Biểu giá điện nước" onClose={onClose}>
      <div className="stack">
        {block('electric', 'Điện (bậc thang)', 'kWh')}{block('water', 'Nước (bậc thang)', 'm³')}
        <div className="field"><label htmlFor="tf-v">VAT (%)</label><input id="tf-v" className="input" type="number" value={Math.round(t.vat * 100)} onChange={(e) => setT({ ...t, vat: Number(e.target.value) / 100 })} /></div>
        <div className="mem-caption">Đơn giá mẫu, bạn sửa lại theo hóa đơn thật. Biểu giá dùng chung cho mọi cửa hàng.</div>
        <div className="row" style={{ justifyContent: 'flex-end' }}><button className="mem-btn" onClick={onClose}>Hủy</button><button className="mem-btn mem-btn-primary" onClick={() => void go()}>Lưu</button></div>
      </div>
    </Modal>
  )
}
