import { useMemo, useState, type FormEvent } from 'react'
import { exportXlsx } from '../../core/excel'
import { money, num, today, vnDate } from '../../core/format'
import { IconDownload, IconPlus, IconUpload } from '../../core/icons'
import { Empty, Modal, MoneyInput, errText, useToast } from '../../core/ui'
import { addOrders, deleteOrder, markPaid, updateOrder } from './api'
import { ageDays, guessKind, matchPaid, OP_GROUPS, parseEfast, plain, type NewOrder, type PayOrder, type Partner, type PartnerAccount } from './logic'
import type { Tx } from '../finance/types'

export interface PayData { orders: PayOrder[]; partners: Partner[]; accounts: PartnerAccount[]; txs: Tx[] }

export const maskAcct = (a: string) => (a.length > 6 ? `•••${a.slice(-4)}` : a)

const STATUS_LABEL = { pending: 'Còn nợ', paid: 'Đã chi', cancelled: 'Đã hủy' } as const
const STATUS_CLS = { pending: 'mem-tag-warning', paid: 'mem-tag-success', cancelled: 'mem-tag-danger' } as const

const Chevron = ({ open }: { open: boolean }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden
    style={{ transform: open ? 'rotate(0)' : 'rotate(-90deg)', transition: 'transform .15s' }}><path d="M6 9l6 6 6-6" /></svg>
)

export default function DebtTab({ data, reload, canEdit, goPartners, scope }: { data: PayData; reload: () => void; canEdit: boolean; goPartners: () => void; scope: 'goods' | 'operating' }) {
  const toast = useToast()
  const [status, setStatus] = useState<'pending' | 'paid' | 'all'>('pending')
  const [subF, setSubF] = useState('')
  const op = scope === 'operating'
  const L = op
    ? { total: 'Tổng chờ chi', n: 'lệnh chưa chi', old: 'Chờ chi trên 60 ngày', who: 'Đối tác đang chờ chi', head: 'Đối tác', empty: 'Chưa có lệnh chi phí vận hành nào', file: 'chi-phi-van-hanh' }
    : { total: 'Tổng còn nợ', n: 'lệnh chưa chi', old: 'Nợ trên 60 ngày', who: 'Nhà cung cấp còn nợ', head: 'Nhà cung cấp', empty: 'Chưa có lệnh công nợ nào', file: 'cong-no-ncc' }
  const [age, setAge] = useState(0)
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [dlg, setDlg] = useState<'paste' | 'manual' | null>(null)
  const [busy, setBusy] = useState(false)
  const t0 = today()

  const partnerById = useMemo(() => new Map(data.partners.map((p) => [p.id, p])), [data.partners])
  const acctPartner = useMemo(() => new Map(data.accounts.map((a) => [a.account_no, partnerById.get(a.partner_id)])), [data.accounts, partnerById])
  const matches = useMemo(() => matchPaid(data.orders, data.txs), [data.orders, data.txs])

  const rows = useMemo(() => data.orders.map((o) => {
    const partner = acctPartner.get(o.account_no)
    // Chưa đặt tên: tự nhận ra khoản vận hành (lương, thuê nhà, thuê xe, tạm ứng) theo nội dung lệnh
    const guess = partner ? null : guessKind([o.note])
    return { o, partner, kind: partner?.kind ?? guess!.kind, sub: partner?.sub_kind || guess?.sub || '', key: partner?.id ?? `acct:${o.account_no}`, name: partner?.name ?? o.supplier_raw, age: ageDays(o, t0), match: matches.get(o.id) }
  }), [data.orders, acctPartner, matches, t0])

  // Hai mục tách riêng: Công nợ NCC (hàng hóa) và Chi phí vận hành (lương, thuê nhà, vận chuyển, tạm ứng)
  const inScope = (r: (typeof rows)[number]) => (op ? r.kind === 'operating' : r.kind !== 'operating')
  const scoped = rows.filter(inScope)
  const pending = scoped.filter((r) => r.o.status === 'pending')
  const kpi = {
    total: pending.reduce((s, r) => s + r.o.amount, 0),
    n: pending.length,
    old: pending.filter((r) => r.age > 60).reduce((s, r) => s + r.o.amount, 0),
    unnamed: new Set(pending.filter((r) => !r.partner).map((r) => r.o.account_no)).size,
  }

  const needle = plain(q)
  const shown = scoped.filter((r) =>
    (status === 'all' || r.o.status === status) &&
    (!age || r.age > age) &&
    (!subF || r.sub === subF) &&
    (!needle || plain(`${r.name} ${r.o.supplier_raw} ${r.o.invoice_no} ${r.o.order_no ?? ''} ${r.o.account_no}`).includes(needle)))
  const groups = (() => {
    const m = new Map<string, { key: string; name: string; partner?: Partner; kind: string; sub: string; acct: string; items: typeof shown }>()
    for (const r of shown) {
      const g = m.get(r.key) ?? { key: r.key, name: r.name, partner: r.partner, kind: r.kind, sub: r.sub, acct: r.o.account_no, items: [] }
      g.items.push(r)
      m.set(r.key, g)
    }
    return [...m.values()]
      .map((g) => ({ ...g, items: g.items.sort((a, b) => (a.o.order_date ?? a.o.invoice_date ?? '').localeCompare(b.o.order_date ?? b.o.invoice_date ?? '')),
        total: g.items.reduce((s, r) => s + r.o.amount, 0), oldest: Math.max(...g.items.map((r) => r.age)) }))
      .sort((a, b) => b.total - a.total)
  })()

  const scopeIds = new Set(scoped.map((r) => r.o.id))
  const pendingAll = data.orders.filter((o) => o.status === 'pending' && scopeIds.has(o.id))
  const matchList = pendingAll.filter((o) => matches.has(o.id))

  async function run(fn: () => Promise<void>, ok: string) {
    setBusy(true)
    try { await fn(); reload(); toast(ok) } catch (e) { toast(errText(e), true) } finally { setBusy(false) }
  }
  const closeMatches = () => {
    if (!confirm(`Đánh dấu ${matchList.length} lệnh là ĐÃ CHI (khớp với khoản chi trong Sổ thu chi, tổng ${money(matchList.reduce((s, o) => s + o.amount, 0))})?`)) return
    void run(() => markPaid(matchList.map((o) => ({ id: o.id, tx_id: matches.get(o.id)!.id, date: matches.get(o.id)!.tx_date }))), `Đã đóng ${matchList.length} lệnh`)
  }

  async function exportFile() {
    await exportXlsx(`${L.file}-${t0}.xlsx`,
      [L.head, 'Số tài khoản', 'Mã lệnh', 'Hóa đơn', 'Ngày hóa đơn', 'Ngày tạo lệnh', 'Tuổi nợ (ngày)', 'Số tiền', 'Trạng thái'],
      groups.flatMap((g) => g.items.map((r) => [g.name, r.o.account_no, r.o.order_no ?? '', r.o.invoice_no, r.o.invoice_date ? vnDate(r.o.invoice_date) : '', r.o.order_date ? vnDate(r.o.order_date) : '', r.age, r.o.amount, STATUS_LABEL[r.o.status]])))
  }

  const toggle = (k: string) => setOpen((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n })

  return (
    <div className="stack">
      <div className="mem-grid-4">
        <div className="mem-card"><div className="mem-caption">{L.total}</div><div className="mem-kpi">{money(kpi.total)}</div><div className="mem-caption">{num(kpi.n)} {L.n}</div></div>
        <div className="mem-card"><div className="mem-caption">{L.old}</div><div className="mem-kpi">{money(kpi.old)}</div><div className="mem-caption">Tính từ ngày tạo lệnh</div></div>
        <div className="mem-card"><div className="mem-caption">{L.who}</div><div className="mem-kpi">{num(new Set(pending.map((r) => r.key)).size)}</div></div>
        <div className="mem-card"><div className="mem-caption">Số tài khoản chưa đặt tên</div><div className="mem-kpi">{num(kpi.unnamed)}</div>
          {kpi.unnamed > 0 && <button className="mem-btn mem-btn-sm" style={{ marginTop: 6 }} onClick={goPartners}>Đặt tên ngay</button>}</div>
      </div>

      {canEdit && matchList.length > 0 && (
        <div className="alert good" role="status">
          <div style={{ flex: 1 }}><span className="t">{matchList.length} lệnh có vẻ đã chi.</span> Khớp số tiền và số hóa đơn với khoản chi trong Sổ thu chi (tổng {money(matchList.reduce((s, o) => s + o.amount, 0))}).</div>
          <button className="mem-btn mem-btn-primary mem-btn-sm" disabled={busy} onClick={closeMatches}>Đánh dấu đã chi</button>
        </div>
      )}

      <div className="mem-card stack">
        <div className="spread" style={{ flexWrap: 'wrap', gap: 10 }}>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <input className="input" style={{ width: 220 }} placeholder="Tìm nhà cung cấp, hóa đơn..." value={q} onChange={(e) => setQ(e.target.value)} aria-label="Tìm" />
            {op && (
              <select className="input" style={{ width: 'auto' }} value={subF} onChange={(e) => setSubF(e.target.value)} aria-label="Nhóm chi phí">
                <option value="">Mọi nhóm</option>{OP_GROUPS.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            )}
            <select className="input" style={{ width: 'auto' }} value={status} onChange={(e) => setStatus(e.target.value as typeof status)} aria-label="Trạng thái">
              <option value="pending">Còn nợ</option><option value="paid">Đã chi</option><option value="all">Mọi trạng thái</option>
            </select>
            <select className="input" style={{ width: 'auto' }} value={age} onChange={(e) => setAge(Number(e.target.value))} aria-label="Tuổi nợ">
              <option value={0}>Mọi tuổi nợ</option><option value={30}>Trên 30 ngày</option><option value={60}>Trên 60 ngày</option>
            </select>
          </div>
          <div className="row head-actions">
            <button className="mem-btn" onClick={() => void exportFile()}><IconDownload /> Xuất Excel</button>
            {canEdit && <button className="mem-btn" onClick={() => setDlg('manual')}><IconPlus /> Thêm lệnh</button>}
            {canEdit && <button className="mem-btn mem-btn-primary" onClick={() => setDlg('paste')}><IconUpload /> Dán lệnh từ eFAST</button>}
          </div>
        </div>

        {groups.length === 0 ? (
          <Empty title={rows.some(inScope) ? 'Không có lệnh nào khớp bộ lọc' : L.empty} hint={canEdit && !data.orders.length ? 'Bấm “Dán lệnh từ eFAST”, mở danh sách điện chờ duyệt trên eFAST, chọn tất cả, sao chép rồi dán vào.' : undefined} />
        ) : (
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>{L.head}</th><th className="num">Số lệnh</th><th className="num">Tuổi nợ lâu nhất</th><th className="num">Tổng tiền</th></tr></thead>
              <tbody>
                {groups.map((g) => {
                  const isOpen = open.has(g.key)
                  return [
                    <tr key={g.key} style={{ cursor: 'pointer' }} onClick={() => toggle(g.key)}>
                      <td><button type="button" className="row" style={{ background: 'none', border: 0, padding: 0, font: 'inherit', fontWeight: 800, cursor: 'pointer', textAlign: 'left' }} aria-expanded={isOpen}>
                        <Chevron open={isOpen} /> {g.name}</button>
                        {!g.partner && <span className="mem-tag mem-tag-warning" style={{ marginLeft: 8 }}>Chưa đặt tên · {maskAcct(g.acct)}</span>}
                        {g.kind === 'operating' && <span className="mem-tag mem-tag-success" style={{ marginLeft: 8 }}>{g.sub || 'Vận hành'}</span>}</td>
                      <td className="num">{g.items.length}</td>
                      <td className="num">{g.oldest} ngày</td>
                      <td className="num"><b>{money(g.total)}</b></td>
                    </tr>,
                    isOpen && (
                      <tr key={`${g.key}-d`}><td colSpan={4} style={{ padding: 0, background: '#fafbf9' }}>
                        <table className="tbl" style={{ margin: 0 }}>
                          <thead><tr><th>Mã lệnh</th><th>Hóa đơn</th><th>Ngày HĐ</th><th>Ngày tạo lệnh</th><th className="num">Tuổi nợ</th><th className="num">Số tiền</th><th>Trạng thái</th>{canEdit && <th />}</tr></thead>
                          <tbody>
                            {g.items.map((r) => (
                              <tr key={r.o.id}>
                                <td>{r.o.order_no ?? '—'}</td>
                                <td>{r.o.invoice_no || '—'}</td>
                                <td>{r.o.invoice_date ? vnDate(r.o.invoice_date) : '—'}</td>
                                <td>{r.o.order_date ? vnDate(r.o.order_date) : '—'}</td>
                                <td className="num">{r.o.status === 'pending' ? `${r.age} ngày` : '—'}</td>
                                <td className="num">{money(r.o.amount)}</td>
                                <td><span className={`mem-tag ${STATUS_CLS[r.o.status]}`}>{STATUS_LABEL[r.o.status]}</span>
                                  {r.o.status === 'paid' && r.o.paid_date && <span className="mem-caption"> {vnDate(r.o.paid_date)}</span>}
                                  {r.o.status === 'pending' && r.match && <div className="mem-caption">Có vẻ đã chi ngày {vnDate(r.match.tx_date)}</div>}</td>
                                {canEdit && (
                                  <td style={{ whiteSpace: 'nowrap' }}>
                                    {r.o.status === 'pending' && <button className="mem-btn mem-btn-sm" disabled={busy} onClick={() => void run(() => updateOrder(r.o.id, { status: 'paid', paid_date: r.match?.tx_date ?? t0, paid_tx_id: r.match?.id ?? null }), 'Đã đánh dấu đã chi')}>Đã chi</button>}{' '}
                                    {r.o.status === 'pending' && <button className="mem-btn mem-btn-sm" disabled={busy} onClick={() => void run(() => updateOrder(r.o.id, { status: 'cancelled' }), 'Đã hủy lệnh')}>Hủy lệnh</button>}
                                    {r.o.status !== 'pending' && <button className="mem-btn mem-btn-sm" disabled={busy} onClick={() => void run(() => updateOrder(r.o.id, { status: 'pending', paid_date: null, paid_tx_id: null }), 'Đã chuyển lại thành còn nợ')}>Còn nợ lại</button>}{' '}
                                    <button className="mem-btn mem-btn-sm" disabled={busy} onClick={() => { if (confirm('Xóa lệnh này? Không hoàn tác được.')) void run(() => deleteOrder(r.o.id), 'Đã xóa') }}>Xóa</button>
                                  </td>
                                )}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td></tr>
                    ),
                  ]
                })}
              </tbody>
              <tfoot><tr><td><b>Cộng ({groups.length} {op ? 'đối tác' : 'nhà cung cấp'})</b></td><td className="num">{groups.reduce((s, g) => s + g.items.length, 0)}</td><td /><td className="num"><b>{money(groups.reduce((s, g) => s + g.total, 0))}</b></td></tr></tfoot>
            </table>
          </div>
        )}
      </div>

      {dlg === 'paste' && <PasteDialog existing={data.orders} onClose={() => setDlg(null)} onDone={(n) => { setDlg(null); reload(); toast(`Đã thêm ${n} lệnh`) }} />}
      {dlg === 'manual' && <ManualDialog data={data} onClose={() => setDlg(null)} onDone={() => { setDlg(null); reload(); toast('Đã thêm lệnh') }} />}
    </div>
  )
}

function PasteDialog({ existing, onClose, onDone }: { existing: PayOrder[]; onClose: () => void; onDone: (n: number) => void }) {
  const toast = useToast()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const parsed = useMemo(() => (text.trim() ? parseEfast(text) : []), [text])
  const have = useMemo(() => new Set(existing.map((o) => o.order_no).filter(Boolean)), [existing])
  const fresh = parsed.filter((p) => !p.order_no || !have.has(p.order_no))
  async function save() {
    setBusy(true)
    try { onDone(await addOrders(fresh)) } catch (e) { toast(errText(e), true) } finally { setBusy(false) }
  }
  return (
    <Modal title="Dán lệnh từ eFAST" onClose={onClose} wide>
      <div className="stack">
        <div className="mem-caption">Trên eFAST mở “Danh sách điện chờ duyệt”, chọn cả bảng (Ctrl/Cmd + A), sao chép (Ctrl/Cmd + C) rồi dán vào ô dưới. Hệ thống tự đọc mã lệnh, nhà cung cấp, số tài khoản, hóa đơn, ngày và số tiền. Lệnh đã có (cùng mã lệnh) sẽ được bỏ qua, nên dán lại nhiều lần không bị nhân đôi.</div>
        <textarea className="input" rows={9} value={text} onChange={(e) => setText(e.target.value)} placeholder="Dán nội dung bảng vào đây..." aria-label="Nội dung dán từ eFAST" />
        {text.trim() && (parsed.length === 0
          ? <div className="alert warn">Chưa đọc được lệnh nào. Hãy chắc là bạn đã chọn và sao chép đúng bảng “Điện chuyển tiền” (mỗi lệnh có mã dạng 1031926P03376011).</div>
          : <div className="alert good"><div><span className="t">Đọc được {parsed.length} lệnh, tổng {money(parsed.reduce((s, p) => s + p.amount, 0))}.</span> {fresh.length} lệnh mới, {parsed.length - fresh.length} lệnh đã có.</div></div>)}
        {fresh.length > 0 && (
          <div className="table-wrap" style={{ maxHeight: 260, overflow: 'auto' }}>
            <table className="tbl"><thead><tr><th>Người nhận</th><th>Hóa đơn</th><th>Ngày HĐ</th><th className="num">Số tiền</th></tr></thead>
              <tbody>{fresh.slice(0, 200).map((p) => <tr key={p.order_no}><td>{p.supplier_raw}</td><td>{p.invoice_no || '—'}</td><td>{p.invoice_date ? vnDate(p.invoice_date) : '—'}</td><td className="num">{money(p.amount)}</td></tr>)}</tbody></table>
          </div>
        )}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="mem-btn" onClick={onClose}>Đóng</button>
          <button className="mem-btn mem-btn-primary" disabled={busy || fresh.length === 0} onClick={() => void save()}>{busy ? 'Đang lưu...' : `Thêm ${fresh.length} lệnh`}</button>
        </div>
      </div>
    </Modal>
  )
}

function ManualDialog({ data, onClose, onDone }: { data: PayData; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const [acct, setAcct] = useState('')
  const [name, setName] = useState('')
  const [inv, setInv] = useState('')
  const [invDate, setInvDate] = useState('')
  const [amount, setAmount] = useState(0)
  const [orderDate, setOrderDate] = useState(today())
  const [note, setNote] = useState('')
  const [err, setErr] = useState('')
  const partner = data.partners.find((p) => p.id === data.accounts.find((a) => a.account_no === acct.trim())?.partner_id)
  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!acct.trim()) return setErr('Cần số tài khoản người nhận.')
    if (!amount) return setErr('Cần số tiền.')
    const row: NewOrder = { order_no: null, account_no: acct.trim(), supplier_raw: partner?.name ?? name.trim(), invoice_no: inv.trim(), invoice_date: invDate || null, amount, order_date: orderDate || null, note }
    try { await addOrders([row]); onDone() } catch (x) { toast(errText(x), true) }
  }
  return (
    <Modal title="Thêm lệnh công nợ" onClose={onClose}>
      <form className="stack" onSubmit={(e) => void submit(e)}>
        <div className="field"><label htmlFor="mo-acct">Số tài khoản người nhận</label>
          <input id="mo-acct" className="input" list="mo-accts" value={acct} onChange={(e) => setAcct(e.target.value)} inputMode="numeric" />
          <datalist id="mo-accts">{data.accounts.map((a) => <option key={a.account_no} value={a.account_no}>{data.partners.find((p) => p.id === a.partner_id)?.name}</option>)}</datalist>
          {partner && <span className="mem-caption">Nhà cung cấp: {partner.name}</span>}</div>
        {!partner && <div className="field"><label htmlFor="mo-name">Tên người nhận (như ngân hàng ghi)</label><input id="mo-name" className="input" value={name} onChange={(e) => setName(e.target.value)} /></div>}
        <div className="form-grid">
          <div className="field"><label htmlFor="mo-inv">Số hóa đơn</label><input id="mo-inv" className="input" value={inv} onChange={(e) => setInv(e.target.value)} /></div>
          <div className="field"><label htmlFor="mo-id">Ngày hóa đơn</label><input id="mo-id" type="date" className="input" value={invDate} onChange={(e) => setInvDate(e.target.value)} /></div>
          <div className="field"><label htmlFor="mo-amt">Số tiền</label><MoneyInput id="mo-amt" value={amount} onChange={setAmount} /></div>
          <div className="field"><label htmlFor="mo-od">Ngày tạo lệnh</label><input id="mo-od" type="date" className="input" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} /></div>
        </div>
        <div className="field"><label htmlFor="mo-note">Ghi chú</label><input id="mo-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} /></div>
        {err && <div className="alert bad" role="alert">{err}</div>}
        <div className="row" style={{ justifyContent: 'flex-end' }}><button type="button" className="mem-btn" onClick={onClose}>Đóng</button><button className="mem-btn mem-btn-primary">Lưu</button></div>
      </form>
    </Modal>
  )
}
