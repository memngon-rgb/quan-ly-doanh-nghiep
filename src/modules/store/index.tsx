import { IconBook } from '../../core/icons'
import type { AppModule } from '../../core/types'
import StoreHub from './StoreHub'

const ANY = 'store.shift|store.review|store.revenue|store.utility'

/** MÔ-ĐUN BÁO CÁO CỬA HÀNG. Bảng: store_*  ·  Quyền: store.* (mỗi tab một quyền) */
export const storeModule: AppModule = {
  id: 'store',
  title: 'Cửa hàng',
  nav: [{ path: '/store', label: 'Báo cáo cửa hàng', icon: <IconBook />, perm: ANY }],
  routes: [{ path: '/store', element: <StoreHub />, perm: ANY }],
}
