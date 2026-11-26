-- =====================================================================
-- 0003_grants.sql  |  CẤP QUYỀN TRUY CẬP BẢNG CHO NGƯỜI ĐÃ ĐĂNG NHẬP
-- Một số dự án Supabase mới không tự cấp quyền cho các bảng tạo bằng SQL.
-- Người CHƯA đăng nhập (anon) vẫn KHÔNG có quyền gì.
-- Quyền thật sự của từng người vẫn do luật RLS trong 0001/0002 quyết định.
-- =====================================================================

grant usage on schema public to authenticated;

grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on all functions in schema public to authenticated;

-- Các bảng/hàm của mô-đun thêm sau này tự được cấp tương tự.
-- QUY ƯỚC: mọi bảng mới PHẢI bật RLS (alter table ... enable row level security)
-- và có policy riêng, nếu không mọi người đăng nhập sẽ đọc được bảng đó.
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public
  grant usage, select on sequences to authenticated;
alter default privileges in schema public
  grant execute on functions to authenticated;
