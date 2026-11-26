import type { Tx } from '../finance/types'

export type OrderStatus = 'pending' | 'paid' | 'cancelled'
export type PartnerKind = 'supplier' | 'operating'

export interface Partner {
  id: string
  name: string
  kind: PartnerKind
  sub_kind: string
  note: string
}
export interface PartnerAccount {
  account_no: string
  partner_id: string
  seen_name: string
}
export interface PayOrder {
  id: string
  order_no: string | null
  account_no: string
  supplier_raw: string
  invoice_no: string
  invoice_date: string | null
  amount: number
  order_date: string | null
  status: OrderStatus
  paid_date: string | null
  paid_tx_id: string | null
  note: string
}
export type NewOrder = Omit<PayOrder, 'id' | 'status' | 'paid_date' | 'paid_tx_id'>

export const KIND_LABEL: Record<PartnerKind, string> = { supplier: 'Nhà cung cấp hàng hóa', operating: 'Chi phí vận hành' }
export const OP_GROUPS = ['Nhân sự', 'Mặt bằng', 'Vận chuyển', 'Khác']

/** Bỏ dấu, viết hoa, gọn khoảng trắng: dùng để so khớp nội dung ngân hàng */
export const plain = (s: unknown) =>
  String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').replace(/\s+/g, ' ').trim().toUpperCase()

const pad = (n: number | string) => String(n).padStart(2, '0')

/** Lấy ngày cuối cùng trong chuỗi như "22-29.09.2026", "01.10.2026", "13082026", "22/10_03/11/2026" */
function lastDate(token: string): string | null {
  const t = token.replace(/[^\d./_-]/g, '')
  const m = t.match(/(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/)
  if (m) return `${m[3]}-${pad(m[2])}-${pad(m[1])}`
  const c = t.match(/(\d{2})(\d{2})(\d{4})$/)
  return c ? `${c[3]}-${c[2]}-${c[1]}` : null
}

const ID_RE = /\b\d{7}[A-Z]\d{8}\b/g

/**
 * Đọc nội dung dán từ trang "Danh sách điện chờ duyệt" của eFAST.
 * Mỗi lệnh bắt đầu bằng mã lệnh (vd 1031926P03376011); các thông tin còn lại tìm trong đoạn đến mã lệnh kế tiếp.
 */
export function parseEfast(input: string): NewOrder[] {
  const text = plain(input.replace(/[\t\r]+/g, ' ').replace(/\n+/g, ' '))
  const ids = [...text.matchAll(ID_RE)]
  const out: NewOrder[] = []
  const seen = new Set<string>()
  ids.forEach((m, i) => {
    const order_no = m[0]
    if (seen.has(order_no)) return
    const chunk = text.slice((m.index ?? 0) + order_no.length, i + 1 < ids.length ? ids[i + 1].index : undefined)
    const amt = chunk.match(/([\d.,]+)\s*VND/)
    const acc = chunk.match(/SO TAI KHOAN:\s*([A-Z0-9]+)/)
    if (!amt || !acc) return
    const amount = Number(amt[1].replace(/\D/g, ''))
    if (!amount) return
    const head = chunk.slice(0, chunk.indexOf('SO TAI KHOAN:'))
    // tên người nhận = phần sau tên người chuyển ("CONG TY TNHH MEM NGON")
    const supplier_raw = head.replace(/^[\s\S]*?MEM NGON\s*/, '').trim() || head.trim()
    const content = (chunk.match(/NOI DUNG:\s*([\s\S]*?)\s*[\d.,]+\s*VND/) ?? [])[1] ?? ''
    const hd = content.match(/THEO\s+HD\s+(?:SO:?\s*)?(\S+)/)
    const ddh = content.match(/THEO\s+DDH\s+(?:TU\s+)?NGAY\s+(\S+)/)
    const invoice_no = hd ? hd[1].replace(/[;,]+$/, '') : ddh ? `DDH ${ddh[1].replace(/[;,]+$/, '')}` : ''
    const dm = content.match(/\sNGAY\s+(\S+)/)
    const invoice_date = hd && dm ? lastDate(dm[1]) : ddh ? lastDate(ddh[1]) : dm ? lastDate(dm[1]) : null
    const dates = [...chunk.matchAll(/(\d{2})-(\d{2})-(\d{4})\s+\d{2}:\d{2}:\d{2}/g)]
    const last = dates[dates.length - 1]
    seen.add(order_no)
    out.push({
      order_no, account_no: acc[1], supplier_raw, invoice_no, invoice_date, amount,
      order_date: last ? `${last[3]}-${last[2]}-${last[1]}` : null,
      note: content.slice(0, 300),
    })
  })
  return out
}

/** Số hóa đơn dùng để dò trong nội dung sao kê (bỏ tiền tố ĐĐH) */
const refToken = (o: Pick<PayOrder, 'invoice_no'>) => o.invoice_no.replace(/^DDH\s+/, '').trim()

/**
 * Tìm khoản đã chi trong sổ thu chi cho các lệnh còn nợ: cùng số tiền, ngày chi từ ngày tạo lệnh trở đi,
 * và (cùng số tài khoản đối ứng hoặc nội dung ghi cùng số hóa đơn). Mỗi khoản chi chỉ khớp một lệnh.
 */
export function matchPaid(orders: PayOrder[], txs: Tx[]): Map<string, Tx> {
  const res = new Map<string, Tx>()
  const used = new Set<string>()
  const cand = txs.filter((t) => t.type === 'expense')
  const pending = orders.filter((o) => o.status === 'pending')
  // Lệnh có số hóa đơn trước (chắc chắn hơn), lệnh không có số hóa đơn sau
  for (const withRef of [true, false]) {
    for (const o of pending) {
      const ref = refToken(o)
      if (res.has(o.id) || (withRef !== !!ref)) continue
      const found = cand.find((t) => {
        if (used.has(t.id) || t.amount !== o.amount) return false
        if (o.order_date && t.tx_date < o.order_date) return false
        const note = plain(t.note)
        const sameAcct = !!t.counterparty_account && t.counterparty_account === o.account_no
        if (ref) return note.includes(ref) && (sameAcct || !t.counterparty_account)
        return sameAcct
      })
      if (found) {
        // Lệnh không có số hóa đơn: chỉ nhận khi không có lệnh nợ nào khác cùng tài khoản và số tiền
        if (!ref && pending.filter((p) => p.account_no === o.account_no && p.amount === o.amount).length > 1) continue
        res.set(o.id, found)
        used.add(found.id)
      }
    }
  }
  return res
}

/** Đoán loại đối tác từ nội dung các lệnh (lương, thuê nhà, vận chuyển -> chi phí vận hành) */
export function guessKind(notes: string[]): { kind: PartnerKind; sub: string } {
  const t = plain(notes.join(' '))
  if (/LUONG/.test(t)) return { kind: 'operating', sub: 'Nhân sự' }
  if (/TIEN THUE (NHA|MAT BANG)|CHI PHI THUE NHA|THUE NHA/.test(t)) return { kind: 'operating', sub: 'Mặt bằng' }
  if (/THUE LAI XE|VAN CHUYEN|VANCHUYEN/.test(t)) return { kind: 'operating', sub: 'Vận chuyển' }
  return { kind: 'supplier', sub: '' }
}

/** Tuổi nợ tính từ ngày tạo lệnh (hoặc ngày hóa đơn nếu thiếu) */
export function ageDays(o: Pick<PayOrder, 'order_date' | 'invoice_date'>, todayIso: string): number {
  const d = o.order_date ?? o.invoice_date
  if (!d) return 0
  return Math.max(0, Math.round((new Date(todayIso).getTime() - new Date(d).getTime()) / 86_400_000))
}
