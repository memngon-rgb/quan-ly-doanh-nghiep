// Kho dữ liệu minh họa lưu trong localStorage, chỉ dùng khi chưa cấu hình Supabase.
// Toàn bộ dữ liệu ở đây là DỮ LIỆU MINH HỌA, không phải số liệu thật.
const PREFIX = 'qltc-demo-v1:'

export function loadTable<T>(name: string, seed: () => T[]): T[] {
  try {
    const raw = localStorage.getItem(PREFIX + name)
    if (raw) return JSON.parse(raw) as T[]
  } catch {
    /* bỏ qua, dùng dữ liệu mẫu */
  }
  const rows = seed()
  saveTable(name, rows)
  return rows
}

export function saveTable<T>(name: string, rows: T[]): void {
  try {
    localStorage.setItem(PREFIX + name, JSON.stringify(rows))
  } catch {
    /* hết dung lượng trình duyệt */
  }
}

export function resetDemo(): void {
  Object.keys(localStorage)
    .filter((k) => k.startsWith(PREFIX))
    .forEach((k) => localStorage.removeItem(k))
}

export const uid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`

/** Sinh số giả lập có thể lặp lại (cùng seed → cùng kết quả) */
export function rng(seed: number) {
  let s = seed
  return () => {
    s = (s * 16807) % 2147483647
    return (s - 1) / 2147483646
  }
}

export const DEMO_BRANCHES = [
  { id: 'demo-b1', name: 'Cửa hàng 1 (minh họa)', is_active: true },
  { id: 'demo-b2', name: 'Cửa hàng 2 (minh họa)', is_active: true },
]
export const DEMO_USER_ID = 'demo-user'
