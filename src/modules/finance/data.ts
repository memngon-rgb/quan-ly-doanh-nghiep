import { useAuth } from '../../core/auth'
import { monthRange, shiftMonth } from '../../core/format'
import type { Range } from '../../core/DateRange'
import { useAsync } from '../../core/ui'
import { listCategories, listForecast, listSales, listTx } from './api'

/** Tải dữ liệu 3 tháng trước + tháng đang xem để tính dự tính và báo cáo. */
export function useMonthData(month: string) {
  const { branchId } = useAuth()
  const from = monthRange(shiftMonth(month, -3)).from
  const to = monthRange(month).to
  return useAsync(async () => {
    const [cats, tx, sales, items] = await Promise.all([
      listCategories(),
      listTx(branchId, from, to),
      listSales(branchId, from, to),
      // chỉnh tay dự tính gắn với 1 chi nhánh cụ thể, xem "tất cả" thì dùng số tự tính
      branchId ? listForecast(branchId) : Promise.resolve([]),
    ])
    return { cats, tx, sales, items }
  }, [branchId, month])
}

/** Tải dữ liệu của khoảng ngày đang xem, cộng 3 tháng trước ngày bắt đầu để tính dự tính. */
export function useRangeData(range: Range) {
  const { branchId } = useAuth()
  const from = monthRange(shiftMonth(range.from.slice(0, 7), -3)).from
  return useAsync(async () => {
    const [cats, tx, sales, items] = await Promise.all([
      listCategories(),
      listTx(branchId, from, range.to),
      listSales(branchId, from, range.to),
      branchId ? listForecast(branchId) : Promise.resolve([]),
    ])
    return { cats, tx, sales, items }
  }, [branchId, from, range.to])
}
