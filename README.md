# Quản lý doanh nghiệp (bắt đầu bằng mô-đun Tài chính)

Web chạy trên điện thoại và máy tính, nhiều tài khoản đăng nhập, phân quyền theo vai trò và chi nhánh.

- **Giao diện:** React + TypeScript (thư mục `src/`)
- **Dữ liệu + đăng nhập + phân quyền:** Supabase (PostgreSQL)
- **Chạy giao diện:** Vercel hoặc Hostinger
- **Mã nguồn:** GitHub (repo công khai chỉ chứa code, không chứa dữ liệu hay mật khẩu)

## 1. Xem thử ngay (không cần Supabase)

Nếu chưa cấu hình Supabase, web tự chạy **bản xem thử** với dữ liệu minh họa lưu trong trình duyệt (có nhãn `DỮ LIỆU MINH HỌA`).

```bash
npm install
npm run dev
```

Mở địa chỉ hiện ra (thường là http://localhost:5173).

## 2. Kết nối Supabase (dữ liệu thật)

1. Vào https://supabase.com, tạo tài khoản và **New project** (chọn vùng Singapore cho nhanh).
2. Vào **SQL Editor**, mở lần lượt từng file trong `supabase/migrations/` theo thứ tự số (`0001_core.sql`, `0002_finance.sql`, rồi `0003_grants.sql`), dán nội dung và bấm **Run**.
3. Vào **Authentication → Providers → Email**: tắt **Allow new users to sign up** để người lạ không tự đăng ký.
4. Vào **Authentication → Users → Add user**, tạo tài khoản đầu tiên của bạn. **Tài khoản đầu tiên tự thành Chủ.** Các tài khoản sau là Nhân viên, bạn vào mục Quản trị → Người dùng của web để gán vai trò và chi nhánh.
5. Vào **Project Settings → API**, chép `Project URL` và khóa `anon public`.
6. Sao chép `.env.example` thành `.env.local` và điền hai giá trị đó:

```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

Chạy lại `npm run dev`, đăng nhập bằng tài khoản vừa tạo. Trước hết vào **Quản trị → Người dùng** để thêm chi nhánh.

> Tuyệt đối **không** đưa khóa `service_role` vào web hay vào GitHub. Web chỉ dùng khóa `anon`, an toàn nhờ các luật phân quyền (RLS) trong file SQL.

## 3. Đưa lên GitHub (công khai)

Kiểm tra `.env.local` không bị đẩy lên: file `.gitignore` đã chặn sẵn. Sau đó tạo repo trên GitHub rồi `git push`.

## 4. Đưa web lên mạng

**Cách A: Vercel** (tự cập nhật mỗi lần push)
1. Vào https://vercel.com, đăng nhập bằng GitHub, **Add New → Project**, chọn repo.
2. Ở mục **Environment Variables** thêm `VITE_SUPABASE_URL` và `VITE_SUPABASE_ANON_KEY`.
3. Bấm Deploy.

Lưu ý: gói miễn phí Vercel (Hobby) theo điều khoản chỉ dành cho dùng phi thương mại. Doanh nghiệp dùng thật nên xem lại điều khoản hoặc dùng cách B.

**Cách B: Hostinger** (đã có sẵn gói)
1. Ở hPanel lấy thông tin **FTP** (máy chủ, tên đăng nhập, mật khẩu, thư mục `public_html`).
2. Ở GitHub: **Settings → Secrets and variables → Actions → New repository secret**, tạo 6 secret: `FTP_SERVER`, `FTP_USERNAME`, `FTP_PASSWORD`, `FTP_DIR` (ví dụ `/public_html/`), `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
3. Mỗi lần push lên nhánh `main`, file `.github/workflows/deploy-hostinger.yml` tự build và tải lên Hostinger.

Hoặc làm tay: chạy `npm run build`, rồi tải nội dung thư mục `dist/` lên `public_html`.

## 5. Cách dùng mô-đun Tài chính

| Mục | Dùng để |
|---|---|
| Tổng quan | Doanh thu, chi, lãi gộp, dòng tiền, cảnh báo |
| Thu chi | Kế toán nhập thu chi hằng ngày, đính kèm ảnh chứng từ |
| Nhập file | Tải báo cáo thu chi tiền mặt, báo cáo doanh thu ngày (iPOS) từ Excel/CSV. Nhập lại file không bị trùng |
| Dự tính | “Bán 10 triệu/ngày thì chi phí bao nhiêu, đủ chi trả không?”, chỉnh số dự tính |
| P&L | Báo cáo lãi lỗ, thực tế so với dự tính, xuất Excel |
| Danh mục | Thêm danh mục thu chi và chọn nhóm (giá vốn, lương, cố định, khác) |

Gói miễn phí của Supabase **không tự sao lưu**: vào **Quản trị → Sao lưu** tải file về Google Drive mỗi tuần.

## 6. Thêm hạng mục mới mà không ảnh hưởng hạng mục cũ

Mỗi hạng mục là một **mô-đun** độc lập:

```
src/modules/finance/    Tài chính  (bảng fin_*, quyền finance.*)
src/modules/admin/      Quản trị   (quyền admin.*)
src/modules/inventory/  ← ví dụ Kho: bảng inv_*, quyền inventory.*
src/modules/hr/         ← ví dụ Nhân sự: bảng hr_*, quyền hr.*
```

Các bước thêm một hạng mục (ví dụ Kho):

1. Tạo `supabase/migrations/0003_inventory.sql`: bảng `inv_*`, quyền `inventory.*`, luật RLS. **Không sửa các file migration cũ.**
2. Tạo thư mục `src/modules/inventory/` và export một `AppModule` (xem `src/modules/finance/index.tsx`).
3. Thêm 1 dòng vào `src/modules/registry.ts`.

Quy ước giữ cho các mô-đun không dẫm lên nhau:
- Mỗi mô-đun chỉ đọc/ghi bảng có tiền tố của mình.
- Mô-đun cần số liệu của mô-đun khác (ví dụ P&L cần giá vốn từ Kho) thì **đọc qua view chỉ đọc**, không ghi vào bảng của họ.
- Phần lõi (`src/core/`, `0001_core.sql`) chỉ chứa thứ dùng chung: đăng nhập, chi nhánh, người dùng, quyền.

## Phân quyền

| Vai trò | Quyền mặc định |
|---|---|
| Chủ | Tất cả |
| Quản lý | Toàn bộ Tài chính + sao lưu |
| Kế toán | Thu chi, nhập file, báo cáo (không đổi cài đặt) |
| Nhân viên | Chỉ nhập thu chi, chỉ thấy khoản mình nhập |

Mỗi người chỉ thấy chi nhánh được gán. Luật này nằm ở cơ sở dữ liệu (RLS), không chỉ ở giao diện.
