import { useState, type FormEvent } from 'react'
import { Empty, ErrorBox, Loading, PageHead, errText, useAsync, useToast } from '../../core/ui'
import { listCategories, saveCategory } from './api'
import { GROUP_LABEL, type Category, type Group, type TxType } from './types'

export default function FinanceSettings() {
  const toast = useToast()
  const cats = useAsync(listCategories, [])
  const [name, setName] = useState('')
  const [type, setType] = useState<TxType>('expense')
  const [grp, setGrp] = useState<Group>('other')

  async function add(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    try {
      await saveCategory({ name: name.trim(), type, grp: type === 'income' && grp !== 'revenue' ? 'other' : grp })
      setName('')
      toast('Đã thêm danh mục')
      cats.reload()
    } catch (e2) { toast(errText(e2), true) }
  }
  async function toggle(c: Category) {
    try { await saveCategory({ ...c, is_active: !c.is_active }); cats.reload() } catch (e) { toast(errText(e), true) }
  }

  const groupsFor = (t: TxType): Group[] => (t === 'income' ? ['revenue', 'other'] : ['cogs', 'payroll', 'fixed', 'other'])

  return (
    <div className="stack">
      <PageHead eyebrow="Tài chính" title="Danh mục thu chi" sub="Nhóm của danh mục quyết định cách tính P&L: giá vốn, lương, chi phí cố định hay chi khác." />
      <form className="mem-card row" onSubmit={(e) => void add(e)}>
        <div className="field" style={{ flex: 1, minWidth: 180 }}><label htmlFor="cn">Tên danh mục mới</label><input id="cn" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ví dụ: Gas, Bao bì" /></div>
        <div className="field"><label htmlFor="ct">Loại</label>
          <select id="ct" className="input" value={type} onChange={(e) => { const t = e.target.value as TxType; setType(t); setGrp(groupsFor(t)[0]) }}>
            <option value="expense">Chi</option><option value="income">Thu</option></select></div>
        <div className="field"><label htmlFor="cg">Nhóm</label>
          <select id="cg" className="input" value={grp} onChange={(e) => setGrp(e.target.value as Group)}>
            {groupsFor(type).map((g) => <option key={g} value={g}>{GROUP_LABEL[g]}</option>)}</select></div>
        <button className="mem-btn mem-btn-primary" style={{ alignSelf: 'flex-end', minHeight: 42 }}>Thêm</button>
      </form>
      <div className="mem-card">
        {cats.loading ? <Loading /> : cats.error ? <ErrorBox error={cats.error} retry={cats.reload} /> : !cats.data?.length ? <Empty title="Chưa có danh mục" /> : (
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>Tên</th><th>Loại</th><th>Nhóm</th><th>Trạng thái</th><th /></tr></thead>
              <tbody>
                {cats.data.map((c) => (
                  <tr key={c.id}>
                    <td>{c.name}</td><td>{c.type === 'income' ? 'Thu' : 'Chi'}</td><td>{GROUP_LABEL[c.grp]}</td>
                    <td><span className={`mem-tag ${c.is_active ? 'mem-tag-success' : 'mem-tag-neutral'}`}>{c.is_active ? 'Đang dùng' : 'Đã ẩn'}</span></td>
                    <td className="num"><button className="mem-btn mem-btn-sm" onClick={() => void toggle(c)}>{c.is_active ? 'Ẩn' : 'Dùng lại'}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
