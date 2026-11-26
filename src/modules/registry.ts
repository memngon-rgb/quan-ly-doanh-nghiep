import type { AppModule } from '../core/types'
import { financeModule } from './finance'
import { adminModule } from './admin'
import { storeModule } from './store'
import { payablesModule } from './payables'

/**
 * DANH SÁCH MÔ-ĐUN. Muốn thêm hạng mục mới (Kho, Nhân sự, Đi chợ...):
 *   1. Tạo thư mục src/modules/<tên>/ và export một AppModule (xem modules/finance/index.tsx)
 *   2. Thêm 1 dòng import + 1 phần tử vào mảng bên dưới
 *   3. Thêm file migration SQL mới trong supabase/migrations/ (bảng tiền tố riêng + quyền riêng)
 * Không phải sửa code của các mô-đun đã có.
 */
export const modules: AppModule[] = [financeModule, payablesModule, storeModule, adminModule]
