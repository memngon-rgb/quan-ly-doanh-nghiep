-- =====================================================================
-- 0007_sales_detail.sql  |  LƯU ĐỦ CÁC CỘT BÁO CÁO A02 VÀ DOANH THU THEO NGUỒN ĐƠN (B03)
-- Để sau này phân tích được: giảm giá, chiết khấu, hoa hồng, thuế, số khách, theo từng kênh bán.
-- Chỉ thêm cột/bảng mới, không mất dữ liệu cũ. Sau khi chạy, nhập lại A02 và B03 để điền các cột mới.
-- =====================================================================

alter table public.fin_daily_sales
  add column if not exists guests int not null default 0,
  add column if not exists gross bigint not null default 0,
  add column if not exists discount bigint not null default 0,           -- Giảm giá
  add column if not exists merchant_discount bigint not null default 0,  -- Chiết khấu
  add column if not exists marketing_fee bigint not null default 0,      -- Phí hỗ trợ marketing
  add column if not exists voucher bigint not null default 0,            -- Phiếu giảm giá
  add column if not exists withholding_tax bigint not null default 0,    -- Thuế khấu trừ
  add column if not exists vat_discount bigint not null default 0,       -- Giảm giá VAT
  add column if not exists commission bigint not null default 0;         -- Hoa hồng nền tảng

create table if not exists public.fin_daily_channels (
  branch_id uuid not null references public.branches (id),
  sale_date date not null,
  channel text not null,                      -- Tại chỗ, Grab, ShopeeFood, Mang về, B2B, ...
  orders int not null default 0,
  guests int not null default 0,
  commission bigint not null default 0,
  discount bigint not null default 0,
  withholding_tax bigint not null default 0,
  net bigint not null default 0,
  gross bigint not null default 0,
  source text not null default 'import',
  created_at timestamptz not null default now(),
  primary key (branch_id, sale_date, channel)
);

alter table public.fin_daily_channels enable row level security;

drop policy if exists fin_chan_select on public.fin_daily_channels;
drop policy if exists fin_chan_write on public.fin_daily_channels;

create policy fin_chan_select on public.fin_daily_channels for select
  using (public.can_access_branch(branch_id) and public.has_perm('finance.report'));
create policy fin_chan_write on public.fin_daily_channels for all
  using (public.can_access_branch(branch_id) and public.has_perm('finance.import'))
  with check (public.can_access_branch(branch_id) and public.has_perm('finance.import'));

-- Báo cho Supabase nạp lại cấu trúc bảng ngay (tránh lỗi "column not found in the schema cache")
notify pgrst, 'reload schema';
