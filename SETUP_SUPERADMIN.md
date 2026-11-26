# Super admin dan akun kasir

## 1. Terapkan migrasi database

Di Supabase Dashboard, pilih project yang URL-nya sama dengan `js/config.js`, buka **SQL Editor**, lalu jalankan seluruh `migration_superadmin.sql`. Migrasi ini menambah role `superadmin`, email/status aktif di profil, policy RLS, dan audit log tanpa menghapus akun atau pesanan.

Jika database lama menampilkan error kolom `orders`/`order_items` tidak ditemukan, jalankan juga seluruh `migration_orders_compat.sql`. Migrasi kompatibilitas ini menambahkan kolom yang dipakai alur pesanan, menyelaraskan metode pembayaran, mengisi nomor invoice untuk pesanan lama, membuat kode unik pesanan, dan memuat ulang schema cache PostgREST.

Setelah migrasi selesai, lanjutkan dengan deployment Edge Function dan pengujian pada project Supabase yang digunakan aplikasi.

## 2. Tetapkan super admin pertama

Di **Authentication → Users**, salin UUID akun yang akan menjadi super admin. Jalankan di SQL Editor:

```sql
update public.profiles
set role = 'superadmin'
where id = 'UUID_AKUN_SUPERADMIN';
```

Jangan membuat tombol untuk mengubah role menjadi super admin dari browser. Role hanya boleh ditetapkan melalui SQL tepercaya.

## 3. Siapkan URL undangan

Di **Authentication → URL Configuration**, daftarkan URL aplikasi di **Redirect URLs**, termasuk port lokal yang benar, misalnya:

- `http://127.0.0.1:5500/**`
- `http://localhost:5500/**`
- URL produksi aplikasi Anda

Atur secret `APP_URL` untuk Edge Function ke origin aplikasi tanpa slash terakhir, misalnya `http://127.0.0.1:5500`. URL ini harus cocok dengan salah satu redirect yang diizinkan.

## 4. Deploy Edge Function

Fitur undangan dan aktivasi akun memanggil `admin-cashier`. Deploy dengan Supabase CLI dari root repository:

```sh
supabase functions deploy admin-cashier
```

Di **Project Settings → Edge Functions → Secrets** (atau melalui Supabase CLI), pastikan fungsi dapat membaca:

- `APP_URL` — origin aplikasi yang diizinkan.
- `ALASTEMPUR_SERVICE_KEY` — secret/server key project, hanya disimpan sebagai Edge Function secret.

`SUPABASE_URL` dan publishable/anon key disediakan oleh runtime Supabase. Jangan menyalin service-role/secret key ke `js/config.js`, HTML, atau file yang di-host publik.

Fungsi memeriksa JWT pemanggil dan membaca role langsung dari `profiles`; hanya super admin aktif yang boleh mengundang atau mengaktifkan/menonaktifkan akun kasir.

## 5. Alur kasir

1. Super admin membuka **Manajemen kasir → Tambah kasir** dan memasukkan nama, email, serta nomor telepon.
2. Kasir membuka undangan, mengonfirmasi email, lalu mengatur password pada halaman Alastempur.
3. Super admin dapat menonaktifkan akun dari daftar. Akun nonaktif ditolak oleh aplikasi dan policy database; pesanan lama tetap tersimpan.

Email undangan tetap tunduk pada batas pengiriman Auth Supabase. Untuk pemakaian rutin, konfigurasi SMTP khusus.

## 6. Sign-up publik

Form pendaftaran mandiri yang sudah ada tetap tersedia. Jika operasional harus hanya menerima akun melalui undangan, nonaktifkan **Allow new users to sign up** di pengaturan Auth setelah memastikan perilaku undangan pada project Anda. Undangan super admin tetap menggunakan Admin API di Edge Function.
