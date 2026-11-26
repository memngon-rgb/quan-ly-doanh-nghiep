-- =====================================================================
-- 0010_payables.sql  |  CÔNG NỢ NHÀ CUNG CẤP + ĐỐI TÁC THEO SỐ TÀI KHOẢN
-- Chỉ THÊM bảng và cột. Chạy lại nhiều lần vẫn an toàn. Sau này gom với mục Kho.
-- Số tài khoản NCC chỉ nằm trong cơ sở dữ liệu, không nằm trong mã nguồn.
-- =====================================================================

-- 1) Quyền riêng của mục Công nợ NCC
insert into public.permissions (code, module, label) values
  ('payable.view', 'payable', 'Công nợ NCC: xem'),
  ('payable.edit', 'payable', 'Công nợ NCC: nhập lệnh, đặt tên nhà cung cấp, đối chiếu')
on conflict (code) do nothing;

insert into public.role_permissions (role, perm) values
  ('manager',    'payable.view'),
  ('accountant', 'payable.view'),
  ('accountant', 'payable.edit')
on conflict do nothing;

-- 2) Sổ thu chi: lưu số tài khoản và tên đối ứng lấy từ sao kê ngân hàng
alter table public.fin_transactions add column if not exists counterparty_account text;
alter table public.fin_transactions add column if not exists counterparty_name text;
create index if not exists fin_tx_counterparty_idx on public.fin_transactions (counterparty_account)
  where counterparty_account is not null;

-- 3) Đối tác: nhà cung cấp hàng hóa hoặc chi phí vận hành (nhân sự, mặt bằng, vận chuyển...)
create table if not exists public.pay_partners (
  id uuid primary key default gen_random_uuid(),
  name text not null,                                         -- tên đẹp, có dấu, do người dùng đặt
  kind text not null default 'supplier' check (kind in ('supplier', 'operating')),
  sub_kind text not null default '',                          -- với chi phí vận hành: Nhân sự, Mặt bằng, Vận chuyển...
  note text not null default '',
  created_at timestamptz not null default now()
);

-- 4) Số tài khoản của đối tác (một đối tác có thể có nhiều số tài khoản)
create table if not exists public.pay_accounts (
  account_no text primary key,
  partner_id uuid not null references public.pay_partners (id) on delete cascade,
  seen_name text not null default ''                          -- tên chủ tài khoản thấy trên sao kê (để đối chiếu)
);
create index if not exists pay_accounts_partner_idx on public.pay_accounts (partner_id);

-- 5) Lệnh chi / công nợ (dán từ danh sách chờ duyệt trên eFAST)
create table if not exists public.pay_orders (
  id uuid primary key default gen_random_uuid(),
  order_no text,                                              -- mã lệnh trên ngân hàng
  account_no text not null,                                   -- số tài khoản người nhận
  supplier_raw text not null default '',                      -- tên người nhận như ngân hàng ghi
  invoice_no text not null default '',                        -- số hóa đơn hoặc ĐĐH
  invoice_date date,
  amount bigint not null check (amount >= 0),
  order_date date,                                            -- ngày tạo lệnh
  status text not null default 'pending' check (status in ('pending', 'paid', 'cancelled')),
  paid_date date,
  paid_tx_id uuid references public.fin_transactions (id) on delete set null,
  note text not null default '',
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create unique index if not exists pay_orders_order_no_uq on public.pay_orders (order_no) where order_no is not null;
create index if not exists pay_orders_acct_idx on public.pay_orders (account_no);
create index if not exists pay_orders_status_idx on public.pay_orders (status);

alter table public.pay_partners enable row level security;
alter table public.pay_accounts enable row level security;
alter table public.pay_orders enable row level security;

drop policy if exists pay_partners_select on public.pay_partners;
drop policy if exists pay_partners_write on public.pay_partners;
create policy pay_partners_select on public.pay_partners for select
  using (public.has_perm('payable.view') or public.has_perm('payable.edit'));
create policy pay_partners_write on public.pay_partners for all
  using (public.has_perm('payable.edit')) with check (public.has_perm('payable.edit'));

drop policy if exists pay_accounts_select on public.pay_accounts;
drop policy if exists pay_accounts_write on public.pay_accounts;
create policy pay_accounts_select on public.pay_accounts for select
  using (public.has_perm('payable.view') or public.has_perm('payable.edit'));
create policy pay_accounts_write on public.pay_accounts for all
  using (public.has_perm('payable.edit')) with check (public.has_perm('payable.edit'));

drop policy if exists pay_orders_select on public.pay_orders;
drop policy if exists pay_orders_write on public.pay_orders;
create policy pay_orders_select on public.pay_orders for select
  using (public.has_perm('payable.view') or public.has_perm('payable.edit'));
create policy pay_orders_write on public.pay_orders for all
  using (public.has_perm('payable.edit')) with check (public.has_perm('payable.edit'));

notify pgrst, 'reload schema';
