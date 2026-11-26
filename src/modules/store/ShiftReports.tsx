import { useMemo, useState, type FormEvent } from 'react'
import { useAuth } from '../../core/auth'
import { DateRangePicker, useDateRange } from '../../core/DateRange'
import { today, vnDate } from '../../core/format'
import { compressImage } from '../../core/image'
import { Empty, ErrorBox, Loading, Modal, errText, useAsync, useToast } from '../../core/ui'
import { PhotoLinks, PhotoPicker, isStore } from './PhotoBits'
import { listShiftReports, reviewShiftReport, saveShiftReport, uploadPhoto, type Shift, type ShiftKind, type ShiftReport } from './api'

const SHIFT_LABEL: Record<Shift, string> = { morning: 'Ca sáng', evening: 'Ca tối' }
const KIND_LABEL: Record<ShiftKind, string> = { open: 'Tác phong đầu ca', close: 'Báo cáo kết ca' }
const SECTIONS: Record<ShiftKind, { key: string; label: string; hint: string }[]> = {
  open: [
    { key: 'staff', label: '1. Tác phong nhân sự', hint: 'Đã kiểm tra đầu tóc, móng tay, đồng phục...' },
    { key: 'material', label: '2. Nguyên vật liệu', hint: 'NVL đầu ca, hàng cận date, chuẩn bị cho ca sau...' },
    { key: 'briefing', label: '3. Briefing đầu ca', hint: 'Nội dung đã nhắc nhân sự: upsell, ghi chú đơn, giảm giá...' },
    { key: 'other', label: '4. Các lưu ý khác', hint: 'Thúc đẩy vận hành, vệ sinh, các vấn đề phát sinh...' },
  ],
  close: [
    { key: 'product', label: '1. Sản phẩm', hint: 'Chất lượng sản phẩm, không ghi nhận sản phẩm lỗi...' },
    { key: 'staff', label: '2. Nhân sự', hint: 'Xin off đột xuất, hỗ trợ giữa các quầy...' },
    { key: 'process', label: '3. Quy trình - Vận hành', hint: 'Lượng khách, kênh bán chủ yếu, đã kiểm tra báo cáo đóng ca...' },
  ],
}

/** Báo cáo ca: tác phong đầu ca và báo cáo kết ca, thay cho tin nhắn gửi Zalo. */
export default function ShiftReports() {
  const { branches: all, branchId } = useAuth()
  const branches = all.filter(isStore)
  const toast = useToast()
  const [range, setRange] = useDateRange()
  const [writing, setWriting] = useState(false)
  const list = useAsync(() => listShiftReports(branchId, range.from, range.to), [branchId, range.from, range.to])
  const [noteOf, setNoteOf] = useState<ShiftReport | null>(null)
  const name = useMemo(() => new Map(branches.map((b) => [b.id, b.name])), [branches])

  return (
    <div className="stack">
      <div className="spread">
        <DateRangePicker value={range} onChange={setRange} />
        <button className="mem-btn mem-btn-primary" onClick={() => setWriting(true)} disabled={branches.length === 0}>Gửi báo cáo ca</button>
      </div>
      {list.loading ? <Loading /> : list.error ? <ErrorBox error={list.error} retry={list.reload} /> : (list.data ?? []).length === 0 ? (
        <Empty title="Chưa có báo cáo ca nào trong khoảng ngày này" hint="Bấm “Gửi báo cáo ca”, chọn ca và loại báo cáo rồi điền theo từng mục." />
      ) : (
        <div className="stack">
          {(list.data ?? []).map((r) => (
            <div key={r.id} className="mem-card stack" style={{ boxShadow: 'none' }}>
              <div className="spread">
                <div><b>{name.get(r.branch_id) ?? '—'}</b> · {vnDate(r.report_date)} · {SHIFT_LABEL[r.shift]}<div className="mem-caption">{KIND_LABEL[r.kind]}</div></div>
                {r.reviewed_at ? <span className="mem-tag mem-tag-success">Đã xem</span> : <button className="mem-btn mem-btn-sm" onClick={() => setNoteOf(r)}>Đánh dấu đã xem</button>}
              </div>
              {SECTIONS[r.kind].map((s) => r.sections[s.key] ? (
                <div key={s.key}><div className="lbl">{s.label}</div><div style={{ whiteSpace: 'pre-wrap' }}>{r.sections[s.key]}</div></div>
              ) : null)}
              <PhotoLinks paths={r.photos} />
              {r.review_note && <div className="alert good"><div><span className="t">Ghi chú của người xem:</span> {r.review_note}</div></div>}
            </div>
          ))}
        </div>
      )}
      {writing && <ReportForm onClose={() => setWriting(false)} onSaved={list.reload} />}
      {noteOf && <ReviewForm r={noteOf} onClose={() => setNoteOf(null)} onSaved={() => { toast('Đã đánh dấu đã xem'); list.reload() }} />}
    </div>
  )
}

function ReportForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { branches: all, branchId } = useAuth()
  const branches = all.filter(isStore)
  const toast = useToast()
  const [branch, setBranch] = useState(branches.find((b) => b.id === branchId)?.id || branches[0]?.id || '')
  const [date, setDate] = useState(today())
  const [shift, setShift] = useState<Shift>(new Date().getHours() < 15 ? 'morning' : 'evening')
  const [kind, setKind] = useState<ShiftKind>('close')
  const [text, setText] = useState<Record<string, string>>({})
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!branch) return setErr('Hãy chọn cửa hàng.')
    const sections = Object.fromEntries(SECTIONS[kind].map((s) => [s.key, (text[`${kind}.${s.key}`] ?? '').trim()]).filter(([, v]) => v))
    if (Object.keys(sections).length === 0) return setErr('Hãy điền ít nhất một mục.')
    setBusy(true); setErr('')
    try {
      const photos: string[] = []
      for (const f of files) photos.push(await uploadPhoto(branch, await compressImage(f)))
      await saveShiftReport({ branch_id: branch, report_date: date, shift, kind, sections, photos: photos.filter(Boolean) })
      toast('Đã gửi báo cáo'); onSaved(); onClose()
    } catch (e2) { setErr(errText(e2)) } finally { setBusy(false) }
  }

  return (
    <Modal title="Gửi báo cáo ca" onClose={onClose} wide>
      <form className="stack" onSubmit={(e) => void submit(e)}>
        <div className="form-grid">
          {branches.length > 1 && <div className="field"><label htmlFor="sr-br">Cửa hàng</label><select id="sr-br" className="input" value={branch} onChange={(e) => setBranch(e.target.value)}>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></div>}
          <div className="field"><label htmlFor="sr-date">Ngày</label><input id="sr-date" className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <div className="field"><label htmlFor="sr-shift">Ca</label><select id="sr-shift" className="input" value={shift} onChange={(e) => setShift(e.target.value as Shift)}>{(Object.keys(SHIFT_LABEL) as Shift[]).map((s) => <option key={s} value={s}>{SHIFT_LABEL[s]}</option>)}</select></div>
          <div className="field"><label htmlFor="sr-kind">Loại báo cáo</label><select id="sr-kind" className="input" value={kind} onChange={(e) => setKind(e.target.value as ShiftKind)}>{(Object.keys(KIND_LABEL) as ShiftKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select></div>
        </div>
        {SECTIONS[kind].map((s) => (
          <div className="field" key={`${kind}.${s.key}`}><label htmlFor={`sr-${kind}-${s.key}`}>{s.label}</label>
            <textarea id={`sr-${kind}-${s.key}`} className="input" rows={3} placeholder={s.hint} value={text[`${kind}.${s.key}`] ?? ''} onChange={(e) => setText({ ...text, [`${kind}.${s.key}`]: e.target.value })} /></div>
        ))}
        <PhotoPicker files={files} onChange={setFiles} label={kind === 'close' ? 'Ảnh đính kèm (báo cáo iPOS, đồng hồ, sổ ghi tay...)' : 'Ảnh đính kèm (đội ngũ, quầy, NVL...)'} />
        <div className="mem-caption">Nếu báo cáo trùng cửa hàng, ngày, ca và loại với báo cáo đã gửi thì báo cáo cũ được ghi đè.</div>
        {err && <div className="alert bad" role="alert">{err}</div>}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="mem-btn" onClick={onClose}>Hủy</button>
          <button className="mem-btn mem-btn-primary" disabled={busy}>{busy ? 'Đang gửi...' : 'Gửi báo cáo'}</button>
        </div>
      </form>
    </Modal>
  )
}

function ReviewForm({ r, onClose, onSaved }: { r: ShiftReport; onClose: () => void; onSaved: () => void }) {
  const toast = useToast()
  const [note, setNote] = useState('')
  async function go() { try { await reviewShiftReport(r.id, note.trim()); onSaved(); onClose() } catch (e) { toast(errText(e), true) } }
  return (
    <Modal title="Đánh dấu đã xem" onClose={onClose}>
      <div className="stack">
        <div className="field"><label htmlFor="rv-note">Ghi chú gửi lại cửa hàng (không bắt buộc)</label><textarea id="rv-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} /></div>
        <div className="row" style={{ justifyContent: 'flex-end' }}><button className="mem-btn" onClick={onClose}>Hủy</button><button className="mem-btn mem-btn-primary" onClick={() => void go()}>Đã xem</button></div>
      </div>
    </Modal>
  )
}
