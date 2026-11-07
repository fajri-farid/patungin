# Keamanan deployment Vercel dan publikasi kode

Audit repository: 8 November 2026, Asia/Singapore. Ini pemeriksaan kode, dependency, file publikasi, dan build production lokal; bukan sertifikasi keamanan atau penetration test production.

## Perlindungan dalam kode

- Login Google diverifikasi dengan revocation check, email terverifikasi, dan login baru untuk pertukaran cookie. Sesi production memakai cookie host-only `__Host-`, `Secure`, `HttpOnly`, dan `SameSite=Lax`.
- Server Actions dan API mutasi memeriksa autentikasi serta Origin yang cocok dengan `APP_ORIGIN`. Ownership, status akun, admin, dan revisi diperiksa server. Sandbox tidak aktif pada production.
- Secret configuration memakai `server-only` sehingga import ke komponen client menyebabkan build gagal. Snapshot publik membatasi data; share bertanda tangan, kedaluwarsa, dan dapat dicabut.
- Endpoint gambar memakai `private, no-store`; ukuran download dan CRC32C diverifikasi. Upload struk, QRIS, serta request scan dibatasi saat membaca stream, sebelum parsing multipart: file maksimal 2 MiB dengan tambahan multipart maksimal 64 KiB.
- Penyimpanan gambar memvalidasi JPEG/PNG/WebP dan maksimal 16 megapiksel, memproses ulang gambar, menghapus metadata, serta membatasi hasil sampai 2400 × 2400 dan 2 MiB. QRIS disimpan sebagai PNG; struk JPEG.
- QRIS maksimal 10 percobaan per jam, 3 reservation aktif, dan default 30 aset per akun melalui `QRIS_MAX_STORED_PER_USER`. Record lama ikut dihitung; `uploading`, `ready`, dan `cleanup_pending` tetap memakai slot. Slot dilepas setelah objek terkonfirmasi terhapus. Gambar yang masih direferensikan profil/tagihan tidak dihapus untuk membuka slot.
- Counter kuota dan reservation memakai transaksi Firestore, sehingga tidak bergantung pada memory satu instance Vercel. Sandbox transaksi hanya untuk development/test.
- Header global: `nosniff`, anti-framing, `no-referrer`, pembatasan camera/microphone/geolocation, CSP untuk base/object/framing/form, dan HSTS production. CSP ini belum membatasi eksekusi script dengan nonce.
- File env, data sandbox, screenshot, dan artefak lokal dikecualikan dari tracing server maupun upload Vercel CLI. `.gitignore` tetap diperlukan secara terpisah.

## Pengaturan Vercel yang harus diverifikasi operator

1. Gunakan Node.js **24.x**, pnpm sesuai `packageManager`, dan commit `pnpm-lock.yaml`, `pnpm-workspace.yaml`, serta `patches/`. Jangan melewati patch dependency dengan install npm.
2. Isi `APP_ORIGIN` dengan origin HTTPS production yang tetap. Jangan menambahkan wildcard preview untuk mengatasi CSRF. Daftarkan hostname yang tepat di Firebase Authorized domains.
3. Simpan private key Firebase, Gemini API key, dan secret signing/cleanup hanya sebagai environment server Production. `NEXT_PUBLIC_*` hanya untuk konfigurasi Firebase Web yang memang dikirim ke browser. Redeploy setelah perubahan environment.
4. Pisahkan project/credential Preview dari Production. Jangan memberi credential production kepada kode PR dari fork. Aktifkan Deployment Protection untuk preview bila tersedia; workflow PR repository ini tidak memakai secret layanan.
5. Route scan, gambar, dan cleanup memakai Node runtime serta `maxDuration=60`. Pastikan paket/pengaturan Vercel mendukungnya. Timeout provider 45 detik dan download 30 detik tetap menyisakan kebutuhan waktu untuk autentikasi/persistensi; ukur pada deployment nyata.
6. File aplikasi 2 MiB + multipart 64 KiB berada di bawah [batas payload function Vercel 4,5 MB](https://vercel.com/docs/functions/limitations). Jangan menaikkan batas tanpa meninjau hosting dan konsumsi memori.
7. Atur firewall/rate limiting pada jalur login, halaman share, Server Actions, dan endpoint API sesuai trafik normal. Pembatas aplikasi bukan hard cap seluruh request, Firestore reads, egress, atau biaya function. Owner image reads dan halaman share teks belum memiliki limiter aplikasi khusus; proteksi provider tetap dibutuhkan.
8. Pantau error rate, timeout, durasi, dan biaya. Pasang budget alert Firebase/Google Cloud serta kontrol pemakaian Vercel. Budget alert tidak otomatis menghentikan seluruh tagihan.

## Firebase sebelum mengaktifkan gambar

Terapkan rules dan indeks terbaru, termasuk indeks `qrisImages(ownerUid, status)` untuk kuota total QRIS:

```powershell
firebase deploy --only "storage" --project YOUR_PROJECT_ID
firebase deploy --only "firestore:rules,firestore:indexes" --project YOUR_PROJECT_ID
```

Tunggu indeks siap sebelum memakai upload QRIS. Verifikasi juga IAM bucket privat, Public Access Prevention, dan least privilege service account; rules Firebase tidak membatasi Admin SDK. Jangan membuat bucket publik untuk mengatasi 403.

Jalankan scheduler POST cleanup setiap 15 menit dengan secret header. Cleanup harus berjalan walaupun fitur upload dimatikan. Terapkan TTL metadata dan lifecycle terbatas `receipts/`; jangan menghapus prefix `payment-qris/` dengan lifecycle struk. Periksa soft delete/versioning serta retensi fisik sesuai [panduan storage](receipt-storage.md).

## Pemeriksaan yang sudah dijalankan

- 267 tes pada 25 file: auth/CSRF, ownership, share revocation/expiry, transaksi/kuota, upload/download, cleanup, dan perhitungan.
- Typecheck, lint, build production Next.js 16.4.5, serta install frozen lockfile lulus.
- `pnpm audit --audit-level moderate`: tidak ada advisory yang diketahui pada dependency terpasang saat pemeriksaan. Override minimatch khusus tooling diperbarui untuk [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249); ini bukan jaminan terhadap kerentanan yang belum diketahui.
- Pemindaian file kerja, staging, dan 167 blob riwayat Git tidak menemukan pola credential yang diperiksa atau kecocokan secret server lokal. Pemeriksaan ini terbatas pada pola/secret yang dikenal.
- Tujuh request HTTP production lokal memeriksa header, penolakan akses gambar anonim, penolakan Origin asing, cleanup tanpa secret, dan token share tidak valid.
- 36 chunk client tidak memuat kecocokan secret server lokal. 26 trace server tidak memuat file env/sandbox/output yang diperiksa; trace terbesar sekitar 10 MiB pada build lokal Windows.

Dashboard/IAM/rules live, scheduler, retensi fisik, login Google pada domain production, build Linux Vercel, trafik berat, serta alur dua akun nyata belum diverifikasi melalui audit ini. Workflow GitHub disiapkan untuk pemeriksaan Linux berikutnya; belum dijalankan di GitHub oleh pekerjaan ini.

Sesudah deploy: coba login, upload, baca sebagai owner, penolakan akun lain, share opt-in, revoke, expiry 24 jam, dan cleanup yang benar-benar menghapus objek. Gunakan data sintetis.

## Open source

Baca [SECURITY.md](../SECURITY.md). CI menjalankan pemeriksaan publikasi, advisory, lint, tes, dan build tanpa secret production. Dependabot dijadwalkan mingguan. Pengelola tetap perlu mengaktifkan secret scanning/push protection, private vulnerability reporting, review, serta branch protection di GitHub.
