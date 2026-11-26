-- =====================================================================
-- 0009_store_reports.sql  |  GIAO DIỆN DÙNG CHUNG + BÁO CÁO CỬA HÀNG + PHÂN QUYỀN TỪNG MỤC
-- Chỉ THÊM bảng, quyền và điều chỉnh luật truy cập. Chạy lại nhiều lần vẫn an toàn.
-- =====================================================================

-- 1) Cài đặt dùng chung của công ty (giao diện)
create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.app_settings enable row level security;
drop policy if exists app_settings_select on public.app_settings;
drop policy if exists app_settings_write on public.app_settings;
create policy app_settings_select on public.app_settings for select using (public.is_active_user());
create policy app_settings_write on public.app_settings for all
  using (public.has_perm('admin.users')) with check (public.has_perm('admin.users'));

-- 2) Quyền riêng từng mục của "Báo cáo cửa hàng" (cấp cho từng người ở Quản trị → Người dùng)
insert into public.permissions (code, module, label) values
  ('store.shift',   'store', 'Báo cáo cửa hàng: Báo cáo ca'),
  ('store.review',  'store', 'Báo cáo cửa hàng: Đánh giá food app'),
  ('store.revenue', 'store', 'Báo cáo cửa hàng: Số thực nhận (doanh thu cửa hàng)'),
  ('store.utility', 'store', 'Báo cáo cửa hàng: Điện nước')
on conflict (code) do nothing;

-- Quản lý có tất cả mục; kế toán xem và duyệt số thực nhận. Chủ luôn có mọi quyền.
insert into public.role_permissions (role, perm) values
  ('manager', 'store.shift'), ('manager', 'store.review'), ('manager', 'store.revenue'), ('manager', 'store.utility'),
  ('accountant', 'store.revenue')
on conflict do nothing;

-- 3) Số thực nhận cửa hàng khai: người có quyền store.revenue cũng được xem và nhập (trong chi nhánh của mình)
drop policy if exists fin_actual_select on public.fin_recon_actuals;
drop policy if exists fin_actual_insert on public.fin_recon_actuals;
drop policy if exists fin_actual_update on public.fin_recon_actuals;
create policy fin_actual_select on public.fin_recon_actuals for select
  using (public.can_access_branch(branch_id) and (public.has_perm('finance.view') or public.has_perm('store.revenue')));
create policy fin_actual_insert on public.fin_recon_actuals for insert
  with check (public.can_access_branch(branch_id) and (public.has_perm('finance.write') or public.has_perm('store.revenue')));
create policy fin_actual_update on public.fin_recon_actuals for update
  using (public.can_access_branch(branch_id) and (public.has_perm('finance.write') or public.has_perm('store.revenue')))
  with check (public.can_access_branch(branch_id) and (public.has_perm('finance.write') or public.has_perm('store.revenue')));

-- Để so với số phải về theo POS, người có store.revenue được ĐỌC doanh thu theo phương thức và các khoản thu chi TIỀN MẶT của chi nhánh mình (không đọc được các khoản khác)
drop policy if exists fin_pay_select on public.fin_daily_payments;
create policy fin_pay_select on public.fin_daily_payments for select
  using (public.can_access_branch(branch_id) and (public.has_perm('finance.report') or public.has_perm('store.revenue')));
drop policy if exists fin_tx_select on public.fin_transactions;
create policy fin_tx_select on public.fin_transactions for select
  using (public.can_access_branch(branch_id)
         and (public.has_perm('finance.view') or created_by = auth.uid()
              or (public.has_perm('store.revenue') and method = 'cash')));

-- 4) Báo cáo ca
create table if not exists public.store_shift_reports (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches (id),
  report_date date not null,
  shift text not null check (shift in ('morning', 'evening')),
  kind text not null check (kind in ('open', 'close')),     -- open: tác phong đầu ca · close: báo cáo kết ca
  sections jsonb not null default '{}'::jsonb,              -- nội dung từng mục
  photos text[] not null default '{}',                      -- đường dẫn ảnh trong kho store-photos
  author uuid default auth.uid(),
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (branch_id, report_date, shift, kind)
);

-- 5) Đánh giá food app (mỗi kênh mỗi ngày một dòng)
create table if not exists public.store_app_reviews (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches (id),
  review_date date not null,
  channel text not null,                                    -- shopee | grab | be | gsm | gmap
  no_new boolean not null default true,                     -- không phát sinh đánh giá mới
  good_count int not null default 0,                        -- số đánh giá 4-5 sao
  bad_count int not null default 0,                         -- số đánh giá 3 sao trở xuống
  note text not null default '',                            -- lý do và cách đã xử lý
  incident text not null default '',                        -- sự cố (nếu có)
  photos text[] not null default '{}',
  author uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (branch_id, review_date, channel)
);

-- 6) Chỉ số đồng hồ điện nước (cuối ca tối)
create table if not exists public.store_meter_readings (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches (id),
  read_date date not null,
  electric numeric,                                         -- chỉ số điện (kWh)
  water numeric,                                            -- chỉ số nước (m3)
  electric_photo text,
  water_photo text,
  note text not null default '',
  author uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (branch_id, read_date)
);

-- 7) Số điện nước thực tế theo tháng (nhập khi có hóa đơn, ghi đè số ước chừng)
create table if not exists public.store_utility_monthly (
  branch_id uuid not null references public.branches (id),
  month text not null,                                      -- yyyy-mm
  kwh numeric,
  m3 numeric,
  electric_cost bigint,
  water_cost bigint,
  note text not null default '',
  primary key (branch_id, month)
);

alter table public.store_shift_reports enable row level security;
alter table public.store_app_reviews enable row level security;
alter table public.store_meter_readings enable row level security;
alter table public.store_utility_monthly enable row level security;

drop policy if exists store_shift_all on public.store_shift_reports;
create policy store_shift_all on public.store_shift_reports for all
  using (public.can_access_branch(branch_id) and public.has_perm('store.shift'))
  with check (public.can_access_branch(branch_id) and public.has_perm('store.shift'));
drop policy if exists store_review_all on public.store_app_reviews;
create policy store_review_all on public.store_app_reviews for all
  using (public.can_access_branch(branch_id) and public.has_perm('store.review'))
  with check (public.can_access_branch(branch_id) and public.has_perm('store.review'));
drop policy if exists store_meter_all on public.store_meter_readings;
create policy store_meter_all on public.store_meter_readings for all
  using (public.can_access_branch(branch_id) and public.has_perm('store.utility'))
  with check (public.can_access_branch(branch_id) and public.has_perm('store.utility'));
drop policy if exists store_utility_all on public.store_utility_monthly;
create policy store_utility_all on public.store_utility_monthly for all
  using (public.can_access_branch(branch_id) and public.has_perm('store.utility'))
  with check (public.can_access_branch(branch_id) and public.has_perm('store.utility'));

-- 8) Kho ảnh của báo cáo cửa hàng (riêng tư), đường dẫn <branch_id>/<tên file>
insert into storage.buckets (id, name, public)
values ('store-photos', 'store-photos', false)
on conflict (id) do nothing;
drop policy if exists store_photos_select on storage.objects;
drop policy if exists store_photos_insert on storage.objects;
create policy store_photos_select on storage.objects for select
  using (bucket_id = 'store-photos'
         and public.can_access_branch(((storage.foldername(name))[1])::uuid)
         and (public.has_perm('store.shift') or public.has_perm('store.review') or public.has_perm('store.revenue') or public.has_perm('store.utility')));
create policy store_photos_insert on storage.objects for insert
  with check (bucket_id = 'store-photos'
              and public.can_access_branch(((storage.foldername(name))[1])::uuid)
              and (public.has_perm('store.shift') or public.has_perm('store.review') or public.has_perm('store.revenue') or public.has_perm('store.utility')));

-- Ảnh chụp app ở số thực nhận dùng kho fin-receipts: cho người có store.revenue
drop policy if exists fin_receipts_select on storage.objects;
drop policy if exists fin_receipts_insert on storage.objects;
create policy fin_receipts_select on storage.objects for select
  using (bucket_id = 'fin-receipts'
         and public.can_access_branch(((storage.foldername(name))[1])::uuid)
         and (public.has_perm('finance.view') or public.has_perm('store.revenue')));
create policy fin_receipts_insert on storage.objects for insert
  with check (bucket_id = 'fin-receipts'
              and public.can_access_branch(((storage.foldername(name))[1])::uuid)
              and (public.has_perm('finance.write') or public.has_perm('store.revenue')));

-- 9) Nhân viên cửa hàng mặc định đang có quyền finance.write (nhập thu chi).
--    Nếu muốn MOD cửa hàng chỉ thấy các mục Báo cáo cửa hàng, bỏ dấu -- ở dòng dưới rồi chạy:
-- delete from public.role_permissions where role = 'staff' and perm = 'finance.write';

notify pgrst, 'reload schema';
