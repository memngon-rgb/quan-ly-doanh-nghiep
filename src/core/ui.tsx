import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'

/* ---------- Toast ---------- */
interface ToastItem { id: number; text: string; err: boolean }
const ToastCtx = createContext<(text: string, err?: boolean) => void>(() => {})
export const useToast = () => useContext(ToastCtx)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const push = useCallback((text: string, err = false) => {
    const id = Date.now() + Math.random()
    setItems((x) => [...x, { id, text, err }])
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), 3200)
  }, [])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toast-wrap" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.err ? 'err' : ''}`}>{t.text}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}

/** Chuyển lỗi bất kỳ thành câu tiếng Việt ngắn gọn */
export function errText(e: unknown): string {
  const m = e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String((e as { message: unknown }).message) : String(e)
  if (/row-level security|permission denied/i.test(m)) return 'Bạn không có quyền thực hiện thao tác này.'
  if (/Failed to fetch|NetworkError/i.test(m)) return 'Mất kết nối mạng. Hãy thử lại.'
  return m
}

/* ---------- Modal ---------- */
export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} style={wide ? { maxWidth: 760 } : undefined}>
        <h3>{title}</h3>
        {children}
      </div>
    </div>
  )
}

/* ---------- Trạng thái chung ---------- */
export const Loading = () => <div className="spinner" aria-label="Đang tải" />

export function Empty({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <b>{title}</b>
      {hint && <div>{hint}</div>}
      {action && <div style={{ marginTop: 14 }}>{action}</div>}
    </div>
  )
}

export function ErrorBox({ error, retry }: { error: unknown; retry?: () => void }) {
  return (
    <div className="alert bad" role="alert">
      <div>
        <div className="t">Không tải được dữ liệu</div>
        <div>{errText(error)}</div>
        {retry && <button className="mem-btn mem-btn-sm" style={{ marginTop: 8 }} onClick={retry}>Thử lại</button>}
      </div>
    </div>
  )
}

export function PageHead({ eyebrow, title, sub, right }: { eyebrow?: string; title: string; sub?: string; right?: ReactNode }) {
  return (
    <div className="spread" style={{ alignItems: 'flex-end', marginBottom: 18 }}>
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1 className="page-title">{title}</h1>
        {sub && <p className="page-sub" style={{ margin: 0 }}>{sub}</p>}
      </div>
      {right && <div className="row">{right}</div>}
    </div>
  )
}

/* ---------- Hook tải dữ liệu ---------- */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)
    fn().then(
      (d) => { if (alive) { setData(d); setLoading(false) } },
      (e) => { if (alive) { setError(e); setLoading(false) } },
    )
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick])
  return { data, error, loading, reload: () => setTick((t) => t + 1) }
}

/** Ô nhập số tiền có dấu phân cách hàng nghìn */
export function MoneyInput({ value, onChange, id, placeholder }: { value: number; onChange: (n: number) => void; id?: string; placeholder?: string }) {
  return (
    <input
      id={id}
      className="input"
      inputMode="numeric"
      placeholder={placeholder ?? '0'}
      value={value ? new Intl.NumberFormat('vi-VN').format(value) : ''}
      onChange={(e) => onChange(Number(e.target.value.replace(/\D/g, '')) || 0)}
    />
  )
}
