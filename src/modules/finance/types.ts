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

export interface Payment {
  branch_id: string
  pay_date: string
  method: string
  orders: number
  amount: number
}

export interface Sale {
  branch_id: string
  sale_date: string
  revenue: number // doanh thu Net như trên iPOS
  vat?: number // thuế VAT đầu ra (đã nằm trong doanh thu Net)
  orders: number
  // Các cột còn lại của báo cáo iPOS A02 (để phân tích sau này)
  guests?: number
  gross?: number
  discount?: number
  merchant_discount?: number
  marketing_fee?: number
  voucher?: number
  withholding_tax?: number
  vat_discount?: number
  commission?: number
}

/** Doanh thu theo nguồn đơn (báo cáo iPOS B03) */
export interface Channel {
  branch_id: string
  sale_date: string
  channel: string
  orders: number
  guests: number
  commission: number
  discount: number
  withholding_tax: number
  net: number
  gross: number
}

export interface ForecastItem {
  id?: string
  branch_id: string
  category_id: string | null
  kind: 'monthly' | 'cogs_pct'
  value: number
}

/** Số thực nhận do cửa hàng khai (kèm ảnh app), giải trình và truy thu */
export interface Actual {
  id: string
  branch_id: string
  source: string
  date_from: string
  date_to: string
  amount: number
  photo_path: string | null
  explain: string
  explain_status: 'none' | 'explained' | 'approved'
  recovery: number
  recovery_status: 'pending' | 'collected'
}

export type DeductionKind = 'ads' | 'grab_loan' | 'fee' | 'other'
export const DEDUCTION_LABEL: Record<DeductionKind, string> = {
  ads: 'Chạy quảng cáo',
  grab_loan: 'Trả vay Grab',
  fee: 'Phí nền tảng khác',
  other: 'Khoản khác',
}
export const DEDUCTION_CATEGORY: Record<DeductionKind, string> = {
  ads: 'Chạy quảng cáo nền tảng',
  grab_loan: 'Trả vay Grab',
  fee: 'Phí nền tảng khác',
  other: 'Khoản nền tảng trừ khác',
}

/** Khoản nền tảng tự trừ khi chuyển tiền về; tự sinh một dòng chi phí ở Thu chi */
export interface Deduction {
  id: string
  branch_id: string
  date_from: string
  date_to: string
  kind: DeductionKind
  source: string
  amount: number
  note: string
}

export interface Holiday {
  hdate: string
  platform: string
  note: string
}
