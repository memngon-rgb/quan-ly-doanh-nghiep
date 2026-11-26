import { useMemo, useState, type FormEvent } from 'react'
import { useAuth } from '../../core/auth'
import { DateRangePicker, useDateRange } from '../../core/DateRange'
import { exportXlsx } from '../../core/excel'
import { addDays, money, num, today, vnDate } from '../../core/format'
import { IconDownload } from '../../core/icons'
import { Empty, ErrorBox, Loading, Modal, MoneyInput, PageHead, errText, useAsync, useToast } from '../../core/ui'
import { ActualsPanel } from './Actuals'
import { deleteDeduction, deleteHoliday, listActuals, listDeductions, listHolidays, listPayments, listTx, saveDeduction, saveHoliday } from './api'
import { ENTRY_SRC, SRC_LABEL, buildRecon, tolerance, type Src } from './reconLogic'
import { DEDUCTION_LABEL, type Deduction, type DeductionKind } from './types'

type Tab = 'overview' | 'actuals' | 'deductions' | 'holidays'
const TABS: [Tab, string][] = [['overview', 'Tổng quan'], ['actuals', 'Cửa hàng khai'], ['deductions', 'Khoản bị trừ'], ['holidays', 'Ngày nghỉ lễ']]

/** Đối soát: POS (phải về) → cửa hàng khai (thực nhận) → sao kê (về tài khoản công ty) → khoản bị trừ. */
export default function Reconcile() {
  const { branches } = useAuth()
  const [range, setRange] = useDateRange()
  const [tab, setTab] = useState<Tab>('overview')
  const ext = addDays(range.to, 7)
  const pays = useAsync(() => listPayments('', range.from, range.to), [range.from, range.to])
  const tx = useAsync(() => listTx('', range.from, ext), [range.from, ext])
  const acts = useAsync(() => listActuals('', range.from, range.to), [range.from, range.to])
  const deds = useAsync(() => listDeductions('', range.from, range.to), [range.from, range.to])
  const hols = useAsync(() => listHolidays(), [])

  const loading = pays.loading || tx.loading || acts.loading || deds.loading || hols.loading
  const error = pays.error ?? tx.error ?? acts.error ?? deds.error ?? hols.error
  const reloadAll = () => { pays.reload(); tx.reload(); acts.reload(); deds.reload(); hols.reload() }

  const recon = useMemo(() => buildRecon({
    from: range.from, to: range.to, today: today(), branches,
    payments: pays.data ?? [], tx: tx.data ?? [], actuals: acts.data ?? [], deductions: deds.data ?? [], holidays: hols.data ?? [],
  }), [range.from, range.to, branches, pays.data, tx.data, acts.data, deds.data, hols.data])

  async function exportFile() {
    const rows: (string | number)[][] = []
    recon.views.forEach((v) => v.rows.forEach((r) => rows.push([v.name, SRC_LABEL[r.src], r.pos, r.entered ?? 'Chờ cửa hàng nhập', r.diff ?? '', r.bank ?? ''])))
    await exportXlsx(`doi-soat-${range.from}_${range.to}`, ['Cửa hàng', 'Nguồn', 'Phải về (POS)', 'Cửa hàng khai', 'Thiếu / dư', 'Sao kê (nếu ghi rõ cửa hàng)'], rows)
  }

  return (
    <div className="stack">
      <PageHead
        eyebrow="Tài chính"
        title="Đối soát"
        sub="Tiền phải về theo POS, so với số cửa hàng khai trên app và số thực nhận trên sao kê ngân hàng."
        right={<button className="mem-btn" onClick={() => void exportFile()} disabled={recon.views.length === 0}><IconDownload /> Xuất Excel</button>}
      />
      <div className="mem-card stack">
        <div className="spread">
          <DateRangePicker value={range} onChange={setRange} />
          <div className="seg" role="tablist" aria-label="Phần đối soát">
            {TABS.map(([k, label]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{label}</button>)}
          </div>
        </div>
        <div className="mem-caption">Đối soát tính cho toàn công ty, không phụ thuộc chi nhánh đang chọn ở góc trên.</div>

        {loading ? <Loading /> : error ? <ErrorBox error={error} retry={reloadAll} /> : tab === 'overview' ? (
          <Overview recon={recon} range={range} />
        ) : tab === 'actuals' ? (
          <ActualsPanel range={range} branchId="" />
        ) : tab === 'deductions' ? (
          <Deductions range={range} recon={recon} deds={deds.data ?? []} onChanged={() => { deds.reload(); tx.reload() }} />
        ) : (
          <Holidays list={hols.data ?? []} onChanged={() => hols.reload()} />
        )}
      </div>
    </div>
  )
}

type Recon = ReturnType<typeof buildRecon>

function Overview({ recon, range }: { recon: Recon; range: { from: string; to: string } }) {
  if (recon.views.length === 0) {
    return <Empty title="Chưa có dữ liệu để đối soát" hint="Vào Doanh thu → nhập báo cáo iPOS PTTT cho khoảng ngày này, rồi nhập sao kê ở Thu chi." />
  }
  const tot = recon.views.reduce((a, v) => ({ thucTe: a.thucTe + v.thucTe, entered: a.entered + v.entered, shortfall: a.shortfall + v.shortfall, waiting: a.waiting + v.waiting }), { thucTe: 0, entered: 0, shortfall: 0, waiting: 0 })
  const bank = recon.company.reduce((a, c) => a + c.bank, 0)
  return (
    <>
      <div className="mem-grid-4">
        <div><div className="mem-caption">Phải về theo POS</div><div className="mem-kpi">{money(tot.thucTe)}</div><div className="mem-caption">Sau thu chi tiền mặt</div></div>
        <div><div className="mem-caption">Cửa hàng khai</div><div className="mem-kpi">{money(tot.entered)}</div><div className="mem-caption">{tot.waiting > 0 ? `${tot.waiting} mục còn chờ cửa hàng nhập` : 'Đã đủ các mục'}</div></div>
        <div><div className="mem-caption">Tiền thiếu so với POS</div><div className={`mem-kpi ${tot.shortfall > 0 ? 'neg' : ''}`}>{money(tot.shortfall)}</div><div className="mem-caption">Cần giải trình hoặc truy thu</div></div>
        <div><div className="mem-caption">Về tài khoản công ty (sao kê)</div><div className="mem-kpi">{money(bank)}</div><div className="mem-caption">Sau khi nền tảng trừ nợ, quảng cáo</div></div>
      </div>

      <div className="section-title">Theo từng cửa hàng</div>
      <div className="mem-grid-2">
        {recon.views.map((v) => (
          <div key={v.id} className="mem-card stack" style={{ boxShadow: 'none' }}>
            <div className="spread">
              <b>{v.name}</b>
              {v.shortfall > 0 ? <span className="mem-tag mem-tag-danger">Thiếu {num(v.shortfall)}</span>
                : v.waiting > 0 ? <span className="mem-tag mem-tag-warning">Chờ cửa hàng nhập</span>
                : <span className="mem-tag mem-tag-success">Khớp</span>}
            </div>
            <div className="table-wrap">
              <table className="tbl">
                <thead><tr><th>Nguồn</th><th className="num">Phải về</th><th className="num">Cửa hàng khai</th><th>Kết quả</th></tr></thead>
                <tbody>
                  {v.rows.map((r) => (
                    <tr key={r.src}>
                      <td>{SRC_LABEL[r.src]}</td>
                      <td className="num">{money(r.pos)}</td>
                      <td className="num">{r.entered === null ? <span className="mem-caption">—</span> : money(r.entered)}</td>
                      <td>
                        {r.entered === null || r.diff === null ? <span className="mem-tag mem-tag-warning">Chờ cửa hàng nhập</span>
                          : r.diff > tolerance(r.pos) ? <span className="mem-tag mem-tag-danger">Thiếu {num(r.diff)}</span>
                          : r.diff < -tolerance(r.pos) ? <span className="mem-tag mem-tag-neutral">Dư {num(-r.diff)}</span>
                          : <span className="mem-tag mem-tag-success">Khớp</span>}
                        {r.bank !== null && r.bank > 0 && <div className="mem-caption">Sao kê: {money(r.bank)}</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>

      <div className="section-title">Toàn công ty: cộng các cửa hàng so với sao kê</div>
      <div className="table-wrap">
        <table className="tbl">
          <thead><tr><th>Nguồn</th><th className="num">Phải về (POS)</th><th className="num">Cửa hàng khai</th><th className="num">Sao kê nhận</th><th className="num">Bị trừ</th><th>Tình trạng</th></tr></thead>
          <tbody>
            {recon.company.map((c) => (
              <tr key={c.src}>
                <td><b>{SRC_LABEL[c.src]}</b>{c.src !== 'other' && c.branchesNeeded > 0 && <div className="mem-caption">{c.branchesEntered}/{c.branchesNeeded} cửa hàng đã khai</div>}{c.src === 'transfer' && <div className="mem-caption">Sao kê gồm cả B2B và khách lẻ</div>}</td>
                <td className="num">{money(c.pos)}</td>
                <td className="num">{c.src === 'other' ? '—' : c.branchesEntered ? money(c.entered) : <span className="mem-caption">Chờ nhập</span>}</td>
                <td className="num">{money(c.bank)}</td>
                <td className="num">{c.deducted === null ? <span className="mem-caption">—</span> : money(c.deducted)}</td>
                <td>
                  {c.pending > 0 && (c.late
                    ? <span className="mem-tag mem-tag-danger">Trễ {money(c.pending)} · dự kiến {vnDate(c.expected!)}</span>
                    : <span className="mem-tag mem-tag-warning">Đang chờ {money(c.pending)} · dự kiến {vnDate(c.expected!)}</span>)}
                  {c.pending === 0 && c.deducted !== null && c.unclassified > tolerance(c.entered) && <span className="mem-tag mem-tag-warning">Chưa phân loại {money(c.unclassified)}</span>}
                  {c.pending === 0 && c.deducted !== null && c.unclassified <= tolerance(c.entered) && <span className="mem-tag mem-tag-success">Đã giải thích</span>}
                  {c.carry > 0 && <div className="mem-caption">Có {money(c.carry)} doanh thu đầu kỳ về theo kỳ gộp từ trước {vnDate(range.from)}, chưa tính vào cột Sao kê. Chọn khoản ngày bắt đầu sớm hơn để so đủ.</div>}
                  {c.pending === 0 && c.deducted === null && c.src !== 'other' && <span className="mem-caption">{c.branchesEntered < c.branchesNeeded ? 'Chờ cửa hàng nhập' : 'Chưa có sao kê'}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mem-caption">
        Bị trừ = số cửa hàng khai − số sao kê nhận (chỉ tính khi mọi cửa hàng đã khai). MoMo và Be Food đối soát theo kỳ ghi trong nội dung chuyển khoản; Grab theo ngày tiền về trừ 1 ngày;
        ShopeeFood và Xanh SM theo ngày chuyển (so dồn tích); tiền mặt nộp gộp cho cả công ty. Dòng “Khác” gồm B2B và chuyển khoản lẻ nên không có số phải về tương ứng.
      </div>

      {(recon.unknown.length > 0 || recon.unassigned.length > 0) && (
        <>
          <div className="section-title">Khoản trên sao kê chưa xác định</div>
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>Ngày</th><th>Nội dung</th><th className="num">Số tiền</th></tr></thead>
              <tbody>
                {[...recon.unassigned, ...recon.unknown].slice(0, 30).map((b) => (
                  <tr key={b.tx.id}><td>{vnDate(b.tx.tx_date)}</td><td>{b.tx.note.slice(0, 120)}{b.src !== 'other' && <div className="mem-caption">{SRC_LABEL[b.src]} · chưa nhận ra cửa hàng</div>}</td><td className="num">{money(b.tx.amount)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mem-caption">Hiển thị tối đa 30 khoản. Các khoản này không tính vào số của cửa hàng nào.</div>
        </>
      )}
    </>
  )
}

function Deductions({ range, recon, deds, onChanged }: { range: { from: string; to: string }; recon: Recon; deds: Deduction[]; onChanged: () => void }) {
  const { branches } = useAuth()
  const toast = useToast()
  const [editing, setEditing] = useState<Partial<Deduction> | null>(null)
  const name = new Map(branches.map((b) => [b.id, b.name]))
  const suggest = recon.company.filter((c) => c.deducted !== null && c.unclassified > tolerance(c.entered))
  async function remove(d: Deduction) {
    if (!confirm('Xóa khoản bị trừ này? Dòng chi phí tương ứng ở Thu chi cũng bị xóa.')) return
    try { await deleteDeduction(d); toast('Đã xóa'); onChanged() } catch (e) { toast(errText(e), true) }
  }
  return (
    <div className="stack">
      <div className="spread">
        <div className="mem-caption">Khoản nền tảng tự trừ khi chuyển tiền về (quảng cáo, trả vay Grab, phí...). Mỗi khoản tự thành một dòng chi phí ở Thu chi và P&L.</div>
        <button className="mem-btn mem-btn-primary" onClick={() => setEditing({ date_from: range.from, date_to: range.to, kind: 'ads', source: 'grab', amount: 0, note: '' })}>Thêm khoản bị trừ</button>
      </div>
      {suggest.length > 0 && (
        <div className="alert warn">
          <div>
            <span className="t">Còn phần bị trừ chưa phân loại</span>
            {suggest.map((c) => (
              <div key={c.src}>{SRC_LABEL[c.src]}: {money(c.unclassified)}{' '}
                <button className="mem-btn mem-btn-sm" onClick={() => setEditing({ date_from: range.from, date_to: range.to, kind: c.src === 'grab' ? 'grab_loan' : 'ads', source: c.src, amount: Math.round(c.unclassified), note: '' })}>Ghi nhận</button></div>
            ))}
          </div>
        </div>
      )}
      {deds.length === 0 ? <Empty title="Chưa có khoản bị trừ trong khoảng ngày này" /> : (
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>Kỳ</th><th>Cửa hàng</th><th>Nguồn</th><th>Loại</th><th>Ghi chú</th><th className="num">Số tiền</th><th /></tr></thead>
            <tbody>
              {deds.map((d) => (
                <tr key={d.id}>
                  <td>{d.date_from === d.date_to ? vnDate(d.date_from) : `${vnDate(d.date_from)} → ${vnDate(d.date_to)}`}</td>
                  <td>{name.get(d.branch_id) ?? '—'}</td><td>{SRC_LABEL[d.source as Src] ?? d.source}</td>
                  <td>{DEDUCTION_LABEL[d.kind]}</td><td>{d.note || <span className="mem-caption">—</span>}</td>
                  <td className="num neg">{num(d.amount)}</td>
                  <td className="num">
                    <button className="mem-btn mem-btn-sm" onClick={() => setEditing(d)}>Sửa</button>{' '}
                    <button className="mem-btn mem-btn-sm mem-btn-danger" onClick={() => void remove(d)}>Xóa</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="mem-caption">Trả vay Grab ghi nguyên số Grab trừ mỗi ngày (cả gốc và lãi) vào chi phí. Lưu ý phần gốc về mặt kế toán không phải chi phí.</div>
      {editing && <DeductionForm initial={editing} onClose={() => setEditing(null)} onSaved={onChanged} />}
    </div>
  )
}

function DeductionForm({ initial, onClose, onSaved }: { initial: Partial<Deduction>; onClose: () => void; onSaved: () => void }) {
  const { branches, branchId } = useAuth()
  const toast = useToast()
  const [branch, setBranch] = useState(initial.branch_id ?? (branchId || branches[0]?.id || ''))
  const [kind, setKind] = useState<DeductionKind>(initial.kind ?? 'ads')
  const [source, setSource] = useState(initial.source ?? 'grab')
  const [from, setFrom] = useState(initial.date_from ?? today())
  const [to, setTo] = useState(initial.date_to ?? today())
  const [amount, setAmount] = useState(initial.amount ?? 0)
  const [note, setNote] = useState(initial.note ?? '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!branch) return setErr('Hãy chọn cửa hàng.')
    if (!amount) return setErr('Hãy nhập số tiền.')
    if (from > to) return setErr('Ngày bắt đầu phải trước ngày kết thúc.')
    setBusy(true); setErr('')
    try {
      await saveDeduction({ id: initial.id, branch_id: branch, date_from: from, date_to: to, kind, source, amount, note: note.trim() })
      toast('Đã lưu và ghi vào chi phí'); onSaved(); onClose()
    } catch (e2) { setErr(errText(e2)) } finally { setBusy(false) }
  }
  return (
    <Modal title={initial.id ? 'Sửa khoản bị trừ' : 'Thêm khoản bị trừ'} onClose={onClose}>
      <form className="stack" onSubmit={(e) => void submit(e)}>
        <div className="form-grid">
          {branches.length > 1 && <div className="field"><label htmlFor="d-br">Cửa hàng</label><select id="d-br" className="input" value={branch} onChange={(e) => setBranch(e.target.value)}>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></div>}
          <div className="field"><label htmlFor="d-kind">Loại</label><select id="d-kind" className="input" value={kind} onChange={(e) => setKind(e.target.value as DeductionKind)}>{(Object.keys(DEDUCTION_LABEL) as DeductionKind[]).map((k) => <option key={k} value={k}>{DEDUCTION_LABEL[k]}</option>)}</select></div>
          <div className="field"><label htmlFor="d-src">Nguồn</label><select id="d-src" className="input" value={source} onChange={(e) => setSource(e.target.value)}>{ENTRY_SRC.map((s) => <option key={s} value={s}>{SRC_LABEL[s]}</option>)}</select></div>
          <div className="field"><label htmlFor="d-amt">Số tiền (đ)</label><MoneyInput id="d-amt" value={amount} onChange={setAmount} /></div>
          <div className="field"><label htmlFor="d-from">Từ ngày</label><input id="d-from" className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div className="field"><label htmlFor="d-to">Đến ngày</label><input id="d-to" className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        </div>
        <div className="field"><label htmlFor="d-note">Ghi chú</label><input id="d-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} /></div>
        <div className="mem-caption">Khi lưu, hệ thống tự tạo một dòng chi phí ngày {vnDate(to)} ở Thu chi. Sửa lại thì dòng đó cập nhật theo, không bị nhân đôi.</div>
        {err && <div className="alert bad" role="alert">{err}</div>}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="mem-btn" onClick={onClose}>Hủy</button>
          <button className="mem-btn mem-btn-primary" disabled={busy}>{busy ? 'Đang lưu...' : 'Lưu'}</button>
        </div>
      </form>
    </Modal>
  )
}

function Holidays({ list, onChanged }: { list: { hdate: string; platform: string; note: string }[]; onChanged: () => void }) {
  const toast = useToast()
  const [date, setDate] = useState(today())
  const [platform, setPlatform] = useState('all')
  const [note, setNote] = useState('')
  async function add(e: FormEvent) {
    e.preventDefault()
    try { await saveHoliday({ hdate: date, platform, note: note.trim() }); setNote(''); toast('Đã thêm ngày nghỉ'); onChanged() } catch (e2) { toast(errText(e2), true) }
  }
  return (
    <div className="stack">
      <div className="mem-caption">Ngày nền tảng nghỉ không chuyển tiền (lễ, Tết). Hệ thống bỏ qua các ngày này khi dự kiến ngày tiền về, nên khoản đến hạn vào ngày nghỉ không bị báo “Trễ” oan.</div>
      <form className="row" onSubmit={(e) => void add(e)}>
        <input className="input" style={{ width: 'auto' }} type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Ngày nghỉ" />
        <select className="input" style={{ width: 'auto' }} value={platform} onChange={(e) => setPlatform(e.target.value)} aria-label="Nền tảng">
          <option value="all">Mọi nền tảng</option>{ENTRY_SRC.filter((s) => s !== 'cash').map((s) => <option key={s} value={s}>{SRC_LABEL[s]}</option>)}
        </select>
        <input className="input" style={{ flex: 1, minWidth: 160 }} placeholder="Ghi chú (ví dụ: MoMo nghỉ lễ)" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Ghi chú" />
        <button className="mem-btn mem-btn-primary">Thêm</button>
      </form>
      {list.length === 0 ? <Empty title="Chưa khai ngày nghỉ nào" /> : (
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>Ngày</th><th>Nền tảng</th><th>Ghi chú</th><th /></tr></thead>
            <tbody>
              {list.map((h) => (
                <tr key={`${h.hdate}|${h.platform}`}>
                  <td>{vnDate(h.hdate)}</td><td>{h.platform === 'all' ? 'Mọi nền tảng' : SRC_LABEL[h.platform as Src] ?? h.platform}</td><td>{h.note || <span className="mem-caption">—</span>}</td>
                  <td className="num"><button className="mem-btn mem-btn-sm mem-btn-danger" onClick={() => void deleteHoliday(h).then(onChanged)}>Xóa</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
