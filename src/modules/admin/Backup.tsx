import { useState } from 'react'
import { downloadText } from '../../core/excel'
import { today } from '../../core/format'
import { PageHead, errText, useToast } from '../../core/ui'
import { IconDownload } from '../../core/icons'
import { backupAll } from '../finance/api'

export default function Backup() {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  async function run() {
    setBusy(true)
    try {
      const data = await backupAll()
      downloadText(`sao-luu-${today()}.json`, JSON.stringify({ exported_at: new Date().toISOString(), ...data }, null, 2))
      toast('Đã tải file sao lưu')
    } catch (e) { toast(errText(e), true) } finally { setBusy(false) }
  }
  return (
    <div className="stack">
      <PageHead eyebrow="Quản trị" title="Sao lưu dữ liệu" sub="Gói miễn phí của Supabase không tự sao lưu. Hãy tải file này về và cất ở Google Drive ít nhất mỗi tuần." />
      <div className="mem-card stack">
        <div className="section-title">Tải toàn bộ dữ liệu (JSON)</div>
        <p className="mem-caption" style={{ margin: 0 }}>Gồm danh mục, sổ thu chi, doanh thu ngày và số dự tính. Mỗi báo cáo cũng có nút “Xuất Excel” riêng. Ảnh chứng từ không nằm trong file này.</p>
        <div><button className="mem-btn mem-btn-primary" disabled={busy} onClick={() => void run()}><IconDownload /> {busy ? 'Đang tạo file...' : 'Tải file sao lưu'}</button></div>
      </div>
    </div>
  )
}
