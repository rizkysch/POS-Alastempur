# Alastempur POS v1 — Supabase Integrated

Versi ini memiliki fitur : 
- Branding Alastempur, tampilan minimalis/responsive.
- Supabase Auth: Login, Register, Forgot Password, Reset Password, Logout.
- Profile otomatis dibuat setelah register.
- Role profile: admin/kasir/pegawai (default register = kasir).
- POS order 1–5 layanan.
- Validasi nomor telepon: angka saja, 10–14 digit.
- Kanban: Baru → Diproses → Dicuci → Dikeringkan → Quality Check → Siap Diambil → Selesai.
- Master layanan.
- Pembayaran dan laporan ringkas.
- Realtime orders/order_items.
- Pesan error yang menjelaskan penyebab Supabase.

## 1. Setup database

1. Buka Supabase project:
   https://supabase.com/dashboard
2. Pilih project Alastempur.
3. Buka SQL Editor.
4. Buat query baru.
5. Copy seluruh isi `schema.sql`.
6. Run.

## 2. Cek Authentication

Buka:
Authentication → Providers → Email

Untuk development paling mudah:
- Email provider: ON
- Confirm email: OFF

Untuk production, gunakan Confirm email: ON.

## 3. Redirect URL

Buka:
Authentication → URL Configuration

Jika memakai VS Code Live Server, tambahkan:

http://127.0.0.1:5500/**

dan:

http://localhost:5500/**

Site URL bisa diisi:

http://127.0.0.1:5500

Jika Live Server memakai port berbeda, sesuaikan port.

## 4. Jalankan aplikasi

JANGAN double-click `index.html` sehingga URL menjadi `file:///...`.

Gunakan:
- VS Code
- Extension "Live Server"
- klik kanan `index.html`
- Open with Live Server

Contoh URL:
http://127.0.0.1:5500/

## 5. Supabase config

`js/config.js` sudah diisi dengan URL project dan anon key yang diberikan pada percakapan.

Anon/publishable key boleh berada di browser jika RLS benar.
JANGAN pernah memasukkan `service_role`/secret key ke `config.js`.

## 6. Register admin pertama

Register akun dari aplikasi. Secara default role = kasir.

Untuk menjadikannya admin:
1. Supabase → Authentication → Users.
2. Copy User UID.
3. SQL Editor:

update public.profiles
set role='admin'
where id='UUID_USER';

## 7. Jika login/register gagal

Aplikasi akan menampilkan penyebab yang lebih spesifik.

### Invalid API key
Pastikan `js/config.js` berisi anon key project yang sama.

### Redirect URL not allowed
Tambahkan URL Live Server di Authentication → URL Configuration.

### Email not confirmed
Matikan Confirm email untuk development, atau buka email konfirmasi.

### relation does not exist
`schema.sql` belum dijalankan.

### 401 / 403 / RLS
Jalankan ulang `schema.sql`.

### Failed to fetch
Periksa internet, URL Supabase, browser extension, dan Console browser.

## Catatan keamanan

RLS saat ini memberikan akses CRUD kepada authenticated users untuk kebutuhan prototype/PKPL.
Untuk production, policy sebaiknya dibatasi berdasarkan role (admin/kasir/pegawai), terutama delete dan perubahan master layanan.

