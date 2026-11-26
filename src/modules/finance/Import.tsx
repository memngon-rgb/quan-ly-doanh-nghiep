import { useMemo, useState } from 'react'
import { useAuth } from '../../core/auth'
import { readTable, type Cell } from '../../core/excel'
import { iso, money, pad, vnDate } from '../../core/format'
import { Empty, PageHead, errText, useAsync, useToast } from '../../core/ui'
import { importTx, listCategories, upsertSales } from './api'
import type { Category, NewTx, Sale, TxType } from './types'

type Kind = 'tx' | 'sales'
type TypeMode = 'expense' | 'income' | 'column' | 'sign'

const norm = (s: unknown) =>
  String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/\s+/g, ' ').trim()

export function parseDate(c: Cell): string | null {
  if (c instanceof Date) {
    const utc = c.getUTCHours() === 0 && c.getUTCMinutes() === 0
    return utc ? `${c.getUTCFullYear()}-${pad(c.getUTCMonth() + 1)}-${pad(c.getUTCDate())}` : iso(c)
  }
  const s = String(c ?? '').trim()
  let m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})/)
  if (m) return valid(+m[3], +m[2], +m[1])
  m = s.match(/^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})/)
  if (m) return valid(+m[1], +m[2], +m[3])
  return null
}
function valid(y: number, mo: number, d: number): string | null {
  const dt = new Date(y, mo - 1, d)
  return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d ? `${y}-${pad(mo)}-${pad(d)}` : null
}

export function parseMoney(c: Cell): number | null {
  if (typeof c === 'number') return Number.isFinite(c) ? Math.round(c) : null
  const s = String(c ?? '').trim()
  if (!s) return null
  const neg = s.startsWith('-') || s.startsWith('(')
  const noDec = s.replace(/[,.]\d{1,2}$/, '') // bỏ phần thập phân kiểu 1.234,50
  const digits = noDec.replace(/\D/g, '')
  if (!digits) return null
  return neg ? -Number(digits) : Number(digits)
}

/** Đoán cột theo tên tiêu đề */
function guess(headers: string[], words: string[]): number {
  const i = headers.findIndex((h) => words.some((w) => norm(h).includes(w)))
  return i
}

export default function Import() {
  const { branches, branchId, can } = useAuth()
  const toast = useToast()
  const cats = useAsync(listCategories, [])
  const [kind, setKind] = useState<Kind>('tx')
  const [branch, setBranch] = useState(branchId || branches[0]?.id || '')
  const [table, setTable] = useState<Cell[][] | null>(null)
  const [fileName, setFileName] = useState('')
  const [hasHeader, setHasHeader] = useState(true)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState('')
  const [col, setCol] = useState({ date: -1, amount: -1, type: -1, cat: -1, note: -1, orders: -1 })
  const [typeMode, setTypeMode] = useState<TypeMode>('expense')
  const [defCat, setDefCat] = useState('')

  const headers = useMemo(() => (table && hasHeader ? (table[0] ?? []).map((c) => String(c ?? '')) : (table?.[0] ?? []).map((_, i) => `Cột ${i + 1}`)), [table, hasHeader])
  const body = useMemo(() => (table ? table.slice(hasHeader ? 1 : 0) : []), [table, hasHeader])

  async function pickFile(f: File | undefined) {
    if (!f) return
    setResult('')
    try {
      const t = await readTable(f)
      if (!t.length) throw new Error('File không có dữ liệu.')
      setTable(t)
      setFileName(f.name)
      const h = t[0].map((c) => String(c ?? ''))
      setCol({
        date: guess(h, ['ngay', 'date']),
        amount: guess(h, kind === 'sales' ? ['doanh thu', 'thanh tien', 'tong tien', 'revenue'] : ['so tien', 'thanh tien', 'tong tien', 'amount']),
        type: guess(h, ['loai', 'thu/chi', 'thu chi']),
        cat: guess(h, ['danh muc', 'khoan muc', 'nhom']),
        note: guess(h, ['ghi chu', 'noi dung', 'dien giai', 'mo ta', 'note']),
        orders: guess(h, ['so hoa don', 'so don', 'orders']),
      })
    } catch (e) {
      setTable(null)
      toast(errText(e), true)
    }
  }

  const catByName = useMemo(() => new Map((cats.data ?? []).map((c: Category) => [`${c.type}|${norm(c.name)}`, c.id])), [cats.data])

  const parsed = useMemo(() => {
    if (!table || col.date < 0 || col.amount < 0) return { tx: [] as NewTx[], sales: [] as Sale[], skipped: body.length }
    const tx: NewTx[] = []
    const salesMap = new Map<string, Sale>()
    let skipped = 0
    const seen = new Map<string, number>()
    for (const row of body) {
      const date = parseDate(row[col.date])
      const raw = parseMoney(row[col.amount])
      if (!date || raw === null || raw === 0) { skipped++; continue }
      if (kind === 'sales') {
        const cur = salesMap.get(date) ?? { branch_id: branch, sale_date: date, revenue: 0, orders: 0 }
        cur.revenue += Math.abs(raw)
        if (col.orders >= 0) cur.orders += parseMoney(row[col.orders]) ?? 0
        salesMap.set(date, cur)
        continue
      }
      let type: TxType = 'expense'
      if (typeMode === 'income') type = 'income'
      else if (typeMode === 'sign') type = raw >= 0 ? 'income' : 'expense'
      else if (typeMode === 'column') {
        const t = norm(row[col.type])
        if (!t) { skipped++; continue }
        type = t.startsWith('thu') ? 'income' : 'expense'
      }
      const amount = Math.abs(raw)
      const note = col.note >= 0 ? String(row[col.note] ?? '').trim() : ''
      const catName = col.cat >= 0 ? norm(row[col.cat]) : ''
      const category_id = (catName && catByName.get(`${type}|${catName}`)) || defCat || null
      const base = `${date}|${type}|${amount}|${norm(note)}`
      const n = (seen.get(base) ?? 0) + 1
      seen.set(base, n)
      tx.push({
        branch_id: branch, tx_date: date, type, category_id, amount, method: 'cash', note, receipt_path: null,
        source: 'import', external_key: `${base}|${n}`,
      })
    }
    return { tx, sales: [...salesMap.values()], skipped }
  }, [table, body, col, kind, typeMode, defCat, branch, catByName])

  const count = kind === 'tx' ? parsed.tx.length : parsed.sales.length

  async function run() {
    if (!branch) return toast('Hãy chọn chi nhánh', true)
    if (!count) return toast('Không có dòng hợp lệ để nhập', true)
    if (!confirm(`Nhập ${count} ${kind === 'tx' ? 'khoản thu chi' : 'ngày doanh thu'} vào chi nhánh đã chọn?`)) return
    setBusy(true)
    try {
      if (kind === 'tx') {
        const added = await importTx(parsed.tx)
        setResult(`Đã thêm ${added} khoản mới. ${parsed.tx.length - added} khoản bị bỏ qua vì đã nhập trước đó. ${parsed.skipped} dòng không hợp lệ.`)
      } else {
        await upsertSales(parsed.sales)
        setResult(`Đã cập nhật doanh thu ${parsed.sales.length} ngày. ${parsed.skipped} dòng không hợp lệ.`)
      }
      toast('Nhập file xong')
    } catch (e) {
      toast(errText(e), true)
    } finally {
      setBusy(false)
    }
  }

  const colSelect = (key: keyof typeof col, label: string, req = false) => (
    <div className="field">
      <label htmlFor={`c-${key}`}>{label}{req && ' *'}</label>
      <select id={`c-${key}`} className="input" value={col[key]} onChange={(e) => setCol({ ...col, [key]: Number(e.target.value) })}>
        <option value={-1}>— Không dùng —</option>
        {headers.map((h, i) => <option key={i} value={i}>{h || `Cột ${i + 1}`}</option>)}
      </select>
    </div>
  )

  if (!can('finance.import')) return <Empty title="Bạn chưa có quyền nhập file" />

  return (
    <div className="stack">
      <PageHead eyebrow="Tài chính" title="Nhập file Excel" sub="Tải báo cáo thu chi tiền mặt của cửa hàng hoặc báo cáo doanh thu ngày từ iPOS. Nhập lại cùng file sẽ không bị trùng." />

      <div className="mem-card stack">
        <div className="row">
          <div className="seg" role="group" aria-label="Loại file">
            <button className={kind === 'tx' ? 'on' : ''} onClick={() => { setKind('tx'); setTable(null) }}>Thu chi tiền mặt</button>
            <button className={kind === 'sales' ? 'on' : ''} onClick={() => { setKind('sales'); setTable(null) }}>Doanh thu ngày (iPOS)</button>
          </div>
          <select className="input" style={{ width: 'auto' }} value={branch} onChange={(e) => setBranch(e.target.value)} aria-label="Chi nhánh nhập">
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="imp-file">Chọn file (.xlsx hoặc .csv)</label>
          <input id="imp-file" className="input" type="file" accept=".xlsx,.csv,.txt" onChange={(e) => void pickFile(e.target.files?.[0])} />
        </div>
      </div>

      {table && (
        <div className="mem-card stack">
          <div className="spread">
            <div><div className="section-title">Ghép cột</div><div className="mem-caption">{fileName} · {body.length} dòng dữ liệu</div></div>
            <label className="row" style={{ cursor: 'pointer' }}><input type="checkbox" checked={hasHeader} onChange={(e) => setHasHeader(e.target.checked)} /> Dòng đầu là tiêu đề</label>
          </div>
          <div className="form-grid">
            {colSelect('date', 'Cột Ngày', true)}
            {colSelect('amount', kind === 'sales' ? 'Cột Doanh thu' : 'Cột Số tiền', true)}
            {kind === 'sales' ? colSelect('orders', 'Cột Số hóa đơn (nếu có)') : (
              <>
                {colSelect('note', 'Cột Ghi chú / nội dung')}
                {colSelect('cat', 'Cột Danh mục (nếu có)')}
                <div className="field"><label htmlFor="tm">Cách xác định Thu hay Chi</label>
                  <select id="tm" className="input" value={typeMode} onChange={(e) => setTypeMode(e.target.value as TypeMode)}>
                    <option value="expense">Tất cả là khoản Chi</option><option value="income">Tất cả là khoản Thu</option>
                    <option value="sign">Số dương là Thu, số âm là Chi</option><option value="column">Theo cột “Loại” (chữ Thu / Chi)</option>
                  </select></div>
                {typeMode === 'column' && colSelect('type', 'Cột Loại (Thu/Chi)', true)}
                <div className="field"><label htmlFor="dc">Danh mục mặc định (khi không khớp)</label>
                  <select id="dc" className="input" value={defCat} onChange={(e) => setDefCat(e.target.value)}>
                    <option value="">— Chưa phân loại —</option>
                    {(cats.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name} ({c.type === 'income' ? 'thu' : 'chi'})</option>)}
                  </select></div>
              </>
            )}
          </div>

          {col.date < 0 || col.amount < 0 ? (
            <div className="alert warn">Hãy chọn cột Ngày và cột Số tiền để xem trước.</div>
          ) : (
            <>
              <div className="alert good"><div><span className="t">{count} dòng hợp lệ</span>{parsed.skipped > 0 && ` · ${parsed.skipped} dòng sẽ bị bỏ qua (thiếu ngày hoặc số tiền)`}</div></div>
              <div className="table-wrap">
                <table className="tbl">
                  <thead><tr><th>Ngày</th>{kind === 'tx' && <th>Loại</th>}<th className="num">{kind === 'tx' ? 'Số tiền' : 'Doanh thu'}</th>{kind === 'tx' && <th>Ghi chú</th>}</tr></thead>
                  <tbody>
                    {(kind === 'tx' ? parsed.tx.slice(0, 8) : parsed.sales.slice(0, 8)).map((r, i) => (
                      <tr key={i}>
                        <td>{vnDate('tx_date' in r ? r.tx_date : r.sale_date)}</td>
                        {'type' in r && <td>{r.type === 'income' ? 'Thu' : 'Chi'}</td>}
                        <td className="num">{money('amount' in r ? r.amount : r.revenue)}</td>
                        {'note' in r && <td>{r.note}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mem-caption">Xem trước tối đa 8 dòng đầu.{kind === 'sales' && ' Nếu một ngày có nhiều dòng (từng hóa đơn), hệ thống tự cộng gộp theo ngày.'}</div>
              <div className="row" style={{ justifyContent: 'flex-end' }}>
                <button className="mem-btn mem-btn-primary" disabled={busy || !count} onClick={() => void run()}>{busy ? 'Đang nhập...' : `Nhập ${count} dòng`}</button>
              </div>
            </>
          )}
          {result && <div className="alert good" role="status">{result}</div>}
        </div>
      )}
    </div>
  )
}
