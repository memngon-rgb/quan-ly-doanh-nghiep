import { IconBook, IconCalc, IconChart, IconHome, IconSettings, IconUpload } from '../../core/icons'
import type { AppModule } from '../../core/types'
import Dashboard from './Dashboard'
import Forecast from './Forecast'
import Import from './Import'
import Ledger from './Ledger'
import PnL from './PnL'
import FinanceSettings from './Settings'

/** MÔ-ĐUN TÀI CHÍNH. Bảng dữ liệu: fin_*  ·  Quyền: finance.* */
export const financeModule: AppModule = {
  id: 'finance',
  title: 'Tài chính',
  nav: [
    { path: '/finance', label: 'Tổng quan', icon: <IconHome />, perm: 'finance.report' },
    { path: '/finance/ledger', label: 'Thu chi', icon: <IconBook />, perm: 'finance.write' },
    { path: '/finance/import', label: 'Nhập file', icon: <IconUpload />, perm: 'finance.import' },
    { path: '/finance/forecast', label: 'Dự tính', icon: <IconCalc />, perm: 'finance.report' },
    { path: '/finance/pnl', label: 'P&L', icon: <IconChart />, perm: 'finance.report' },
    { path: '/finance/settings', label: 'Danh mục', icon: <IconSettings />, perm: 'finance.settings' },
  ],
  routes: [
    { path: '/finance', element: <Dashboard />, perm: 'finance.report' },
    { path: '/finance/ledger', element: <Ledger />, perm: 'finance.write' },
    { path: '/finance/import', element: <Import />, perm: 'finance.import' },
    { path: '/finance/forecast', element: <Forecast />, perm: 'finance.report' },
    { path: '/finance/pnl', element: <PnL />, perm: 'finance.report' },
    { path: '/finance/settings', element: <FinanceSettings />, perm: 'finance.settings' },
  ],
}
