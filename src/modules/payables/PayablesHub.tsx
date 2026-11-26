import { useState } from 'react'
import { useAuth } from '../../core/auth'
import { addDays, today } from '../../core/format'
import { ErrorBox, Loading, PageHead, useAsync } from '../../core/ui'
import { listTx } from '../finance/api'
import type { Tx } from '../finance/types'
import { listAccounts, listOrders, listPartners } from './api'
import DebtTab from './DebtTab'
import PartnersTab from './PartnersTab'

/** Công nợ nhà cung cấp. Sau này gộp với mục Kho (mua hàng, nhập kho, thanh toán). */
export default function PayablesHub() {
  const { can } = useAuth()
  const canEdit = can('payable.edit')
  const [tab, setTab] = useState<'debt' | 'partners'>('debt')
  const d = useAsync(async () => {
    const [orders, partners, accounts] = await Promise.all([listOrders(), listPartners(), listAccounts()])
    // Sổ chi dùng để đối chiếu lệnh đã chi; người không có quyền xem sổ thì bỏ qua phần này
    let txs: Tx[] = []
    try { txs = await listTx('', addDays(today(), -240), today()) } catch { txs = [] }
    return { orders, partners, accounts, txs }
  }, [])

  return (
    <div className="stack">
      <PageHead title="Công nợ nhà cung cấp" sub="Theo dõi các lệnh chi còn nợ, gom theo nhà cung cấp và số tài khoản, tự đối chiếu với sao kê." />
      <div className="seg" role="tablist" aria-label="Mục công nợ" style={{ alignSelf: 'flex-start' }}>
        <button role="tab" aria-selected={tab === 'debt'} className={tab === 'debt' ? 'on' : ''} onClick={() => setTab('debt')}>Công nợ</button>
        <button role="tab" aria-selected={tab === 'partners'} className={tab === 'partners' ? 'on' : ''} onClick={() => setTab('partners')}>Nhà cung cấp</button>
      </div>
      {d.loading && !d.data ? <Loading /> : d.error || !d.data ? <ErrorBox error={d.error} retry={d.reload} /> : tab === 'debt'
        ? <DebtTab data={d.data} reload={d.reload} canEdit={canEdit} goPartners={() => setTab('partners')} />
        : <PartnersTab data={d.data} reload={d.reload} canEdit={canEdit} />}
    </div>
  )
}
