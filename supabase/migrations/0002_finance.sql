-- =====================================================================
-- 0002_finance.sql  |  MÔ-ĐUN TÀI CHÍNH (tiền tố bảng: fin_)
-- Chỉ THÊM bảng/quyền mới, không đụng tới bảng lõi.
-- =====================================================================

-- ---------- Quyền của mô-đun ----------
insert into public.permissions (code, module, label) values
  ('finance.view',     'finance', 'Xem sổ thu chi và báo cáo'),
  ('finance.write',    'finance', 'Nhập thu chi'),
  ('finance.edit',     'finance', 'Sửa, xóa thu chi'),
  ('finance.import',   'finance', 'Nhập file Excel'),
  ('finance.report',   'finance', 'Xem P&L, dự tính, dashboard'),
  ('finance.settings', 'finance', 'Cài đặt danh mục, dự tính');

insert into public.role_permissions (role, perm) values
  ('manager',    'finance.view'), ('manager', 'finance.write'), ('manager', 'finance.edit'),
  ('manager',    'finance.import'), ('manager', 'finance.report'), ('manager', 'finance.settings'),
  ('accountant', 'finance.view'), ('accountant', 'finance.write'), ('accountant', 'finance.edit'),
  ('accountant', 'finance.import'), ('accountant', 'finance.report'),
  ('staff',      'finance.write');

-- ---------- Danh mục thu/chi ----------
-- grp: revenue (thu từ bán hàng) | cogs (giá vốn/NVL) | payroll (lương)
--      fixed (cố định: điện, nước, thuê) | other (chi khác)
create table public.fin_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text not null check (type in ('income', 'expense')),
  grp text not null check (grp in ('revenue', 'cogs', 'payroll', 'fixed', 'other')),
  sort int not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.fin_categories (name, type, grp, sort) values
  ('Thu tiền mặt cửa hàng',  'income',  'revenue', 10),
  ('Thu khác',               'income',  'other',   20),
  ('Nguyên vật liệu',        'expense', 'cogs',    10),
  ('Đi chợ hằng ngày',       'expense', 'cogs',    20),
  ('Lương nhân viên',        'expense', 'payroll', 30),
  ('Thuê mặt bằng',          'expense', 'fixed',   40),
  ('Điện',                   'expense', 'fixed',   50),
  ('Nước',                   'expense', 'fixed',   60),
  ('Internet, phần mềm',     'expense', 'fixed',   70),
  ('Marketing',              'expense', 'other',   80),
  ('Sửa chữa, bảo trì',      'expense', 'other',   90),
  ('Chi khác',               'expense', 'other',   99);

-- ---------- Sổ thu chi hằng ngày ----------
create table public.fin_transactions (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches (id),
  tx_date date not null,
  type text not null check (type in ('income', 'expense')),
  category_id uuid references public.fin_categories (id),
  amount bigint not null check (amount >= 0),
  method text not null default 'cash' check (method in ('cash', 'transfer', 'company_order')),
  note text not null default '',
  receipt_path text,
  source text not null default 'manual' check (source in ('manual', 'import')),
  external_key text,                       -- chống nhập trùng khi import lại file
  created_by uuid not null default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now()
);
create unique index fin_tx_external_uq on public.fin_transactions (branch_id, external_key)
  where external_key is not null;
create index fin_tx_branch_date_idx on public.fin_transactions (branch_id, tx_date);

-- ---------- Doanh thu theo ngày (từ báo cáo iPOS) ----------
create table public.fin_daily_sales (
  branch_id uuid not null references public.branches (id),
  sale_date date not null,
  revenue bigint not null check (revenue >= 0),
  orders int not null default 0,
  source text not null default 'manual',
  created_at timestamptz not null default now(),
  primary key (branch_id, sale_date)
);

-- ---------- Số dự tính do người dùng chỉnh tay ----------
-- kind = 'monthly'  : chi phí dự tính cả tháng của 1 danh mục (category_id bắt buộc)
-- kind = 'cogs_pct' : tỉ lệ giá vốn/doanh thu của chi nhánh (category_id để trống)
create table public.fin_forecast_items (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches (id),
  category_id uuid references public.fin_categories (id) on delete cascade,
  kind text not null check (kind in ('monthly', 'cogs_pct')),
  value numeric not null check (value >= 0),
  updated_at timestamptz not null default now()
);
create unique index fin_forecast_uq on public.fin_forecast_items
  (branch_id, kind, coalesce(category_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- ---------- RLS ----------
alter table public.fin_categories     enable row level security;
alter table public.fin_transactions   enable row level security;
alter table public.fin_daily_sales    enable row level security;
alter table public.fin_forecast_items enable row level security;

create policy fin_cat_select on public.fin_categories for select
  using (public.is_active_user());
create policy fin_cat_write on public.fin_categories for all
  using (public.has_perm('finance.settings')) with check (public.has_perm('finance.settings'));

-- Người có finance.view xem hết của chi nhánh mình; nhân viên chỉ thấy dòng mình nhập.
create policy fin_tx_select on public.fin_transactions for select
  using (public.can_access_branch(branch_id)
         and (public.has_perm('finance.view') or created_by = auth.uid()));
create policy fin_tx_insert on public.fin_transactions for insert
  with check (public.can_access_branch(branch_id)
              and public.has_perm('finance.write')
              and created_by = auth.uid());
create policy fin_tx_update on public.fin_transactions for update
  using (public.can_access_branch(branch_id) and public.has_perm('finance.edit'))
  with check (public.can_access_branch(branch_id) and public.has_perm('finance.edit'));
create policy fin_tx_delete on public.fin_transactions for delete
  using (public.can_access_branch(branch_id) and public.has_perm('finance.edit'));

create policy fin_sales_select on public.fin_daily_sales for select
  using (public.can_access_branch(branch_id) and public.has_perm('finance.report'));
create policy fin_sales_write on public.fin_daily_sales for all
  using (public.can_access_branch(branch_id) and public.has_perm('finance.import'))
  with check (public.can_access_branch(branch_id) and public.has_perm('finance.import'));

create policy fin_forecast_select on public.fin_forecast_items for select
  using (public.can_access_branch(branch_id) and public.has_perm('finance.report'));
create policy fin_forecast_write on public.fin_forecast_items for all
  using (public.can_access_branch(branch_id) and public.has_perm('finance.settings'))
  with check (public.can_access_branch(branch_id) and public.has_perm('finance.settings'));

-- ---------- Kho ảnh chứng từ (riêng tư) ----------
insert into storage.buckets (id, name, public)
values ('fin-receipts', 'fin-receipts', false)
on conflict (id) do nothing;

-- Ảnh lưu theo đường dẫn  <branch_id>/<tên file>
create policy fin_receipts_select on storage.objects for select
  using (bucket_id = 'fin-receipts'
         and public.can_access_branch(((storage.foldername(name))[1])::uuid)
         and public.has_perm('finance.view'));
create policy fin_receipts_insert on storage.objects for insert
  with check (bucket_id = 'fin-receipts'
              and public.can_access_branch(((storage.foldername(name))[1])::uuid)
              and public.has_perm('finance.write'));
