import { isDemo, sb } from '../../core/supabase'
import { loadTable, saveTable, uid } from '../../core/demo'
import type { NewOrder, Partner, PartnerAccount, PartnerKind, PayOrder } from './logic'

const T_PARTNER = 'pay_partners'
const T_ACCOUNT = 'pay_accounts'
const T_ORDER = 'pay_orders'

async function all<T>(table: string, order: string): Promise<T[]> {
  const out: T[] = []
  for (let page = 0; ; page++) {
    const { data, error } = await sb().from(table).select('*').order(order).range(page * 1000, page * 1000 + 999)
    if (error) throw error
    out.push(...(data as T[]))
    if ((data?.length ?? 0) < 1000) break
  }
  return out
}

export async function listPartners(): Promise<Partner[]> {
  if (isDemo) return loadTable<Partner>('pay_partners', () => [])
  return all<Partner>(T_PARTNER, 'name')
}
export async function listAccounts(): Promise<PartnerAccount[]> {
  if (isDemo) return loadTable<PartnerAccount>('pay_accounts', () => [])
  return all<PartnerAccount>(T_ACCOUNT, 'account_no')
}
export async function listOrders(): Promise<PayOrder[]> {
  if (isDemo) return loadTable<PayOrder>('pay_orders', () => [])
  return all<PayOrder>(T_ORDER, 'created_at')
}

export interface PartnerInput {
  id?: string
  name: string
  kind: PartnerKind
  sub_kind: string
  note: string
  accounts: { account_no: string; seen_name: string }[]
}

/** Thêm hoặc sửa đối tác, ghi lại danh sách số tài khoản của đối tác đó (số tài khoản đã thuộc đối tác khác sẽ được chuyển sang) */
export async function savePartner(p: PartnerInput): Promise<string> {
  const base = { name: p.name.trim(), kind: p.kind, sub_kind: p.kind === 'operating' ? p.sub_kind : '', note: p.note }
  const accNos = p.accounts.map((a) => a.account_no.trim()).filter(Boolean)
  if (isDemo) {
    const partners = loadTable<Partner>('pay_partners', () => [])
    const id = p.id ?? uid()
    saveTable('pay_partners', p.id ? partners.map((x) => (x.id === id ? { ...x, ...base } : x)) : [...partners, { id, ...base }])
    const keep = loadTable<PartnerAccount>('pay_accounts', () => []).filter((a) => a.partner_id !== id && !accNos.includes(a.account_no))
    saveTable('pay_accounts', [...keep, ...p.accounts.filter((a) => a.account_no.trim()).map((a) => ({ account_no: a.account_no.trim(), partner_id: id, seen_name: a.seen_name }))])
    return id
  }
  let id = p.id
  if (id) {
    const { error } = await sb().from(T_PARTNER).update(base).eq('id', id)
    if (error) throw error
  } else {
    const { data, error } = await sb().from(T_PARTNER).insert(base).select('id').single()
    if (error) throw error
    id = (data as { id: string }).id
  }
  const cur = await sb().from(T_ACCOUNT).select('account_no').eq('partner_id', id)
  if (cur.error) throw cur.error
  const drop = (cur.data ?? []).map((r: { account_no: string }) => r.account_no).filter((n) => !accNos.includes(n))
  if (drop.length) {
    const { error } = await sb().from(T_ACCOUNT).delete().in('account_no', drop)
    if (error) throw error
  }
  if (accNos.length) {
    const rows = p.accounts.filter((a) => a.account_no.trim()).map((a) => ({ account_no: a.account_no.trim(), partner_id: id, seen_name: a.seen_name }))
    const { error } = await sb().from(T_ACCOUNT).upsert(rows, { onConflict: 'account_no' })
    if (error) throw error
  }
  return id as string
}

export async function deletePartner(id: string): Promise<void> {
  if (isDemo) {
    saveTable('pay_partners', loadTable<Partner>('pay_partners', () => []).filter((x) => x.id !== id))
    saveTable('pay_accounts', loadTable<PartnerAccount>('pay_accounts', () => []).filter((x) => x.partner_id !== id))
    return
  }
  const { error } = await sb().from(T_PARTNER).delete().eq('id', id)
  if (error) throw error
}

/** Thêm lệnh nợ; lệnh đã có (cùng mã lệnh) được bỏ qua. Trả về số lệnh mới */
export async function addOrders(rows: NewOrder[]): Promise<number> {
  if (isDemo) {
    const cur = loadTable<PayOrder>('pay_orders', () => [])
    const have = new Set(cur.map((o) => o.order_no).filter(Boolean))
    const fresh = rows.filter((r) => !r.order_no || !have.has(r.order_no))
    saveTable('pay_orders', [...cur, ...fresh.map((r) => ({ ...r, id: uid(), status: 'pending' as const, paid_date: null, paid_tx_id: null }))])
    return fresh.length
  }
  const withNo = rows.filter((r) => r.order_no)
  const noNo = rows.filter((r) => !r.order_no)
  let added = 0
  for (let i = 0; i < withNo.length; i += 200) {
    const { data, error } = await sb().from(T_ORDER).upsert(withNo.slice(i, i + 200), { onConflict: 'order_no', ignoreDuplicates: true }).select('id')
    if (error) throw error
    added += data?.length ?? 0
  }
  if (noNo.length) {
    const { data, error } = await sb().from(T_ORDER).insert(noNo).select('id')
    if (error) throw error
    added += data?.length ?? 0
  }
  return added
}

export async function updateOrder(id: string, patch: Partial<PayOrder>): Promise<void> {
  if (isDemo) {
    saveTable('pay_orders', loadTable<PayOrder>('pay_orders', () => []).map((o) => (o.id === id ? { ...o, ...patch } : o)))
    return
  }
  const { error } = await sb().from(T_ORDER).update(patch).eq('id', id)
  if (error) throw error
}

export async function deleteOrder(id: string): Promise<void> {
  if (isDemo) {
    saveTable('pay_orders', loadTable<PayOrder>('pay_orders', () => []).filter((o) => o.id !== id))
    return
  }
  const { error } = await sb().from(T_ORDER).delete().eq('id', id)
  if (error) throw error
}

/** Đánh dấu nhiều lệnh đã chi, gắn với khoản chi tương ứng trong Sổ thu chi */
export async function markPaid(items: { id: string; tx_id: string; date: string }[]): Promise<void> {
  for (const it of items) await updateOrder(it.id, { status: 'paid', paid_date: it.date, paid_tx_id: it.tx_id })
}
