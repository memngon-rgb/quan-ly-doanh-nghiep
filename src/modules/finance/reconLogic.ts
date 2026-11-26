import { addDays } from '../../core/format'
import type { Branch } from '../../core/types'
import { normText } from './ipos'
import type { Actual, Deduction, Holiday, Payment, Tx } from './types'

/** Nguồn tiền được đối soát */
export type Src = 'cash' | 'momo' | 'grab' | 'shopee' | 'be' | 'gsm' | 'transfer' | 'other'
export const SRC_LABEL: Record<Src, string> = {
  cash: 'Tiền mặt', momo: 'MoMo', grab: 'Grab', shopee: 'ShopeeFood', be: 'Be Food', gsm: 'Xanh SM', transfer: 'Chuyển khoản', other: 'Khác',
}
/** Các nguồn cửa hàng phải khai số thực nhận */
export const ENTRY_SRC: Src[] = ['cash', 'momo', 'grab', 'shopee', 'be', 'gsm', 'transfer']
/** Nguồn mà sao kê ghi rõ cửa hàng (đối soát được từng cửa hàng) */
const BRANCH_ON_STATEMENT: Src[] = ['momo', 'grab']

export function posSource(method: string): Src | null {
  const m = normText(method)
  if (m === 'no') return null
  if (m === 'tien mat') return 'cash'
  if (m.includes('chuyen khoan')) return 'transfer'
  if (m.includes('momo')) return 'momo'
  if (m.includes('grab')) return 'grab'
  if (m.includes('shopee')) return 'shopee'
  if (m.includes('xanh') || m.includes('gsm')) return 'gsm'
  if (/^be\b/.test(m) || m.includes('befood')) return 'be'
  return 'other'
}

/* ---------- Đọc dòng sao kê ---------- */
export interface BankRow {
  tx: Tx
  src: Src
  branchId: string | null
  from: string
  to: string
  /** period: kỳ doanh thu ghi trong nội dung · day: ngày về trừ 1 · payout: chỉ biết ngày chuyển tiền */
  basis: 'period' | 'day' | 'payout'
}
const iso = (y: string, m: string, d: string) => `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
const d8 = (s: string) => iso(s.slice(4), s.slice(2, 4), s.slice(0, 2))

export function branchByName(n: string, branches: Branch[]): string | null {
  for (const b of branches) {
    const key = normText(b.name.split('-').pop() ?? b.name).replace(/^cn /, '')
    if (key && n.includes(key)) return b.id
  }
  return null
}

export function parseBank(tx: Tx, branches: Branch[]): BankRow {
  const n = normText(tx.note)
  const day = tx.tx_date
  const branchId = branchByName(n, branches)
  if (n.includes('momo')) {
    const m = n.match(/tu (\d{1,2})\/(\d{1,2})\/(\d{4}) den (\d{1,2})\/(\d{1,2})\/(\d{4})/)
    if (m) return { tx, src: 'momo', branchId, from: iso(m[3], m[2], m[1]), to: iso(m[6], m[5], m[4]), basis: 'period' }
    // Không có kỳ doanh thu: là khách lẻ chuyển tiền qua MoMo, không phải MoMo thanh toán
    return { tx, src: 'other', branchId: null, from: day, to: day, basis: 'payout' }
  }
  if (n.includes('grab')) { const d = addDays(day, -1); return { tx, src: 'grab', branchId, from: d, to: d, basis: 'day' } }
  if (n.includes('shopee')) {
    const m = n.match(/(\d{2}) (\d{2}) (\d{4})/)
    const d = m ? iso(m[3], m[2], m[1]) : day
    return { tx, src: 'shopee', branchId: null, from: d, to: d, basis: 'payout' }
  }
  if (n.includes('befood') || n.includes('be group')) {
    const m = n.match(/ky (\d{8})(?:\s+(\d{8}))?/)
    if (m) return { tx, src: 'be', branchId: null, from: d8(m[1]), to: d8(m[2] ?? m[1]), basis: 'period' }
    return { tx, src: 'be', branchId: null, from: day, to: day, basis: 'payout' }
  }
  if (n.includes('gsm') || n.includes('tien rut vi')) {
    const m = n.match(/mc (\d{2})(\d{2})(\d{2})/)
    const d = m ? iso(`20${m[3]}`, m[2], m[1]) : day
    return { tx, src: 'gsm', branchId: null, from: d, to: d, basis: 'payout' }
  }
  if (n.includes('doanh thu tien mat') || n.includes('nop tien mat') || n.includes('nop doanh thu')) {
    return { tx, src: 'cash', branchId: null, from: day, to: day, basis: 'payout' }
  }
  return { tx, src: 'other', branchId, from: day, to: day, basis: 'payout' }
}

/* ---------- Ngày dự kiến tiền về ---------- */
const dow = (s: string) => new Date(`${s}T00:00:00`).getDay() // 0 = CN
const isWeekend = (s: string) => dow(s) === 0 || dow(s) === 6

export function expectedArrival(date: string, src: Src, holidays: Holiday[]): string {
  const off = (d: string, weekends: boolean) =>
    (weekends && isWeekend(d)) || holidays.some((h) => h.hdate === d && (h.platform === 'all' || h.platform === src))
  let d: string
  if (src === 'cash') {
    // Thứ 2 nộp doanh thu thứ 6, 7, CN · thứ 6 nộp doanh thu thứ 2 đến thứ 5
    const w = dow(date)
    d = w === 5 || w === 6 || w === 0 ? addDays(date, w === 5 ? 3 : w === 6 ? 2 : 1) : addDays(date, 5 - w)
    for (let i = 0; i < 10 && off(d, false); i++) d = addDays(d, 1)
    return d
  }
  const weekdayOnly = src !== 'grab'
  d = addDays(date, src === 'shopee' || src === 'gsm' ? 2 : 1)
  for (let i = 0; i < 14 && off(d, weekdayOnly); i++) d = addDays(d, 1)
  return d
}

/* ---------- Phải về theo POS cho 1 cửa hàng, 1 nguồn, 1 kỳ ---------- */
export function expectedPos(payments: Payment[], tx: Tx[], branchId: string, src: Src, from: string, to: string): number {
  const pos = payments
    .filter((p) => p.branch_id === branchId && p.pay_date >= from && p.pay_date <= to && posSource(p.method) === src)
    .reduce((a, p) => a + p.amount, 0)
  if (src !== 'cash') return pos
  const cash = tx.filter((t) => t.branch_id === branchId && t.method === 'cash' && t.tx_date >= from && t.tx_date <= to && !t.external_key?.startsWith('recon|'))
  const inc = cash.filter((t) => t.type === 'income').reduce((a, t) => a + t.amount, 0)
  const exp = cash.filter((t) => t.type === 'expense').reduce((a, t) => a + t.amount, 0)
  return pos + inc - exp
}

export const tolerance = (base: number) => Math.max(50_000, Math.abs(base) * 0.01)

/* ---------- Tổng hợp đối soát ---------- */
export interface BranchRow { src: Src; pos: number; entered: number | null; diff: number | null; bank: number | null }
export interface BranchView {
  id: string; name: string; rows: BranchRow[]
  thucTe: number; entered: number; shortfall: number; waiting: number
}
export interface CompanyRow {
  src: Src; pos: number; entered: number; branchesEntered: number; branchesNeeded: number
  bank: number; deducted: number | null; vsPos: number
  pending: number; expected: string | null; late: boolean
  /** Doanh thu trong khoảng đã chọn nhưng tiền về theo kỳ bắt đầu trước khoảng này (không so sánh được) */
  carry: number
  recorded: number; unclassified: number
}

export interface ReconInput {
  from: string; to: string; today: string
  branches: Branch[]; payments: Payment[]; tx: Tx[]; actuals: Actual[]; deductions: Deduction[]; holidays: Holiday[]
}

export function buildRecon(i: ReconInput) {
  const bank = i.tx.filter((t) => t.type === 'income' && t.method === 'transfer' && !t.external_key?.startsWith('recon|')).map((t) => parseBank(t, i.branches))
  const inRange = (b: BankRow) => {
    if (b.src === 'cash') return b.tx.tx_date >= i.from && b.tx.tx_date <= addDays(i.to, 3)
    if (b.basis === 'payout') return b.from >= i.from && b.from <= addDays(i.to, 3)
    return b.from >= i.from && b.to <= i.to
  }
  const bankIn = bank.filter(inRange)
  const bankSum = (src: Src, branchId?: string) => bankIn.filter((b) => b.src === src && (branchId === undefined || b.branchId === branchId)).reduce((a, b) => a + b.tx.amount, 0)

  const ids = [...new Set([...i.payments.map((p) => p.branch_id), ...i.actuals.map((a) => a.branch_id)])]
  const views: BranchView[] = ids.map((id) => {
    const rows: BranchRow[] = []
    for (const src of ENTRY_SRC) {
      const pos = expectedPos(i.payments, i.tx, id, src, i.from, i.to)
      const mine = i.actuals.filter((a) => a.branch_id === id && a.source === src)
      const has = mine.length > 0
      const entered = has ? mine.reduce((a, x) => a + x.amount, 0) : null
      if (pos === 0 && !has) continue
      rows.push({ src, pos, entered, diff: entered === null ? null : pos - entered, bank: BRANCH_ON_STATEMENT.includes(src) ? bankSum(src, id) : null })
    }
    return {
      id, name: i.branches.find((b) => b.id === id)?.name ?? '—', rows,
      thucTe: rows.reduce((a, r) => a + r.pos, 0),
      entered: rows.reduce((a, r) => a + (r.entered ?? 0), 0),
      shortfall: rows.reduce((a, r) => a + (r.diff !== null && r.diff > tolerance(r.pos) ? r.diff : 0), 0),
      waiting: rows.filter((r) => r.entered === null).length,
    }
  }).sort((a, b) => a.name.localeCompare(b.name))

  const company: CompanyRow[] = [...ENTRY_SRC, 'other' as Src].map((src) => {
    const rows = views.flatMap((v) => v.rows.filter((r) => r.src === src))
    const pos = src === 'other' ? i.payments.filter((p) => posSource(p.method) === 'other').reduce((a, p) => a + p.amount, 0) : rows.reduce((a, r) => a + r.pos, 0)
    const entered = rows.reduce((a, r) => a + (r.entered ?? 0), 0)
    const branchesEntered = rows.filter((r) => r.entered !== null).length
    // Chuyển khoản của khách và các khoản chưa nhận ra nguồn đều nằm ở nhóm “khác” trên sao kê
    const b = src === 'transfer' ? bankSum('other') : src === 'other' ? 0 : bankSum(src)
    const allIn = rows.length > 0 && branchesEntered === rows.length
    const recorded = i.deductions.filter((d) => d.source === src).reduce((a, d) => a + d.amount, 0)
    const deducted = allIn && b > 0 && src !== 'cash' && src !== 'transfer' ? entered - b : null
    // Tiền đang chờ về: doanh thu các ngày sau ngày cuối đã có tiền (chỉ nguồn ghi rõ kỳ hoặc ngày)
    let pending = 0, expected: string | null = null, late = false
    if (src === 'momo' || src === 'grab' || src === 'be') {
      const covered = bank.filter((x) => x.src === src && x.basis !== 'payout').reduce((m, x) => (x.to > m ? x.to : m), '')
      const days = i.payments.filter((p) => p.pay_date >= i.from && p.pay_date <= i.to && posSource(p.method) === src && p.pay_date > covered && p.amount > 0)
      pending = days.reduce((a, p) => a + p.amount, 0)
      const first = days.map((p) => p.pay_date).sort()[0]
      if (first) { expected = expectedArrival(first, src, i.holidays); late = expected < i.today }
    }
    // Kỳ nối: khoản tiền về cho kỳ bắt đầu trước ngày đầu của khoảng đã chọn
    const carry = bank.filter((x) => x.src === src && x.basis !== 'payout' && x.from < i.from && x.to >= i.from && x.to <= i.to).reduce((a, x) => {
      const ids2 = BRANCH_ON_STATEMENT.includes(src) && x.branchId ? [x.branchId] : ids
      return a + i.payments.filter((p) => ids2.includes(p.branch_id) && p.pay_date >= i.from && p.pay_date <= x.to && posSource(p.method) === src).reduce((t, p) => t + p.amount, 0)
    }, 0)
    return { src, pos, entered, branchesEntered, branchesNeeded: rows.length, bank: b, deducted, vsPos: b - (pos - pending), pending, expected, late, carry, recorded, unclassified: deducted === null ? 0 : deducted - recorded }
  }).filter((c) => c.pos > 0 || c.bank > 0 || c.entered > 0)

  const unknown = bankIn.filter((b) => b.src === 'other')
  const unassigned = bankIn.filter((b) => BRANCH_ON_STATEMENT.includes(b.src) && !b.branchId)
  return { views, company, unknown, unassigned, bankCount: bank.length }
}
