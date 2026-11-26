import { IconBriefcase, IconReceipt } from '../../core/icons'
import type { AppModule } from '../../core/types'
import PayablesHub from './PayablesHub'

const ANY = 'payable.view|payable.edit'

/** MÔ-ĐUN CÔNG NỢ NCC + CHI PHÍ VẬN HÀNH. Bảng: pay_*  ·  Quyền: payable.view, payable.edit  ·  Công nợ NCC sau này gộp với mô-đun Kho */
export const payablesModule: AppModule = {
  id: 'payables',
  title: 'Chi phí & công nợ',
  nav: [
    { path: '/payables', label: 'Công nợ NCC', icon: <IconReceipt />, perm: ANY, group: 'Chi phí & công nợ' },
    { path: '/payables/operating', label: 'Chi phí vận hành', icon: <IconBriefcase />, perm: ANY, group: 'Chi phí & công nợ' },
  ],
  routes: [
    { path: '/payables', element: <PayablesHub key="goods" scope="goods" />, perm: ANY },
    { path: '/payables/operating', element: <PayablesHub key="op" scope="operating" />, perm: ANY },
  ],
}
