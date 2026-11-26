-- =====================================================================
-- 0004_fix_import_key.sql  |  SỬA LỖI NHẬP FILE: "no unique constraint matching ON CONFLICT"
-- Chỉ mục chống trùng cũ có điều kiện (where ...) nên chức năng nhập file không dùng được.
-- Bản mới không có điều kiện. Các khoản nhập tay (external_key rỗng/NULL) vẫn không bị ảnh hưởng,
-- vì PostgreSQL coi mỗi NULL là khác nhau. Không mất dữ liệu.
-- =====================================================================

drop index if exists public.fin_tx_external_uq;
create unique index fin_tx_external_uq on public.fin_transactions (branch_id, external_key);
