import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useAuth } from '../../core/auth'
import type { Range } from '../../core/DateRange'
import { money, num, vnDate } from '../../core/format'
import { compressImage } from '../../core/image'
import { Empty, ErrorBox, Loading, Modal, MoneyInput, errText, useAsync, useToast } from '../../core/ui'
import { readSheets } from '../../core/excel'
import { deleteActual, listActuals, listDeductions, listPayments, listTx, receiptUrl, saveActual, saveActuals, saveDeduction, uploadReceipt } from './api'
import { parseReconSheets, type SheetResult } from './sheetImport'
import { ENTRY_SRC, SRC_LABEL, expectedPos, tolerance, type Src } from './reconLogic'
import type { Actual } from './types'

const STATUS_LABEL = { none: 'Chưa giải trình', explained: 'Đã giải trình', approved: 'Kế toán đã duyệt' } as const

/** Danh sách số thực nhận do cửa hàng khai (kèm ảnh app, giải trình) và truy thu của kế toán. */
export function ActualsPanel({ range, branchId }: { range: Range; branchId: string }) {
  const { branches, can } = useAuth()
  const toast = useToast()
  const acts = useAsync(() => listActuals(branchId, range.from, range.to), [branchId, range.from, range.to])
  const pays = useAsync(() => listPayments(branchId, range.from, range.to), [branchId, range.from, range.to])
  const tx = useAsync(() => listTx(branchId, range.from, range.to), [branchId, range.from, range.to])
  const [editing, setEditing] = useState<Actual | 'new' | null>(null)
  const [importing, setImporting] = useState(false)
  const [limit, setLimit] = useState(150)
  const name = useMemo(() => new Map(branches.map((b) => [b.id, b.name])), [branches])
  const canEdit = can('finance.edit')

  const rows = useMemo(() => {
    return (acts.data ?? []).map((a) => {
      const pos = expectedPos(pays.data ?? [], tx.data ?? [], a.branch_id, a.source as Src, a.date_from, a.date_to)
      const diff = pos - a.amount
      return { a, pos, diff, short: diff > tolerance(pos) }
    }).sort((x, y) => (x.a.date_from < y.a.date_from ? 1 : -1))
  }, [acts.data, pays.data, tx.data])

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
          {can('finance.edit') && <button className="mem-btn" onClick={() => setImporting(true)}>Nhập từ file đối soát</button>}
          <button className="mem-btn mem-btn-primary" onClick={() => setEditing('new')} disabled={branches.length === 0}>Thêm số thực nhận</button>
        </div>
      </div>
      {loading ? <Loading /> : error ? <ErrorBox error={error} retry={() => { acts.reload(); pays.reload(); tx.reload() }} /> : rows.length === 0 ? (
        <Empty title="Chưa có số thực nhận nào trong khoảng ngày này" hint="Bấm “Thêm số thực nhận”, chọn nguồn, kỳ, nhập số trên app và đính ảnh chụp màn hình." />
      ) : (
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr>
              <th>Cửa hàng</th><th>Nguồn</th><th>Kỳ</th><th className="num">Phải về (POS)</th><th className="num">Cửa hàng khai</th>
              <th className="num">Thiếu / dư</th><th>Giải trình</th><th className="num">Truy thu</th><th />
            </tr></thead>
            <tbody>
              {rows.slice(0, limit).map(({ a, pos, diff, short }) => (
                <tr key={a.id}>
                  <td>{name.get(a.branch_id) ?? '—'}</td>
                  <td>{SRC_LABEL[a.source as Src] ?? a.source}</td>
                  <td>{a.date_from === a.date_to ? vnDate(a.date_from) : `${vnDate(a.date_from)} → ${vnDate(a.date_to)}`}</td>
                  <td className="num">{money(pos)}</td>
                  <td className="num">{money(a.amount)}</td>
                  <td className={`num ${short ? 'neg' : diff < -tolerance(pos) ? 'pos' : ''}`}>
                    <b>{short ? `Thiếu ${num(diff)}` : diff < -tolerance(pos) ? `Dư ${num(-diff)}` : 'Khớp'}</b>
                  </td>
                  <td style={{ maxWidth: 240 }}>
                    {short || a.explain ? (
                      <>
                        <span className={`mem-tag ${a.explain_status === 'approved' ? 'mem-tag-success' : a.explain_status === 'explained' ? 'mem-tag-neutral' : 'mem-tag-warning'}`}>{STATUS_LABEL[a.explain_status]}</span>
                        {a.explain && <div className="mem-caption">{a.explain}</div>}
                      </>
                    ) : <span className="mem-caption">—</span>}
                  </td>
                  <td className="num">
                    {a.recovery > 0 ? <>{money(a.recovery)}<div className="mem-caption">{a.recovery_status === 'collected' ? 'Đã thu' : 'Chưa thu'}</div></> : <span className="mem-caption">—</span>}
                  </td>
                  <td className="num">
                    {a.photo_path && <button className="mem-btn mem-btn-sm" onClick={() => void openPhoto(a.photo_path!)}>Ảnh</button>}{' '}
                    <button className="mem-btn mem-btn-sm" onClick={() => setEditing(a)}>Sửa</button>
                    {canEdit && a.explain_status === 'explained' && <> <button className="mem-btn mem-btn-sm" onClick={() => void approve(a)}>Duyệt</button></>}
                    {canEdit && <> <button className="mem-btn mem-btn-sm mem-btn-danger" onClick={() => void remove(a)}>Xóa</button></>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows.length > limit && <div className="spread mem-caption"><span>Hiển thị {limit} / {rows.length}</span><button className="mem-btn mem-btn-sm" onClick={() => setLimit(limit + 150)}>Xem thêm</button></div>}
      {importing && <SheetImport onClose={() => setImporting(false)} onDone={() => { acts.reload(); pays.reload(); tx.reload() }} />}
      {editing && <ActualForm actual={editing === 'new' ? null : editing} defaultBranch={branchId} range={range} onClose={() => setEditing(null)} onSaved={() => { acts.reload(); pays.reload(); tx.reload() }} />}
    </div>
  )
}

function ActualForm({ actual, defaultBranch, range, onClose, onSaved }: { actual: Actual | null; defaultBranch: string; range: Range; onClose: () => void; onSaved: () => void }) {
  const { branches, can } = useAuth()
  const toast = useToast()
  const canEdit = can('finance.edit')
  const [branch, setBranch] = useState(actual?.branch_id ?? (defaultBranch || branches[0]?.id || ''))
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
