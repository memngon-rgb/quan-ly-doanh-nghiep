-- =====================================================================
-- 0005_payments.sql  |  DOANH THU THEO PHƯƠNG THỨC THANH TOÁN (phục vụ đối soát)
-- Mỗi dòng = 1 cửa hàng, 1 ngày, 1 phương thức (Tiền mặt, Momo, Grab Moca, ...).
-- Chỉ thêm bảng mới, không đụng dữ liệu cũ.
-- =====================================================================

create table public.fin_daily_payments (
  branch_id uuid not null references public.branches (id),
  pay_date date not null,
  method text not null,                       -- tên phương thức đúng như trên báo cáo iPOS
  orders int not null default 0,
  amount bigint not null default 0,
  source text not null default 'import',
  created_at timestamptz not null default now(),
  primary key (branch_id, pay_date, method)
);

alter table public.fin_daily_payments enable row level security;

create policy fin_pay_select on public.fin_daily_payments for select
  using (public.can_access_branch(branch_id) and public.has_perm('finance.report'));
create policy fin_pay_write on public.fin_daily_payments for all
  using (public.can_access_branch(branch_id) and public.has_perm('finance.import'))
  with check (public.can_access_branch(branch_id) and public.has_perm('finance.import'));
