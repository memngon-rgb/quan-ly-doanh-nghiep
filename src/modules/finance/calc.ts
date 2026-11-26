import { monthRange, shiftMonth } from '../../core/format'
import type { Category, ForecastItem, Group, Sale, Tx } from './types'

export const EXPENSE_GROUPS: Group[] = ['cogs', 'payroll', 'fixed', 'other']

export interface Summary {
  revenue: number
  revenueFromSales: boolean
  vat: number
  income: number
  expense: number
  byGroup: Record<Group, number>
  byCategory: Record<string, number>
}

const zeroGroups = (): Record<Group, number> => ({ revenue: 0, cogs: 0, payroll: 0, fixed: 0, other: 0 })

/**
 * Tổng hợp 1 khoảng thời gian.
 * Doanh thu lấy từ báo cáo bán hàng (iPOS). Nếu chưa có báo cáo bán hàng thì dùng các khoản "Thu từ bán hàng" trong sổ thu chi.
 */
export function summarize(txs: Tx[], sales: Sale[], cats: Category[]): Summary {
  const catMap = new Map(cats.map((c) => [c.id, c]))
  const byGroup = zeroGroups()
  const byCategory: Record<string, number> = {}
  let income = 0
  let expense = 0
  let incomeRevenue = 0
  for (const t of txs) {
    const c = t.category_id ? catMap.get(t.category_id) : undefined
    if (t.type === 'income') {
      income += t.amount
      if (c?.grp === 'revenue') incomeRevenue += t.amount
    } else {
      expense += t.amount
      byGroup[c?.grp && c.grp !== 'revenue' ? c.grp : 'other'] += t.amount
    }
    const key = t.category_id ?? 'none'
    byCategory[key] = (byCategory[key] ?? 0) + t.amount
  }
  const salesSum = sales.reduce((s, x) => s + x.revenue, 0)
  const revenueFromSales = salesSum > 0
  const vat = sales.reduce((s, x) => s + (x.vat ?? 0), 0)
  return {
    revenue: revenueFromSales ? salesSum : incomeRevenue,
    revenueFromSales,
    vat,
    income,
    expense,
    byGroup,
    byCategory,
  }
}

export interface ForecastLine {
  cat: Category
  auto: number // trung bình 3 tháng trước
  override: number | null // người dùng chỉnh tay
  value: number // số dùng để tính
}

export interface Forecast {
  histMonths: string[]
  revenueMonthly: number
  cogsPct: number
  cogsPctSource: 'manual' | 'history' | 'default'
  cogsPctAuto: number | null
  lines: ForecastLine[]
  fixedMonthly: number // tổng lương + cố định + khác (không gồm giá vốn)
}

export const DEFAULT_COGS_PCT = 0.35

/** Dự tính tháng `month` dựa vào 3 tháng liền trước + số người dùng chỉnh tay. */
export function buildForecast(
  month: string,
  histTx: Tx[],
  histSales: Sale[],
  cats: Category[],
  items: ForecastItem[],
): Forecast {
  const histMonths = [shiftMonth(month, -3), shiftMonth(month, -2), shiftMonth(month, -1)]
  const perMonth = histMonths.map((m) => {
    const { from, to } = monthRange(m)
    return summarize(
      histTx.filter((t) => t.tx_date >= from && t.tx_date <= to),
      histSales.filter((s) => s.sale_date >= from && s.sale_date <= to),
      cats,
    )
  })
  const hasData = perMonth.filter((s) => s.revenue > 0 || s.expense > 0).length
  const div = Math.max(1, hasData)
  const revenueMonthly = perMonth.reduce((s, x) => s + x.revenue, 0) / div
  const totalRev = perMonth.reduce((s, x) => s + x.revenue, 0)
  const totalCogs = perMonth.reduce((s, x) => s + x.byGroup.cogs, 0)
  const cogsPctAuto = totalRev > 0 ? totalCogs / totalRev : null
  const manualPct = items.find((i) => i.kind === 'cogs_pct')
  const cogsPct = manualPct ? manualPct.value : (cogsPctAuto ?? DEFAULT_COGS_PCT)
  const cogsPctSource = manualPct ? 'manual' : cogsPctAuto != null ? 'history' : 'default'

  const lines: ForecastLine[] = cats
    .filter((c) => c.type === 'expense' && c.grp !== 'cogs' && c.is_active)
    .map((cat) => {
      const total = perMonth.reduce((s, x) => s + (x.byCategory[cat.id] ?? 0), 0)
      const auto = total / div
      const ov = items.find((i) => i.kind === 'monthly' && i.category_id === cat.id)
      return { cat, auto, override: ov ? ov.value : null, value: ov ? ov.value : auto }
    })
  return {
    histMonths,
    revenueMonthly,
    cogsPct,
    cogsPctSource,
    cogsPctAuto,
    lines,
    fixedMonthly: lines.reduce((s, l) => s + l.value, 0),
  }
}

export interface Sim {
  cogs: number
  fixedDaily: number
  totalCost: number
  profit: number
  margin: number
  breakeven: number
  ok: boolean
}

/** "1 ngày bán X đồng thì chi phí dự tính bao nhiêu, có lãi không?" */
export function simulate(dailyRevenue: number, cogsPct: number, monthlyFixed: number, daysInMonth: number): Sim {
  const cogs = dailyRevenue * cogsPct
  const fixedDaily = monthlyFixed / daysInMonth
  const totalCost = cogs + fixedDaily
  const profit = dailyRevenue - totalCost
  return {
    cogs,
    fixedDaily,
    totalCost,
    profit,
    margin: dailyRevenue > 0 ? profit / dailyRevenue : 0,
    breakeven: cogsPct < 1 ? fixedDaily / (1 - cogsPct) : Infinity,
    ok: profit >= 0,
  }
}

/** Các tháng (yyyy-mm) mà khoảng ngày [from, to] chạm tới. */
export function monthsIn(from: string, to: string): string[] {
  const out: string[] = []
  for (let m = from.slice(0, 7); m <= to.slice(0, 7); m = shiftMonth(m, 1)) out.push(m)
  return out
}

export interface RangePlan {
  revenue: number
  fixed: number
  cogsPct: number
  /** Dự tính theo danh mục chi (đã quy theo số ngày của khoảng) */
  byCategory: Record<string, number>
  byGroup: Record<Group, number>
  /** Dự tính của tháng cuối khoảng, dùng cho các cảnh báo */
  last: Forecast
}

/** Dự tính cho 1 khoảng ngày bất kỳ: lấy dự tính từng tháng rồi quy theo số ngày của khoảng nằm trong tháng đó. */
export function rangePlan(from: string, to: string, tx: Tx[], sales: Sale[], cats: Category[], items: ForecastItem[]): RangePlan {
  const byCategory: Record<string, number> = {}
  const byGroup = zeroGroups()
  let revenue = 0
  let fixed = 0
  let cogs = 0
  let last = buildForecast(to.slice(0, 7), tx, sales, cats, items)
  for (const m of monthsIn(from, to)) {
    const f = m === to.slice(0, 7) ? last : buildForecast(m, tx, sales, cats, items)
    const r = monthRange(m)
    const a = from > r.from ? from : r.from
    const b = to < r.to ? to : r.to
    const share = (Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000) + 1) / r.days
    revenue += f.revenueMonthly * share
    fixed += f.fixedMonthly * share
    cogs += f.revenueMonthly * f.cogsPct * share
    for (const l of f.lines) {
      byCategory[l.cat.id] = (byCategory[l.cat.id] ?? 0) + l.value * share
      byGroup[l.cat.grp] += l.value * share
    }
  }
  byGroup.cogs = cogs
  return { revenue, fixed, cogsPct: revenue > 0 ? cogs / revenue : last.cogsPct, byCategory, byGroup, last }
}
