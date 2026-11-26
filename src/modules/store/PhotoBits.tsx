import { photoUrl } from './api'
import { errText, useToast } from '../../core/ui'

/** Chọn nhiều ảnh (chụp trực tiếp trên điện thoại hoặc chọn từ thư viện). */
export function PhotoPicker({ files, onChange, label = 'Ảnh đính kèm' }: { files: File[]; onChange: (f: File[]) => void; label?: string }) {
  return (
    <div className="field">
      <label>{label}</label>
      <input className="input" type="file" accept="image/*" multiple onChange={(e) => onChange([...files, ...Array.from(e.target.files ?? [])])} />
      {files.length > 0 && (
        <div className="row mem-caption">
          {files.length} ảnh đã chọn
          <button type="button" className="mem-btn mem-btn-sm" onClick={() => onChange([])}>Bỏ hết</button>
        </div>
      )}
    </div>
  )
}

/** Hàng nút “Ảnh 1, Ảnh 2…” mở ảnh đã lưu ở tab mới. */
export function PhotoLinks({ paths }: { paths: string[] }) {
  const toast = useToast()
  if (paths.length === 0) return null
  return (
    <div className="row">
      {paths.filter(Boolean).map((p, i) => (
        <button key={p} className="mem-btn mem-btn-sm" onClick={() => void photoUrl(p).then((u) => window.open(u, '_blank', 'noopener')).catch((e) => toast(errText(e), true))}>Ảnh {i + 1}</button>
      ))}
    </div>
  )
}

/** Chi nhánh "CÔNG TY" chỉ dùng cho khoản cấp công ty, không phải cửa hàng nên không nhận báo cáo cửa hàng. */
export const isStore = (b: { name: string }) => b.name.trim().toUpperCase() !== 'CÔNG TY'
