import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useAuth } from '../../core/auth'
import type { Range } from '../../core/DateRange'
import { monthLabel, monthRange, money, num, shiftMonth, thisMonth, vnDate } from '../../core/format'
import { compressImage } from '../../core/image'
import { Empty, ErrorBox, Loading, Modal, MoneyInput, errText, useAsync, useToast } from '../../core/ui'
import { readSheets } from '../../core/excel'
import { deleteActual, listActuals, listDeductions, listPayments, listTx, receiptUrl, saveActual, saveActuals, saveDeduction, uploadReceipt } from './api'
import { parseReconSheets, type SheetResult } from './sheetImport'
import { ENTRY_SRC, SRC_LABEL, expectedPos, tolerance, type Src } from './reconLogic'
import type { Actual } from './types'

const STATUS_LABEL = { none: 'Chưa giải trình', explained: 'Đã giải trình', approved: 'Kế toán đã duyệt' } as const

/** Danh sách số thực nhận do cửa hàng khai (kèm ảnh app, giải trình) và truy thu của kế toán. */
export function ActualsPanel({ range, branchId, onRange }: { range: Range; branchId: string; onRange?: (r: Range) => void }) {
  const { branches, can } = useAuth()
  const toast = useToast()
  // Phần tổng luôn theo một tháng (có nút chuyển tháng); phần chi tiết từng ngày theo khoảng ngày riêng.
  const [ym, setYm] = useState(thisMonth())
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [openAll, setOpenAll] = useState(false)
  const mr = monthRange(ym)
  const sumRange = onRange ? { from: mr.from, to: mr.to } : range
  const loadFrom = onRange ? sumRange.from : range.from
  const loadTo = onRange ? sumRange.to : range.to
  const acts = useAsync(() => listActuals(branchId, loadFrom, loadTo), [branchId, loadFrom, loadTo])
  const pays = useAsync(() => listPayments(branchId, loadFrom, loadTo), [branchId, loadFrom, loadTo])
  const tx = useAsync(() => listTx(branchId, loadFrom, loadTo), [branchId, loadFrom, loadTo])
  const [editing, setEditing] = useState<Actual | 'new' | null>(null)
  const [importing, setImporting] = useState(false)
  const [dayEntry, setDayEntry] = useState(false)
  const [limit, setLimit] = useState(150)
  const name = useMemo(() => new Map(branches.map((b) => [b.id, b.name])), [branches])
  const canEdit = can('finance.edit')
  const [tab, setTab] = useState('')
  const stores = useMemo(() => branches.filter((b) => b.name.trim().toUpperCase() !== 'CÔNG TY'), [branches])
  const storeName = (n: string) => n.replace(/^.*\bCN\s+/i, '')

  const allRows = useMemo(() => {
    return (acts.data ?? []).map((a) => {
      const pos = expectedPos(pays.data ?? [], tx.data ?? [], a.branch_id, a.source as Src, a.date_from, a.date_to)
      const diff = pos - a.amount
      return { a, pos, diff, short: diff > tolerance(pos) }
    }).sort((x, y) => (x.a.date_from < y.a.date_from ? 1 : -1))
  }, [acts.data, pays.data, tx.data])
  const curId = branchId || tab || stores[0]?.id || ''
  const rows = useMemo(() => allRows.filter((r) => r.a.branch_id === curId), [allRows, curId])
  const inR = (r: { a: Actual }, x: Range) => r.a.date_from >= x.from && r.a.date_from <= x.to
  const monthRows = useMemo(() => rows.filter((r) => inR(r, sumRange)), [rows, sumRange.from, sumRange.to])
  const detailRange = onRange ? sumRange : range
  const detailRows = useMemo(() => rows.filter((r) => inR(r, detailRange)), [rows, detailRange.from, detailRange.to])
  const [onlyIssues, setOnlyIssues] = useState(false)
  const bySrc = useMemo(() => {
    const m = new Map<string, { src: string; pos: number; amount: number; recovery: number; shortN: number; n: number }>()
    for (const r of monthRows) {
      const c = m.get(r.a.source) ?? { src: r.a.source, pos: 0, amount: 0, recovery: 0, shortN: 0, n: 0 }
      c.pos += r.pos; c.amount += r.a.amount; c.recovery += r.a.recovery; c.n++; if (r.short) c.shortN++
      m.set(r.a.source, c)
    }
    return [...m.values()].sort((x, y) => y.pos - x.pos)
  }, [monthRows])
  const days = useMemo(() => {
    const vis = detailRows.filter((r) => !onlyIssues || r.short || r.a.recovery > 0 || (r.a.explain && r.a.explain_status !== 'approved'))
    const map = new Map<string, typeof rows>()
    for (const r of vis.slice(0, limit)) map.set(r.a.date_from, [...(map.get(r.a.date_from) ?? []), r])
    const wd = ['Chủ nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy']
    return [...map.entries()].sort((x, y) => (x[0] < y[0] ? -1 : 1)).map(([date, items0]) => ({
      date, items: [...items0].sort((p, q) => ENTRY_SRC.indexOf(p.a.source as Src) - ENTRY_SRC.indexOf(q.a.source as Src)), label: `${wd[new Date(`${date}T00:00:00`).getDay()]}, ${vnDate(date)}`,
      pos: items0.reduce((t, r) => t + r.pos, 0), amount: items0.reduce((t, r) => t + r.a.amount, 0), shortN: items0.filter((r) => r.short).length,
    }))
  }, [detailRows, onlyIssues, limit])
  const sum = useMemo(() => ({
    pos: monthRows.reduce((t, r) => t + r.pos, 0), amount: monthRows.reduce((t, r) => t + r.a.amount, 0),
    recovery: monthRows.reduce((t, r) => t + r.a.recovery, 0), shortN: monthRows.filter((r) => r.short).length,
  }), [monthRows])

  async function openPhoto(path: string) {
    try { window.open(await receiptUrl(path), '_blank', 'noopener') } catch (e) { toast(errText(e), true) }
  }
  async function remove(a: Actual) {
    if (!confirm('Xóa số thực nhận này?')) return
    try { await deleteActual(a.id); toast('Đã xóa'); acts.reload() } catch (e) { toast(errText(e), true) }
  }
  async function approve(a: Actual) {
    try { await saveActual({ ...a, explain_status: 'approved' }); toast('Đã duyệt giải trình'); acts.reload() } catch (e) { toast(errText(e), true) }
  }

  const loading = acts.loading || pays.loading || tx.loading
  const error = acts.error ?? pays.error ?? tx.error

  return (
    <div className="stack">
      <div className="spread">
        <div className="mem-caption">Cửa hàng chụp màn hình app bán hàng (Grab, ShopeeFood, Be, Xanh SM, MoMo) rồi nhập số thực nhận trước khi bị trừ nợ, quảng cáo. Số này là cơ sở để tính truy thu.</div>
        <div className="row">
          {can('finance.edit') && <button className="mem-btn" onClick={() => setImporting(true)} title="Dùng cho giai đoạn chuyển đổi, khi cửa hàng chưa tự nhập trên web">Nhập từ file đối soát (giai đoạn chuyển đổi)</button>}
          <button className="mem-btn mem-btn-primary" onClick={() => setDayEntry(true)} disabled={stores.length === 0}>Nhập số thực nhận theo ngày</button>
        </div>
      </div>
      {!branchId && stores.length > 1 && (
        <div className="seg" role="tablist" aria-label="Cửa hàng" style={{ flexWrap: 'wrap', alignSelf: 'flex-start' }}>
          {stores.map((b) => {
            const n = allRows.filter((r) => r.a.branch_id === b.id && inR(r, sumRange)).length
            return <button key={b.id} role="tab" aria-selected={b.id === curId} className={b.id === curId ? 'on' : ''} onClick={() => { setTab(b.id); setLimit(150) }}>{storeName(b.name)} ({n})</button>
          })}
        </div>
      )}
      {onRange && (
        <div className="row" style={{ alignItems: 'center' }}>
          <button className="mem-btn mem-btn-sm" onClick={() => { setYm(shiftMonth(ym, -1)); setOpen(new Set()) }} aria-label="Tháng trước">‹</button>
          <b>{monthLabel(ym)}</b>
          <button className="mem-btn mem-btn-sm" onClick={() => { setYm(shiftMonth(ym, 1)); setOpen(new Set()) }} aria-label="Tháng sau">›</button>
        </div>
      )}
      {!loading && !error && monthRows.length > 0 && (
        <div className="mem-grid-4">
          <div className="mem-card"><div className="mem-caption">Phải về (POS)</div><div className="mem-kpi">{money(sum.pos)}</div></div>
          <div className="mem-card"><div className="mem-caption">Cửa hàng khai</div><div className="mem-kpi">{money(sum.amount)}</div></div>
          <div className="mem-card"><div className="mem-caption">Dòng bị thiếu</div><div className="mem-kpi">{sum.shortN}</div></div>
          <div className="mem-card"><div className="mem-caption">Truy thu</div><div className="mem-kpi">{money(sum.recovery)}</div></div>
        </div>
      )}
      {loading ? <Loading /> : error ? <ErrorBox error={error} retry={() => { acts.reload(); pays.reload(); tx.reload() }} /> : monthRows.length === 0 && detailRows.length === 0 ? (
        <Empty title={`Chưa có số thực nhận nào của ${name.get(curId) ? storeName(name.get(curId) as string) : 'cửa hàng này'} trong kỳ này`} hint="Bấm “Thêm số thực nhận”, chọn nguồn, kỳ, nhập số trên app và đính ảnh chụp màn hình." />
      ) : (
        <div className="stack">
          <div className="mem-card" style={{ padding: 0, overflow: 'hidden' }}>
            <div className="day-head"><b>{onRange ? `Tổng ${monthLabel(ym).toLowerCase()} theo nguồn tiền` : 'Tổng cả kỳ theo nguồn tiền'}</b><span className="mem-caption">{vnDate(sumRange.from)} → {vnDate(sumRange.to)}</span></div>
            <div className="table-wrap"><table className="tbl">
              <thead><tr><th>Nguồn</th><th className="num">Phải về (POS)</th><th className="num">Cửa hàng khai</th><th className="num">Chênh</th><th className="num">Số dòng thiếu</th><th className="num">Truy thu</th></tr></thead>
              <tbody>{bySrc.map((c) => {
                const d = c.pos - c.amount
                return (
                  <tr key={c.src}>
                    <td><b>{SRC_LABEL[c.src as Src] ?? c.src}</b></td><td className="num">{money(c.pos)}</td><td className="num">{money(c.amount)}</td>
                    <td className={`num ${d > tolerance(c.pos) ? 'neg' : ''}`}><b>{d > tolerance(c.pos) ? `Thiếu ${num(d)}đ` : d < -tolerance(c.pos) ? `Dư ${num(-d)}đ` : 'Khớp'}</b></td>
                    <td className="num">{c.shortN || '—'}</td><td className="num">{c.recovery ? money(c.recovery) : '—'}</td>
                  </tr>
                )
              })}</tbody>
            </table></div>
          </div>
          <div className="spread" style={{ marginTop: 8 }}>
            <div className="section-title" style={{ margin: 0 }}>Chi tiết từng ngày</div>
            <div className="row">
              <label className="row" style={{ cursor: 'pointer' }}><input type="checkbox" checked={onlyIssues} onChange={(e) => setOnlyIssues(e.target.checked)} /> Chỉ ngày cần xử lý</label>
              <button className="mem-btn mem-btn-sm" onClick={() => { setOpenAll(!openAll); setOpen(new Set()) }}>{openAll ? 'Thu gọn hết' : 'Mở hết'}</button>
            </div>
          </div>
          {days.length === 0 && <Empty title="Không có ngày nào cần xử lý" hint="Bỏ tick “Chỉ ngày cần xử lý” để xem đủ cả tháng." />}
          {days.map((d) => {
            const isOpen = openAll ? !open.has(d.date) : open.has(d.date)
            const toggle = () => { const n = new Set(open); if (n.has(d.date)) n.delete(d.date); else n.add(d.date); setOpen(n) }
            return (
              <div key={d.date} className="day-card">
                <button type="button" className="day-head day-toggle" aria-expanded={isOpen} onClick={toggle}>
                  <div><b>{isOpen ? '▾' : '▸'} {d.label}</b></div>
                  <div className="day-sum">
                    <span>Phải về <b>{money(d.pos)}</b></span>
                    <span>Khai <b>{money(d.amount)}</b></span>
                    {d.shortN > 0 ? <span className="mem-tag mem-tag-danger">{d.shortN} dòng thiếu</span> : <span className="mem-tag mem-tag-success">Khớp hết</span>}
                  </div>
                </button>
                {isOpen && d.items.map(({ a, pos, diff, short }) => {
                  const over = diff < -tolerance(pos)
                  const needs = short || a.explain || a.recovery > 0
                  return (
                    <div key={a.id} className={`day-row ${short ? 'bad' : ''}`}>
                      <div className="day-main">
                        <span className="day-src">{SRC_LABEL[a.source as Src] ?? a.source}{a.date_from !== a.date_to && <span className="mem-caption"> · {vnDate(a.date_from)} → {vnDate(a.date_to)}</span>}</span>
                        <span className="num day-n"><span className="mem-caption">POS</span> {money(pos)}</span>
                        <span className="num day-n"><span className="mem-caption">Khai</span> <b>{money(a.amount)}</b></span>
                        <span className={`day-diff ${short ? 'neg' : over ? 'pos' : ''}`}>{short ? `Thiếu ${num(diff)}đ` : over ? `Dư ${num(-diff)}đ` : 'Khớp'}</span>
                        <span className="day-act">
                          {a.photo_path && <button className="mem-btn mem-btn-sm" onClick={() => void openPhoto(a.photo_path!)}>Ảnh</button>}
                          <button className="mem-btn mem-btn-sm" onClick={() => setEditing(a)}>Sửa</button>
                          {canEdit && a.explain_status === 'explained' && <button className="mem-btn mem-btn-sm" onClick={() => void approve(a)}>Duyệt</button>}
                          {canEdit && <button className="mem-btn mem-btn-sm mem-btn-danger" onClick={() => void remove(a)}>Xóa</button>}
                        </span>
                      </div>
                      {needs && (
                        <div className="day-note">
                          <span className={`mem-tag ${a.explain_status === 'approved' ? 'mem-tag-success' : a.explain_status === 'explained' ? 'mem-tag-neutral' : 'mem-tag-warning'}`}>{STATUS_LABEL[a.explain_status]}</span>
                          {a.explain && <span>{a.explain}</span>}
                          {a.recovery > 0 && <span className="mem-tag mem-tag-danger">Truy thu {money(a.recovery)} · {a.recovery_status === 'collected' ? 'đã thu' : 'chưa thu'}</span>}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      )}
      {detailRows.length > limit && <div className="spread mem-caption"><span>Hiển thị {limit} / {detailRows.length}</span><button className="mem-btn mem-btn-sm" onClick={() => setLimit(limit + 150)}>Xem thêm</button></div>}
      {importing && <SheetImport onClose={() => setImporting(false)} onDone={() => { acts.reload(); pays.reload(); tx.reload() }} />}
      {dayEntry && <DayEntry stores={stores} defaultBranch={branchId} onClose={() => setDayEntry(false)} onSaved={() => { acts.reload(); pays.reload(); tx.reload() }} />}
      {editing && <ActualForm actual={editing === 'new' ? null : editing} defaultBranch={branchId} range={range} onClose={() => setEditing(null)} onSaved={() => { acts.reload(); pays.reload(); tx.reload() }} />}
    </div>
  )
}

function ActualForm({ actual, defaultBranch, range, onClose, onSaved }: { actual: Actual | null; defaultBranch: string; range: Range; onClose: () => void; onSaved: () => void }) {
  const { branches, can } = useAuth()
  const toast = useToast()
  const canEdit = can('finance.edit')
  const [branch, setBranch] = useState(actual?.branch_id ?? (defaultBranch || branches.find((b) => b.name.trim().toUpperCase() !== 'CÔNG TY')?.id || ''))
  const [source, setSource] = useState<string>(actual?.source ?? 'grab')
  const [from, setFrom] = useState(actual?.date_from ?? range.to)
  const [to, setTo] = useState(actual?.date_to ?? range.to)
  const [amount, setAmount] = useState(actual?.amount ?? 0)
  const [explain, setExplain] = useState(actual?.explain ?? '')
  const [status, setStatus] = useState<Actual['explain_status']>(actual?.explain_status ?? 'none')
  const [recovery, setRecovery] = useState(actual?.recovery ?? 0)
  const [recStatus, setRecStatus] = useState<Actual['recovery_status']>(actual?.recovery_status ?? 'pending')
  const [file, setFile] = useState<File | null>(null)
  const [pos, setPos] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    let alive = true
    if (!branch || !from || !to || from > to) { setPos(null); return }
    void Promise.all([listPayments(branch, from, to), listTx(branch, from, to)]).then(([p, t]) => { if (alive) setPos(expectedPos(p, t, branch, source as Src, from, to)) }).catch(() => { if (alive) setPos(null) })
    return () => { alive = false }
  }, [branch, source, from, to])

  const diff = pos === null ? null : pos - amount
  const short = diff !== null && pos !== null && amount > 0 && diff > tolerance(pos)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!branch) return setErr('Hãy chọn cửa hàng.')
    if (from > to) return setErr('Ngày bắt đầu phải trước ngày kết thúc.')
    if (!amount) return setErr('Hãy nhập số thực nhận trên app.')
    if (short && !explain.trim()) return setErr('Số khai đang thấp hơn số phải về. Hãy điền giải trình.')
    setBusy(true)
    setErr('')
    try {
      let photo = actual?.photo_path ?? null
      if (file) photo = await uploadReceipt(branch, await compressImage(file))
      await saveActual({
        id: actual?.id, branch_id: branch, source, date_from: from, date_to: to, amount, photo_path: photo, explain: explain.trim(),
        explain_status: explain.trim() && status === 'none' ? 'explained' : status, recovery, recovery_status: recStatus,
      })
      toast('Đã lưu số thực nhận')
      onSaved()
      onClose()
    } catch (e2) { setErr(errText(e2)) } finally { setBusy(false) }
  }

  return (
    <Modal title={actual ? 'Sửa số thực nhận' : 'Thêm số thực nhận'} onClose={onClose}>
      <form className="stack" onSubmit={(e) => void submit(e)}>
        <div className="form-grid">
          {branches.length > 1 && (
            <div className="field"><label htmlFor="a-br">Cửa hàng</label>
              <select id="a-br" className="input" value={branch} onChange={(e) => setBranch(e.target.value)}>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></div>
          )}
          <div className="field"><label htmlFor="a-src">Nguồn tiền</label>
            <select id="a-src" className="input" value={source} onChange={(e) => setSource(e.target.value)}>{ENTRY_SRC.map((s) => <option key={s} value={s}>{SRC_LABEL[s]}</option>)}</select></div>
          <div className="field"><label htmlFor="a-from">Từ ngày</label><input id="a-from" className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div className="field"><label htmlFor="a-to">Đến ngày</label><input id="a-to" className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        </div>
        <div className="field"><label htmlFor="a-amt">Số thực nhận trên app (trước khi trừ nợ, quảng cáo)</label><MoneyInput id="a-amt" value={amount} onChange={setAmount} /></div>
        {pos !== null && (
          <div className={`alert ${short ? 'warn' : ''}`}>
            <div>
              Số phải về theo POS cho kỳ này: <b>{money(pos)}</b>.{' '}
              {amount > 0 && (short ? <>Bạn khai thấp hơn <b>{money(diff!)}</b>, cần giải trình.</> : <>Số khai khớp hoặc cao hơn số POS.</>)}
            </div>
          </div>
        )}
        <div className="field"><label htmlFor="a-photo">Ảnh chụp màn hình app</label>
          <input id="a-photo" className="input" type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          {actual?.photo_path && !file && <span className="mem-caption">Đã có ảnh. Chọn ảnh mới nếu muốn thay.</span>}</div>
        <div className="field"><label htmlFor="a-ex">Giải trình {short && <span className="neg">(bắt buộc)</span>}</label>
          <textarea id="a-ex" className="input" value={explain} onChange={(e) => setExplain(e.target.value)} placeholder="Ví dụ: Hủy 3 đơn, khách hoàn tiền" /></div>
        {canEdit && (
          <div className="form-grid">
            <div className="field"><label htmlFor="a-st">Trạng thái giải trình</label>
              <select id="a-st" className="input" value={status} onChange={(e) => setStatus(e.target.value as Actual['explain_status'])}>
                {(Object.keys(STATUS_LABEL) as (keyof typeof STATUS_LABEL)[]).map((k) => <option key={k} value={k}>{STATUS_LABEL[k]}</option>)}</select></div>
            <div className="field"><label htmlFor="a-rec">Truy thu (đ)</label><MoneyInput id="a-rec" value={recovery} onChange={setRecovery} /></div>
            <div className="field"><label htmlFor="a-rs">Tình trạng truy thu</label>
              <select id="a-rs" className="input" value={recStatus} onChange={(e) => setRecStatus(e.target.value as Actual['recovery_status'])}>
                <option value="pending">Chưa thu</option><option value="collected">Đã thu</option></select></div>
          </div>
        )}
        {err && <div className="alert bad" role="alert">{err}</div>}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="mem-btn" onClick={onClose}>Hủy</button>
          <button className="mem-btn mem-btn-primary" disabled={busy}>{busy ? 'Đang lưu...' : 'Lưu'}</button>
        </div>
      </form>
    </Modal>
  )
}

function SheetImport({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { branches } = useAuth()
  const toast = useToast()
  const [year, setYear] = useState(new Date().getFullYear())
  const [file, setFile] = useState<File | null>(null)
  const [res, setRes] = useState<SheetResult | null>(null)
  const [withDed, setWithDed] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const name = new Map(branches.map((b) => [b.id, b.name]))

  async function read(f: File | null, y: number) {
    setFile(f); setRes(null); setErr('')
    if (!f) return
    try { setRes(parseReconSheets(await readSheets(f), branches, y)) } catch (e) { setErr(errText(e)) }
  }
  async function run() {
    if (!res) return
    setBusy(true); setErr('')
    try {
      const n = await saveActuals(res.actuals.map(({ pos: _p, ...a }) => a))
      let d = 0
      if (withDed) {
        for (const x of res.deductions) {
          const old = (await listDeductions(x.branch_id, x.from, x.to)).find((o) => o.kind === x.kind && o.source === x.source && o.date_from === x.from && o.date_to === x.to)
          await saveDeduction({ id: old?.id, branch_id: x.branch_id, date_from: x.from, date_to: x.to, kind: x.kind, source: x.source, amount: x.amount, note: 'Nhập từ file đối soát' })
          d++
        }
      }
      toast(`Đã nhập ${n} dòng thực nhận${withDed ? ` và ${d} khoản bị trừ` : ''}`)
      onDone(); onClose()
    } catch (e) { setErr(errText(e)) } finally { setBusy(false) }
  }
  const sum = (f: (a: SheetResult['actuals'][number]) => number) => (res?.actuals ?? []).reduce((a, x) => a + f(x), 0)

  return (
    <Modal title="Nhập số liệu từ file đối soát của kế toán" onClose={onClose} wide>
      <div className="stack">
        <div className="mem-caption">
          Mở Google Sheet đối soát → Tệp → Tải xuống → Microsoft Excel (.xlsx), rồi chọn file đó ở đây. Hệ thống đọc các sheet “ĐS DT …” của từng cửa hàng:
          cột <b>Thực nhận (kế toán nhập)</b> thành số thực nhận, phần thiếu so với <b>Thực tế</b> thành truy thu, cột <b>Giải trình</b>, cùng quảng cáo và trả vay Grab.
          Nhập lại cùng file sẽ ghi đè, không bị nhân đôi.
        </div>
        <div className="form-grid">
          <div className="field"><label htmlFor="si-file">File Excel</label><input id="si-file" className="input" type="file" accept=".xlsx,.xls" onChange={(e) => void read(e.target.files?.[0] ?? null, year)} /></div>
          <div className="field"><label htmlFor="si-year">Năm của các ngày trong file</label>
            <input id="si-year" className="input" type="number" value={year} onChange={(e) => { const y = Number(e.target.value); setYear(y); if (file) void read(file, y) }} /></div>
        </div>
        {res && (
          res.stores.length === 0 ? <div className="alert bad">Không tìm thấy sheet “ĐS DT …” nào đọc được. {res.skipped.length > 0 && `Đã bỏ qua: ${res.skipped.join(', ')}`}</div> : (
            <>
              <div className="table-wrap"><table className="tbl">
                <thead><tr><th>Sheet</th><th>Cửa hàng</th><th className="num">Số ngày</th></tr></thead>
                <tbody>{res.stores.map((s) => <tr key={s.sheet}><td>{s.sheet}</td><td>{name.get(s.branchId) ?? '—'}</td><td className="num">{s.days}</td></tr>)}</tbody>
              </table></div>
              <div className="mem-grid-3">
                <div><div className="mem-caption">Dòng thực nhận</div><div className="mem-kpi">{num(res.actuals.length)}</div></div>
                <div><div className="mem-caption">Tổng truy thu phát hiện</div><div className="mem-kpi">{money(sum((a) => a.recovery))}</div></div>
                <div><div className="mem-caption">Quảng cáo + trả vay</div><div className="mem-kpi">{money(res.deductions.reduce((a, d) => a + d.amount, 0))}</div></div>
              </div>
              <label className="row"><input type="checkbox" checked={withDed} onChange={(e) => setWithDed(e.target.checked)} /> Ghi cả khoản bị trừ (quảng cáo, trả vay Grab) vào chi phí</label>
              {res.skipped.length > 0 && <div className="mem-caption">Bỏ qua: {res.skipped.join(', ')}</div>}
            </>
          )
        )}
        {err && <div className="alert bad" role="alert">{err}</div>}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="mem-btn" onClick={onClose}>Hủy</button>
          <button className="mem-btn mem-btn-primary" disabled={busy || !res || res.actuals.length === 0} onClick={() => void run()}>{busy ? 'Đang nhập...' : 'Nhập vào hệ thống'}</button>
        </div>
      </div>
    </Modal>
  )
}


/** Nhập số thực nhận theo ngày: chọn cửa hàng và ngày, điền số trên app của từng nguồn một lượt. */
function DayEntry({ stores, defaultBranch, onClose, onSaved }: { stores: { id: string; name: string }[]; defaultBranch: string; onClose: () => void; onSaved: () => void }) {
  const toast = useToast()
  const [branch, setBranch] = useState(stores.find((b) => b.id === defaultBranch)?.id ?? stores[0]?.id ?? '')
  const [date, setDate] = useState(() => new Date(Date.now() - 86_400_000 - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10))
  const [amounts, setAmounts] = useState<Record<string, string>>({})
  const [explains, setExplains] = useState<Record<string, string>>({})
  const [files, setFiles] = useState<Record<string, File | null>>({})
  const [exist, setExist] = useState<Record<string, Actual>>({})
  const [pos, setPos] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    let alive = true
    if (!branch || !date) return
    setLoading(true); setErr('')
    void Promise.all([listActuals(branch, date, date), listPayments(branch, date, date), listTx(branch, date, date)]).then(([a, p, t]) => {
      if (!alive) return
      const ex: Record<string, Actual> = {}
      a.filter((x) => x.date_from === date && x.date_to === date).forEach((x) => { ex[x.source] = x })
      setExist(ex)
      setAmounts(Object.fromEntries(Object.values(ex).map((x) => [x.source, String(x.amount)])))
      setExplains(Object.fromEntries(Object.values(ex).map((x) => [x.source, x.explain])))
      setFiles({})
      setPos(Object.fromEntries(ENTRY_SRC.map((sc) => [sc, expectedPos(p, t, branch, sc, date, date)])))
    }).catch((e) => { if (alive) setErr(errText(e)) }).finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [branch, date])

  const val = (sc: string) => (amounts[sc] === undefined || amounts[sc] === '' ? null : Number(amounts[sc].replace(/\D/g, '')))
  const shortOf = (sc: string) => { const v = val(sc); const ps = pos[sc] ?? 0; return v !== null && ps - v > tolerance(ps) ? ps - v : 0 }

  async function submit(e: FormEvent) {
    e.preventDefault()
    const rows = ENTRY_SRC.filter((sc) => val(sc) !== null)
    if (rows.length === 0) return setErr('Hãy nhập số thực nhận của ít nhất một nguồn.')
    for (const sc of rows) if (shortOf(sc) > 0 && !(explains[sc] ?? '').trim()) return setErr(`${SRC_LABEL[sc]}: đang thấp hơn số phải về, hãy điền giải trình.`)
    setBusy(true); setErr('')
    try {
      const out: Omit<Actual, 'id'>[] = []
      for (const sc of rows) {
        const old = exist[sc]
        const photo = files[sc] ? await uploadReceipt(branch, await compressImage(files[sc] as File)) : old?.photo_path ?? null
        const ex = (explains[sc] ?? '').trim()
        out.push({
          branch_id: branch, source: sc, date_from: date, date_to: date, amount: val(sc) as number, photo_path: photo, explain: ex,
          explain_status: old?.explain_status === 'approved' && ex === old.explain ? 'approved' : ex ? 'explained' : 'none',
          recovery: old?.recovery ?? 0, recovery_status: old?.recovery_status ?? 'pending',
        })
      }
      await saveActuals(out)
      toast(`Đã lưu ${out.length} nguồn của ngày ${vnDate(date)}`); onSaved(); onClose()
    } catch (e2) { setErr(errText(e2)) } finally { setBusy(false) }
  }

  return (
    <Modal title="Nhập số thực nhận theo ngày" onClose={onClose} wide>
      <form className="stack" onSubmit={(e) => void submit(e)}>
        <div className="form-grid">
          {stores.length > 1 && <div className="field"><label htmlFor="de-br">Cửa hàng</label><select id="de-br" className="input" value={branch} onChange={(e) => setBranch(e.target.value)}>{stores.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></div>}
          <div className="field"><label htmlFor="de-date">Ngày</label><input id="de-date" className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        </div>
        <div className="mem-caption">Nhập số tiền thực nhận trên từng app (trước khi trừ nợ, quảng cáo), đính ảnh chụp màn hình. Nguồn nào hôm đó không có thì để trống. Mở lại đúng cửa hàng và ngày để sửa.</div>
        {loading ? <Loading /> : (
          <div className="stack">
            {ENTRY_SRC.map((sc) => {
              const v = val(sc); const ps = pos[sc] ?? 0; const sh = shortOf(sc)
              return (
                <div key={sc} className="mem-card stack" style={{ boxShadow: 'none', padding: '12px 14px', borderColor: sh ? 'var(--mem-danger)' : undefined }}>
                  <div className="spread">
                    <b>{SRC_LABEL[sc]}</b>
                    <span className="mem-caption">Phải về theo POS: <b>{money(ps)}</b>{v !== null && (sh ? <> · <span className="neg">Thiếu {money(sh)}</span></> : <> · <span style={{ color: '#3b9260' }}>Khớp</span></>)}</span>
                  </div>
                  <div className="form-grid">
                    <div className="field"><label htmlFor={`de-a-${sc}`}>Số thực nhận trên app</label>
                      <input id={`de-a-${sc}`} className="input" inputMode="numeric" placeholder="Để trống nếu không có" value={amounts[sc] === undefined || amounts[sc] === '' ? '' : Number(amounts[sc].replace(/\D/g, '')).toLocaleString('vi-VN')} onChange={(e) => setAmounts({ ...amounts, [sc]: e.target.value.replace(/\D/g, '') })} /></div>
                    <div className="field"><label htmlFor={`de-f-${sc}`}>Ảnh chụp app</label>
                      <input id={`de-f-${sc}`} className="input" type="file" accept="image/*" onChange={(e) => setFiles({ ...files, [sc]: e.target.files?.[0] ?? null })} />
                      {exist[sc]?.photo_path && !files[sc] && <span className="mem-caption">Đã có ảnh</span>}</div>
                  </div>
                  {sh > 0 && <div className="field"><label htmlFor={`de-e-${sc}`}>Giải trình <span className="neg">(bắt buộc)</span></label>
                    <textarea id={`de-e-${sc}`} className="input" rows={2} placeholder="Ví dụ: Hủy 3 đơn, khách hoàn tiền" value={explains[sc] ?? ''} onChange={(e) => setExplains({ ...explains, [sc]: e.target.value })} /></div>}
                </div>
              )
            })}
          </div>
        )}
        {err && <div className="alert bad" role="alert">{err}</div>}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="mem-btn" onClick={onClose}>Hủy</button>
          <button className="mem-btn mem-btn-primary" disabled={busy || loading}>{busy ? 'Đang lưu...' : 'Lưu cả ngày'}</button>
        </div>
      </form>
    </Modal>
  )
}
