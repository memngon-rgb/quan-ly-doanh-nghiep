import { isDemo, sb } from '../../core/supabase'
import { DEMO_BRANCHES, DEMO_USER_ID, loadTable, rng, saveTable, uid } from '../../core/demo'
import { addDays, today } from '../../core/format'
import type { Category, ForecastItem, NewTx, Sale, Tx } from './types'

/** Lấy danh sách chi nhánh cần truy vấn: '' = tất cả (RLS tự lọc theo quyền) */
const branchFilter = <T extends { eq: (c: string, v: string) => T }>(q: T, branchId: string): T =>
  branchId ? q.eq('branch_id', branchId) : q

/* ======================= DỮ LIỆU MINH HỌA (chỉ khi chưa có Supabase) ======================= */
const DEMO_CATS: Category[] = [
  ['Thu tiền mặt cửa hàng', 'income', 'revenue'], ['Thu khác', 'income', 'other'],
  ['Nguyên vật liệu', 'expense', 'cogs'], ['Đi chợ hằng ngày', 'expense', 'cogs'],
  ['Lương nhân viên', 'expense', 'payroll'], ['Thuê mặt bằng', 'expense', 'fixed'],
  ['Điện', 'expense', 'fixed'], ['Nước', 'expense', 'fixed'], ['Internet, phần mềm', 'expense', 'fixed'],
  ['Marketing', 'expense', 'other'], ['Sửa chữa, bảo trì', 'expense', 'other'], ['Chi khác', 'expense', 'other'],
].map(([name, type, grp], i) => ({ id: `demo-c${i}`, name, type, grp, sort: i, is_active: true }) as Category)

function seedDemo(): { tx: Tx[]; sales: Sale[] } {
  const r = rng(42)
  const tx: Tx[] = []
  const sales: Sale[] = []
  const cat = (n: string) => DEMO_CATS.find((c) => c.name === n)!.id
  for (const [bi, b] of DEMO_BRANCHES.entries()) {
    for (let i = 120; i >= 0; i--) {
      const d = addDays(today(), -i)
      const dow = new Date(d).getDay()
      const base = (bi === 0 ? 11_000_000 : 8_000_000) * (dow === 0 || dow === 6 ? 1.25 : 1)
      const revenue = Math.round((base * (0.8 + r() * 0.4)) / 1000) * 1000
      sales.push({ branch_id: b.id, sale_date: d, revenue, orders: Math.round(revenue / 85000) })
      const add = (category: string, amount: number, note: string, type: 'income' | 'expense' = 'expense') =>
        tx.push({
          id: uid(), branch_id: b.id, tx_date: d, type, category_id: cat(category), amount: Math.round(amount / 1000) * 1000,
          method: 'cash', note, receipt_path: null, source: 'manual', external_key: null, created_by: DEMO_USER_ID,
        })
      add('Đi chợ hằng ngày', revenue * (0.2 + r() * 0.08), 'Đi chợ sáng')
      if (r() > 0.55) add('Nguyên vật liệu', revenue * (0.05 + r() * 0.06), 'Nhập hàng bổ sung')
      if (r() > 0.85) add('Chi khác', 50_000 + r() * 250_000, 'Chi lặt vặt')
      add('Thu tiền mặt cửa hàng', revenue * 0.35, 'Thu tiền mặt cuối ngày', 'income')
      if (d.endsWith('-01')) {
        add('Thuê mặt bằng', 18_000_000, 'Tiền thuê tháng')
        add('Lương nhân viên', bi === 0 ? 42_000_000 : 30_000_000, 'Lương tháng')
      }
      if (d.endsWith('-05')) {
        add('Điện', 3_500_000 + r() * 800_000, 'Tiền điện')
        add('Nước', 650_000 + r() * 150_000, 'Tiền nước')
        add('Internet, phần mềm', 1_200_000, 'Internet và phần mềm')
      }
    }
  }
  return { tx, sales }
}
function demoTx(): Tx[] {
  return loadTable<Tx>('fin_transactions', () => {
    const s = seedDemo()
    saveTable('fin_daily_sales', s.sales)
    return s.tx
  })
}
function demoSales(): Sale[] {
  demoTx() // bảo đảm đã tạo dữ liệu mẫu
  return loadTable<Sale>('fin_daily_sales', () => [])
}

/* ======================= Danh mục ======================= */
export async function listCategories(): Promise<Category[]> {
  if (isDemo) return loadTable<Category>('fin_categories', () => DEMO_CATS)
  const { data, error } = await sb().from('fin_categories').select('*').order('sort').order('name')
  if (error) throw error
  return data as Category[]
}

export async function saveCategory(c: Partial<Category> & { name: string; type: Category['type']; grp: Category['grp'] }): Promise<void> {
  if (isDemo) {
    const rows = loadTable<Category>('fin_categories', () => DEMO_CATS)
    if (c.id) saveTable('fin_categories', rows.map((r) => (r.id === c.id ? { ...r, ...c } : r)))
    else saveTable('fin_categories', [...rows, { id: uid(), sort: 100, is_active: true, ...c } as Category])
    return
  }
  const { error } = c.id
    ? await sb().from('fin_categories').update({ name: c.name, type: c.type, grp: c.grp, is_active: c.is_active }).eq('id', c.id)
    : await sb().from('fin_categories').insert({ name: c.name, type: c.type, grp: c.grp })
  if (error) throw error
}

/* ======================= Thu chi ======================= */
export async function listTx(branchId: string, from: string, to: string): Promise<Tx[]> {
  if (isDemo) {
    return demoTx()
      .filter((t) => (!branchId || t.branch_id === branchId) && t.tx_date >= from && t.tx_date <= to)
      .sort((a, b) => (a.tx_date < b.tx_date ? 1 : -1))
  }
  // phân trang để vượt giới hạn 1000 dòng mỗi lần của Supabase
  const out: Tx[] = []
  for (let page = 0; ; page++) {
    const q = branchFilter(sb().from('fin_transactions').select('*').gte('tx_date', from).lte('tx_date', to), branchId)
      .order('tx_date', { ascending: false }).order('created_at', { ascending: false })
      .range(page * 1000, page * 1000 + 999)
    const { data, error } = await q
    if (error) throw error
    out.push(...(data as Tx[]))
    if ((data?.length ?? 0) < 1000) break
  }
  return out
}

export async function addTx(t: NewTx): Promise<void> {
  if (isDemo) {
    saveTable('fin_transactions', [{ ...t, id: uid(), created_by: DEMO_USER_ID }, ...demoTx()])
    return
  }
  const { error } = await sb().from('fin_transactions').insert(t)
  if (error) throw error
}

export async function updateTx(id: string, t: Partial<NewTx>): Promise<void> {
  if (isDemo) {
    saveTable('fin_transactions', demoTx().map((r) => (r.id === id ? { ...r, ...t } : r)))
    return
  }
  const { error } = await sb().from('fin_transactions').update(t).eq('id', id)
  if (error) throw error
}

export async function deleteTx(id: string): Promise<void> {
  if (isDemo) {
    saveTable('fin_transactions', demoTx().filter((r) => r.id !== id))
    return
  }
  const { error } = await sb().from('fin_transactions').delete().eq('id', id)
  if (error) throw error
}

/** Nhập hàng loạt; dòng trùng external_key sẽ bị bỏ qua. Trả về số dòng thật sự thêm mới. */
export async function importTx(rows: NewTx[]): Promise<number> {
  if (isDemo) {
    const cur = demoTx()
    const seen = new Set(cur.filter((t) => t.external_key).map((t) => `${t.branch_id}|${t.external_key}`))
    const fresh = rows.filter((r) => !seen.has(`${r.branch_id}|${r.external_key}`))
    saveTable('fin_transactions', [...fresh.map((r) => ({ ...r, id: uid(), created_by: DEMO_USER_ID })), ...cur])
    return fresh.length
  }
  let added = 0
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500)
    const { data, error } = await sb()
      .from('fin_transactions')
      .upsert(chunk, { onConflict: 'branch_id,external_key', ignoreDuplicates: true })
      .select('id')
    if (error) throw error
    added += data?.length ?? 0
  }
  return added
}

/* ======================= Doanh thu theo ngày ======================= */
export async function listSales(branchId: string, from: string, to: string): Promise<Sale[]> {
  if (isDemo) return demoSales().filter((s) => (!branchId || s.branch_id === branchId) && s.sale_date >= from && s.sale_date <= to)
  const out: Sale[] = []
  for (let page = 0; ; page++) {
    const { data, error } = await branchFilter(sb().from('fin_daily_sales').select('*').gte('sale_date', from).lte('sale_date', to), branchId)
      .order('sale_date').range(page * 1000, page * 1000 + 999)
    if (error) throw error
    out.push(...(data as Sale[]))
    if ((data?.length ?? 0) < 1000) break
  }
  return out
}

export async function upsertSales(rows: Sale[]): Promise<number> {
  if (isDemo) {
    const map = new Map(demoSales().map((s) => [`${s.branch_id}|${s.sale_date}`, s]))
    rows.forEach((r) => map.set(`${r.branch_id}|${r.sale_date}`, r))
    saveTable('fin_daily_sales', [...map.values()])
    return rows.length
  }
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await sb().from('fin_daily_sales').upsert(rows.slice(i, i + 500).map((r) => ({ ...r, source: 'import' })), { onConflict: 'branch_id,sale_date' })
    if (error) throw error
  }
  return rows.length
}

/* ======================= Dự tính ======================= */
export async function listForecast(branchId: string): Promise<ForecastItem[]> {
  if (isDemo) return loadTable<ForecastItem>('fin_forecast_items', () => []).filter((f) => !branchId || f.branch_id === branchId)
  const base = sb().from('fin_forecast_items').select('*')
  const { data, error } = branchId ? await base.eq('branch_id', branchId) : await base
  if (error) throw error
  return ((data ?? []) as ForecastItem[]).map((d) => ({ ...d, value: Number(d.value) }))
}

export async function saveForecast(f: ForecastItem): Promise<void> {
  if (isDemo) {
    const rows = loadTable<ForecastItem>('fin_forecast_items', () => [])
    const rest = rows.filter((r) => !(r.branch_id === f.branch_id && r.kind === f.kind && r.category_id === f.category_id))
    saveTable('fin_forecast_items', [...rest, { ...f, id: uid() }])
    return
  }
  let q = sb().from('fin_forecast_items').delete().eq('branch_id', f.branch_id).eq('kind', f.kind)
  q = f.category_id ? q.eq('category_id', f.category_id) : q.is('category_id', null)
  const del = await q
  if (del.error) throw del.error
  const { error } = await sb().from('fin_forecast_items').insert({ branch_id: f.branch_id, category_id: f.category_id, kind: f.kind, value: f.value })
  if (error) throw error
}

export async function removeForecast(f: Pick<ForecastItem, 'branch_id' | 'category_id' | 'kind'>): Promise<void> {
  if (isDemo) {
    const rows = loadTable<ForecastItem>('fin_forecast_items', () => [])
    saveTable('fin_forecast_items', rows.filter((r) => !(r.branch_id === f.branch_id && r.kind === f.kind && r.category_id === f.category_id)))
    return
  }
  let q = sb().from('fin_forecast_items').delete().eq('branch_id', f.branch_id).eq('kind', f.kind)
  q = f.category_id ? q.eq('category_id', f.category_id) : q.is('category_id', null)
  const { error } = await q
  if (error) throw error
}

/* ======================= Ảnh chứng từ ======================= */
export async function uploadReceipt(branchId: string, blob: Blob): Promise<string | null> {
  if (isDemo) return null
  const path = `${branchId}/${uid()}.jpg`
  const { error } = await sb().storage.from('fin-receipts').upload(path, blob, { contentType: 'image/jpeg' })
  if (error) throw error
  return path
}

export async function receiptUrl(path: string): Promise<string> {
  const { data, error } = await sb().storage.from('fin-receipts').createSignedUrl(path, 120)
  if (error) throw error
  return data.signedUrl
}

/* ======================= Sao lưu ======================= */
export async function backupAll(): Promise<Record<string, unknown[]>> {
  const from = '2000-01-01'
  const to = '2999-12-31'
  const [cats, tx, sales, fc] = await Promise.all([listCategories(), listTx('', from, to), listSales('', from, to), listForecast('')])
  return { fin_categories: cats, fin_transactions: tx, fin_daily_sales: sales, fin_forecast_items: fc }
}
