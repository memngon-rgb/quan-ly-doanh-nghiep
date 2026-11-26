import { useMemo, useState } from 'react'
import { useAuth } from '../../core/auth'
import { DateRangePicker, useDateRange } from '../../core/DateRange'
import { exportXlsx } from '../../core/excel'
import { money, num, pct, vnDate } from '../../core/format'
import { IconDownload, IconUpload } from '../../core/icons'
import { Empty, ErrorBox, Loading, Modal, PageHead, errText, useAsync, useToast } from '../../core/ui'
import { deleteSalesDay, listChannels, listSales } from './api'
import ImportPanel from './Import'

/** Doanh thu theo ngày (lấy từ báo cáo iPOS A02 và B03). Nhập file doanh thu nằm ngay tại đây. */
export default function Revenue() {
  const { branches, can } = useAuth()
  const toast = useToast()
  const [range, setRange] = useDateRange()
  const [importing, setImporting] = useState(false)
  const [tab, setTab] = useState<'store' | 'channel'>('store')
  const [showDays, setShowDays] = useState(true)
  const [dayBranch, setDayBranch] = useState('')
  const [chanBranch, setChanBranch] = useState('')
  const sales = useAsync(() => listSales('', range.from, range.to), [range.from, range.to])
  const chans = useAsync(() => listChannels('', range.from, range.to), [range.from, range.to])
  const branchName = useMemo(() => new Map(branches.map((b) => [b.id, b.name])), [branches])

  const rows = useMemo(
    () => [...(sales.data ?? [])].sort((a, b) => (a.sale_date === b.sale_date ? a.branch_id.localeCompare(b.branch_id) : b.sale_date.localeCompare(a.sale_date))),
    [sales.data],
  )
  const t = useMemo(() => {
    const sum = (f: (x: (typeof rows)[number]) => number) => rows.reduce((a, x) => a + f(x), 0)
    return {
      net: sum((x) => x.revenue), vat: sum((x) => x.vat ?? 0), orders: sum((x) => x.orders), gross: sum((x) => x.gross ?? 0),
      discount: sum((x) => (x.discount ?? 0) + (x.merchant_discount ?? 0) + (x.voucher ?? 0)), commission: sum((x) => x.commission ?? 0),
    }
  }, [rows])
  const missingDetail = rows.length > 0 && t.gross === 0

  const byStore = useMemo(() => {
    const m = new Map<string, { orders: number; gross: number; discount: number; commission: number; net: number; vat: number }>()
    for (const x of rows) {
      const cur = m.get(x.branch_id) ?? { orders: 0, gross: 0, discount: 0, commission: 0, net: 0, vat: 0 }
      cur.orders += x.orders; cur.gross += x.gross ?? 0; cur.discount += (x.discount ?? 0) + (x.merchant_discount ?? 0) + (x.voucher ?? 0)
      cur.commission += x.commission ?? 0; cur.net += x.revenue; cur.vat += x.vat ?? 0
      m.set(x.branch_id, cur)
    }
    return [...m.entries()].map(([id, v]) => ({ id, name: branchName.get(id) ?? '—', ...v })).sort((a, b) => b.net - a.net)
  }, [rows, branchName])

  const dayRows = useMemo(
    () => rows.filter((x) => !dayBranch || x.branch_id === dayBranch).sort((a, b) => (a.sale_date === b.sale_date ? (branchName.get(a.branch_id) ?? '').localeCompare(branchName.get(b.branch_id) ?? '') : a.sale_date.localeCompare(b.sale_date))),
    [rows, dayBranch, branchName],
  )

  const byChannel = useMemo(() => {
    const m = new Map<string, { orders: number; gross: number; discount: number; commission: number; net: number }>()
    for (const c of (chans.data ?? []).filter((x) => !chanBranch || x.branch_id === chanBranch)) {
      const cur = m.get(c.channel) ?? { orders: 0, gross: 0, discount: 0, commission: 0, net: 0 }
      cur.orders += c.orders; cur.gross += c.gross; cur.discount += c.discount; cur.commission += c.commission; cur.net += c.net
      m.set(c.channel, cur)
    }
    return [...m.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.net - a.net)
  }, [chans.data, chanBranch])
  const chanNet = byChannel.reduce((a, c) => a + c.net, 0)

  async function removeDay(branch: string, date: string) {
    if (!confirm(`Xóa doanh thu, phương thức thanh toán và nguồn đơn ngày ${vnDate(date)} của ${branchName.get(branch) ?? 'chi nhánh này'}? Sau đó bạn có thể nhập lại ngày này từ file.`)) return
    try {
      await deleteSalesDay(branch, date)
      toast('Đã xóa dữ liệu ngày ' + vnDate(date))
      sales.reload()
      chans.reload()
    } catch (e) {
      toast(errText(e), true)
    }
  }

  async function exportFile() {
    await exportXlsx(
      `doanh-thu-${range.from}_${range.to}`,
      ['Ngày', 'Chi nhánh', 'Số hóa đơn', 'Số khách', 'Doanh thu Gross', 'Giảm giá', 'Chiết khấu', 'Phí hỗ trợ marketing', 'Phiếu GG', 'Hoa hồng', 'Doanh thu Net', 'Thuế VAT đầu ra', 'Thuế khấu trừ', 'Giảm giá VAT', 'Net sau khi trừ VAT'],
      rows.map((x) => [
        vnDate(x.sale_date), branchName.get(x.branch_id) ?? '', x.orders, x.guests ?? 0, x.gross ?? 0, x.discount ?? 0, x.merchant_discount ?? 0,
        x.marketing_fee ?? 0, x.voucher ?? 0, x.commission ?? 0, x.revenue, x.vat ?? 0, x.withholding_tax ?? 0, x.vat_discount ?? 0, x.revenue - (x.vat ?? 0),
      ]),
    )
  }

  return (
    <div className="stack">
      <PageHead
        controls={<DateRangePicker value={range} onChange={setRange} />}
        eyebrow="Tài chính"
        title="Doanh thu"
        sub="Doanh thu bán hàng theo ngày từ POS. Tải báo cáo iPOS A02 (theo cửa hàng) và B03 (theo nguồn đơn)."
        right={
          <>
            <button className="mem-btn" onClick={() => void exportFile()} disabled={!rows.length}><IconDownload /> Xuất Excel</button>
            {can('finance.import') && <button className="mem-btn mem-btn-primary" onClick={() => setImporting(true)}><IconUpload /> Nhập file doanh thu</button>}
          </>
        }
      />

      <div className="mem-card stack">
        <div className="mem-grid-4">
          <div>
            <div className="mem-caption">Doanh thu (Net)</div>
            <div className="mem-kpi">{money(t.net)}</div>
            <div className="mem-caption">Trừ thuế VAT {money(t.vat)} còn lại <b>{money(t.net - t.vat)}</b></div>
          </div>
          <div><div className="mem-caption">Doanh thu Gross</div><div className="mem-kpi">{money(t.gross)}</div><div className="mem-caption">{num(t.orders)} hóa đơn{t.orders > 0 ? ` · TB ${money(t.net / t.orders)}/hóa đơn` : ''}</div></div>
          <div><div className="mem-caption">Giảm giá, chiết khấu, phiếu GG</div><div className="mem-kpi">{money(t.discount)}</div><div className="mem-caption">{t.gross > 0 ? `${pct(t.discount / t.gross)} doanh thu Gross` : ''}</div></div>
          <div><div className="mem-caption">Hoa hồng nền tảng</div><div className="mem-kpi">{money(t.commission)}</div><div className="mem-caption">{t.gross > 0 ? `${pct(t.commission / t.gross)} doanh thu Gross` : ''}</div></div>
        </div>
        {missingDetail && <div className="alert warn"><div><span className="t">Các cột Gross, giảm giá, hoa hồng chưa có.</span> Nhập lại báo cáo A02 (sau khi chạy SQL 0007) để điền đủ.</div></div>}

        <div className="seg" role="tablist" aria-label="Cách xem doanh thu">
          <button role="tab" aria-selected={tab === 'store'} className={tab === 'store' ? 'on' : ''} onClick={() => setTab('store')}>Theo cửa hàng</button>
          <button role="tab" aria-selected={tab === 'channel'} className={tab === 'channel' ? 'on' : ''} onClick={() => setTab('channel')}>Theo nguồn đơn</button>
        </div>

        {sales.loading || chans.loading ? <Loading /> : sales.error ? <ErrorBox error={sales.error} retry={sales.reload} /> : rows.length === 0 && tab === 'store' ? (
          <Empty title="Chưa có doanh thu trong khoảng ngày này" hint="Bấm “Nhập file doanh thu” rồi chọn báo cáo A02 xuất từ iPOS." />
        ) : tab === 'store' ? (
          <>
            <div className="table-wrap">
              <table className="tbl">
                <thead><tr><th>Cửa hàng</th><th className="num">Số HĐ</th><th className="num">Gross</th><th className="num">Giảm giá</th><th className="num">Hoa hồng</th><th className="num">Net</th><th className="num">Thuế VAT</th><th className="num">Net sau VAT</th><th className="num">Tỉ trọng</th></tr></thead>
                <tbody>
                  {byStore.map((r) => (
                    <tr key={r.id}>
                      <td><b>{r.name}</b></td><td className="num">{num(r.orders)}</td><td className="num">{money(r.gross)}</td><td className="num">{money(r.discount)}</td>
                      <td className="num">{money(r.commission)}</td><td className="num"><b>{money(r.net)}</b></td><td className="num">{money(r.vat)}</td><td className="num">{money(r.net - r.vat)}</td><td className="num">{pct(t.net ? r.net / t.net : 0)}</td>
                    </tr>
                  ))}
                  {byStore.length > 1 && (
                    <tr className="total">
                      <td><b>Tổng</b></td><td className="num">{num(t.orders)}</td><td className="num">{money(t.gross)}</td><td className="num">{money(t.discount)}</td>
                      <td className="num">{money(t.commission)}</td><td className="num"><b>{money(t.net)}</b></td><td className="num">{money(t.vat)}</td><td className="num">{money(t.net - t.vat)}</td><td className="num">100%</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <>
            <div className="row">
              <select className="input" style={{ width: 'auto' }} value={chanBranch} onChange={(e) => setChanBranch(e.target.value)} aria-label="Lọc theo cửa hàng">
                <option value="">Tất cả cửa hàng</option>
                {branches.filter((b) => b.name.trim().toUpperCase() !== 'CÔNG TY').map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
              <span className="mem-caption">Từ báo cáo B03, cùng khoảng ngày đã chọn</span>
            </div>
            {byChannel.length === 0 ? <Empty title="Chưa có doanh thu theo nguồn đơn" hint="Nhập báo cáo iPOS B03 (theo nguồn đơn) cho khoảng ngày này." /> : (
              <div className="table-wrap">
                <table className="tbl">
                  <thead><tr><th>Nguồn</th><th className="num">Số HĐ</th><th className="num">Gross</th><th className="num">Giảm giá</th><th className="num">Hoa hồng</th><th className="num">Net</th><th className="num">Tỉ trọng</th></tr></thead>
                  <tbody>
                    {byChannel.map((c) => (
                      <tr key={c.name}>
                        <td>{c.name}</td><td className="num">{num(c.orders)}</td><td className="num">{money(c.gross)}</td><td className="num">{money(c.discount)}</td>
                        <td className="num">{money(c.commission)}</td><td className="num"><b>{money(c.net)}</b></td><td className="num">{pct(chanNet ? c.net / chanNet : 0)}</td>
                      </tr>
                    ))}
                    <tr className="total"><td><b>Tổng</b></td><td className="num">{num(byChannel.reduce((a, c) => a + c.orders, 0))}</td><td className="num">{money(byChannel.reduce((a, c) => a + c.gross, 0))}</td><td className="num">{money(byChannel.reduce((a, c) => a + c.discount, 0))}</td><td className="num">{money(byChannel.reduce((a, c) => a + c.commission, 0))}</td><td className="num"><b>{money(chanNet)}</b></td><td className="num">100%</td></tr>
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>

      {tab === 'store' && rows.length > 0 && !sales.loading && (
        <div className="mem-card stack">
        <div className="spread">
          <div className="section-title" style={{ margin: 0 }}>Chi tiết từng ngày</div>
          <div className="row">
            <select className="input" style={{ width: 'auto', minHeight: 38 }} value={dayBranch} onChange={(e) => setDayBranch(e.target.value)} aria-label="Lọc chi tiết theo cửa hàng">
              <option value="">Tất cả cửa hàng</option>
              {branches.filter((b) => b.name.trim().toUpperCase() !== 'CÔNG TY').map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <button className="mem-btn mem-btn-sm" onClick={() => setShowDays(!showDays)}>{showDays ? 'Ẩn' : 'Hiện'}</button>
          </div>
        </div>
        {showDays && (
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>Ngày</th>{!dayBranch && <th>Cửa hàng</th>}<th className="num">Số HĐ</th><th className="num">Gross</th><th className="num">Giảm giá</th><th className="num">Hoa hồng</th><th className="num">Net</th><th className="num">Thuế VAT</th><th className="num">Net sau VAT</th>{can('finance.import') && <th />}</tr></thead>
              <tbody>
                {dayRows.map((x) => (
                  <tr key={`${x.branch_id}|${x.sale_date}`}>
                    <td>{vnDate(x.sale_date)}</td>
                    {!dayBranch && <td>{branchName.get(x.branch_id) ?? '—'}</td>}
                    <td className="num">{num(x.orders)}</td>
                    <td className="num">{money(x.gross ?? 0)}</td>
                    <td className="num">{money((x.discount ?? 0) + (x.merchant_discount ?? 0) + (x.voucher ?? 0))}</td>
                    <td className="num">{money(x.commission ?? 0)}</td>
                    <td className="num"><b>{money(x.revenue)}</b></td>
                    <td className="num">{money(x.vat ?? 0)}</td>
                    <td className="num">{money(x.revenue - (x.vat ?? 0))}</td>
                    {can('finance.import') && <td className="num"><button className="mem-btn mem-btn-sm mem-btn-danger" onClick={() => void removeDay(x.branch_id, x.sale_date)}>Xóa</button></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        </div>
      )}

      {importing && (
        <Modal title="Nhập file doanh thu" onClose={() => setImporting(false)} wide>
          <ImportPanel mode="revenue" onDone={() => { sales.reload(); chans.reload() }} />
        </Modal>
      )}
    </div>
  )
}
