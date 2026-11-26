import { useMemo, useState, type FormEvent } from 'react'
import { useAuth } from '../../core/auth'
import { DateRangePicker, useDateRange } from '../../core/DateRange'
import { today, vnDate } from '../../core/format'
import { compressImage } from '../../core/image'
import { Empty, ErrorBox, Loading, Modal, errText, useAsync, useToast } from '../../core/ui'
import { PhotoLinks, PhotoPicker, isStore } from './PhotoBits'
import { listAppReviews, saveAppReviews, uploadPhoto, type AppReview } from './api'

export const CHANNELS: { key: string; label: string }[] = [
  { key: 'shopee', label: 'ShopeeFood' }, { key: 'grab', label: 'GrabFood' }, { key: 'be', label: 'Be Food' },
  { key: 'gsm', label: 'Xanh SM' }, { key: 'gmap', label: 'Google Maps' },
]
const chLabel = (k: string) => CHANNELS.find((c) => c.key === k)?.label ?? k

/** Đánh giá khách trên các app giao đồ ăn và Google Maps: mỗi kênh một dòng mỗi ngày. */
export default function AppReviews() {
  const { branches: all, branchId } = useAuth()
  const branches = all.filter(isStore)
  const [range, setRange] = useDateRange()
  const [writing, setWriting] = useState(false)
  const list = useAsync(() => listAppReviews(branchId, range.from, range.to), [branchId, range.from, range.to])
  const name = useMemo(() => new Map(branches.map((b) => [b.id, b.name])), [branches])
  const rows = list.data ?? []
  const good = rows.reduce((s, r) => s + r.good_count, 0)
  const bad = rows.reduce((s, r) => s + r.bad_count, 0)

  return (
    <div className="stack">
      <div className="spread">
        <DateRangePicker value={range} onChange={setRange} />
        <button className="mem-btn mem-btn-primary" onClick={() => setWriting(true)} disabled={branches.length === 0}>Báo cáo đánh giá hôm nay</button>
      </div>
      {rows.length > 0 && (
        <div className="mem-grid-2">
          <div className="mem-card"><div className="mem-caption">Đánh giá tốt trong kỳ</div><div className="mem-kpi">{good}</div></div>
          <div className="mem-card"><div className="mem-caption">Đánh giá chưa tốt trong kỳ</div><div className="mem-kpi" style={{ color: bad ? 'var(--mem-danger)' : undefined }}>{bad}</div></div>
        </div>
      )}
      {list.loading ? <Loading /> : list.error ? <ErrorBox error={list.error} retry={list.reload} /> : rows.length === 0 ? (
        <Empty title="Chưa có báo cáo đánh giá nào trong khoảng ngày này" hint="Mỗi ngày bấm “Báo cáo đánh giá hôm nay”, chọn kênh nào có đánh giá mới, kênh nào không có." />
      ) : (
        <div className="mem-card">
          <div className="table-wrap"><table className="tbl">
            <thead><tr><th>Ngày</th><th>Cửa hàng</th><th>Kênh</th><th className="num">Tốt</th><th className="num">Chưa tốt</th><th>Nguyên nhân và xử lý</th><th>Sự cố</th><th /></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{vnDate(r.review_date)}</td><td>{name.get(r.branch_id) ?? '—'}</td><td>{chLabel(r.channel)}</td>
                  {r.no_new ? <td colSpan={2} className="mem-caption">Không có đánh giá mới</td> : <><td className="num">{r.good_count}</td><td className="num">{r.bad_count ? <b style={{ color: 'var(--mem-danger)' }}>{r.bad_count}</b> : 0}</td></>}
                  <td style={{ whiteSpace: 'pre-wrap' }}>{r.note || '—'}</td><td style={{ whiteSpace: 'pre-wrap' }}>{r.incident || '—'}</td>
                  <td><PhotoLinks paths={r.photos} /></td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </div>
      )}
      {writing && <ReviewForm onClose={() => setWriting(false)} onSaved={list.reload} />}
    </div>
  )
}

interface Draft { no_new: boolean; good: string; bad: string; note: string; incident: string; files: File[] }
const blank = (): Draft => ({ no_new: true, good: '', bad: '', note: '', incident: '', files: [] })

function ReviewForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { branches: all, branchId } = useAuth()
  const branches = all.filter(isStore)
  const toast = useToast()
  const [branch, setBranch] = useState(branches.find((b) => b.id === branchId)?.id || branches[0]?.id || '')
  const [date, setDate] = useState(today())
  const [d, setD] = useState<Record<string, Draft>>(() => Object.fromEntries(CHANNELS.map((c) => [c.key, blank()])))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const patch = (k: string, p: Partial<Draft>) => setD((x) => ({ ...x, [k]: { ...x[k], ...p } }))

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!branch) return setErr('Hãy chọn cửa hàng.')
    for (const c of CHANNELS) {
      const x = d[c.key]
      if (!x.no_new && !(Number(x.good) > 0 || Number(x.bad) > 0)) return setErr(`${c.label}: nhập số đánh giá tốt hoặc chưa tốt, hoặc chọn “Không có đánh giá mới”.`)
      if (!x.no_new && Number(x.bad) > 0 && !x.note.trim()) return setErr(`${c.label}: có đánh giá chưa tốt thì cần ghi nguyên nhân và cách xử lý.`)
    }
    setBusy(true); setErr('')
    try {
      const rows: Omit<AppReview, 'id'>[] = []
      for (const c of CHANNELS) {
        const x = d[c.key]
        const photos: string[] = []
        for (const f of x.files) photos.push(await uploadPhoto(branch, await compressImage(f)))
        rows.push({
          branch_id: branch, review_date: date, channel: c.key, no_new: x.no_new,
          good_count: x.no_new ? 0 : Math.max(0, Math.round(Number(x.good) || 0)), bad_count: x.no_new ? 0 : Math.max(0, Math.round(Number(x.bad) || 0)),
          note: x.note.trim(), incident: x.incident.trim(), photos: photos.filter(Boolean),
        })
      }
      await saveAppReviews(rows)
      toast('Đã lưu báo cáo đánh giá'); onSaved(); onClose()
    } catch (e2) { setErr(errText(e2)) } finally { setBusy(false) }
  }

  return (
    <Modal title="Báo cáo đánh giá food app" onClose={onClose} wide>
      <form className="stack" onSubmit={(e) => void submit(e)}>
        <div className="form-grid">
          {branches.length > 1 && <div className="field"><label htmlFor="ar-br">Cửa hàng</label><select id="ar-br" className="input" value={branch} onChange={(e) => setBranch(e.target.value)}>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></div>}
          <div className="field"><label htmlFor="ar-date">Ngày</label><input id="ar-date" className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        </div>
        {CHANNELS.map((c) => {
          const x = d[c.key]
          return (
            <div key={c.key} className="mem-card stack" style={{ boxShadow: 'none' }}>
              <div className="spread"><b>{c.label}</b>
                <label className="row"><input type="checkbox" checked={x.no_new} onChange={(e) => patch(c.key, { no_new: e.target.checked })} /> Không có đánh giá mới</label></div>
              {!x.no_new && (
                <>
                  <div className="form-grid">
                    <div className="field"><label htmlFor={`g-${c.key}`}>Số đánh giá tốt</label><input id={`g-${c.key}`} className="input" inputMode="numeric" value={x.good} onChange={(e) => patch(c.key, { good: e.target.value })} /></div>
                    <div className="field"><label htmlFor={`b-${c.key}`}>Số đánh giá chưa tốt</label><input id={`b-${c.key}`} className="input" inputMode="numeric" value={x.bad} onChange={(e) => patch(c.key, { bad: e.target.value })} /></div>
                  </div>
                  <div className="field"><label htmlFor={`n-${c.key}`}>Nguyên nhân và cách xử lý (bắt buộc nếu có đánh giá chưa tốt)</label><textarea id={`n-${c.key}`} className="input" rows={2} value={x.note} onChange={(e) => patch(c.key, { note: e.target.value })} /></div>
                  <div className="field"><label htmlFor={`i-${c.key}`}>Sự cố (nếu có)</label><textarea id={`i-${c.key}`} className="input" rows={2} value={x.incident} onChange={(e) => patch(c.key, { incident: e.target.value })} /></div>
                  <PhotoPicker files={x.files} onChange={(f) => patch(c.key, { files: f })} label="Ảnh chụp đánh giá" />
                </>
              )}
            </div>
          )
        })}
        <div className="mem-caption">Gửi lại cùng cửa hàng, ngày và kênh thì dòng cũ được ghi đè.</div>
        {err && <div className="alert bad" role="alert">{err}</div>}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="mem-btn" onClick={onClose}>Hủy</button>
          <button className="mem-btn mem-btn-primary" disabled={busy}>{busy ? 'Đang lưu...' : 'Lưu báo cáo'}</button>
        </div>
      </form>
    </Modal>
  )
}
