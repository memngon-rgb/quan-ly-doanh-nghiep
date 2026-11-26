import type { Cell } from '../../core/excel'
import type { Branch } from '../../core/types'
import { normText } from './ipos'
import { parseMoney } from './Import'
import { branchByName, type Src } from './reconLogic'
import type { Actual, DeductionKind } from './types'

export interface SheetActual extends Omit<Actual, 'id'> { pos: number }
export interface SheetDeduction { branch_id: string; source: Src; kind: DeductionKind; amount: number; from: string; to: string }
export interface SheetResult {
  actuals: SheetActual[]
  deductions: SheetDeduction[]
  stores: { sheet: string; branchId: string; days: number }[]
  skipped: string[]
}

const SRC_BY_LABEL: Record<string, Src> = {
  'tien mat': 'cash', momo: 'momo', 'chuyen khoan': 'transfer', grab: 'grab', 'shopee food': 'shopee', shopeefood: 'shopee', 'be food': 'be', befood: 'be', 'xanh sm': 'gsm',
}

/** Ô ngày trong file Excel là kiểu ngày (đọc ra Date, 00:00 giờ UTC) hoặc chữ “dd/mm” khi tải từ CSV. */
function sheetDate(v: unknown, year: number): string | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10)
  const m = String(v ?? '').trim().match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/)
  return m ? `${m[3] ?? year}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null
}

/**
 * Đọc file Excel đối soát của kế toán (các sheet “ĐS DT …”, mỗi cửa hàng một sheet, mỗi ngày nhiều dòng theo nguồn tiền).
 * Số cửa hàng khai = cột “THỰC NHẬN (Kế toán nhập)”; truy thu = phần thiếu so với cột “THỰC TẾ”;
 * quảng cáo và trả vay Grab lấy từ hai cột cùng tên, gộp theo cửa hàng và nguồn cho cả kỳ.
 */
export function parseReconSheets(sheets: { name: string; rows: Cell[][] }[], branches: Branch[], year: number): SheetResult {
  const out: SheetResult = { actuals: [], deductions: [], stores: [], skipped: [] }
  for (const sh of sheets) {
    if (!normText(sh.name).startsWith('ds dt')) { out.skipped.push(sh.name); continue }
    const h = sh.rows.findIndex((r) => normText(r[1]) === 'ngay' && r.some((c) => normText(c).startsWith('doanh thu pos')))
    if (h < 0) { out.skipped.push(sh.name); continue }
    const title = normText(sh.rows.slice(0, h).flat().find((c) => normText(c).startsWith('doi soat')) ?? sh.name)
    const branchId = branchByName(title, branches) ?? branchByName(normText(sh.name), branches)
    if (!branchId) { out.skipped.push(`${sh.name} (không nhận ra cửa hàng)`); continue }
    const head = sh.rows[h].map((c) => normText(c))
    const col = (pred: (s: string) => boolean) => head.findIndex(pred)
    const c = {
      date: 1, label: 2,
      pos: col((s) => s.startsWith('doanh thu pos')), actual: col((s) => s.startsWith('thuc te')),
      booked: col((s) => s.startsWith('thuc nhan') && s.includes('ke toan')),
      note: col((s) => s.startsWith('giai trinh')), ads: col((s) => s.startsWith('chay quang cao')), loan: col((s) => s.startsWith('tra vay')),
    }
    if (c.pos < 0 || c.actual < 0 || c.booked < 0) { out.skipped.push(`${sh.name} (thiếu cột)`); continue }
    const num = (r: Cell[], i: number) => (i < 0 ? 0 : parseMoney(r[i]) ?? 0)
    const ded = new Map<string, SheetDeduction>()
    const days = new Set<string>()
    for (const r of sh.rows.slice(h + 1)) {
      const src = SRC_BY_LABEL[normText(r[c.label])]
      const date = sheetDate(r[c.date], year)
      if (!date || !src) continue
      const pos = num(r, c.pos), expected = num(r, c.actual), booked = num(r, c.booked)
      if (pos === 0 && expected === 0 && booked === 0) continue
      days.add(date)
      const short = expected - booked
      const note = c.note >= 0 ? String(r[c.note] ?? '').trim() : ''
      out.actuals.push({
        branch_id: branchId, source: src, date_from: date, date_to: date, amount: booked, photo_path: null, pos,
        explain: note, explain_status: note ? 'explained' : 'none', recovery: short > 1000 ? short : 0, recovery_status: 'pending',
      })
      for (const [kind, i] of [['ads', c.ads], ['grab_loan', c.loan]] as [DeductionKind, number][]) {
        const v = num(r, i)
        if (v <= 0) continue
        const k = `${kind}|${src}`
        const cur = ded.get(k) ?? { branch_id: branchId, source: src, kind, amount: 0, from: date, to: date }
        cur.amount += v
        if (date < cur.from) cur.from = date
        if (date > cur.to) cur.to = date
        ded.set(k, cur)
      }
    }
    out.deductions.push(...ded.values())
    out.stores.push({ sheet: sh.name, branchId, days: days.size })
  }
  return out
}
