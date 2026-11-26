const nf = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 })

export const money = (n: number) => `${nf.format(Math.round(n))}đ`
export const num = (n: number) => nf.format(Math.round(n))

/** 12.500.000 → "12,5 tr"; 1.200.000.000 → "1,2 tỷ" */
export function short(n: number): string {
  const a = Math.abs(n)
  const f = (v: number) => v.toLocaleString('vi-VN', { maximumFractionDigits: 1 })
  if (a >= 1e9) return `${f(n / 1e9)} tỷ`
  if (a >= 1e6) return `${f(n / 1e6)} tr`
  if (a >= 1e3) return `${f(n / 1e3)}k`
  return String(Math.round(n))
}

export const pct = (v: number) =>
  `${(v * 100).toLocaleString('vi-VN', { maximumFractionDigits: 1 })}%`

export const pad = (n: number) => String(n).padStart(2, '0')

/** Date → 'YYYY-MM-DD' theo giờ máy (không lệch múi giờ) */
export const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export const today = () => iso(new Date())

/** 'YYYY-MM-DD' → 'dd/mm/yyyy' */
export function vnDate(s: string): string {
  const [y, m, d] = s.split('-')
  return `${d}/${m}/${y}`
}

/** 'YYYY-MM' → 'Tháng 11/2026' */
export function monthLabel(ym: string): string {
  const [y, m] = ym.split('-')
  return `Tháng ${Number(m)}/${y}`
}

export const thisMonth = () => today().slice(0, 7)

export function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
}

export function monthRange(ym: string): { from: string; to: string; days: number } {
  const [y, m] = ym.split('-').map(Number)
  const days = new Date(y, m, 0).getDate()
  return { from: `${ym}-01`, to: `${ym}-${pad(days)}`, days }
}

export function addDays(s: string, delta: number): string {
  const [y, m, d] = s.split('-').map(Number)
  return iso(new Date(y, m - 1, d + delta))
}

/** Chống CSV/Excel injection: ô bắt đầu bằng = + @ - thì thêm dấu ' */
export function safeCell(v: string): string {
  return /^[=+@-]/.test(v) ? `'${v}` : v
}
