import type { ReactNode } from 'react'

export type Role = 'owner' | 'manager' | 'accountant' | 'staff'

export const ROLE_LABEL: Record<Role, string> = {
  owner: 'Chủ',
  manager: 'Quản lý',
  accountant: 'Kế toán',
  staff: 'Nhân viên',
}

export interface Branch {
  id: string
  name: string
  is_active: boolean
}

export interface Profile {
  id: string
  full_name: string
  role: Role
  is_active: boolean
}

export interface Access {
  profile: Profile
  /** Danh sách mã quyền, hoặc ['*'] với Chủ */
  perms: string[]
}

/**
 * Mỗi hạng mục (Tài chính, Kho, Nhân sự...) khai báo 1 "manifest" như dưới đây
 * rồi đăng ký ở src/modules/registry.ts. Thêm mô-đun mới = thêm 1 thư mục + 1 dòng đăng ký.
 */
export interface NavItem {
  path: string // đường dẫn đầy đủ, ví dụ '/finance/ledger'
  label: string
  icon: ReactNode
  perm: string // quyền cần có để thấy mục này
  group?: string // tên nhóm trong thanh bên ('' = đứng riêng, không có tiêu đề); mặc định theo tên mô-đun
}

export interface ModuleRoute {
  path: string
  element: ReactNode
  perm: string
}

export interface AppModule {
  id: string
  title: string
  nav: NavItem[]
  routes: ModuleRoute[]
}
