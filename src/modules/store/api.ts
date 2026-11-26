import { DEMO_USER_ID, loadTable, saveTable, uid } from '../../core/demo'
import { isDemo, sb } from '../../core/supabase'

export type ShiftKind = 'open' | 'close'
export type Shift = 'morning' | 'evening'

export interface ShiftReport {
  id: string; branch_id: string; report_date: string; shift: Shift; kind: ShiftKind
  sections: Record<string, string>; photos: string[]
  author: string | null; reviewed_by: string | null; reviewed_at: string | null; review_note: string
}
export interface AppReview {
  id: string; branch_id: string; review_date: string; channel: string
  no_new: boolean; good_count: number; bad_count: number; note: string; incident: string; photos: string[]
}
export interface Meter {
  id: string; branch_id: string; read_date: string
  electric: number | null; water: number | null; electric_photo: string | null; water_photo: string | null; note: string
}
export interface UtilityMonth { branch_id: string; month: string; kwh: number | null; m3: number | null; electric_cost: number | null; water_cost: number | null; note: string }

const branchEq = <T extends { eq: (c: string, v: string) => T }>(q: T, b: string): T => (b ? q.eq('branch_id', b) : q)

/* ---------- Ảnh ---------- */
export async function uploadPhoto(branchId: string, blob: Blob): Promise<string> {
  if (isDemo) return ''
  const path = `${branchId}/${uid()}.jpg`
  const { error } = await sb().storage.from('store-photos').upload(path, blob, { contentType: 'image/jpeg' })
  if (error) throw error
  return path
}
export async function photoUrl(path: string): Promise<string> {
  const { data, error } = await sb().storage.from('store-photos').createSignedUrl(path, 120)
  if (error) throw error
  return data.signedUrl
}

/* ---------- Báo cáo ca ---------- */
export async function listShiftReports(branchId: string, from: string, to: string): Promise<ShiftReport[]> {
  if (isDemo) return loadTable<ShiftReport>('store_shift_reports', () => []).filter((r) => (!branchId || r.branch_id === branchId) && r.report_date >= from && r.report_date <= to)
  const { data, error } = await branchEq(sb().from('store_shift_reports').select('*').gte('report_date', from).lte('report_date', to), branchId)
    .order('report_date', { ascending: false }).order('created_at', { ascending: false })
  if (error) throw error
  return data as ShiftReport[]
}
export async function saveShiftReport(r: Omit<ShiftReport, 'id' | 'author' | 'reviewed_by' | 'reviewed_at' | 'review_note'> & { id?: string }): Promise<void> {
  if (isDemo) {
    const rows = loadTable<ShiftReport>('store_shift_reports', () => [])
    const dup = rows.find((x) => x.branch_id === r.branch_id && x.report_date === r.report_date && x.shift === r.shift && x.kind === r.kind)
    if (dup) saveTable('store_shift_reports', rows.map((x) => (x.id === dup.id ? { ...x, ...r, id: dup.id } : x)))
    else saveTable('store_shift_reports', [{ ...r, id: uid(), author: DEMO_USER_ID, reviewed_by: null, reviewed_at: null, review_note: '' }, ...rows])
    return
  }
  const { error } = await sb().from('store_shift_reports').upsert(
    { branch_id: r.branch_id, report_date: r.report_date, shift: r.shift, kind: r.kind, sections: r.sections, photos: r.photos, updated_at: new Date().toISOString() },
    { onConflict: 'branch_id,report_date,shift,kind' },
  )
  if (error) throw error
}
export async function reviewShiftReport(id: string, note: string): Promise<void> {
  if (isDemo) {
    saveTable('store_shift_reports', loadTable<ShiftReport>('store_shift_reports', () => []).map((x) => (x.id === id ? { ...x, reviewed_by: DEMO_USER_ID, reviewed_at: new Date().toISOString(), review_note: note } : x)))
    return
  }
  const { data: u } = await sb().auth.getUser()
  const { error } = await sb().from('store_shift_reports').update({ reviewed_by: u.user?.id, reviewed_at: new Date().toISOString(), review_note: note }).eq('id', id)
  if (error) throw error
}

/* ---------- Đánh giá food app ---------- */
export async function listAppReviews(branchId: string, from: string, to: string): Promise<AppReview[]> {
  if (isDemo) return loadTable<AppReview>('store_app_reviews', () => []).filter((r) => (!branchId || r.branch_id === branchId) && r.review_date >= from && r.review_date <= to)
  const { data, error } = await branchEq(sb().from('store_app_reviews').select('*').gte('review_date', from).lte('review_date', to), branchId).order('review_date', { ascending: false })
  if (error) throw error
  return data as AppReview[]
}
export async function saveAppReviews(rows: Omit<AppReview, 'id'>[]): Promise<void> {
  if (isDemo) {
    const cur = loadTable<AppReview>('store_app_reviews', () => [])
    const key = (r: Omit<AppReview, 'id'>) => `${r.branch_id}|${r.review_date}|${r.channel}`
    const map = new Map(cur.map((r) => [key(r), r]))
    rows.forEach((r) => map.set(key(r), { ...r, id: map.get(key(r))?.id ?? uid() }))
    saveTable('store_app_reviews', [...map.values()])
    return
  }
  const { error } = await sb().from('store_app_reviews').upsert(rows, { onConflict: 'branch_id,review_date,channel' })
  if (error) throw error
}

/* ---------- Điện nước ---------- */
export async function listMeters(branchId: string, from: string, to: string): Promise<Meter[]> {
  if (isDemo) return loadTable<Meter>('store_meter_readings', () => []).filter((r) => (!branchId || r.branch_id === branchId) && r.read_date >= from && r.read_date <= to)
  const { data, error } = await branchEq(sb().from('store_meter_readings').select('*').gte('read_date', from).lte('read_date', to), branchId).order('read_date')
  if (error) throw error
  return (data as Meter[]).map((m) => ({ ...m, electric: m.electric === null ? null : Number(m.electric), water: m.water === null ? null : Number(m.water) }))
}
export async function saveMeter(m: Omit<Meter, 'id'>): Promise<void> {
  if (isDemo) {
    const rows = loadTable<Meter>('store_meter_readings', () => [])
    const dup = rows.find((x) => x.branch_id === m.branch_id && x.read_date === m.read_date)
    saveTable('store_meter_readings', dup ? rows.map((x) => (x.id === dup.id ? { ...m, id: dup.id } : x)) : [...rows, { ...m, id: uid() }])
    return
  }
  const { error } = await sb().from('store_meter_readings').upsert(m, { onConflict: 'branch_id,read_date' })
  if (error) throw error
}
export async function listUtilityMonths(branchId: string): Promise<UtilityMonth[]> {
  if (isDemo) return loadTable<UtilityMonth>('store_utility_monthly', () => []).filter((r) => !branchId || r.branch_id === branchId)
  const base = sb().from('store_utility_monthly').select('*')
  const { data, error } = branchId ? await base.eq('branch_id', branchId) : await base
  if (error) throw error
  return (data as UtilityMonth[]).map((u) => ({ ...u, kwh: u.kwh === null ? null : Number(u.kwh), m3: u.m3 === null ? null : Number(u.m3) }))
}
export async function saveUtilityMonth(u: UtilityMonth): Promise<void> {
  if (isDemo) {
    const rows = loadTable<UtilityMonth>('store_utility_monthly', () => []).filter((x) => !(x.branch_id === u.branch_id && x.month === u.month))
    return saveTable('store_utility_monthly', [...rows, u])
  }
  const { error } = await sb().from('store_utility_monthly').upsert(u, { onConflict: 'branch_id,month' })
  if (error) throw error
}
