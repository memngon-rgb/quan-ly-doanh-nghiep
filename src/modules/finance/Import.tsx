import { useMemo, useState } from 'react'
import { useAuth } from '../../core/auth'
import { readSheets, readTable, type Cell } from '../../core/excel'
import { iso, money, pad, vnDate } from '../../core/format'
import { Empty, errText, useAsync, useToast } from '../../core/ui'
import { deleteImportedTx, importTx, listCategories, upsertChannels, upsertPayments, upsertSales } from './api'
import { matchBranch, parseA02, parseB03, parsePttt, type ChanStore, type IposStore, type PttStore } from './ipos'
import { METHOD_LABEL, type Category, type Channel, type Method, type NewTx, type Payment, type Sale, type TxType } from './types'

type Kind = 'tx' | 'sales' | 'b03' | 'pttt' | 'chan'
type TypeMode = 'expense' | 'income' | 'column' | 'sign' | 'split'

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

const filled = (r: Cell[]) => r.filter((c) => c !== null && String(c).trim() !== '').length

/** Tìm dòng tiêu đề: dòng có cả chữ "ngày/thời gian" lẫn chữ về số tiền (số tiền, ghi nợ, ghi có...). Sao kê ngân hàng thường có nhiều dòng thông tin tài khoản phía trên. */
function guessHeaderRow(raw: Cell[][]): number {
  for (let i = 0; i < Math.min(raw.length, 60); i++) {
    const h = raw[i].map(norm)
    const hasDate = h.some((x) => x.includes('ngay') || x.includes('thoi gian') || x === 'date')
    const hasAmt = h.some((x) => /so tien|ghi no|ghi co|debit|credit|phat sinh|amount|doanh thu|thanh tien/.test(x))
    if (hasDate && hasAmt) return i
  }
  const k = raw.findIndex((r) => filled(r) >= 3)
  return k > 0 ? k : 0
}

/**
 * Khối nhập file dùng lại ở nhiều trang (mỗi mục tự có nút "Nhập file" riêng).
 * mode 'tx' = thu chi tiền mặt (iPOS D03) · mode 'revenue' = doanh thu (iPOS A02 hoặc file khác).
 */
export default function ImportPanel({ mode, onDone }: { mode: 'tx' | 'revenue'; onDone?: () => void }) {
  const { branches, branchId, can } = useAuth()
  const toast = useToast()
  const cats = useAsync(listCategories, [])
  const [kind, setKind] = useState<Kind>(mode === 'tx' ? 'tx' : 'b03')
  // Không tự chọn sẵn chi nhánh khi có nhiều chi nhánh: người nhập phải chọn đúng (hoặc file có cột cửa hàng)
  const [branch, setBranch] = useState(branchId || (branches.length === 1 ? branches[0].id : ''))
  const [raw, setRaw] = useState<Cell[][] | null>(null)
  const [hdr, setHdr] = useState(0)
  const [txMethod, setTxMethod] = useState<Method>('cash')
  const [rowBranch, setRowBranch] = useState<Record<string, string>>({})
  const [table, setTable] = useState<Cell[][] | null>(null)
  const [fileName, setFileName] = useState('')
  const [hasHeader, setHasHeader] = useState(true)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState('')
  const [col, setCol] = useState({ date: -1, amount: -1, type: -1, cat: -1, note: -1, orders: -1, debit: -1, credit: -1, store: -1, acct: -1, acctName: -1 })
  const [typeMode, setTypeMode] = useState<TypeMode>('expense')
  const [defCat, setDefCat] = useState('')
  const [stores, setStores] = useState<IposStore[] | null>(null)
  const [storeBranch, setStoreBranch] = useState<Record<string, string>>({})
  const [overwrite, setOverwrite] = useState(true)
  const [pStores, setPStores] = useState<PttStore[] | null>(null)
  const [cStores, setCStores] = useState<ChanStore[] | null>(null)

  const headers = useMemo(() => (table && hasHeader ? (table[0] ?? []).map((c) => String(c ?? '')) : (table?.[0] ?? []).map((_, i) => `Cột ${i + 1}`)), [table, hasHeader])
  const body = useMemo(() => (table ? table.slice(hasHeader ? 1 : 0) : []), [table, hasHeader])

  async function pickFile(f: File | undefined) {
    if (!f) return
    setResult('')
    if (kind === 'chan') {
      try {
        const st = parseB03(await readSheets(f))
        if (!st.length) throw new Error('Không nhận ra file. Hãy chọn báo cáo B03 - Nguồn đơn hàng xuất từ iPOS, có mỗi cửa hàng một sheet.')
        setCStores(st)
        setFileName(f.name)
        setStoreBranch(Object.fromEntries(st.map((x) => [x.sheet, matchBranch(x.storeName, branches)])))
      } catch (e) {
        setCStores(null)
        toast(errText(e), true)
      }
      return
    }
    if (kind === 'pttt') {
      try {
        const st = parsePttt(await readSheets(f))
        if (!st.length) throw new Error('Không nhận ra file. Hãy chọn báo cáo PTTT (phương thức thanh toán) xuất từ iPOS, có mỗi cửa hàng một sheet.')
        setPStores(st)
        setFileName(f.name)
        setStoreBranch(Object.fromEntries(st.map((x) => [x.sheet, matchBranch(x.storeName, branches)])))
      } catch (e) {
        setPStores(null)
        toast(errText(e), true)
      }
      return
    }
    if (kind === 'b03') {
      try {
        const st = parseA02(await readTable(f))
        if (!st.length) throw new Error('Không nhận ra file. Hãy chọn báo cáo A02 - Doanh thu theo cửa hàng (xuất theo ngày) từ iPOS.')
        setStores(st)
        setFileName(f.name)
        setStoreBranch(Object.fromEntries(st.map((x) => [x.sheet, matchBranch(x.storeName, branches)])))
      } catch (e) {
        setStores(null)
        toast(errText(e), true)
      }
      return
    }
    try {
      let t: Cell[][]
      let detected = ''
      if (f.name.toLowerCase().endsWith('.xlsx')) {
        const sheets = await readSheets(f)
        const title = (r: Cell[][]) => String(r[0]?.[0] ?? '').match(/tại\s+(.+)$/i)?.[1]?.trim() ?? ''
        const stores = sheets.filter((sh) => title(sh.rows) && !norm(title(sh.rows)).startsWith('tat ca'))
        if (kind === 'tx' && stores.length >= 2) {
          // Một file nhiều cửa hàng (mỗi cửa hàng một sheet): gộp lại, thêm cột "Cửa hàng"
          const merged: Cell[][] = []
          stores.forEach((sh, si) => {
            const h = guessHeaderRow(sh.rows)
            if (si === 0) merged.push(['Cửa hàng', ...sh.rows[h]])
            for (const r of sh.rows.slice(h + 1)) merged.push([title(sh.rows), ...r])
          })
          t = merged
        } else {
          t = sheets[0]?.rows ?? []
          detected = sheets.length === 1 ? title(sheets[0].rows) : ''
        }
      } else {
        t = await readTable(f)
      }
      if (!t.length) throw new Error('File không có dữ liệu.')
      setFileName(f.name)
      setRaw(t)
      applyHeader(t, guessHeaderRow(t))
      const m = detected ? matchBranch(detected, branches) : ''
      if (m) setBranch(m)
    } catch (e) {
      setTable(null)
      setRaw(null)
      toast(errText(e), true)
    }
  }

  /** Chọn dòng tiêu đề và đoán lại các cột theo tên tiêu đề */
  function applyHeader(all: Cell[][], idx: number) {
    const t = all.slice(idx)
    setHdr(idx)
    setTable(t)
    const h = (t[0] ?? []).map((c) => String(c ?? ''))
    const debit = guess(h, ['ghi no', 'debit', 'tien ra', 'rut ra'])
    const credit = guess(h, ['ghi co', 'credit', 'tien vao', 'nop vao'])
    setCol({
      date: guess(h, ['ngay', 'thoi gian', 'date']),
      amount: guess(h, kind === 'sales' ? ['doanh thu', 'thanh tien', 'tong tien', 'revenue'] : ['so tien', 'thanh tien', 'tong tien', 'amount']),
      type: guess(h, ['loai', 'thu/chi', 'thu chi']),
      cat: guess(h, ['danh muc', 'khoan muc', 'nghiep vu', 'nhom']),
      note: guess(h, ['ghi chu', 'noi dung', 'dien giai', 'mo ta', 'note']),
      orders: guess(h, ['so hoa don', 'so don', 'orders']),
      debit, credit,
      store: guess(h, ['cua hang', 'chi nhanh', 'store']),
      acct: guess(h, ['so tai khoan doi ung', 'corresponsive account']),
      acctName: guess(h, ['ten tai khoan doi ung', 'corresponsive name']),
    })
    if (kind === 'tx') {
      if (debit >= 0 && credit >= 0) { setTypeMode('split'); setTxMethod('transfer') }
      else if (guess(h, ['loai', 'thu/chi', 'thu chi']) >= 0) { setTypeMode('column'); setTxMethod('cash') }
    }
  }

  const branchFor = (v: string) => rowBranch[v] ?? matchBranch(v, branches)
  const storeValues = useMemo(() => (col.store >= 0 ? [...new Set(body.map((r) => String(r[col.store] ?? '').trim()).filter(Boolean))] : []), [body, col.store])

  const catByName = useMemo(() => new Map((cats.data ?? []).map((c: Category) => [`${c.type}|${norm(c.name)}`, c.id])), [cats.data])

  const parsed = useMemo(() => {
    const split = kind === 'tx' && typeMode === 'split'
    if (!table || col.date < 0 || (split ? col.debit < 0 && col.credit < 0 : col.amount < 0)) return { tx: [] as NewTx[], sales: [] as Sale[], skipped: body.length, noBranch: 0 }
    const tx: NewTx[] = []
    const salesMap = new Map<string, Sale>()
    let skipped = 0
    let noBranch = 0
    const seen = new Map<string, number>()
    for (const row of body) {
      const date = parseDate(row[col.date])
      let forced: TxType | null = null
      let raw: number | null
      if (split) {
        const dv = col.debit >= 0 ? parseMoney(row[col.debit]) ?? 0 : 0
        const cv = col.credit >= 0 ? parseMoney(row[col.credit]) ?? 0 : 0
        if (cv > 0) { raw = cv; forced = 'income' } else if (dv > 0) { raw = dv; forced = 'expense' } else raw = null
      } else raw = parseMoney(row[col.amount])
      if (!date || raw === null || raw === 0) { skipped++; continue }
      const rowBr = col.store >= 0 ? branchFor(String(row[col.store] ?? '').trim()) : branch
      if (!rowBr) { noBranch++; continue }
      if (kind === 'sales') {
        const cur = salesMap.get(date) ?? { branch_id: rowBr, sale_date: date, revenue: 0, orders: 0 }
        cur.revenue += Math.abs(raw)
        if (col.orders >= 0) cur.orders += parseMoney(row[col.orders]) ?? 0
        salesMap.set(date, cur)
        continue
      }
      let type: TxType = forced ?? 'expense'
      if (forced) { /* đã xác định theo cột Ghi nợ / Ghi có */ }
      else if (typeMode === 'income') type = 'income'
      else if (typeMode === 'sign') type = raw >= 0 ? 'income' : 'expense'
      else if (typeMode === 'column') {
        const t = norm(row[col.type])
        if (!t) { skipped++; continue }
        type = t.startsWith('thu') ? 'income' : 'expense'
      }
      const amount = Math.abs(raw)
      const note = col.note >= 0 ? String(row[col.note] ?? '').trim() : ''
      const catName = col.cat >= 0 ? norm(row[col.cat]) : ''
      const category_id = (catName && (catByName.get(`${type}|${catName}`) ?? catByName.get(`${type}|${catName.replace(/^chi phi /, 'chi ')}`))) || defCat || null
      const base = `${date}|${type}|${amount}|${norm(note)}`
      const n = (seen.get(`${rowBr}|${base}`) ?? 0) + 1
      seen.set(`${rowBr}|${base}`, n)
      const acct = col.acct >= 0 ? String(row[col.acct] ?? '').trim() : ''
      const acctName = col.acctName >= 0 ? String(row[col.acctName] ?? '').trim() : ''
      tx.push({
        branch_id: rowBr, tx_date: date, type, category_id, amount, method: txMethod, note, receipt_path: null,
        source: 'import', external_key: `${base}|${n}`,
        // Chỉ gửi khi file có cột này (cần chạy SQL 0010 trước)
        ...(acct ? { counterparty_account: acct, counterparty_name: acctName } : {}),
      })
    }
    return { tx, sales: [...salesMap.values()], skipped, noBranch }
  }, [table, body, col, kind, typeMode, defCat, branch, catByName, txMethod, rowBranch, branches])

  const count = kind === 'tx' ? parsed.tx.length : parsed.sales.length

  const b03 = useMemo(() => {
    const sales: Sale[] = []
    for (const st of stores ?? []) {
      const br = storeBranch[st.sheet]
      if (!br) continue
      for (const d of st.days) {
        sales.push({
          branch_id: br, sale_date: d.date, revenue: d.revenue, vat: d.vat, orders: d.orders, guests: d.guests, gross: d.gross,
          discount: d.discount, merchant_discount: d.merchantDiscount, marketing_fee: d.marketingFee, voucher: d.voucher,
          withholding_tax: d.withholdingTax, vat_discount: d.vatDiscount, commission: d.commission,
        })
      }
    }
    return { sales }
  }, [stores, storeBranch])

  const pttt = useMemo(() => {
    const rows: Payment[] = []
    for (const st of pStores ?? []) {
      const br = storeBranch[st.sheet]
      if (!br) continue
      for (const r of st.rows) rows.push({ branch_id: br, pay_date: r.date, method: r.method, orders: r.orders, amount: r.amount })
    }
    return rows
  }, [pStores, storeBranch])

  const chan = useMemo(() => {
    const rows: Channel[] = []
    for (const st of cStores ?? []) {
      const br = storeBranch[st.sheet]
      if (!br) continue
      for (const r of st.rows) {
        rows.push({
          branch_id: br, sale_date: r.date, channel: r.channel, orders: r.orders, guests: r.guests, commission: r.commission,
          discount: r.discount, withholding_tax: r.withholdingTax, net: r.net, gross: r.gross,
        })
      }
    }
    return rows
  }, [cStores, storeBranch])

  async function runChan() {
    if (!chan.length) return toast('Hãy chọn chi nhánh cho ít nhất một cửa hàng', true)
    if (!confirm(`Nhập ${chan.length} dòng doanh thu theo nguồn đơn?`)) return
    setBusy(true)
    try {
      await upsertChannels(chan)
      onDone?.()
      setResult(`Đã cập nhật ${chan.length} dòng theo nguồn đơn. Ngày đã có của cùng chi nhánh và cùng nguồn được ghi đè.`)
      toast('Nhập file xong')
    } catch (e) {
      toast(errText(e), true)
    } finally {
      setBusy(false)
    }
  }

  async function runPttt() {
    if (!pttt.length) return toast('Hãy chọn chi nhánh cho ít nhất một cửa hàng', true)
    if (!confirm(`Nhập ${pttt.length} dòng doanh thu theo phương thức thanh toán?`)) return
    setBusy(true)
    try {
      await upsertPayments(pttt)
      onDone?.()
      setResult(`Đã cập nhật ${pttt.length} dòng phương thức thanh toán. Nhập lại cùng file sẽ ghi đè, không bị nhân đôi.`)
      toast('Nhập file xong')
    } catch (e) {
      toast(errText(e), true)
    } finally {
      setBusy(false)
    }
  }

  async function runB03() {
    if (!b03.sales.length) return toast('Hãy chọn chi nhánh cho ít nhất một cửa hàng', true)
    if (!confirm(`Nhập doanh thu ${b03.sales.length} ngày?`)) return
    setBusy(true)
    try {
      await upsertSales(b03.sales)
      onDone?.()
      setResult(`Đã cập nhật doanh thu ${b03.sales.length} ngày (Net như trên iPOS, VAT đầu ra lưu riêng). Ngày đã có của cùng chi nhánh được ghi đè.`)
      toast('Nhập file xong')
    } catch (e) {
      toast(errText(e), true)
    } finally {
      setBusy(false)
    }
  }

  async function run() {
    if (kind !== 'tx' || col.store < 0) { if (!branch) return toast('Hãy chọn chi nhánh', true) }
    if (!count) return toast('Không có dòng hợp lệ để nhập', true)
    const byBranch = new Map<string, string[]>()
    parsed.tx.forEach((t) => byBranch.set(t.branch_id, [...(byBranch.get(t.branch_id) ?? []), t.tx_date]))
    const dates = parsed.tx.map((t) => t.tx_date).sort()
    const span = dates.length ? `${vnDate(dates[0])} – ${vnDate(dates[dates.length - 1])}` : ''
    const msg = kind === 'tx' && overwrite
      ? `Ghi đè: xóa các khoản ${METHOD_LABEL[txMethod].toLowerCase()} đã nhập từ file trước trong ${span} (khoản nhập tay không bị đụng), rồi nhập ${count} khoản từ file này?`
      : `Nhập ${count} ${kind === 'tx' ? 'khoản thu chi' : 'ngày doanh thu'}?`
    if (!confirm(msg)) return
    setBusy(true)
    try {
      if (kind === 'tx') {
        let removed = 0
        if (overwrite) {
          for (const [br, ds] of byBranch) {
            const s2 = [...ds].sort()
            removed += await deleteImportedTx(br, s2[0], s2[s2.length - 1], txMethod)
          }
        }
        const added = await importTx(parsed.tx)
        onDone?.()
        setResult(overwrite
          ? `Đã ghi đè: xóa ${removed} khoản cũ từ file và nhập ${added} khoản từ file mới. ${parsed.skipped} dòng không hợp lệ${parsed.noBranch ? `, ${parsed.noBranch} dòng chưa chọn chi nhánh nên bị bỏ qua` : ''}.`
          : `Đã thêm ${added} khoản mới. ${parsed.tx.length - added} khoản bị bỏ qua vì đã nhập trước đó. ${parsed.skipped} dòng không hợp lệ${parsed.noBranch ? `, ${parsed.noBranch} dòng chưa chọn chi nhánh` : ''}.`)
      } else {
        await upsertSales(parsed.sales)
        onDone?.()
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

      <div className="mem-card stack">
        <div className="row">
          {mode === 'revenue' && (
            <div className="seg" role="group" aria-label="Loại file doanh thu">
              <button className={kind === 'b03' ? 'on' : ''} onClick={() => { setKind('b03'); setTable(null); setStores(null); setPStores(null); setResult('') }}>iPOS A02 (nhiều cửa hàng)</button>
              <button className={kind === 'chan' ? 'on' : ''} onClick={() => { setKind('chan'); setTable(null); setStores(null); setPStores(null); setCStores(null); setResult('') }}>iPOS B03 (theo nguồn đơn)</button>
              <button className={kind === 'pttt' ? 'on' : ''} onClick={() => { setKind('pttt'); setTable(null); setStores(null); setPStores(null); setCStores(null); setResult('') }}>iPOS PTTT (thanh toán)</button>
              <button className={kind === 'sales' ? 'on' : ''} onClick={() => { setKind('sales'); setTable(null); setStores(null); setPStores(null) }}>File doanh thu khác</button>
            </div>
          )}
          {kind !== 'b03' && kind !== 'pttt' && kind !== 'chan' && col.store < 0 && (
            <select className="input" style={{ width: 'auto' }} value={branch} onChange={(e) => setBranch(e.target.value)} aria-label="Chi nhánh nhập">
              <option value="">— Chọn chi nhánh —</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}
        </div>
        <div className="field">
          <label htmlFor="imp-file">{kind === 'tx' ? 'Chọn báo cáo thu chi (iPOS D03, .xlsx hoặc .csv)' : kind === 'chan' ? 'Chọn báo cáo nguồn đơn hàng (iPOS B03, .xlsx)' : kind === 'pttt' ? 'Chọn báo cáo phương thức thanh toán (iPOS PTTT, .xlsx)' : kind === 'b03' ? 'Chọn báo cáo doanh thu theo cửa hàng (iPOS A02, .xlsx)' : 'Chọn file (.xlsx hoặc .csv)'}</label>
          <input id="imp-file" className="input" type="file" accept=".xlsx,.csv,.txt" onChange={(e) => void pickFile(e.target.files?.[0])} />
        </div>
        {kind === 'tx' && <div className="mem-caption">Thu chi cửa hàng (iPOS D03): chọn chi nhánh, hoặc chọn file có nhiều cửa hàng để ghép từng cửa hàng. Sao kê ngân hàng của công ty: tạo chi nhánh “Công ty” ở Quản trị → Người dùng rồi chọn chi nhánh đó.</div>}
      </div>

      {kind === 'chan' && cStores && (
        <div className="mem-card stack">
          <div><div className="section-title">Ghép cửa hàng với chi nhánh</div><div className="mem-caption">{fileName} · doanh thu theo từng nguồn đơn (Tại chỗ, Grab, ShopeeFood, ...)</div></div>
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>Cửa hàng trong file</th><th className="num">Số dòng</th><th className="num">Doanh thu Net</th><th className="num">Hoa hồng</th><th>Nhập vào chi nhánh</th></tr></thead>
              <tbody>
                {cStores.map((st) => (
                  <tr key={st.sheet}>
                    <td>{st.storeName}</td>
                    <td className="num">{st.rows.length}</td>
                    <td className="num">{money(st.rows.reduce((a, r) => a + r.net, 0))}</td>
                    <td className="num">{money(st.rows.reduce((a, r) => a + r.commission, 0))}</td>
                    <td>
                      <select className="input" value={storeBranch[st.sheet] ?? ''} aria-label={`Chi nhánh cho ${st.storeName}`}
                        onChange={(e) => setStoreBranch({ ...storeBranch, [st.sheet]: e.target.value })}>
                        <option value="">— Bỏ qua cửa hàng này —</option>
                        {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="mem-btn mem-btn-primary" disabled={busy || !chan.length} onClick={() => void runChan()}>{busy ? 'Đang nhập...' : `Nhập ${chan.length} dòng`}</button>
          </div>
          {result && <div className="alert good" role="status">{result}</div>}
        </div>
      )}

      {kind === 'pttt' && pStores && (
        <div className="mem-card stack">
          <div><div className="section-title">Ghép cửa hàng với chi nhánh</div><div className="mem-caption">{fileName} · dùng để đối soát tiền về ngân hàng theo từng phương thức</div></div>
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>Cửa hàng trong file</th><th className="num">Số dòng</th><th className="num">Tiền mặt</th><th className="num">Tổng các phương thức</th><th>Nhập vào chi nhánh</th></tr></thead>
              <tbody>
                {pStores.map((st) => (
                  <tr key={st.sheet}>
                    <td>{st.storeName}</td>
                    <td className="num">{st.rows.length}</td>
                    <td className="num">{money(st.rows.filter((r) => norm(r.method) === 'tien mat').reduce((a, r) => a + r.amount, 0))}</td>
                    <td className="num">{money(st.rows.reduce((a, r) => a + r.amount, 0))}</td>
                    <td>
                      <select className="input" value={storeBranch[st.sheet] ?? ''} aria-label={`Chi nhánh cho ${st.storeName}`}
                        onChange={(e) => setStoreBranch({ ...storeBranch, [st.sheet]: e.target.value })}>
                        <option value="">— Bỏ qua cửa hàng này —</option>
                        {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="mem-btn mem-btn-primary" disabled={busy || !pttt.length} onClick={() => void runPttt()}>{busy ? 'Đang nhập...' : `Nhập ${pttt.length} dòng`}</button>
          </div>
          {result && <div className="alert good" role="status">{result}</div>}
        </div>
      )}

      {kind === 'b03' && stores && (
        <div className="mem-card stack">
          <div><div className="section-title">Ghép cửa hàng với chi nhánh</div><div className="mem-caption">{fileName} · doanh thu = Net như trên iPOS, thuế VAT đầu ra lưu riêng</div></div>
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>Cửa hàng trong file</th><th className="num">Số ngày</th><th className="num">Doanh thu</th><th className="num">Hoa hồng</th><th className="num">VAT đầu ra</th><th>Nhập vào chi nhánh</th></tr></thead>
              <tbody>
                {stores.map((st) => (
                  <tr key={st.sheet}>
                    <td>{st.storeName}</td>
                    <td className="num">{st.days.length}</td>
                    <td className="num">{money(st.days.reduce((a, d) => a + d.revenue, 0))}</td>
                    <td className="num">{money(st.days.reduce((a, d) => a + d.commission, 0))}</td>
                    <td className="num">{money(st.days.reduce((a, d) => a + d.vat, 0))}</td>
                    <td>
                      <select className="input" value={storeBranch[st.sheet] ?? ''} aria-label={`Chi nhánh cho ${st.storeName}`}
                        onChange={(e) => setStoreBranch({ ...storeBranch, [st.sheet]: e.target.value })}>
                        <option value="">— Bỏ qua cửa hàng này —</option>
                        {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mem-caption">Nhập lại ngày đã có của cùng chi nhánh sẽ ghi đè số cũ, không bị nhân đôi. Cửa hàng chưa có chi nhánh thì thêm ở mục Quản trị rồi nhập lại.</div>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="mem-btn mem-btn-primary" disabled={busy || !b03.sales.length} onClick={() => void runB03()}>{busy ? 'Đang nhập...' : `Nhập ${b03.sales.length} ngày doanh thu`}</button>
          </div>
          {result && <div className="alert good" role="status">{result}</div>}
        </div>
      )}

      {kind !== 'b03' && kind !== 'pttt' && kind !== 'chan' && table && (
        <div className="mem-card stack">
          <div className="spread">
            <div><div className="section-title">Ghép cột</div><div className="mem-caption">{fileName} · {body.length} dòng dữ liệu</div></div>
            <label className="row" style={{ cursor: 'pointer' }}><input type="checkbox" checked={hasHeader} onChange={(e) => setHasHeader(e.target.checked)} /> Dòng đầu là tiêu đề</label>
          </div>
          {raw && raw.length > 1 && (
            <div className="field"><label htmlFor="hdr-row">Dòng tiêu đề của bảng (sao kê ngân hàng thường có vài dòng thông tin tài khoản phía trên)</label>
              <select id="hdr-row" className="input" value={hdr} onChange={(e) => applyHeader(raw, Number(e.target.value))}>
                {raw.slice(0, 40).map((r, i) => (
                  <option key={i} value={i}>Dòng {i + 1}: {r.filter((c) => c !== null && String(c).trim() !== '').slice(0, 4).join(' | ').slice(0, 80) || '(trống)'}</option>
                ))}
              </select></div>
          )}
          <div className="form-grid">
            {colSelect('date', 'Cột Ngày', true)}
            {kind === 'tx' && typeMode === 'split' ? (
              <>
                {colSelect('debit', 'Cột Ghi nợ / Tiền ra (khoản Chi)')}
                {colSelect('credit', 'Cột Ghi có / Tiền vào (khoản Thu)')}
              </>
            ) : colSelect('amount', kind === 'sales' ? 'Cột Doanh thu' : 'Cột Số tiền', true)}
            {kind === 'tx' && colSelect('store', 'Cột Cửa hàng (nếu một file có nhiều cửa hàng)')}
            {kind === 'tx' && colSelect('acct', 'Cột Số tài khoản đối ứng (sao kê ngân hàng, để theo dõi nhà cung cấp)')}
            {kind === 'tx' && col.acct >= 0 && colSelect('acctName', 'Cột Tên tài khoản đối ứng')}
            {kind === 'tx' && (
              <div className="field"><label htmlFor="tx-method">Hình thức thanh toán</label>
                <select id="tx-method" className="input" value={txMethod} onChange={(e) => setTxMethod(e.target.value as Method)}>
                  {(Object.keys(METHOD_LABEL) as Method[]).map((m) => <option key={m} value={m}>{METHOD_LABEL[m]}</option>)}
                </select></div>
            )}
            {kind === 'sales' ? colSelect('orders', 'Cột Số hóa đơn (nếu có)') : (
              <>
                {colSelect('note', 'Cột Ghi chú / nội dung')}
                {colSelect('cat', 'Cột Danh mục (nếu có)')}
                <div className="field"><label htmlFor="tm">Cách xác định Thu hay Chi</label>
                  <select id="tm" className="input" value={typeMode} onChange={(e) => setTypeMode(e.target.value as TypeMode)}>
                    <option value="expense">Tất cả là khoản Chi</option><option value="income">Tất cả là khoản Thu</option>
                    <option value="sign">Số dương là Thu, số âm là Chi</option><option value="column">Theo cột “Loại” (chữ Thu / Chi)</option>
                    <option value="split">Hai cột riêng: Ghi nợ (chi) và Ghi có (thu)</option>
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

          {kind === 'tx' && col.store >= 0 && storeValues.length > 0 && (
            <div className="stack">
              <div className="section-title">Ghép cửa hàng với chi nhánh</div>
              <div className="table-wrap">
                <table className="tbl">
                  <thead><tr><th>Cửa hàng trong file</th><th>Nhập vào chi nhánh</th></tr></thead>
                  <tbody>
                    {storeValues.map((v) => (
                      <tr key={v}>
                        <td>{v}</td>
                        <td>
                          <select className="input" value={branchFor(v)} aria-label={`Chi nhánh cho ${v}`} onChange={(e) => setRowBranch({ ...rowBranch, [v]: e.target.value })}>
                            <option value="">— Bỏ qua cửa hàng này —</option>
                            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {col.date < 0 || (kind === 'tx' && typeMode === 'split' ? col.debit < 0 && col.credit < 0 : col.amount < 0) ? (
            <div className="alert warn">Hãy chọn cột Ngày và cột Số tiền (hoặc Ghi nợ / Ghi có) để xem trước.</div>
          ) : (
            <>
              <div className="alert good"><div><span className="t">{count} dòng hợp lệ</span>{parsed.skipped > 0 && ` · ${parsed.skipped} dòng sẽ bị bỏ qua (thiếu ngày hoặc số tiền)`}{parsed.noBranch > 0 && ` · ${parsed.noBranch} dòng chưa có chi nhánh`}</div></div>
              <div className="table-wrap">
                <table className="tbl">
                  <thead><tr><th>Ngày</th>{col.store >= 0 && <th>Chi nhánh</th>}{kind === 'tx' && <th>Loại</th>}<th className="num">{kind === 'tx' ? 'Số tiền' : 'Doanh thu'}</th>{kind === 'tx' && <th>Ghi chú</th>}</tr></thead>
                  <tbody>
                    {(kind === 'tx' ? parsed.tx.slice(0, 8) : parsed.sales.slice(0, 8)).map((r, i) => (
                      <tr key={i}>
                        <td>{vnDate('tx_date' in r ? r.tx_date : r.sale_date)}</td>
                        {col.store >= 0 && <td>{branches.find((b) => b.id === r.branch_id)?.name ?? '—'}</td>}
                        {'type' in r && <td>{r.type === 'income' ? 'Thu' : 'Chi'}</td>}
                        <td className="num">{money('amount' in r ? r.amount : r.revenue)}</td>
                        {'note' in r && <td>{r.note}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {kind === 'tx' && (
                <label className="row" style={{ cursor: 'pointer', alignItems: 'flex-start' }}>
                  <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} style={{ marginTop: 3 }} />
                  <span>Ghi đè dữ liệu cũ: xóa các khoản đã nhập từ file trước trong khoảng ngày của file này rồi nhập lại. Khoản nhập tay không bị đụng; khoản từ file mà bạn đã sửa tay sẽ mất chỉnh sửa.</span>
                </label>
              )}
              {kind === 'sales' && <div className="mem-caption">Nhập lại ngày đã có của cùng chi nhánh sẽ ghi đè số cũ.</div>}
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
