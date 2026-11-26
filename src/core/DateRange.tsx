import { useEffect, useRef, useState } from 'react'
import { addDays, monthRange, pad, shiftMonth, today, vnDate } from './format'

export interface Range { from: string; to: string }

const KEY = 'qltc-range'

/** Khoảng ngày đang xem, nhớ lại giữa các trang và các lần mở app. Mặc định: từ đầu tháng đến hôm nay. */
export function useDateRange(): [Range, (r: Range) => void] {
  const [range, setRange] = useState<Range>(() => {
    try {
      const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Range | null
      if (v && /^\d{4}-\d{2}-\d{2}$/.test(v.from) && /^\d{4}-\d{2}-\d{2}$/.test(v.to) && v.from <= v.to) return v
    } catch { /* dùng mặc định */ }
    return { from: `${today().slice(0, 7)}-01`, to: today() }
  })
  const set = (r: Range) => {
    setRange(r)
    try { localStorage.setItem(KEY, JSON.stringify(r)) } catch { /* bỏ qua */ }
  }
  return [range, set]
}

const PRESETS: { label: string; get: () => Range }[] = [
  { label: 'Hôm nay', get: () => ({ from: today(), to: today() }) },
  { label: 'Hôm qua', get: () => ({ from: addDays(today(), -1), to: addDays(today(), -1) }) },
  { label: '7 ngày trước', get: () => ({ from: addDays(today(), -6), to: today() }) },
  { label: 'Tháng này', get: () => ({ from: `${today().slice(0, 7)}-01`, to: monthRange(today().slice(0, 7)).to }) },
  { label: 'Tháng trước', get: () => { const m = shiftMonth(today().slice(0, 7), -1); return { from: monthRange(m).from, to: monthRange(m).to } } },
]

const WEEK = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN']

function Month({ ym, pick, value, onPick }: { ym: string; pick: string | null; value: Range; onPick: (d: string) => void }) {
  const [y, m] = ym.split('-').map(Number)
  const lead = (new Date(y, m - 1, 1).getDay() + 6) % 7 // tuần bắt đầu từ thứ Hai
  const days = new Date(y, m, 0).getDate()
  const lo = pick ?? value.from
  const hi = pick ?? value.to
  return (
    <div className="drp-month">
      <div className="drp-title">Tháng {m} {y}</div>
      <div className="drp-grid">
        {WEEK.map((w) => <div key={w} className="drp-dow">{w}</div>)}
        {Array.from({ length: lead }, (_, i) => <div key={`b${i}`} />)}
        {Array.from({ length: days }, (_, i) => {
          const d = `${ym}-${pad(i + 1)}`
          const edge = d === lo || d === hi
          const inside = d > lo && d < hi
          return (
            <button key={d} type="button" className={`drp-day${edge ? ' edge' : inside ? ' in' : ''}${d === today() ? ' today' : ''}`} onClick={() => onPick(d)} aria-label={vnDate(d)} aria-pressed={edge}>
              {i + 1}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** Chọn khoảng ngày kiểu iPOS: lối tắt bên trái, lịch 1–2 tháng, bấm ngày đầu rồi ngày cuối. */
export function DateRangePicker({ value, onChange }: { value: Range; onChange: (r: Range) => void }) {
  const [open, setOpen] = useState(false)
  const [two, setTwo] = useState(true)
  const [view, setView] = useState(value.from.slice(0, 7))
  const [pick, setPick] = useState<string | null>(null)
  const [alignRight, setAlignRight] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const down = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) { setOpen(false); setPick(null) } }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); setPick(null) } }
    document.addEventListener('mousedown', down)
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key) }
  }, [open])

  function toggle() {
    if (!open) {
      setView(value.from.slice(0, 7))
      // Nút nằm nửa bên phải màn hình thì mở lịch về phía trái để không bị cắt mất
      const r = ref.current?.getBoundingClientRect()
      setAlignRight(!!r && r.left + 640 > window.innerWidth)
    }
    setOpen(!open)
    setPick(null)
  }
  function apply(r: Range) {
    onChange(r)
    setOpen(false)
    setPick(null)
  }
  function onPick(d: string) {
    if (!pick) return setPick(d)
    apply(d < pick ? { from: d, to: pick } : { from: pick, to: d })
  }

  return (
    <div className="drp" ref={ref}>
      <button type="button" className="drp-btn" onClick={toggle} aria-haspopup="dialog" aria-expanded={open}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><rect x="3.5" y="5" width="17" height="15" rx="2.5" /><path d="M8 3v4M16 3v4M3.5 10h17" /></svg>
        <span>{vnDate(value.from)} - {vnDate(value.to)}</span>
      </button>
      {open && (
        <div className={`drp-pop${alignRight ? ' right' : ''}`} role="dialog" aria-label="Chọn khoảng ngày">
          <div className="drp-side">
            <label className="drp-toggle"><input type="checkbox" checked={two} onChange={(e) => setTwo(e.target.checked)} /> Hiển thị 2 tháng</label>
            {PRESETS.map((p) => <button key={p.label} type="button" className="drp-preset" onClick={() => apply(p.get())}>{p.label}</button>)}
          </div>
          <div className="drp-cals">
            <div className="drp-nav">
              <button type="button" className="mem-btn mem-btn-sm" onClick={() => setView(shiftMonth(view, -1))} aria-label="Tháng trước">‹</button>
              <span className="mem-caption">{pick ? 'Chọn ngày cuối' : 'Chọn ngày đầu'}</span>
              <button type="button" className="mem-btn mem-btn-sm" onClick={() => setView(shiftMonth(view, 1))} aria-label="Tháng sau">›</button>
            </div>
            <div className="drp-months">
              <Month ym={view} pick={pick} value={value} onPick={onPick} />
              {two && <Month ym={shiftMonth(view, 1)} pick={pick} value={value} onPick={onPick} />}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

