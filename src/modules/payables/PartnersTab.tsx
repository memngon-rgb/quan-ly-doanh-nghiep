import { useMemo, useState, type FormEvent } from 'react'
import { money, num } from '../../core/format'
import { IconPlus } from '../../core/icons'
import { Empty, Modal, errText, useToast } from '../../core/ui'
import { deletePartner, savePartner, type PartnerInput } from './api'
import { maskAcct, type PayData } from './DebtTab'
import { guessKind, KIND_LABEL, OP_GROUPS, plain, type Partner, type PartnerAccount, type PartnerKind } from './logic'

interface Unnamed { account_no: string; names: string[]; notes: string[]; orders: number; owed: number; txs: number; paid: number }

export default function PartnersTab({ data, reload, canEdit }: { data: PayData; reload: () => void; canEdit: boolean }) {
  const toast = useToast()
  const [dlg, setDlg] = useState<{ init?: PartnerInput; accounts?: { account_no: string; seen_name: string }[]; hint?: { kind: PartnerKind; sub: string } } | null>(null)
  const [q, setQ] = useState('')

  const named = useMemo(() => new Set(data.accounts.map((a) => a.account_no)), [data.accounts])

  const unnamed = useMemo(() => {
    const m = new Map<string, Unnamed>()
    const get = (a: string) => m.get(a) ?? { account_no: a, names: [], notes: [], orders: 0, owed: 0, txs: 0, paid: 0 }
    const put = (u: Unnamed) => m.set(u.account_no, u)
    for (const o of data.orders) {
      if (named.has(o.account_no)) continue
      const u = get(o.account_no)
      if (o.supplier_raw && !u.names.includes(o.supplier_raw)) u.names.push(o.supplier_raw)
      u.notes.push(o.note)
      u.orders++
      if (o.status === 'pending') u.owed += o.amount
      put(u)
    }
    for (const t of data.txs) {
      if (t.type !== 'expense' || !t.counterparty_account || named.has(t.counterparty_account)) continue
      const u = get(t.counterparty_account)
      const nm = (t.counterparty_name ?? '').trim()
      if (nm && !u.names.includes(nm)) u.names.push(nm)
      u.notes.push(t.note)
      u.txs++
      u.paid += t.amount
      put(u)
    }
    return [...m.values()].filter((u) => u.owed > 0 || u.paid > 0).sort((a, b) => b.owed + b.paid - (a.owed + a.paid))
  }, [data.orders, data.txs, named])

  const owedByPartner = useMemo(() => {
    const acctPartner = new Map(data.accounts.map((a) => [a.account_no, a.partner_id]))
    const m = new Map<string, number>()
    for (const o of data.orders) if (o.status === 'pending') { const p = acctPartner.get(o.account_no); if (p) m.set(p, (m.get(p) ?? 0) + o.amount) }
    return m
  }, [data.orders, data.accounts])

  const needle = plain(q)
  const list = data.partners.filter((p) => !needle || plain(p.name).includes(needle))

  return (
    <div className="stack">
      {unnamed.length > 0 && (
        <div className="mem-card stack">
          <div className="spread"><div><div className="section-title">Chưa đặt tên ({unnamed.length} số tài khoản)</div>
            <div className="mem-caption">Số tài khoản lấy từ lệnh chờ duyệt và sao kê ngân hàng. Đặt tên có dấu một lần, mọi lệnh và khoản chi của số tài khoản đó sẽ gộp về đúng nhà cung cấp.</div></div></div>
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>Tên ngân hàng ghi</th><th>Số tài khoản</th><th className="num">Còn nợ</th><th className="num">Đã chi (sổ)</th>{canEdit && <th />}</tr></thead>
              <tbody>
                {unnamed.map((u) => (
                  <tr key={u.account_no}>
                    <td>{u.names.slice(0, 2).join(' / ') || '—'}</td>
                    <td>{maskAcct(u.account_no)}</td>
                    <td className="num">{u.owed ? money(u.owed) : '—'}</td>
                    <td className="num">{u.paid ? `${money(u.paid)} · ${num(u.txs)} khoản` : '—'}</td>
                    {canEdit && <td><button className="mem-btn mem-btn-sm" onClick={() => setDlg({ accounts: [{ account_no: u.account_no, seen_name: u.names[0] ?? '' }], hint: guessKind(u.notes), init: { name: u.names[0] ?? '', kind: 'supplier', sub_kind: '', note: '', accounts: [] } })}>Đặt tên</button></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="mem-card stack">
        <div className="spread" style={{ flexWrap: 'wrap', gap: 10 }}>
          <div><div className="section-title">Đối tác ({data.partners.length})</div><div className="mem-caption">Nhà cung cấp hàng hóa và chi phí vận hành (nhân sự, mặt bằng, vận chuyển). Chi phí vận hành không nằm trong công nợ nhà cung cấp.</div></div>
          <div className="row">
            <input className="input" style={{ width: 200 }} placeholder="Tìm đối tác..." value={q} onChange={(e) => setQ(e.target.value)} aria-label="Tìm đối tác" />
            {canEdit && <button className="mem-btn mem-btn-primary" onClick={() => setDlg({ init: { name: '', kind: 'supplier', sub_kind: '', note: '', accounts: [] } })}><IconPlus /> Thêm đối tác</button>}
          </div>
        </div>
        {list.length === 0 ? <Empty title="Chưa có đối tác nào" hint="Đặt tên cho các số tài khoản ở bảng “Chưa đặt tên” phía trên, hoặc thêm thủ công." /> : (
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>Tên</th><th>Loại</th><th>Số tài khoản</th><th className="num">Còn nợ</th>{canEdit && <th />}</tr></thead>
              <tbody>
                {list.map((p) => {
                  const accs = data.accounts.filter((a) => a.partner_id === p.id)
                  return (
                    <tr key={p.id}>
                      <td><b>{p.name}</b></td>
                      <td>{p.kind === 'operating' ? `Vận hành${p.sub_kind ? ` · ${p.sub_kind}` : ''}` : 'Hàng hóa'}</td>
                      <td>{accs.map((a) => maskAcct(a.account_no)).join(', ') || '—'}</td>
                      <td className="num">{owedByPartner.get(p.id) ? money(owedByPartner.get(p.id)!) : '—'}</td>
                      {canEdit && (
                        <td style={{ whiteSpace: 'nowrap' }}>
                          <button className="mem-btn mem-btn-sm" onClick={() => setDlg({ init: { id: p.id, name: p.name, kind: p.kind, sub_kind: p.sub_kind, note: p.note, accounts: accs.map((a) => ({ account_no: a.account_no, seen_name: a.seen_name })) } })}>Sửa</button>{' '}
                          <button className="mem-btn mem-btn-sm" onClick={() => { if (confirm(`Xóa đối tác “${p.name}”? Các số tài khoản của họ sẽ về lại danh sách “Chưa đặt tên”.`)) void deletePartner(p.id).then(reload).catch((e) => toast(errText(e), true)) }}>Xóa</button>
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {dlg?.init && <PartnerDialog init={dlg.init} extra={dlg.accounts} hint={dlg.hint} partners={data.partners} allAccounts={data.accounts} onClose={() => setDlg(null)} onDone={() => { setDlg(null); reload(); toast('Đã lưu') }} />}
    </div>
  )
}

function PartnerDialog({ init, extra, hint, partners, allAccounts, onClose, onDone }: {
  init: PartnerInput; extra?: { account_no: string; seen_name: string }[]; hint?: { kind: PartnerKind; sub: string }
  partners: Partner[]; allAccounts: PartnerAccount[]; onClose: () => void; onDone: () => void
}) {
  const toast = useToast()
  const [name, setName] = useState(init.name)
  const [kind, setKind] = useState<PartnerKind>(hint?.kind ?? init.kind)
  const [sub, setSub] = useState(hint?.sub || init.sub_kind || OP_GROUPS[0])
  const [note, setNote] = useState(init.note)
  const [accounts, setAccounts] = useState([...init.accounts, ...(extra ?? [])])
  const [newAcct, setNewAcct] = useState('')
  const [target, setTarget] = useState('') // gộp vào đối tác đã có
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const merging = !init.id && !!extra && !!target

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!merging && !name.trim()) return setErr('Cần nhập tên đối tác.')
    setBusy(true)
    try {
      if (merging) {
        // Thêm số tài khoản vào đối tác đã có, giữ nguyên các số cũ
        const p = partners.find((x) => x.id === target)!
        await savePartner({ id: target, name: p.name, kind: p.kind, sub_kind: p.sub_kind, note: p.note,
          accounts: [...allAccounts.filter((a) => a.partner_id === target).map((a) => ({ account_no: a.account_no, seen_name: a.seen_name })), ...accounts] })
      } else {
        await savePartner({ id: init.id, name, kind, sub_kind: sub, note, accounts })
      }
      onDone()
    } catch (x) { toast(errText(x), true) } finally { setBusy(false) }
  }

  return (
    <Modal title={init.id ? 'Sửa đối tác' : extra ? 'Đặt tên cho số tài khoản' : 'Thêm đối tác'} onClose={onClose}>
      <form className="stack" onSubmit={(e) => void submit(e)}>
        {!init.id && extra && partners.length > 0 && (
          <div className="field"><label htmlFor="pd-t">Gộp vào đối tác đã có (nếu nhà cung cấp này có nhiều số tài khoản)</label>
            <select id="pd-t" className="input" value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="">— Tạo đối tác mới —</option>
              {partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select></div>
        )}
        {!merging && (
          <>
            <div className="field"><label htmlFor="pd-n">Tên (có dấu)</label><input id="pd-n" className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus /></div>
            <div className="form-grid">
              <div className="field"><label htmlFor="pd-k">Loại</label>
                <select id="pd-k" className="input" value={kind} onChange={(e) => setKind(e.target.value as PartnerKind)}>
                  {(Object.keys(KIND_LABEL) as PartnerKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
                </select></div>
              {kind === 'operating' && (
                <div className="field"><label htmlFor="pd-s">Nhóm chi phí vận hành</label>
                  <select id="pd-s" className="input" value={sub} onChange={(e) => setSub(e.target.value)}>{OP_GROUPS.map((g) => <option key={g}>{g}</option>)}</select></div>
              )}
            </div>
            <div className="field"><label htmlFor="pd-o">Ghi chú</label><input id="pd-o" className="input" value={note} onChange={(e) => setNote(e.target.value)} /></div>
          </>
        )}
        <div className="field"><span className="lbl">Số tài khoản</span>
          <div className="chip-row">
            {accounts.map((a) => <button key={a.account_no} type="button" className="chip on" title="Bấm để bỏ số này" onClick={() => setAccounts(accounts.filter((x) => x.account_no !== a.account_no))}>{maskAcct(a.account_no)} ✕</button>)}
            {accounts.length === 0 && <span className="mem-caption">Chưa có số tài khoản nào.</span>}
          </div>
          {!merging && (
            <div className="row" style={{ marginTop: 8 }}>
              <input className="input" style={{ width: 220 }} placeholder="Thêm số tài khoản" inputMode="numeric" value={newAcct} onChange={(e) => setNewAcct(e.target.value)} aria-label="Thêm số tài khoản" />
              <button type="button" className="mem-btn mem-btn-sm" onClick={() => { const n = newAcct.trim(); if (n && !accounts.some((a) => a.account_no === n)) setAccounts([...accounts, { account_no: n, seen_name: '' }]); setNewAcct('') }}>Thêm</button>
            </div>
          )}
        </div>
        {err && <div className="alert bad" role="alert">{err}</div>}
        <div className="row" style={{ justifyContent: 'flex-end' }}><button type="button" className="mem-btn" onClick={onClose}>Đóng</button><button className="mem-btn mem-btn-primary" disabled={busy}>{busy ? 'Đang lưu...' : 'Lưu'}</button></div>
      </form>
    </Modal>
  )
}
