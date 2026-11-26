import { useSyncExternalStore } from 'react'
import { isDemo, sb } from './supabase'

export interface Theme {
  name: string
  font: string
  primary: string // nút chính
  accent: string // liên kết, mục đang chọn
  hero: string // khối nổi bật ở trang Tổng quan
  logo: string | null // ảnh nhỏ dạng data URL
}

export const DEFAULT_THEME: Theme = { name: 'Quản lý', font: 'inter', primary: '#17684f', accent: '#12664e', hero: '#153f32', logo: null }

export const FONTS: { key: string; label: string; stack: string; google?: string }[] = [
  { key: 'inter', label: 'Inter (mặc định)', stack: 'Inter, "Segoe UI", Arial, sans-serif' },
  { key: 'system', label: 'Chữ hệ thống', stack: '-apple-system, "Segoe UI", Roboto, Arial, sans-serif' },
  { key: 'beVietnam', label: 'Be Vietnam Pro', stack: '"Be Vietnam Pro", "Segoe UI", Arial, sans-serif', google: 'Be+Vietnam+Pro:wght@400;600;800' },
  { key: 'roboto', label: 'Roboto', stack: 'Roboto, "Segoe UI", Arial, sans-serif', google: 'Roboto:wght@400;500;700;900' },
  { key: 'montserrat', label: 'Montserrat', stack: 'Montserrat, "Segoe UI", Arial, sans-serif', google: 'Montserrat:wght@400;600;800' },
  { key: 'serif', label: 'Chữ có chân (Georgia)', stack: 'Georgia, "Times New Roman", serif' },
]

export const PALETTES: { label: string; primary: string; accent: string; hero: string }[] = [
  { label: 'Xanh rừng', primary: '#17684f', accent: '#12664e', hero: '#153f32' },
  { label: 'Nâu cát', primary: '#8a5a2b', accent: '#7a4f25', hero: '#4a3320' },
  { label: 'Xanh dương', primary: '#2455a4', accent: '#1d4a94', hero: '#173560' },
  { label: 'Đỏ đô', primary: '#a3342b', accent: '#8e2c24', hero: '#5a1d18' },
  { label: 'Tím', primary: '#5b3fa0', accent: '#4e3590', hero: '#34235f' },
]

const KEY = 'qltc-theme'
let current: Theme = load()
const listeners = new Set<() => void>()

function load(): Theme {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Theme> | null
    if (v) return { ...DEFAULT_THEME, ...v }
  } catch { /* dùng mặc định */ }
  return DEFAULT_THEME
}

const ok = (c: string) => /^#[0-9a-fA-F]{6}$/.test(c)

/** Áp giao diện lên toàn trang bằng biến CSS (không đụng vào mã từng màn hình). */
export function applyTheme(t: Theme): void {
  current = { ...DEFAULT_THEME, ...t }
  const root = document.documentElement.style
  const f = FONTS.find((x) => x.key === current.font) ?? FONTS[0]
  if (f.google && !document.getElementById('theme-font')) {
    const l = document.createElement('link')
    l.id = 'theme-font'
    l.rel = 'stylesheet'
    document.head.appendChild(l)
  }
  const link = document.getElementById('theme-font') as HTMLLinkElement | null
  if (link) link.href = f.google ? `https://fonts.googleapis.com/css2?family=${f.google}&display=swap` : ''
  root.setProperty('--mem-font', f.stack)
  if (ok(current.primary)) root.setProperty('--mem-action', current.primary)
  if (ok(current.accent)) {
    root.setProperty('--mem-green', current.accent)
    root.setProperty('--mem-green-2', current.accent)
    root.setProperty('--mem-green-soft', `color-mix(in srgb, ${current.accent} 10%, white)`)
  }
  if (ok(current.hero)) root.setProperty('--mem-hero', current.hero)
  document.title = current.name
  try { localStorage.setItem(KEY, JSON.stringify(current)) } catch { /* bỏ qua */ }
  listeners.forEach((l) => l())
}

export function useTheme(): Theme {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => { listeners.delete(cb) } }, () => current)
}

/** Lấy giao diện dùng chung của công ty (Supabase); bản xem thử dùng giá trị lưu trong trình duyệt. */
export async function fetchCompanyTheme(): Promise<void> {
  if (isDemo) return
  const { data } = await sb().from('app_settings').select('value').eq('key', 'theme').maybeSingle()
  if (data?.value) applyTheme(data.value as Theme)
}

export async function saveCompanyTheme(t: Theme): Promise<void> {
  applyTheme(t)
  if (isDemo) return
  const { error } = await sb().from('app_settings').upsert({ key: 'theme', value: t, updated_at: new Date().toISOString() })
  if (error) throw error
}

/** Thu nhỏ ảnh logo về tối đa 160px để lưu gọn trong cài đặt. */
export async function logoFromFile(file: File): Promise<string> {
  const bmp = await createImageBitmap(file)
  const scale = Math.min(1, 160 / Math.max(bmp.width, bmp.height))
  const c = document.createElement('canvas')
  c.width = Math.round(bmp.width * scale)
  c.height = Math.round(bmp.height * scale)
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height)
  return c.toDataURL('image/png')
}
