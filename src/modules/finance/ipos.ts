import type { Cell } from '../../core/excel'
import { parseDate, parseMoney } from './Import'

export interface IposDay {
  date: string; orders: number; guests: number; revenue: number; gross: number
  discount: number; merchantDiscount: number; marketingFee: number; voucher: number
  commission: number; vat: number; withholdingTax: number; vatDiscount: number
}
export interface IposStore { sheet: string; storeName: string; days: IposDay[] }

export const normText = (s: unknown) =>
  String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/\s+/g, ' ').trim()

/**
 * Đọc báo cáo iPOS A02 "Doanh thu theo cửa hàng" (xuất theo ngày, mọi cửa hàng trong một bảng).
 * revenue = Doanh thu Net đúng như trên iPOS (đã trừ giảm giá và hoa hồng nền tảng).
 * Cột "Thuế" là VAT đầu ra, lưu riêng để hiện dòng "sau khi trừ thuế".
 */
export function parseA02(rows: Cell[][]): IposStore[] {
  const h = rows.findIndex((r) => normText(r[0]) === 'ngay' && r.some((c) => normText(c) === 'ten cua hang'))
  if (h < 0) return []
  const idx = (label: string) => rows[h].findIndex((c) => normText(c) === label)
  const c = {
    store: idx('ten cua hang'), orders: idx('so hd'), vat: idx('thue'),
    comm: idx('hoa hong'), net: idx('doanh thu net'),
  }
  if (Object.values(c).some((i) => i < 0)) return []
  const opt = {
    guests: idx('so khach'), gross: idx('doanh thu gross'), discount: idx('giam gia'), merchant: idx('chiet khau'),
    marketing: idx('phi ho tro marketing'), voucher: idx('phieu gg'), withholding: idx('thue khau tru'), vatDiscount: idx('giam gia vat'),
  }
  const map = new Map<string, IposStore>()
  for (const row of rows.slice(h + 1)) {
    const date = parseDate(row[0])
    const name = String(row[c.store] ?? '').trim()
    if (!date || !name) continue // dòng TỔNG hoặc trống
    const n = (i: number) => (i < 0 ? 0 : parseMoney(row[i]) ?? 0)
    const commission = n(c.comm)
    const revenue = n(c.net)
    const orders = n(c.orders)
    if (orders === 0 && revenue === 0) continue
    const st = map.get(name) ?? { sheet: name, storeName: name, days: [] }
    st.days.push({
      date, orders, revenue, commission, vat: n(c.vat),
      guests: n(opt.guests), gross: n(opt.gross), discount: n(opt.discount), merchantDiscount: n(opt.merchant),
      marketingFee: n(opt.marketing), voucher: n(opt.voucher), withholdingTax: n(opt.withholding), vatDiscount: n(opt.vatDiscount),
    })
    map.set(name, st)
  }
  return [...map.values()]
}

/** Gợi ý chi nhánh khớp tên cửa hàng, ví dụ "TIỆM XÔI MỀM - CỬU LONG" ↔ "... CN Cửu Long" */
export function matchBranch(storeName: string, branches: { id: string; name: string }[]): string {
  const key = normText(storeName.split('-').pop())
  if (!key) return ''
  return branches.find((b) => normText(b.name).includes(key))?.id ?? ''
}

export interface PttRow { date: string; method: string; orders: number; amount: number }
export interface PttStore { sheet: string; storeName: string; rows: PttRow[] }

/**
 * Đọc báo cáo iPOS "PTTT" (phương thức thanh toán), mỗi cửa hàng một sheet:
 * hàng 2 là tên phương thức (mỗi phương thức chiếm 2 cột: số đơn, số tiền), hàng 3 là tiêu đề phụ.
 * Bỏ nhóm "Tổng" và sheet "Tất cả cửa hàng" để không cộng trùng.
 */
export function parsePttt(sheets: { name: string; rows: Cell[][] }[]): PttStore[] {
  const out: PttStore[] = []
  for (const sh of sheets) {
    const m = String(sh.rows[0]?.[0] ?? '').match(/tại\s+(.+)$/i)
    if (!m || normText(m[1]).startsWith('tat ca')) continue
    const groups = sh.rows[1] ?? []
    const cols: { method: string; orders: number; amount: number }[] = []
    groups.forEach((g, i) => {
      const name = String(g ?? '').trim()
      if (i === 0 || !name || normText(name) === 'tong') return
      cols.push({ method: name, orders: i, amount: i + 1 })
    })
    if (!cols.length) continue
    const rows: PttRow[] = []
    for (const row of sh.rows.slice(3)) {
      const date = parseDate(row[0])
      if (!date) continue
      for (const c of cols) {
        const amount = parseMoney(row[c.amount]) ?? 0
        const orders = parseMoney(row[c.orders]) ?? 0
        if (amount !== 0 || orders !== 0) rows.push({ date, method: c.method, orders, amount })
      }
    }
    out.push({ sheet: sh.name, storeName: m[1].trim(), rows })
  }
  return out
}

export interface ChanRow {
  date: string; channel: string; orders: number; guests: number
  commission: number; discount: number; withholdingTax: number; net: number; gross: number
}
export interface ChanStore { sheet: string; storeName: string; rows: ChanRow[] }

/**
 * Đọc báo cáo iPOS B03 "Nguồn đơn hàng", mỗi cửa hàng một sheet.
 * Hàng 2 là tên nguồn (Tại chỗ, Grab, ShopeeFood...), mỗi nguồn chiếm 7 cột; hàng 3 là tiêu đề cột.
 * Bỏ nhóm "Tổng" và sheet "Tất cả cửa hàng" để không cộng trùng.
 */
export function parseB03(sheets: { name: string; rows: Cell[][] }[]): ChanStore[] {
  const out: ChanStore[] = []
  for (const sh of sheets) {
    const m = String(sh.rows[0]?.[0] ?? '').match(/tại cửa hàng\s+(.+)$/i)
    if (!m || normText(m[1]).startsWith('tat ca')) continue
    const groups = sh.rows[1] ?? []
    const heads = sh.rows[2] ?? []
    const cols: { channel: string; at: (label: string) => number }[] = []
    groups.forEach((g, i) => {
      const name = String(g ?? '').trim()
      if (i === 0 || !name || normText(name) === 'tong') return
      cols.push({
        channel: name,
        at: (label) => {
          for (let k = i; k < Math.min(heads.length, i + 8); k++) if (normText(heads[k]) === label) return k
          return -1
        },
      })
    })
    const rows: ChanRow[] = []
    for (const row of sh.rows.slice(3)) {
      const date = parseDate(row[0])
      if (!date) continue
      for (const c of cols) {
        const n = (label: string) => { const k = c.at(label); return k < 0 ? 0 : parseMoney(row[k]) ?? 0 }
        const r = {
          date, channel: c.channel, orders: n('so hoa don'), guests: n('so khach'), commission: n('hoa hong'),
          discount: n('giam gia'), withholdingTax: n('thue khau tru'), net: n('doanh thu (net)'), gross: n('doanh thu (gross)'),
        }
        if (r.orders !== 0 || r.net !== 0 || r.gross !== 0) rows.push(r)
      }
    }
    out.push({ sheet: sh.name, storeName: m[1].trim(), rows })
  }
  return out
}
