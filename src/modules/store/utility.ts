/** Biểu giá bậc thang (đơn giá mẫu, bạn chỉnh lại theo hóa đơn thật ở màn Điện nước). */
export interface Tier { upTo: number | null; price: number } // upTo = null: bậc cuối, không giới hạn
export const DEFAULT_ELECTRIC_TIERS: Tier[] = [
  { upTo: 50, price: 1984 }, { upTo: 100, price: 2050 }, { upTo: 200, price: 2380 },
  { upTo: 300, price: 2998 }, { upTo: 400, price: 3350 }, { upTo: null, price: 3460 },
]
export const DEFAULT_WATER_TIERS: Tier[] = [
  { upTo: 4, price: 6700 }, { upTo: 6, price: 12900 }, { upTo: null, price: 14400 },
]
export const VAT_UTILITY = 0.08

/** Tiền theo bậc thang cho 1 lượng tiêu thụ trong tháng (chưa VAT). */
export function tierCost(amount: number, tiers: Tier[]): number {
  let left = Math.max(0, amount)
  let prev = 0
  let total = 0
  for (const t of tiers) {
    const size = t.upTo === null ? left : Math.min(left, t.upTo - prev)
    if (size <= 0) break
    total += size * t.price
    left -= size
    prev = t.upTo ?? prev
    if (left <= 0) break
  }
  return Math.round(total)
}

/** Từ các chỉ số đồng hồ (đã sắp theo ngày) tính lượng tiêu thụ mỗi ngày = chỉ số hôm nay − chỉ số lần ghi trước. */
export function dailyUse(readings: { date: string; value: number | null }[]): { date: string; use: number; days: number }[] {
  const rs = readings.filter((r) => r.value !== null).sort((a, b) => (a.date < b.date ? -1 : 1))
  const out: { date: string; use: number; days: number }[] = []
  for (let i = 1; i < rs.length; i++) {
    const days = Math.max(1, Math.round((new Date(rs[i].date).getTime() - new Date(rs[i - 1].date).getTime()) / 86_400_000))
    const use = (rs[i].value as number) - (rs[i - 1].value as number)
    if (use >= 0) out.push({ date: rs[i].date, use, days })
  }
  return out
}
