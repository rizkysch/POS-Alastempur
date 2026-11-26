# Alastempur POS

Aplikasi point of sale untuk layanan perawatan sepatu. Aplikasi ini mengelola pelanggan, pesanan, proses pengerjaan, layanan, pembayaran, laporan, dan akun kasir menggunakan Supabase.

## Fitur

- Login, registrasi, logout, lupa password, dan reset password melalui Supabase Auth.
- Profil pengguna dengan role `superadmin`, `admin`, `kasir`, atau `pegawai`. Registrasi mandiri membuat akun dengan role `kasir`.
- Dashboard berisi jumlah pesanan aktif, pesanan siap diambil, omzet, dan pelanggan.
- Pembuatan pesanan untuk 1–5 sepatu, dengan layanan yang dipilih untuk setiap sepatu.
- Pencarian pesanan dan pelanggan, serta ringkasan jumlah pesanan pelanggan.
- Kanban dengan alur Baru, Diproses, Dicuci, Dikeringkan, Quality Check, Siap Diambil, dan Selesai.
- Pengelolaan layanan dan status aktif/nonaktif.
- Pencatatan dan pembaruan pembayaran, termasuk pembayaran sebagian.
- Laporan ringkas dengan filter tanggal.
- Undangan, aktivasi, dan penonaktifan akun kasir oleh super admin, beserta audit log.
- Pembaruan profil, nomor telepon, dan password.
- Pembaruan pesanan secara realtime melalui Supabase Realtime.

## Persyaratan

- Node.js dan npm.
- Project Supabase.
- Visual Studio Code dengan ekstensi Live Server, atau server web lokal lain.

## Setup database

### Project baru

1. Buka [Supabase Dashboard](https://supabase.com/dashboard) dan pilih project yang digunakan aplikasi.
2. Buka **SQL Editor** dan jalankan seluruh isi `schema.sql`.
3. Jalankan seluruh isi `migration_superadmin.sql` untuk menyiapkan profil aktif, audit log, kebijakan RLS, dan dukungan manajemen kasir.

### Project lama

1. Jika tabel `orders` atau `order_items` belum memiliki kolom yang dipakai aplikasi, jalankan `migration_orders_compat.sql`.
2. Jalankan `migration_superadmin.sql` untuk menyiapkan fitur super admin dan memperbarui kebijakan RLS.

Migrasi tersebut dirancang agar dapat dijalankan ulang dan mempertahankan data yang sudah ada. Pastikan project yang dipilih sama dengan URL pada `js/config.js`.

## Konfigurasi Supabase

`js/config.js` menyimpan URL project dan anon/publishable key yang digunakan browser. Gunakan nilai dari project Supabase yang sesuai.

Anon/publishable key memang dirancang untuk digunakan di aplikasi browser. Jangan pernah menaruh `service_role`, secret key, atau kredensial server di `js/config.js`, HTML, atau file frontend lainnya. Akses data harus dilindungi oleh kebijakan RLS.

## Authentication dan URL redirect

Di Supabase, buka **Authentication → Providers → Email** dan pastikan Email provider aktif. Untuk development lokal, Confirm email dapat dinonaktifkan. Untuk deployment, atur konfirmasi email dan SMTP sesuai kebijakan project.

Di **Authentication → URL Configuration**, tambahkan URL aplikasi ke **Redirect URLs**. Untuk Live Server dengan port default, gunakan:

```text
http://127.0.0.1:5500/**
http://localhost:5500/**
```

Sesuaikan port jika Live Server menggunakan port berbeda. Atur **Site URL** ke origin aplikasi yang digunakan.

## Menyiapkan super admin pertama

Registrasi mandiri membuat profil dengan role `kasir`. Setelah menjalankan `migration_superadmin.sql`, tetapkan akun super admin pertama melalui SQL Editor:

```sql
update public.profiles
set role = 'superadmin'
where id = 'UUID_AKUN_SUPERADMIN';
```

Ganti `UUID_AKUN_SUPERADMIN` dengan UID akun dari **Authentication → Users**. Jangan menyediakan perubahan role super admin melalui frontend.

## Menjalankan aplikasi

1. Jalankan `npm install` dari folder proyek.
2. Buka folder proyek di Visual Studio Code.
3. Klik kanan `index.html`, lalu pilih **Open with Live Server**.
4. Pastikan URL browser menggunakan `http://localhost` atau `http://127.0.0.1`, bukan `file:///...`.

## Menjalankan tes

Jalankan seluruh tes otomatis dengan:

```powershell
npm test
```

Tes menggunakan Node.js Test Runner. Integrasi yang memerlukan project Supabase, Auth, atau Edge Function perlu diuji terpisah dengan akun dan database pengujian.

## Deployment fitur manajemen kasir

Undangan dan aktivasi akun kasir menggunakan Supabase Edge Function `admin-cashier`. Ikuti [SETUP_SUPERADMIN.md](SETUP_SUPERADMIN.md) untuk deployment fungsi, konfigurasi URL redirect, dan pengaturan secret server.

Panduan pengecekan fitur tersedia di [QA_SUPERADMIN.md](QA_SUPERADMIN.md).

## Pemecahan masalah

| Pesan/gejala | Tindakan |
|---|---|
| Invalid API key | Pastikan URL dan anon/publishable key pada `js/config.js` berasal dari project Supabase yang sama. |
| Redirect URL not allowed | Tambahkan origin aplikasi dan port yang benar di **Authentication → URL Configuration**. |
| Email not confirmed | Konfirmasi email, atau nonaktifkan Confirm email khusus untuk development. |
| Relation does not exist | Jalankan `schema.sql` pada project Supabase yang benar. |
| 401/403 atau akses ditolak | Periksa sesi pengguna, status akun aktif, kebijakan RLS, dan migrasi `migration_superadmin.sql`. |
| Failed to fetch | Periksa koneksi internet, URL Supabase, Console browser, dan ekstensi browser yang memblokir request. |

## Catatan RLS

`schema.sql` menyediakan kebijakan dasar untuk penggunaan aplikasi. Jalankan `migration_superadmin.sql` setelahnya agar kebijakan sebelumnya diganti dengan kebijakan untuk pengguna aktif dan audit log tersedia. Edge Function manajemen kasir memeriksa role super admin aktif di server.

Kebijakan tabel layanan, pesanan, dan item pesanan masih mengizinkan operasi bagi pengguna yang sudah login dan aktif. Sebelum penggunaan produksi dengan pembagian hak akses yang lebih ketat, sesuaikan kebijakan tersebut dengan role dan aturan operasional organisasi.
