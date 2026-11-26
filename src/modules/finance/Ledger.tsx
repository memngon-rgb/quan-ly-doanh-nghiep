import { useMemo, useState, type FormEvent } from 'react'
import { useAuth } from '../../core/auth'
import { compressImage } from '../../core/image'
import { exportXlsx } from '../../core/excel'
import { money, num, today, vnDate } from '../../core/format'
import { DateRangePicker, useDateRange } from '../../core/DateRange'
import { Empty, ErrorBox, Loading, Modal, MoneyInput, PageHead, errText, useAsync, useToast } from '../../core/ui'
import { IconDownload, IconPlus, IconUpload } from '../../core/icons'
import { addTx, deleteTx, listCategories, listTx, receiptUrl, updateTx, uploadReceipt } from './api'
import ImportPanel from './Import'
import { METHOD_LABEL, type Category, type Method, type Tx, type TxType } from './types'

const PAGE = 150

export default function Ledger() {
  const { branchId, branches, can } = useAuth()
  const toast = useToast()
  const [range, setRange] = useDateRange()
  const [type, setType] = useState<'' | TxType>('')
  const [catId, setCatId] = useState('')
  const [q, setQ] = useState('')
  const [limit, setLimit] = useState(PAGE)
  const [editing, setEditing] = useState<Tx | 'new' | null>(null)
  const [importing, setImporting] = useState(false)

  const cats = useAsync(listCategories, [])
  const tx = useAsync(() => listTx(branchId, range.from, range.to), [branchId, range.from, range.to])

  const catName = useMemo(() => new Map((cats.data ?? []).map((c) => [c.id, c.name])), [cats.data])
  const branchName = useMemo(() => new Map(branches.map((b) => [b.id, b.name])), [branches])

  const rows = useMemo(() => {
    const kw = q.trim().toLowerCase()
    return (tx.data ?? []).filter(
      (t) =>
        (!type || t.type === type) &&
        (!catId || t.category_id === catId) &&
        (!kw || t.note.toLowerCase().includes(kw) || (catName.get(t.category_id ?? '') ?? '').toLowerCase().includes(kw)),
    )
  }, [tx.data, type, catId, q, catName])

  const totals = useMemo(() => {
    let inc = 0
    let exp = 0
    rows.forEach((t) => (t.type === 'income' ? (inc += t.amount) : (exp += t.amount)))
    return { inc, exp }
  }, [rows])

  async function remove(t: Tx) {
    if (!confirm(`Xóa khoản ${t.type === 'income' ? 'thu' : 'chi'} ${money(t.amount)} ngày ${vnDate(t.tx_date)}?`)) return
    try {
      await deleteTx(t.id)
      toast('Đã xóa')
      tx.reload()
    } catch (e) {
      toast(errText(e), true)
    }
  }

  async function openReceipt(path: string) {
    try {
      window.open(await receiptUrl(path), '_blank', 'noopener')
    } catch (e) {
      toast(errText(e), true)
    }
  }

  async function exportFile() {
    await exportXlsx(
      `so-thu-chi-${range.from}_${range.to}`,
      ['Ngày', 'Chi nhánh', 'Loại', 'Danh mục', 'Hình thức', 'Số tiền', 'Ghi chú'],
      rows.map((t) => [
        vnDate(t.tx_date), branchName.get(t.branch_id) ?? '', t.type === 'income' ? 'Thu' : 'Chi',
        catName.get(t.category_id ?? '') ?? '', METHOD_LABEL[t.method], t.amount, t.note,
      ]),
    )
  }

  return (
    <div className="stack">
      <PageHead
        eyebrow="Tài chính"
        title="Sổ thu chi"
        sub="Ghi nhận dòng tiền hằng ngày: kế toán chi theo lệnh công ty, thu chi tiền mặt cửa hàng."
        right={
          <>
            <button className="mem-btn" onClick={() => void exportFile()} disabled={!rows.length}><IconDownload /> Xuất Excel</button>
            {can('finance.import') && <button className="mem-btn" onClick={() => setImporting(true)}><IconUpload /> Nhập file</button>}
            {can('finance.write') && <button className="mem-btn mem-btn-primary" onClick={() => setEditing('new')}><IconPlus /> Thêm khoản</button>}
          </>
        }
      />

      <div className="mem-card stack">
        <div className="row">
          <DateRangePicker value={range} onChange={setRange} />
          <select className="input" style={{ width: 'auto' }} value={type} onChange={(e) => setType(e.target.value as '' | TxType)} aria-label="Lọc loại">
            <option value="">Thu và chi</option><option value="income">Chỉ thu</option><option value="expense">Chỉ chi</option>
          </select>
          <select className="input" style={{ width: 'auto' }} value={catId} onChange={(e) => setCatId(e.target.value)} aria-label="Lọc danh mục">
            <option value="">Mọi danh mục</option>
            {(cats.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <input className="input" style={{ flex: 1, minWidth: 160 }} placeholder="Tìm theo ghi chú, danh mục..." value={q} onChange={(e) => setQ(e.target.value)} aria-label="Tìm kiếm" />
        </div>

        <div className="mem-grid-3">
          <div><div className="mem-caption">Tổng thu</div><div className="mem-kpi pos">{money(totals.inc)}</div></div>
          <div><div className="mem-caption">Tổng chi</div><div className="mem-kpi neg">{money(totals.exp)}</div></div>
          <div><div className="mem-caption">Chênh lệch</div><div className="mem-kpi">{money(totals.inc - totals.exp)}</div></div>
        </div>

        {tx.loading || cats.loading ? <Loading /> : tx.error || cats.error ? <ErrorBox error={tx.error ?? cats.error} retry={() => { tx.reload(); cats.reload() }} /> : rows.length === 0 ? (
          <Empty title="Chưa có khoản nào" hint="Bấm “Thêm khoản” để nhập thu chi, hoặc “Nhập file” để tải báo cáo thu chi từ iPOS (D03)." />
        ) : (
          <>
            <div className="table-wrap">
              <table className="tbl">
                <thead><tr><th>Ngày</th>{!branchId && <th>Chi nhánh</th>}<th>Danh mục</th><th>Ghi chú</th><th>Hình thức</th><th className="num">Số tiền</th><th /></tr></thead>
                <tbody>
                  {rows.slice(0, limit).map((t) => (
                    <tr key={t.id}>
                      <td>{vnDate(t.tx_date)}</td>
                      {!branchId && <td>{branchName.get(t.branch_id) ?? '—'}</td>}
                      <td>{catName.get(t.category_id ?? '') ?? '—'}</td>
                      <td>{t.note || <span className="mem-caption">—</span>}</td>
                      <td><span className="mem-tag mem-tag-neutral">{METHOD_LABEL[t.method]}</span></td>
                      <td className={`num ${t.type === 'income' ? 'pos' : 'neg'}`}>{t.type === 'income' ? '+' : '−'}{num(t.amount)}</td>
                      <td className="num">
                        {t.receipt_path && <button className="mem-btn mem-btn-sm" onClick={() => void openReceipt(t.receipt_path!)}>Ảnh</button>}{' '}
                        {can('finance.edit') && (
                          <>
                            <button className="mem-btn mem-btn-sm" onClick={() => setEditing(t)}>Sửa</button>{' '}
                            <button className="mem-btn mem-btn-sm mem-btn-danger" onClick={() => void remove(t)}>Xóa</button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="spread mem-caption">
              <span>Hiển thị {Math.min(limit, rows.length)} / {rows.length}</span>
              {limit < rows.length && <button className="mem-btn mem-btn-sm" onClick={() => setLimit(limit + PAGE)}>Xem thêm</button>}
            </div>
          </>
        )}
      </div>

      {importing && (
        <Modal title="Nhập file thu chi tiền mặt" onClose={() => setImporting(false)} wide>
          <ImportPanel mode="tx" onDone={() => tx.reload()} />
        </Modal>
      )}

      {editing && (
        <TxForm
          tx={editing === 'new' ? null : editing}
          cats={cats.data ?? []}
          onClose={() => setEditing(null)}
          onSaved={() => { tx.reload() }}
        />
      )}
    </div>
  )
}

function TxForm({ tx, cats, onClose, onSaved }: { tx: Tx | null; cats: Category[]; onClose: () => void; onSaved: () => void }) {
  const { branches, branchId } = useAuth()
  const toast = useToast()
  const [type, setType] = useState<TxType>(tx?.type ?? 'expense')
  const [date, setDate] = useState(tx?.tx_date ?? today())
  const [branch, setBranch] = useState(tx?.branch_id ?? (branchId || branches[0]?.id || ''))
  const [catId, setCatId] = useState(tx?.category_id ?? '')
  const [amount, setAmount] = useState(tx?.amount ?? 0)
  const [method, setMethod] = useState<Method>(tx?.method ?? 'cash')
  const [note, setNote] = useState(tx?.note ?? '')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const options = cats.filter((c) => c.type === type && (c.is_active || c.id === catId))

  async function submit(e: FormEvent, again = false) {
    e.preventDefault()
    if (!branch) return setErr('Chưa có chi nhánh. Hãy vào Quản trị → Người dùng để thêm chi nhánh trước.')
    if (!amount) return setErr('Hãy nhập số tiền.')
    setBusy(true)
    setErr('')
    try {
      let receipt = tx?.receipt_path ?? null
      if (file) receipt = await uploadReceipt(branch, await compressImage(file))
      const body = {
        branch_id: branch, tx_date: date, type, category_id: catId || null, amount, method, note: note.trim(),
        receipt_path: receipt, source: tx?.source ?? ('manual' as const), external_key: tx?.external_key ?? null,
      }
      if (tx) await updateTx(tx.id, body)
      else await addTx(body)
      toast(tx ? 'Đã lưu thay đổi' : 'Đã thêm khoản')
      onSaved()
      if (again && !tx) {
        setAmount(0); setNote(''); setFile(null)
      } else onClose()
    } catch (e2) {
      setErr(errText(e2))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={tx ? 'Sửa khoản thu chi' : 'Thêm khoản thu chi'} onClose={onClose}>
      <form className="stack" onSubmit={(e) => void submit(e)}>
        {branches.length === 0 && <div className="alert warn"><div><span className="t">Chưa có chi nhánh nào.</span> Hãy đóng cửa sổ này, vào <a href="#/admin/users">Quản trị → Người dùng</a> để thêm chi nhánh (tên cửa hàng) trước.</div></div>}
        <div className="seg" role="group" aria-label="Loại khoản">
          <button type="button" className={type === 'expense' ? 'on exp' : ''} onClick={() => { setType('expense'); setCatId('') }}>Chi</button>
          <button type="button" className={type === 'income' ? 'on' : ''} onClick={() => { setType('income'); setCatId('') }}>Thu</button>
        </div>
        <div className="form-grid">
          <div className="field"><label htmlFor="f-date">Ngày</label><input id="f-date" className="input" type="date" required value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <div className="field"><label htmlFor="f-amt">Số tiền (đ)</label><MoneyInput id="f-amt" value={amount} onChange={setAmount} /></div>
          {branches.length > 1 && (
            <div className="field"><label htmlFor="f-br">Chi nhánh</label>
              <select id="f-br" className="input" value={branch} onChange={(e) => setBranch(e.target.value)}>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></div>
          )}
          <div className="field"><label htmlFor="f-cat">Danh mục</label>
            <select id="f-cat" className="input" value={catId} onChange={(e) => setCatId(e.target.value)}>
              <option value="">— Chưa phân loại —</option>{options.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          <div className="field"><label htmlFor="f-m">Hình thức</label>
            <select id="f-m" className="input" value={method} onChange={(e) => setMethod(e.target.value as Method)}>
              {(Object.keys(METHOD_LABEL) as Method[]).map((m) => <option key={m} value={m}>{METHOD_LABEL[m]}</option>)}</select></div>
        </div>
        <div className="field"><label htmlFor="f-note">Ghi chú</label><textarea id="f-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ví dụ: Lệnh chi số 125, trả tiền điện tháng 10" /></div>
        <div className="field"><label htmlFor="f-file">Ảnh chứng từ (không bắt buộc)</label>
          <input id="f-file" className="input" type="file" accept="image/*" capture="environment" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          {tx?.receipt_path && !file && <span className="mem-caption">Khoản này đã có ảnh chứng từ.</span>}</div>
        {err && <div className="alert bad" role="alert">{err}</div>}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="mem-btn" onClick={onClose}>Hủy</button>
          {!tx && <button type="button" className="mem-btn" disabled={busy || branches.length === 0} onClick={(e) => void submit(e as unknown as FormEvent, true)}>Lưu và nhập tiếp</button>}
          <button className="mem-btn mem-btn-primary" disabled={busy || branches.length === 0}>{busy ? 'Đang lưu...' : 'Lưu'}</button>
        </div>
      </form>
    </Modal>
  )
}
