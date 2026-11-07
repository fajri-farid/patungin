# Foto struk sementara dan profil pembayaran — v1.1.0

## Perilaku aplikasi

- Foto disimpan dalam bucket privat. Masa akses **24 jam sejak server menerima upload**, terpisah dari masa berlaku link tujuh hari. Setelah expiry endpoint menolak pembacaan walau cleanup belum selesai. File yang sudah diunduh/screenshot tidak dapat ditarik kembali.
- Satu foto aktif per tagihan, maksimal 2 MiB setelah optimasi. Server membatasi 16 juta pixel input, decode, rotasi/resize maksimal 2400 px, re-encode JPEG, dan membuang EXIF.
- Berbagi foto default mati. Host memilih sebelum finalisasi; snapshot mengikat ID foto dan pilihannya. Semua syarat share tetap diperiksa: signature, record, expiry, pencabutan, finalisasi aktif, status bill, dan akses produk pemilik.
- Hapus foto menutup akses tanpa mengubah hitungan. Ganti foto hanya pada draft; buka ulang final mencabut link lama. Foto baru memiliki masa akses sendiri.
- Retry simpan foto tidak menjalankan Gemini atau mengurangi kuota scan. Jika hasil upload tidak pasti, revision direkonsiliasi sebelum scan dilanjutkan.
- Upload aktif ditandai pada bill untuk mencegah scan/finalisasi berjalan ketika hasil upload belum jelas. Kegagalan atau cleanup reservation stale melepas penanda ini. Retry yang diakui gagal memakai attempt baru; request yang sudah berhasil tetap idempotent dan tidak memperpanjang expiry.
- Bila upload gagal/fitur online nonaktif, preview baru dapat disimpan sementara di tab browser, diberi label belum online, dan dibersihkan pada expiry/tab ditutup. Preview lama tanpa metadata expiry tidak dipakai. Foto server yang expired/dihapus tidak digantikan dengan preview lokal lama.
- `/settings/payments` menyimpan maksimal 10 rekening/e-wallet dan satu default opsional. Default hanya ditandai dalam pemilih, bukan dimasukkan otomatis.
- Rekening yang dipilih disalin ke tagihan. Mengubah/menghapus profil tidak mengubah tagihan lama. Profil pembayaran tidak memiliki TTL satu hari.

## Gambar QRIS pada tujuan pembayaran

Di **Pengaturan → Tujuan pembayaran → Tambah tujuan pembayaran → QRIS**, unggah JPG/PNG/WebP maksimal 2 MiB, periksa preview, lalu simpan. Gambar bisa dipilih pada tagihan, ditampilkan pada hasil dan link peserta, serta diunduh sebagai PNG. Bank/e-wallet dan QRIS petunjuk teks pada data lama tetap kompatibel.

QRIS memakai prefix **`payment-qris/`**, bukan `receipts/`. Gambar tetap disimpan selama masih dipakai oleh profil atau tagihan, termasuk snapshot final yang dipertahankan. Mengganti/menghapus QRIS pada profil tidak mengubah gambar pada tagihan lama. File tanpa referensi dijadwalkan hapus setelah jeda 24 jam. Aplikasi memvalidasi gambar, bukan keabsahan QRIS atau status pembayaran; gunakan QRIS statis untuk pemakaian ulang dan periksa penerima/nominal saat membayar.

Secara default QRIS memakai bucket dari `FIREBASE_STORAGE_BUCKET` dan tidak bergantung pada `RECEIPT_PHOTOS_ENABLED`. Konfigurasi server opsional:

```dotenv
QRIS_IMAGES_ENABLED=true
# Kosong/tidak diisi = menggunakan FIREBASE_STORAGE_BUCKET.
FIREBASE_QRIS_STORAGE_BUCKET=
```

Jika memakai bucket terpisah, berikan IAM objek yang sama pada runtime dan pastikan bucket privat. **Jangan memasang lifecycle hapus satu hari pada seluruh bucket atau prefix `payment-qris/`. Batasi aturan struk pada `receipts/`.** Bucket yang sudah memiliki aturan penghapusan global perlu diperbaiki atau dipisahkan sebelum QRIS dipakai.

Jika upload QRIS gagal dengan `QRIS_BUCKET_NOT_FOUND`, periksa `FIREBASE_QRIS_STORAGE_BUCKET` terlebih dahulu: field ini menimpa bucket utama jika terisi. Kosongkan jika memakai bucket yang sama. Nama bucket tidak berisi secret, `gs://`, atau URL console. `QRIS_STORAGE_PERMISSION_DENIED` berarti izin service account pada bucket perlu diperiksa. Restart server lokal atau redeploy setelah mengubah env. Error backend mempunyai `requestId` yang juga tercatat pada log aman `qris_request_failed`.

Cleanup POST yang sudah ada turut memproses `qrisImages`; respons menyertakan rincian `qris` dan agregat processed/deleted/failed/hasMore. Aktifkan TTL `deleteAfter` untuk collection group `qrisImages` agar tombstone setelah file terhapus dibersihkan tujuh hari kemudian. Jadwalkan rekonsiliasi harian QRIS dengan POST `/api/internal/receipt-cleanup?reconcile=qris`, bearer secret yang sama, dan ikuti `cursor` hingga null. Jangan memberi TTL pada metadata QRIS aktif.

## Setup production

Fitur foto cloud nonaktif secara default. [Firebase Storage memerlukan Blaze/billing aktif](https://firebase.google.com/docs/storage/faqs-storage-changes-announced-sept-2024). Implementasi lokal tidak membuat bucket atau mengaktifkan billing.

1. Buat bucket khusus foto sementara pada project yang sesuai. Pertimbangkan region runtime dan egress saat memilih lokasi.
2. Aktifkan Public Access Prevention dan Uniform Bucket-Level Access. Jangan beri `allUsers`/`allAuthenticatedUsers` izin baca, membuat download token, atau memakai public URL.
3. Runtime menggunakan JWT service account Firebase server melalui auth client eksplisit `@google-cloud/storage`. Beri hak objek `get/create/delete/list` pada bucket khusus, misalnya `roles/storage.objectUser`, dan verifikasi izin efektif. Jangan kirim credential ke browser.
4. Jika tidak ingin salinan recoverable, nonaktifkan **soft delete** dan **object versioning** pada bucket khusus ini. Pastikan tidak ada retention policy/hold yang mencegah cleanup. File terhapus tidak dapat dipulihkan; jangan menerapkan konfigurasi ini ke bucket dokumen lain.
5. Terapkan rules dan indeks/TTL dari folder aplikasi:

```powershell
firebase deploy --only storage --project YOUR_PROJECT_ID
firebase deploy --only firestore:rules,firestore:indexes --project YOUR_PROJECT_ID
```

`storage.rules` menolak akses browser langsung. Admin/Cloud SDK memakai IAM dan bypass rules; guard server tetap wajib. Verifikasi kebijakan TTL `deleteAfter` pada `receiptPhotos` dan `receiptPhotoReads` telah aktif di console setelah deployment.

6. Tambahkan lifecycle pengaman pada prefix khusus:

```json
{
  "rule": [{
    "action": { "type": "Delete" },
    "condition": { "age": 1, "matchesPrefix": ["receipts/"] }
  }]
}
```

[Lifecycle berjalan asynchronous](https://docs.cloud.google.com/storage/docs/lifecycle), sehingga tidak menjamin penghapusan fisik tepat pada detik ke-86.400. Scheduler aplikasi merupakan jalur cleanup utama; lifecycle mengamankan objek yang luput.

7. Isi env server melalui pengelola secret deployment:

```dotenv
FIREBASE_STORAGE_BUCKET=YOUR_BUCKET_NAME
RECEIPT_CLEANUP_SECRET=RANDOM_SECRET_MINIMUM_32_CHARACTERS
RECEIPT_PHOTOS_ENABLED=true
RECEIPT_PHOTO_SHARING_ENABLED=false
RECEIPT_UPLOAD_HOURLY_LIMIT=10
RECEIPT_MAX_STORED_PER_USER=30
RECEIPT_PUBLIC_READS_PER_MINUTE=60
RECEIPT_DEPLOYMENT_READS_PER_MINUTE=600
```

Gunakan nama bucket tanpa `gs://`. Secret tidak boleh masuk `.env.example`, log, atau variabel `NEXT_PUBLIC_*`.

8. Pasang scheduler eksternal setiap 15 menit untuk **POST** `/api/internal/receipt-cleanup` dengan `Authorization: Bearer <RECEIPT_CLEANUP_SECRET>`. Gunakan penyedia yang mendukung POST serta secret header, misalnya Cloud Scheduler. Jangan menganggap cron GET bawaan Vercel langsung cocok dengan endpoint ini.
9. Smoke test pada bucket staging: upload → baca owner → tanpa sesi ditolak → opt-in share → revoke → expiry → cleanup → objek benar-benar hilang. Verifikasi IAM dan soft delete melalui console/API. Setelah lulus, aktifkan `RECEIPT_PHOTO_SHARING_ENABLED=true` bila berbagi foto diinginkan.

Menurut [dokumentasi Vercel Cron](https://vercel.com/docs/schedules/cron-jobs/usage-and-pricing) saat implementasi, Hobby hanya mendukung cron sekali sehari. Pilih scheduler/paket sesuai target; repository tidak memaksakan cron per-15-menit ke Hobby.

## Cleanup dan rekonsiliasi

Cleanup tetap bekerja saat fitur foto dimatikan. Secret kosong/kurang dari 32 karakter menolak semua request; GET ditolak. Respons memuat `processed`, `deleted`, `failed`, `oldestDueAt`, dan `hasMore`.

- Satu panggilan mengambil maksimal 50 record jatuh tempo melalui `nextCleanupAt`, bukan scan seluruh koleksi. Jika `hasMore`, orchestrator mengulang dengan batas durasi wajar sampai backlog habis.
- Reservation dibuat sebelum upload objek. Reservation menggantung 15 menit, kegagalan upload, foto diganti/dihapus, serta bill dihapus dijadwalkan cleanup.
- Status ditutup dahulu, lalu objek dihapus dengan generation precondition. Not-found dianggap berhasil. Kegagalan mempertahankan metadata dan kuota aset; retry backoff 1 menit hingga maksimal 1 jam.
- Setelah objek terkonfirmasi hilang, record menjadi tombstone dengan TTL tujuh hari. Metadata yang masih bertanggung jawab atas bytes tidak diberi TTL. Jangan menghapus metadata pending lebih dulu.
- Counter `receiptPhotoReads` memiliki TTL satu hari. Tanpa kebijakan TTL, otorisasi tetap berjalan tetapi counter lama menumpuk.
- Rekonsiliasi harian: POST endpoint yang sama dengan `?reconcile=1`. Satu halaman maksimal 100 objek pada prefix `receipts/`. Ulangi dengan `?reconcile=1&cursor=<url-encoded-cursor>` sampai respons `cursor` null. Hanya objek berumur lebih dari 25 jam tanpa record aktif yang dibersihkan.
- Jangan listing bucket pada request pengguna. Tagihan yang dihapus selama upload tidak dibuat ulang oleh proses foto.

Pantau log terstruktur `receipt_cleanup` dan isi respons. Pasang alarm eksternal pada HTTP gagal, `failed > 0`, backlog berulang, serta waktu jatuh tempo tertua lewat satu jam. Satu jam adalah target operasional normal, bukan jaminan platform. HTTP 200 bisa berisi kegagalan sebagian batch; monitoring perlu memeriksa `failed` juga.

## Akses dan biaya

QRIS dibatasi 10 percobaan per jam, 3 reservation aktif, dan default 30 aset belum terhapus per akun (`QRIS_MAX_STORED_PER_USER`). Kuota total memakai query dalam transaksi serta indeks `qrisImages(ownerUid, status)` pada `firestore.indexes.json`; terapkan indeks sebelum deployment upload. Aset lama ikut dihitung, termasuk yang menunggu penghapusan. QRIS yang masih dipakai profil/tagihan tetap dipertahankan.

Download QRIS dan foto struk menggunakan native fetch ke Storage JSON API dengan autentikasi server dan generation objek yang tetap. Ukuran dan CRC32C diperiksa sebelum respons dikirim. Download dibatasi 15 detik per percobaan, maksimal dua percobaan dalam deadline 30 detik. Jalur ini menghindari pipeline download SDK yang dilaporkan memicu warning listener `PassThrough`; upload dan cleanup tetap memakai SDK.

Jika log QRIS menampilkan `QRIS_STORAGE_TIMEOUT` atau `QRIS_STORAGE_CONNECTION_FAILED`, periksa koneksi server ke `storage.googleapis.com` dan coba ulang. Warning listener sendiri belum membuktikan memory leak. Jangan membuka bucket atau menaikkan batas listener untuk menangani kegagalan jaringan.

Endpoint bytes menggunakan `private, no-store`, `nosniff`, dan `no-referrer`. UI sengaja melewati Next Image optimizer. Jangan menggantinya dengan cache/CDN publik karena expiry dan pencabutan diperiksa per request.

Default upload per akun: 10 percobaan per jendela jam, 3 reservation aktif, dan 30 aset belum terhapus. Ini terpisah dari kuota scan. Input gambar rusak tetap memakai percobaan foto dan reservation hingga cleanup. Baca publik dibatasi per share dan deployment per menit sebelum bytes dikirim. Pembatas aplikasi bukan hard cap total biaya.

Biaya dapat mencakup storage, operasi, egress, Firestore, server pemroses gambar, dan scheduler. Pantau dashboard dan pasang budget alert pada penyedia; repository tidak mengaktifkannya otomatis. Hindari bytes foto, EXIF, token link lengkap, nomor rekening, dan body request dalam log/error monitoring.

## Sandbox dan rollback

Sandbox hanya aktif tanpa konfigurasi Firebase pada development/test. Metadata menggunakan database sandbox dan bytes di `.patungin-receipts/` yang diabaikan Git. Ganti path dengan `PATUNGIN_DEV_RECEIPTS_PATH` bila perlu. Filesystem serverless tidak dipakai untuk production. Tidak ada timer cleanup di proses Next.js; panggil endpoint terjadwal atau uji menggunakan clock/adapter.

- Matikan `RECEIPT_PHOTO_SHARING_ENABLED` untuk menutup foto publik tanpa menutup rincian share.
- Matikan `RECEIPT_PHOTOS_ENABLED` untuk menghentikan upload/akses foto. Cleanup wajib tetap aktif.
- Bila rollback ke kode sebelum v1.1.0, pertahankan deployment/worker cleanup yang kompatibel sampai file lama bersih; lifecycle bucket tetap terpasang.
- Profil privat berada di `paymentProfiles`; fallback ke input pembayaran manual tidak membutuhkan penghapusan profil/snapshot.

Tes lokal tidak membuktikan konfigurasi bucket, IAM, scheduler, dan soft delete production. Operator perlu menyelesaikan smoke test staging sebelum mengaktifkan fitur cloud.
