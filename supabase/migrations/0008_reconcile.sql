-- =====================================================================
-- 0008_reconcile.sql  |  ĐỐI SOÁT: cửa hàng khai thực nhận, khoản bị trừ, ngày nghỉ lễ
-- Chỉ THÊM bảng mới và danh mục mới, không đụng dữ liệu cũ. Chạy lại nhiều lần vẫn an toàn.
-- =====================================================================

-- 1) Số thực nhận do cửa hàng khai (kèm ảnh chụp app), giải trình, truy thu
create table if not exists public.fin_recon_actuals (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches (id),
  source text not null,                       -- cash | momo | grab | shopee | be | gsm
  date_from date not null,
  date_to date not null,
  amount bigint not null default 0,           -- thực nhận TRƯỚC khi trừ nợ, quảng cáo
  photo_path text,                            -- ảnh chụp app (bucket fin-receipts)
  explain text not null default '',           -- giải trình của cửa hàng
  explain_status text not null default 'none' check (explain_status in ('none', 'explained', 'approved')),
  recovery bigint not null default 0,         -- truy thu (kế toán nhập)
  recovery_status text not null default 'pending' check (recovery_status in ('pending', 'collected')),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (branch_id, source, date_from, date_to)
);

-- 2) Khoản nền tảng tự trừ (quảng cáo, trả vay Grab, phí...). Mỗi khoản tự sinh 1 dòng chi phí ở fin_transactions.
create table if not exists public.fin_recon_deductions (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches (id),
  date_from date not null,
  date_to date not null,
  kind text not null check (kind in ('ads', 'grab_loan', 'fee', 'other')),
  source text not null default '',
  amount bigint not null default 0,
  note text not null default '',
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

-- 3) Ngày nghỉ lễ của nền tảng (để không báo "trễ" oan)
create table if not exists public.fin_holidays (
  hdate date not null,
  platform text not null default 'all',
  note text not null default '',
  primary key (hdate, platform)
);

alter table public.fin_recon_actuals enable row level security;
alter table public.fin_recon_deductions enable row level security;
alter table public.fin_holidays enable row level security;

drop policy if exists fin_actual_select on public.fin_recon_actuals;
drop policy if exists fin_actual_insert on public.fin_recon_actuals;
drop policy if exists fin_actual_update on public.fin_recon_actuals;
drop policy if exists fin_actual_delete on public.fin_recon_actuals;
create policy fin_actual_select on public.fin_recon_actuals for select
  using (public.can_access_branch(branch_id) and public.has_perm('finance.view'));
create policy fin_actual_insert on public.fin_recon_actuals for insert
  with check (public.can_access_branch(branch_id) and public.has_perm('finance.write'));
create policy fin_actual_update on public.fin_recon_actuals for update
  using (public.can_access_branch(branch_id) and public.has_perm('finance.write'))
  with check (public.can_access_branch(branch_id) and public.has_perm('finance.write'));
create policy fin_actual_delete on public.fin_recon_actuals for delete
  using (public.can_access_branch(branch_id) and public.has_perm('finance.edit'));

-- Người không có quyền sửa (finance.edit) không được tự đặt truy thu hay tự "duyệt" giải trình
create or replace function public.fin_actuals_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_perm('finance.edit') then
    if tg_op = 'INSERT' then
      new.recovery := 0;
      new.recovery_status := 'pending';
      if new.explain_status = 'approved' then new.explain_status := 'explained'; end if;
    else
      new.recovery := old.recovery;
      new.recovery_status := old.recovery_status;
      if new.explain_status = 'approved' and old.explain_status <> 'approved' then
        new.explain_status := old.explain_status;
      end if;
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists fin_actuals_guard_trg on public.fin_recon_actuals;
create trigger fin_actuals_guard_trg before insert or update on public.fin_recon_actuals
  for each row execute function public.fin_actuals_guard();

drop policy if exists fin_ded_select on public.fin_recon_deductions;
drop policy if exists fin_ded_write on public.fin_recon_deductions;
create policy fin_ded_select on public.fin_recon_deductions for select
  using (public.can_access_branch(branch_id) and public.has_perm('finance.report'));
create policy fin_ded_write on public.fin_recon_deductions for all
  using (public.can_access_branch(branch_id) and public.has_perm('finance.edit'))
  with check (public.can_access_branch(branch_id) and public.has_perm('finance.edit'));

drop policy if exists fin_hol_select on public.fin_holidays;
drop policy if exists fin_hol_write on public.fin_holidays;
create policy fin_hol_select on public.fin_holidays for select using (public.has_perm('finance.view'));
create policy fin_hol_write on public.fin_holidays for all
  using (public.has_perm('finance.edit')) with check (public.has_perm('finance.edit'));

-- 4) Danh mục chi phí cho các khoản bị trừ (nếu chưa có)
insert into public.fin_categories (name, type, grp)
select v.name, 'expense', 'other'
from (values ('Chạy quảng cáo nền tảng'), ('Trả vay Grab'), ('Phí nền tảng khác'), ('Khoản nền tảng trừ khác')) as v(name)
where not exists (select 1 from public.fin_categories c where c.name = v.name);

notify pgrst, 'reload schema';
