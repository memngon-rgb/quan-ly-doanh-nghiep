import { IconDownload, IconUsers } from '../../core/icons'
import type { AppModule } from '../../core/types'
import Backup from './Backup'
import Users from './Users'

/** MÔ-ĐUN QUẢN TRỊ: người dùng, chi nhánh, sao lưu. Quyền: admin.* */
export const adminModule: AppModule = {
  id: 'admin',
  title: 'Quản trị',
  nav: [
    { path: '/admin/users', label: 'Người dùng', icon: <IconUsers />, perm: 'admin.users' },
    { path: '/admin/backup', label: 'Sao lưu', icon: <IconDownload />, perm: 'admin.backup' },
  ],
  routes: [
    { path: '/admin/users', element: <Users />, perm: 'admin.users' },
    { path: '/admin/backup', element: <Backup />, perm: 'admin.backup' },
  ],
}
