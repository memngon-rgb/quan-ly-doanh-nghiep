import { useState } from 'react'
import { DEFAULT_THEME, FONTS, PALETTES, applyTheme, logoFromFile, saveCompanyTheme, useTheme, type Theme } from '../../core/theme'
import { PageHead, errText, useToast } from '../../core/ui'

/** Cài đặt giao diện dùng chung cho cả công ty: tên, logo, font chữ, màu sắc. */
export default function Appearance() {
  const saved = useTheme()
  const toast = useToast()
  const [t, setT] = useState<Theme>(saved)
  const [busy, setBusy] = useState(false)
  const set = (p: Partial<Theme>) => { const n = { ...t, ...p }; setT(n); applyTheme(n) } // xem trước ngay

  async function save() {
    setBusy(true)
    try { await saveCompanyTheme(t); toast('Đã lưu giao diện cho cả công ty') } catch (e) { toast(errText(e), true) } finally { setBusy(false) }
  }
  async function pickLogo(f: File | null) {
    if (!f) return
    try { set({ logo: await logoFromFile(f) }) } catch (e) { toast(errText(e), true) }
  }

  return (
    <div className="stack">
      <PageHead eyebrow="Quản trị" title="Giao diện" sub="Đổi tên, logo, font chữ và màu sắc. Thay đổi hiện ngay để xem thử, bấm Lưu để áp dụng cho mọi người dùng." />
      <div className="mem-grid-2">
        <div className="mem-card stack">
          <div className="field"><label htmlFor="ap-name">Tên hiển thị</label><input id="ap-name" className="input" value={t.name} maxLength={30} onChange={(e) => set({ name: e.target.value })} /></div>
          <div className="field"><label htmlFor="ap-logo">Logo (ảnh vuông, PNG hoặc JPG)</label>
            <div className="row">
              {t.logo && <img src={t.logo} alt="Logo hiện tại" style={{ width: 40, height: 40, objectFit: 'contain', borderRadius: 9, border: '1px solid var(--mem-line)' }} />}
              <input id="ap-logo" className="input" type="file" accept="image/*" onChange={(e) => void pickLogo(e.target.files?.[0] ?? null)} />
              {t.logo && <button className="mem-btn mem-btn-sm" onClick={() => set({ logo: null })}>Bỏ logo</button>}
            </div>
          </div>
          <div className="field"><label htmlFor="ap-font">Font chữ</label>
            <select id="ap-font" className="input" value={t.font} onChange={(e) => set({ font: e.target.value })}>{FONTS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}</select></div>
          <div className="field"><label>Bảng màu có sẵn</label>
            <div className="chip-row">{PALETTES.map((p) => (
              <button key={p.label} type="button" className={`chip${t.primary === p.primary ? ' on' : ''}`} onClick={() => set({ primary: p.primary, accent: p.accent, hero: p.hero })}>{p.label}</button>
            ))}</div></div>
          <div className="form-grid">
            <div className="field"><label htmlFor="ap-c1">Màu nút chính</label><input id="ap-c1" type="color" className="input" value={t.primary} onChange={(e) => set({ primary: e.target.value })} /></div>
            <div className="field"><label htmlFor="ap-c2">Màu mục đang chọn, liên kết</label><input id="ap-c2" type="color" className="input" value={t.accent} onChange={(e) => set({ accent: e.target.value })} /></div>
            <div className="field"><label htmlFor="ap-c3">Màu khối nổi bật</label><input id="ap-c3" type="color" className="input" value={t.hero} onChange={(e) => set({ hero: e.target.value })} /></div>
          </div>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="mem-btn" onClick={() => set({ ...DEFAULT_THEME })}>Khôi phục mặc định</button>
            <button className="mem-btn mem-btn-primary" onClick={() => void save()} disabled={busy}>{busy ? 'Đang lưu...' : 'Lưu cho cả công ty'}</button>
          </div>
        </div>

        <div className="mem-card stack">
          <div className="section-title">Xem thử</div>
          <div className="hero" style={{ margin: 0 }}>
            <div><div className="kicker">Doanh thu trong kỳ</div><div style={{ fontSize: 30, fontWeight: 850 }}>1.234.567.890đ</div></div>
          </div>
          <div className="row"><button className="mem-btn mem-btn-primary">Nút chính</button><button className="mem-btn">Nút phụ</button><span className="mem-tag mem-tag-success">Khớp</span></div>
          <p>Đây là đoạn chữ mẫu để xem font: Tiệm Xôi Mềm, doanh thu 1.234.567đ, ngày 26/11/2026.</p>
          <div className="mem-caption">Nếu đổi sang font từ Google Fonts mà chưa thấy đổi, hãy chờ vài giây để tải font.</div>
        </div>
      </div>
    </div>
  )
}
