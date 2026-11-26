-- =====================================================================
-- 0006_sales_vat.sql  |  DOANH THU = NET NHƯ TRÊN iPOS, THUẾ VAT ĐẦU RA LƯU RIÊNG
-- 1) Thêm cột vat vào doanh thu theo ngày.
-- 2) Xóa các khoản "Hoa hồng nền tảng" mà bản nhập A02 trước đây tự ghi vào Sổ thu chi.
--    Doanh thu Net của iPOS đã trừ hoa hồng nên không được ghi thêm như một khoản chi (sẽ bị tính hai lần).
--    Chỉ xóa đúng các dòng do chức năng nhập A02 tạo (external_key bắt đầu bằng a02-commission|).
-- Sau khi chạy: vào Doanh thu → Nhập file doanh thu → iPOS A02 và nhập lại file A02 để cập nhật số Net và VAT.
-- =====================================================================

alter table public.fin_daily_sales add column if not exists vat bigint not null default 0;

delete from public.fin_transactions
where source = 'import' and external_key like 'a02-commission|%';
