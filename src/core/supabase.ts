import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/** Chưa cấu hình Supabase → chạy "bản xem thử" với dữ liệu minh họa lưu trong trình duyệt. */
export const isDemo = !url || !key

export const supabase = isDemo ? null : createClient(url!, key!)

/** Dùng trong code đã kiểm tra !isDemo */
export function sb() {
  if (!supabase) throw new Error('Chưa cấu hình Supabase')
  return supabase
}
