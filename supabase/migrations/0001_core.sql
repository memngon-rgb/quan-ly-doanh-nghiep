-- =====================================================================
-- 0001_core.sql  |  LÕI DÙNG CHUNG: chi nhánh, người dùng, phân quyền
-- QUY TẮC: file migration đã chạy thì KHÔNG sửa. Muốn đổi thì thêm file mới
-- (0003_..., 0004_...). Mỗi hạng mục mới có tiền tố bảng riêng (fin_, inv_, hr_).
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------- Chi nhánh ----------
create table public.branches (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------- Hồ sơ người dùng (gắn với tài khoản đăng nhập) ----------
create type public.app_role as enum ('owner', 'manager', 'accountant', 'staff');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  role public.app_role not null default 'staff',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Người dùng được xem chi nhánh nào (chủ xem hết nên không cần dòng ở đây)
create table public.user_branches (
  user_id uuid not null references public.profiles (id) on delete cascade,
  branch_id uuid not null references public.branches (id) on delete cascade,
  primary key (user_id, branch_id)
);

-- ---------- Quyền chức năng ----------
-- Mỗi mô-đun tự thêm quyền của nó bằng migration riêng (không sửa bảng này).
create table public.permissions (
  code text primary key,           -- ví dụ 'finance.view'
  module text not null,            -- ví dụ 'finance'
  label text not null
);

create table public.role_permissions (
  role public.app_role not null,
  perm text not null references public.permissions (code) on delete cascade,
  primary key (role, perm)
);

-- Quyền cấp thêm riêng cho từng người (ngoài quyền theo vai trò)
create table public.user_permissions (
  user_id uuid not null references public.profiles (id) on delete cascade,
  perm text not null references public.permissions (code) on delete cascade,
  primary key (user_id, perm)
);

insert into public.permissions (code, module, label) values
  ('admin.users',    'admin', 'Quản lý người dùng và chi nhánh'),
  ('admin.backup',   'admin', 'Sao lưu dữ liệu');

insert into public.role_permissions (role, perm) values
  ('manager', 'admin.backup');

-- ---------- Hàm kiểm tra quyền (dùng trong RLS của MỌI mô-đun) ----------
create or replace function public.is_active_user()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and is_active);
$$;

create or replace function public.is_owner()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles
                 where id = auth.uid() and is_active and role = 'owner');
$$;

create or replace function public.has_perm(p text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_owner()
      or exists (
        select 1 from public.profiles pr
        join public.role_permissions rp on rp.role = pr.role
        where pr.id = auth.uid() and pr.is_active and rp.perm = p)
      or exists (
        select 1 from public.user_permissions up
        join public.profiles pr on pr.id = up.user_id
        where up.user_id = auth.uid() and pr.is_active and up.perm = p);
$$;

create or replace function public.can_access_branch(b uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_owner()
      or exists (
        select 1 from public.user_branches ub
        join public.profiles pr on pr.id = ub.user_id
        where ub.user_id = auth.uid() and pr.is_active and ub.branch_id = b);
$$;

-- ---------- Tự tạo hồ sơ khi có tài khoản mới ----------
-- Tài khoản ĐẦU TIÊN trở thành Chủ (owner). Các tài khoản sau là nhân viên,
-- chưa thấy chi nhánh nào cho tới khi Chủ gán quyền.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    case when exists (select 1 from public.profiles) then 'staff'::public.app_role
         else 'owner'::public.app_role end);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- RLS ----------
alter table public.branches         enable row level security;
alter table public.profiles         enable row level security;
alter table public.user_branches    enable row level security;
alter table public.permissions      enable row level security;
alter table public.role_permissions enable row level security;
alter table public.user_permissions enable row level security;

create policy branches_select on public.branches for select
  using (public.can_access_branch(id));
create policy branches_write on public.branches for all
  using (public.is_owner()) with check (public.is_owner());

create policy profiles_select on public.profiles for select
  using (id = auth.uid() or public.is_owner());
create policy profiles_write on public.profiles for update
  using (public.is_owner()) with check (public.is_owner());

create policy user_branches_select on public.user_branches for select
  using (user_id = auth.uid() or public.is_owner());
create policy user_branches_write on public.user_branches for all
  using (public.is_owner()) with check (public.is_owner());

create policy permissions_select on public.permissions for select
  using (public.is_active_user());
create policy role_permissions_select on public.role_permissions for select
  using (public.is_active_user());
create policy role_permissions_write on public.role_permissions for all
  using (public.is_owner()) with check (public.is_owner());

create policy user_permissions_select on public.user_permissions for select
  using (user_id = auth.uid() or public.is_owner());
create policy user_permissions_write on public.user_permissions for all
  using (public.is_owner()) with check (public.is_owner());
