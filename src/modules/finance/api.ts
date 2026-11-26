import { isDemo, sb } from '../../core/supabase'
import { DEMO_BRANCHES, DEMO_USER_ID, loadTable, rng, saveTable, uid } from '../../core/demo'
import { addDays, today } from '../../core/format'
import { DEDUCTION_CATEGORY, DEDUCTION_LABEL, type Actual, type Category, type Channel, type Deduction, type ForecastItem, type Holiday, type NewTx, type Payment, type Sale, type Tx } from './types'

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

/** Xóa doanh thu + phương thức thanh toán của 1 chi nhánh trong 1 ngày (để nhập lại cho đúng). */
export async function deleteSalesDay(branchId: string, date: string): Promise<void> {
  if (isDemo) {
    saveTable('fin_daily_sales', demoSales().filter((s) => !(s.branch_id === branchId && s.sale_date === date)))
    saveTable('fin_daily_payments', loadTable<Payment>('fin_daily_payments', () => []).filter((p) => !(p.branch_id === branchId && p.pay_date === date)))
    saveTable('fin_daily_channels', loadTable<Channel>('fin_daily_channels', () => []).filter((c) => !(c.branch_id === branchId && c.sale_date === date)))
    return
  }
  const a = await sb().from('fin_daily_sales').delete().eq('branch_id', branchId).eq('sale_date', date)
  if (a.error) throw a.error
  const b = await sb().from('fin_daily_payments').delete().eq('branch_id', branchId).eq('pay_date', date)
  if (b.error) throw b.error
  const c = await sb().from('fin_daily_channels').delete().eq('branch_id', branchId).eq('sale_date', date)
  if (c.error) throw c.error
}

/** Xóa các khoản thu chi do NHẬP FILE tạo (không đụng khoản nhập tay) của 1 chi nhánh trong khoảng ngày, cùng hình thức (tiền mặt hoặc chuyển khoản). */
export async function deleteImportedTx(branchId: string, from: string, to: string, method: string): Promise<number> {
  if (isDemo) {
    const cur = demoTx()
    const keep = cur.filter((t) => !(t.branch_id === branchId && t.source === 'import' && t.method === method && t.tx_date >= from && t.tx_date <= to))
    saveTable('fin_transactions', keep)
    return cur.length - keep.length
  }
  const { data, error } = await sb().from('fin_transactions').delete()
    .eq('branch_id', branchId).eq('source', 'import').eq('method', method).gte('tx_date', from).lte('tx_date', to).select('id')
  if (error) throw error
  return data?.length ?? 0
}

/* ======================= Doanh thu theo nguồn đơn (B03) ======================= */
export async function listChannels(branchId: string, from: string, to: string): Promise<Channel[]> {
  if (isDemo) return loadTable<Channel>('fin_daily_channels', () => []).filter((c) => (!branchId || c.branch_id === branchId) && c.sale_date >= from && c.sale_date <= to)
  const out: Channel[] = []
  for (let page = 0; ; page++) {
    const { data, error } = await branchFilter(sb().from('fin_daily_channels').select('*').gte('sale_date', from).lte('sale_date', to), branchId)
      .order('sale_date').range(page * 1000, page * 1000 + 999)
    if (error) throw error
    out.push(...(data as Channel[]))
    if ((data?.length ?? 0) < 1000) break
  }
  return out
}

export async function upsertChannels(rows: Channel[]): Promise<number> {
  if (isDemo) {
    const map = new Map(loadTable<Channel>('fin_daily_channels', () => []).map((c) => [`${c.branch_id}|${c.sale_date}|${c.channel}`, c]))
    rows.forEach((r) => map.set(`${r.branch_id}|${r.sale_date}|${r.channel}`, r))
    saveTable('fin_daily_channels', [...map.values()])
    return rows.length
  }
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await sb().from('fin_daily_channels').upsert(rows.slice(i, i + 500).map((r) => ({ ...r, source: 'import' })), { onConflict: 'branch_id,sale_date,channel' })
    if (error) throw error
  }
  return rows.length
}

/* ======================= Doanh thu theo phương thức thanh toán ======================= */
export async function listPayments(branchId: string, from: string, to: string): Promise<Payment[]> {
  if (isDemo) return loadTable<Payment>('fin_daily_payments', () => []).filter((p) => (!branchId || p.branch_id === branchId) && p.pay_date >= from && p.pay_date <= to)
  const out: Payment[] = []
  for (let page = 0; ; page++) {
    const { data, error } = await branchFilter(sb().from('fin_daily_payments').select('*').gte('pay_date', from).lte('pay_date', to), branchId)
      .order('pay_date').range(page * 1000, page * 1000 + 999)
    if (error) throw error
    out.push(...(data as Payment[]))
    if ((data?.length ?? 0) < 1000) break
  }
  return out
}

export async function upsertPayments(rows: Payment[]): Promise<number> {
  if (isDemo) {
    const map = new Map(loadTable<Payment>('fin_daily_payments', () => []).map((p) => [`${p.branch_id}|${p.pay_date}|${p.method}`, p]))
    rows.forEach((r) => map.set(`${r.branch_id}|${r.pay_date}|${r.method}`, r))
    saveTable('fin_daily_payments', [...map.values()])
    return rows.length
  }
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await sb().from('fin_daily_payments').upsert(rows.slice(i, i + 500).map((r) => ({ ...r, source: 'import' })), { onConflict: 'branch_id,pay_date,method' })
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

/* ======================= Đối soát: số thực nhận cửa hàng khai ======================= */
export async function listActuals(branchId: string, from: string, to: string): Promise<Actual[]> {
  if (isDemo) return loadTable<Actual>('fin_recon_actuals', () => []).filter((a) => (!branchId || a.branch_id === branchId) && a.date_from >= from && a.date_to <= to)
  const { data, error } = await branchFilter(sb().from('fin_recon_actuals').select('*').gte('date_from', from).lte('date_to', to), branchId)
    .order('date_from', { ascending: false })
  if (error) throw error
  return (data as Actual[]).map((a) => ({ ...a, amount: Number(a.amount), recovery: Number(a.recovery) }))
}

export async function saveActual(a: Omit<Actual, 'id'> & { id?: string }): Promise<void> {
  if (isDemo) {
    const rows = loadTable<Actual>('fin_recon_actuals', () => [])
    const dup = rows.find((r) => r.id === a.id) ?? rows.find((r) => r.branch_id === a.branch_id && r.source === a.source && r.date_from === a.date_from && r.date_to === a.date_to)
    if (dup) saveTable('fin_recon_actuals', rows.map((r) => (r.id === dup.id ? { ...r, ...a, id: dup.id } : r)))
    else saveTable('fin_recon_actuals', [...rows, { ...a, id: uid() }])
    return
  }
  const body = {
    branch_id: a.branch_id, source: a.source, date_from: a.date_from, date_to: a.date_to, amount: a.amount, photo_path: a.photo_path,
    explain: a.explain, explain_status: a.explain_status, recovery: a.recovery, recovery_status: a.recovery_status,
  }
  const { error } = await sb().from('fin_recon_actuals').upsert(body, { onConflict: 'branch_id,source,date_from,date_to' })
  if (error) throw error
}

/** Nhập hàng loạt số thực nhận (ghi đè dòng trùng cửa hàng + nguồn + ngày). */
export async function saveActuals(rows: Omit<Actual, 'id'>[]): Promise<number> {
  if (isDemo) {
    const cur = loadTable<Actual>('fin_recon_actuals', () => [])
    const key = (a: Omit<Actual, 'id'>) => `${a.branch_id}|${a.source}|${a.date_from}|${a.date_to}`
    const map = new Map(cur.map((a) => [key(a), a]))
    rows.forEach((r) => map.set(key(r), { ...r, id: map.get(key(r))?.id ?? uid() }))
    saveTable('fin_recon_actuals', [...map.values()])
    return rows.length
  }
  for (let i = 0; i < rows.length; i += 500) {
    const body = rows.slice(i, i + 500).map((a) => ({
      branch_id: a.branch_id, source: a.source, date_from: a.date_from, date_to: a.date_to, amount: a.amount, photo_path: a.photo_path,
      explain: a.explain, explain_status: a.explain_status, recovery: a.recovery, recovery_status: a.recovery_status,
    }))
    const { error } = await sb().from('fin_recon_actuals').upsert(body, { onConflict: 'branch_id,source,date_from,date_to' })
    if (error) throw error
  }
  return rows.length
}

export async function deleteActual(id: string): Promise<void> {
  if (isDemo) return saveTable('fin_recon_actuals', loadTable<Actual>('fin_recon_actuals', () => []).filter((a) => a.id !== id))
  const { error } = await sb().from('fin_recon_actuals').delete().eq('id', id)
  if (error) throw error
}

/* ======================= Đối soát: khoản bị trừ (tự sinh chi phí) ======================= */
export async function listDeductions(branchId: string, from: string, to: string): Promise<Deduction[]> {
  if (isDemo) return loadTable<Deduction>('fin_recon_deductions', () => []).filter((d) => (!branchId || d.branch_id === branchId) && d.date_from >= from && d.date_to <= to)
  const { data, error } = await branchFilter(sb().from('fin_recon_deductions').select('*').gte('date_from', from).lte('date_to', to), branchId)
    .order('date_from', { ascending: false })
  if (error) throw error
  return (data as Deduction[]).map((d) => ({ ...d, amount: Number(d.amount) }))
}

async function ensureCategoryId(name: string): Promise<string | null> {
  let cats = await listCategories()
  let c = cats.find((x) => x.name === name)
  if (!c) {
    try { await saveCategory({ name, type: 'expense', grp: 'other' }) } catch { return null }
    cats = await listCategories()
    c = cats.find((x) => x.name === name)
  }
  return c?.id ?? null
}

/** Lưu khoản bị trừ và đồng bộ 1 dòng chi phí tương ứng ở Thu chi (khóa recon|<id>, sửa thì cập nhật, không nhân đôi). */
export async function saveDeduction(d: Omit<Deduction, 'id'> & { id?: string }): Promise<void> {
  const id = d.id ?? uid()
  const catId = await ensureCategoryId(DEDUCTION_CATEGORY[d.kind])
  const tx: NewTx = {
    branch_id: d.branch_id, tx_date: d.date_to, type: 'expense', category_id: catId, amount: d.amount, method: 'transfer',
    note: `${DEDUCTION_LABEL[d.kind]}${d.note ? ': ' + d.note : ''} (tự động từ Đối soát)`, receipt_path: null, source: 'manual', external_key: `recon|${id}`,
  }
  if (isDemo) {
    const rows = loadTable<Deduction>('fin_recon_deductions', () => [])
    const next = { ...d, id }
    saveTable('fin_recon_deductions', rows.some((r) => r.id === id) ? rows.map((r) => (r.id === id ? next : r)) : [...rows, next])
    const all = demoTx().filter((t) => !(t.external_key === tx.external_key))
    saveTable('fin_transactions', [{ ...tx, id: uid(), created_by: DEMO_USER_ID }, ...all])
    return
  }
  const a = await sb().from('fin_recon_deductions').upsert({ id, branch_id: d.branch_id, date_from: d.date_from, date_to: d.date_to, kind: d.kind, source: d.source, amount: d.amount, note: d.note })
  if (a.error) throw a.error
  const b = await sb().from('fin_transactions').upsert(tx, { onConflict: 'branch_id,external_key' })
  if (b.error) throw b.error
}

export async function deleteDeduction(d: Deduction): Promise<void> {
  if (isDemo) {
    saveTable('fin_recon_deductions', loadTable<Deduction>('fin_recon_deductions', () => []).filter((r) => r.id !== d.id))
    saveTable('fin_transactions', demoTx().filter((t) => t.external_key !== `recon|${d.id}`))
    return
  }
  const a = await sb().from('fin_transactions').delete().eq('branch_id', d.branch_id).eq('external_key', `recon|${d.id}`)
  if (a.error) throw a.error
  const b = await sb().from('fin_recon_deductions').delete().eq('id', d.id)
  if (b.error) throw b.error
}

/* ======================= Ngày nghỉ lễ ======================= */
export async function listHolidays(): Promise<Holiday[]> {
  if (isDemo) return loadTable<Holiday>('fin_holidays', () => [])
  const { data, error } = await sb().from('fin_holidays').select('*').order('hdate', { ascending: false })
  if (error) throw error
  return data as Holiday[]
}
export async function saveHoliday(h: Holiday): Promise<void> {
  if (isDemo) {
    const rows = loadTable<Holiday>('fin_holidays', () => []).filter((r) => !(r.hdate === h.hdate && r.platform === h.platform))
    return saveTable('fin_holidays', [...rows, h])
  }
  const { error } = await sb().from('fin_holidays').upsert(h, { onConflict: 'hdate,platform' })
  if (error) throw error
}
export async function deleteHoliday(h: Holiday): Promise<void> {
  if (isDemo) return saveTable('fin_holidays', loadTable<Holiday>('fin_holidays', () => []).filter((r) => !(r.hdate === h.hdate && r.platform === h.platform)))
  const { error } = await sb().from('fin_holidays').delete().eq('hdate', h.hdate).eq('platform', h.platform)
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
  const [pays, chans] = await Promise.all([listPayments('', from, to), listChannels('', from, to)])
  const [acts, deds] = await Promise.all([listActuals('', from, to), listDeductions('', from, to)])
  return { fin_categories: cats, fin_transactions: tx, fin_daily_sales: sales, fin_forecast_items: fc, fin_daily_payments: pays, fin_daily_channels: chans, fin_recon_actuals: acts, fin_recon_deductions: deds }
}
