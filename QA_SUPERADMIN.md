# Rencana black-box, white-box, BVA, dan SQA

## Black-box

| Area | Langkah/input | Hasil yang diharapkan |
|---|---|---|
| Hak akses | Kasir membuka Manajemen kasir | Halaman tidak dapat dibuka; Edge Function mengembalikan 403 |
| Undangan | Super admin mengundang email valid baru | Email undangan terkirim; profil ber-role kasir aktif dan audit log tercatat |
| Undangan duplikat | Undang email yang sudah terdaftar | Pesan error yang jelas; tidak ada profil kedua |
| Konfirmasi | Kasir membuka link undangan valid | Halaman Buat password tampil; password valid mengaktifkan login |
| Link kedaluwarsa | Buka undangan kedaluwarsa | Aplikasi menampilkan error dan meminta undangan baru |
| Deaktivasi | Nonaktifkan kasir lalu coba masuk | Aplikasi menolak sesi dan RLS menolak akses data |
| Profil | Ubah nama dan telepon dengan nilai valid | Profil tersimpan, header diperbarui, audit log mencatat perubahan |
| Password | Password lama salah atau konfirmasi tidak cocok | Password tidak berubah dan pesan validasi muncul |
| Password | Password lama benar dan password baru valid | Password berubah; login berikutnya memakai password baru |
| Audit | Buka audit log sebagai kasir | Data audit tidak dapat dibaca; super admin dapat melihatnya |

## BVA (Boundary Value Analysis)

| Input | Nilai batas yang diuji | Validasi |
|---|---|---|
| Nama | 1, 2, 100, 101 karakter | 2–100 karakter diterima |
| Telepon | 9, 10, 14, 15 digit; berisi huruf | Hanya 10–14 digit diterima |
| Password baru | 7, 8 karakter | Minimal 8 karakter |
| Email | kosong, tanpa `@`, domain tidak lengkap, format valid | Hanya format email valid diterima |
| ID kasir | UUID valid dan string malformed | Hanya UUID valid diproses |
| Status aktif | boolean dan string (`"true"`) | Hanya boolean diterima |

Jalankan nilai batas di form dan panggil Edge Function secara langsung untuk memastikan validasi server tidak bergantung pada browser.

## White-box

- Tutupi cabang Edge Function: tanpa Authorization, JWT invalid, role bukan super admin, super admin nonaktif, action tidak dikenal, email duplikat, undangan berhasil, target bukan kasir, menonaktifkan diri sendiri, serta toggle aktif/nonaktif berhasil/gagal.
- Periksa cabang profil: nama/telepon valid, format telepon gagal, password saat ini salah, konfirmasi beda, update Supabase gagal, dan sukses.
- Periksa policy RLS sebagai anon, kasir aktif, kasir nonaktif, admin, dan super admin untuk tabel `profiles`, `orders`, `services`, `order_items`, serta `audit_logs`.
- Pastikan payload metadata dari browser tidak dapat menetapkan role; trigger database menetapkan pengguna baru sebagai `kasir`.

## SQA / kriteria mutu

- Tidak ada secret/service-role key di berkas browser atau hasil build publik.
- Akses penting ditegakkan di Edge Function dan RLS, bukan sekadar menu yang disembunyikan.
- Input divalidasi di browser untuk UX dan di server/database untuk integritas.
- Aksi administratif memiliki actor, target, waktu, dan detail audit yang tidak memuat password.
- Deaktivasi tidak menghapus riwayat pesanan.
- Error email/rate limit ditampilkan tanpa mengklaim undangan berhasil.
- Verifikasi manual harus dilakukan setelah migrasi, deploy function, URL redirect, dan SMTP siap.
