import { IconWallet } from '../../core/icons'
import type { AppModule } from '../../core/types'
import PayablesHub from './PayablesHub'

const ANY = 'payable.view|payable.edit'

/** MÔ-ĐUN CÔNG NỢ NCC. Bảng: pay_*  ·  Quyền: payable.view, payable.edit  ·  Sau này gộp với mô-đun Kho */
export const payablesModule: AppModule = {
  id: 'payables',
  title: 'Mua hàng',
  nav: [{ path: '/payables', label: 'Công nợ NCC', icon: <IconWallet />, perm: ANY }],
  routes: [{ path: '/payables', element: <PayablesHub />, perm: ANY }],
}
