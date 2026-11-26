export type TxType = 'income' | 'expense'
export type Method = 'cash' | 'transfer' | 'company_order'
export type Group = 'revenue' | 'cogs' | 'payroll' | 'fixed' | 'other'

export const METHOD_LABEL: Record<Method, string> = {
  cash: 'Tiền mặt',
  transfer: 'Chuyển khoản',
  company_order: 'Lệnh chi công ty',
}
export const GROUP_LABEL: Record<Group, string> = {
  revenue: 'Thu từ bán hàng',
  cogs: 'Giá vốn / nguyên vật liệu',
  payroll: 'Lương nhân sự',
  fixed: 'Chi phí cố định',
  other: 'Chi phí khác',
}

export interface Category {
  id: string
  name: string
  type: TxType
  grp: Group
  sort: number
  is_active: boolean
}

export interface Tx {
  id: string
  branch_id: string
  tx_date: string
  type: TxType
  category_id: string | null
  amount: number
  method: Method
  note: string
  receipt_path: string | null
  source: 'manual' | 'import'
  external_key: string | null
  created_by: string
}

export type NewTx = Omit<Tx, 'id' | 'created_by'>

export interface Sale {
  branch_id: string
  sale_date: string
  revenue: number
  orders: number
}

export interface ForecastItem {
  id?: string
  branch_id: string
  category_id: string | null
  kind: 'monthly' | 'cogs_pct'
  value: number
}
