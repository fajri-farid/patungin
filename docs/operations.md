# Deployment dan operasi

[Kembali ke README](../README.md) · [Setup dan konfigurasi](setup.md) · [Deploy ke Vercel](deploy-vercel.md)

## Deployment

Untuk pertama kali deploy melalui dashboard, ikuti **[panduan Vercel untuk pemula](deploy-vercel.md)**. Panduan tersebut menjelaskan import repo, pengisian environment, konfigurasi domain Firebase, dan percobaan aplikasi setelah online.

Langkah umum di bawah juga berlaku untuk penyedia hosting Node.js lainnya.

Gunakan hosting yang mendukung server Next.js dengan runtime Node.js. Autentikasi, server actions, scan gambar, dan link hasil memerlukan proses server; aplikasi tidak dapat dijalankan sebagai ekspor HTML statis saja.

1. Siapkan Firebase, kredensial server, admin, dan secret mengikuti [panduan setup](setup.md).
2. Isi environment pada penyedia hosting. Gunakan `APP_ORIGIN` HTTPS yang sama dengan domain publik aplikasi dan daftarkan hostname tersebut di Firebase Authentication.
3. Terapkan `firestore.rules` dan `firestore.indexes.json` pada project tujuan. Tunggu seluruh indeks yang diperlukan berstatus Enabled.
4. Ikuti [daftar pemeriksaan setup](setup.md#diagnosis-setup) memakai environment deployment. Pastikan project Firebase dan origin sesuai target rilis.
5. Verifikasi kode dan buat build:

   ```bash
   pnpm lint
   pnpm typecheck
   pnpm test
   pnpm build
   ```

6. Untuk hosting Node.js yang dikelola sendiri, jalankan `pnpm start` setelah build. Pada hosting terkelola, gunakan alur deployment Next.js yang disediakan platform.
7. Uji login admin, pembuatan tagihan manual, pembagian menu bersama, finalisasi, dan riwayat. Jika diaktifkan, uji satu scan gambar serta pembukaan dan pencabutan link dari sesi browser yang belum login.

Variabel `NEXT_PUBLIC_FIREBASE_*` masuk ke build browser. Perubahan nilainya memerlukan build baru. Perubahan konfigurasi server memerlukan restart atau deployment ulang sesuai lingkungan hosting.

## Pemeliharaan dependency

Jalankan `pnpm audit --prod` untuk memeriksa dependency aplikasi dan `pnpm audit` untuk menyertakan alat pengembangan. Audit mengikuti database advisory saat perintah dijalankan, sehingga hasilnya dapat berubah.

`pnpm-workspace.yaml` memuat override yang dibatasi pada dependency tertentu untuk gRPC Firebase, Gaxios, serta Glob yang dipakai Rimraf. Override ini menutup advisory pada dependency aplikasi tanpa mengganti seluruh paket yang memiliki nama sama. Tinjau kembali override saat memperbarui Firebase dan Google Cloud SDK.

Audit menyeluruh saat penyiapan repo masih melaporkan advisory moderate [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) pada Minimatch yang dipakai ESLint dan plugin pengembangan. Versi tersebut tidak dipasang melalui dependency production. Mengganti seluruh Minimatch dengan versi mayor baru dapat memutus API plugin lama; temuan ini tetap terlihat di audit sambil menunggu pembaruan tooling yang kompatibel.

## Akun dan undangan

Halaman `/admin` hanya dapat diakses identitas yang ditetapkan dalam `ADMIN_EMAILS` atau `ADMIN_UIDS`. Admin tetap memakai `/app` dan memiliki pembatas scan seperti pengguna lain.

- **Undangan kode:** kode 8–24 huruf, angka, atau tanda hubung, dengan pencocokan tanpa membedakan huruf besar/kecil. Admin menetapkan batas klaim, kedaluwarsa undangan, dan masa akses setelah aktivasi. Kode ditampilkan ketika dibuat; server menyimpan verifikator HMAC. Kode yang pernah dibuat tidak digunakan ulang.
- **Undangan email:** ditujukan ke satu akun Google. Akses aktif ketika akun yang cocok login. Untuk akun yang sudah terdaftar, ubah status dan masa akses melalui tab Pengguna.
- **Pengelolaan akun:** admin dapat mengaktifkan atau menonaktifkan akun, mengatur masa akses, jatah bulanan, dan total bonus bulan berjalan. Bonus tidak mereset pemakaian dan tidak dibawa ke bulan berikutnya; klaim undangan ulang tidak menambah jatah.

Akses yang nonaktif atau kedaluwarsa menutup halaman privat dan link publik pada request berikutnya tanpa menghapus data. Mengaktifkan akun kembali dapat membuka link lama yang belum dicabut atau kedaluwarsa. Rotasi secret undangan perlu disertai rencana penggantian kode yang belum diklaim.

## Kuota scan

### Monitoring dari halaman admin

Tab **Monitoring** menampilkan pemakaian scan bulan berjalan untuk seluruh akun, jumlah akun yang memakai scan, slot scan aktif, dan 25 aktivitas scan terbaru yang masih tersimpan. Ringkasan hasil berhasil/gagal hanya mencakup aktivitas yang dimuat, bukan seluruh bulan. Gunakan **Perbarui data** untuk mengambil kondisi terbaru.

Setiap aktivitas dapat dibuka untuk melihat pengguna, model, waktu mulai dan selesai, durasi, ID tagihan, serta kode kendala. Scan yang belum selesai lebih dari satu menit ditandai **Perlu dicek**; status tersebut tidak menyatakan bahwa scan pasti gagal. Foto, hasil ekstraksi pesanan, dan pesan error mentah tidak dikirim ke tampilan monitoring.

Tab **Pengguna** menyediakan tabel pada desktop dan kartu pada layar kecil. Pencarian nama/email dari awal teks serta UID lengkap mencakup seluruh database, dengan pagination 25 akun. Filter status dan urutan berlaku pada halaman yang sudah dimuat. Panel **Kelola** menyatukan ringkasan akses dan kuota, aktivitas scan per pengguna, serta riwayat perubahan admin; waktu perubahan bukan waktu login terakhir.

Monitoring menyediakan periode hari ini, 7 hari, atau bulan ini dalam WITA. Angka pemakaian tetap untuk bulan berjalan; distribusi hasil mengikuti halaman aktivitas yang dimuat. Catatan scan memiliki retensi sekitar 30 hari, sehingga awal bulan yang berisi 31 hari bisa sudah terhapus. Tab **Peringatan** menampilkan kuota menipis, akses yang segera berakhir, dan tingkat kegagalan tinggi dari ringkasan yang dicatat.

Ikuti **[panduan admin](admin.md)** untuk persiapan akun lama, penyalinan pesan undangan, penjelasan cakupan data, dan rincian batas query serta tambahan write.

Untuk menambah bonus, gunakan tombol **+5**, **+10**, atau **+25 scan**, periksa perkiraan sisa, lalu pilih **Simpan perubahan**. Tombol tambah hanya mengubah nilai form sampai disimpan. Bonus berupa total jatah tambahan bulan ini dan tidak mereset pemakaian. Pengubahan kuota akun yang menunggu akses mempertahankan status tersebut kecuali admin memilih mengaktifkannya.

Jika pengaturan akun atau bonus sudah diubah dari perangkat lain, server menolak penyimpanan dari panel yang memakai data lama. Tutup panel, perbarui data, dan periksa nilainya sebelum mencoba lagi.

### Pembatas pemakaian

| Pembatas | Nilai bawaan | Pengaturan |
| --- | --- | --- |
| Jatah awal per akun per bulan | 30 scan | `SCAN_MONTHLY_LIMIT`; dapat disesuaikan untuk akun lewat admin |
| Permintaan per akun per menit | 3 | `SCAN_PER_MINUTE_LIMIT` |
| Percobaan scan per tagihan | 5 | Implementasi server |
| Scan aktif per akun | 1 | Implementasi server |
| Scan aktif per deployment | 2 | Implementasi server |
| Sakelar scan | Nonaktif pada contoh environment | `GEMINI_SCAN_ENABLED` |

Reservasi kuota dan slot aktif dilakukan sebelum memanggil Gemini, dengan penanganan idempotensi. Kalender kuota memakai WITA (`Asia/Makassar`). Batas per akun tidak membatasi total biaya Gemini, Firestore, atau hosting secara keseluruhan.

## Lifecycle data

| Koleksi | Isi utama |
| --- | --- |
| `bills` | Draft, kepemilikan, dan satu snapshot `finalResult` terbaru |
| `shares` | Metadata akses link dan ID finalisasi |
| `scanAttempts` | Percobaan scan, status, dan metadata pembatas |
| `usageMonths` | Pemakaian bulanan dan slot scan aktif |
| `users` | Status akses, masa akses, dan pengaturan kuota akun |
| `invites` | Verifikator undangan dan aturan klaim |
| `adminUserMonths` | Ringkasan kuota dan hasil scan per pengguna per bulan untuk monitoring |
| `accountAudits` | Perubahan akses dan kuota oleh admin, beserta nilai sebelum/sesudah |
| `operationalEvents` | Ringkasan penolakan dan gangguan penting per akun, kode, tahap, dan jendela waktu |

Hasil final mencakup input yang diperiksa, hasil hitung, dan informasi pembayaran saat finalisasi. Membuka ulang tagihan mencabut link aktif. Selama tagihan kembali menjadi draft, halaman hasil menunggu pengguna menyelesaikan perubahan dan melakukan finalisasi kembali.

Server hanya membagikan data yang diperlukan untuk melihat rincian patungan. Link dilindungi token acak bertanda tangan. Setiap kali link dibuka, server memeriksa masa berlaku, status pencabutan, status tagihan, dan akses pemilik. Foto struk serta email akun pemilik tidak ikut ditampilkan.

Untuk menghentikan seluruh akses link publik, atur `SHARE_LINKS_ENABLED=false` lalu restart atau deploy ulang. Pembuatan link baru dan pembukaan link lama ditolak; penolakan pembukaan dilakukan sebelum membaca database. Mengaktifkannya kembali dengan secret yang sama memulihkan akses link yang masih valid dan belum dicabut. Gunakan pencabutan pada tagihan untuk menonaktifkan satu link secara permanen.

Informasi pembayaran disimpan dalam `paymentMethods`. QRIS berupa petunjuk meminta kode melalui chat, bukan penyimpanan gambar QRIS. Sampai 10 tujuan pembayaran dapat dicantumkan dalam hasil.

Menghapus tagihan juga membersihkan link berbagi, data finalisasi terkait, dan scan yang telah selesai. Scan yang masih berjalan dipertahankan sementara untuk melepas slot aktif, lalu dihapus saat selesai jika tagihan sudah tidak ada. Kuota yang sudah digunakan tidak dikembalikan.

### Indeks dan retensi

`firestore.indexes.json` memuat indeks daftar tagihan, aktivitas scan per pengguna, hasil/alasan penerapan scan, audit akun, tingkat kejadian operasional, dan peringatan admin. Payload besar, map penghitung, serta field ringkasan dan log yang tidak dicari dikecualikan dari indeks. Lookup `billId` pada share dan scan menggunakan single-field index bawaan.

Field TTL `deleteAfter` tersedia pada scan, share, usage bulanan, ringkasan admin, audit akun, dan kejadian operasional. Retensi scan serta kejadian operasional sekitar 30 hari; usage serta ringkasan bulanan disimpan sampai akhir bulan ditambah 30 hari. Audit akun disimpan hingga 1 tahun, sedangkan share mengikuti kedaluwarsa link. Konfigurasi TTL perlu diterapkan pada project Firebase dan bergantung pada konfigurasi billing yang mendukungnya. Penghapusan TTL dapat tertunda; pemeriksaan akses dan kedaluwarsa tetap dilakukan aplikasi pada setiap request terkait.

## Peta halaman

| Route | Akses | Fungsi |
| --- | --- | --- |
| `/` | Publik | Landing page dan contoh struk interaktif |
| `/login` | Publik | Login Google |
| `/activate` | Akun Google | Klaim undangan atau periksa status akses |
| `/admin` | Admin | Kelola akun, undangan, dan kuota |
| `/admin/logs` | Admin | Telusuri hasil scan, perubahan admin, penolakan, dan gangguan penting |
| `/app` | Akun aktif atau admin | Beranda, unggah struk, input manual, dan lanjutkan draft |
| `/bills/new` | Akun aktif atau admin | Alur alternatif unggah dan scan struk |
| `/bills/[id]/review` | Pemilik tagihan | Periksa dan konfirmasi data struk |
| `/bills/[id]/split` | Pemilik tagihan | Peserta, pembayar, dan alokasi pesanan |
| `/bills/[id]/result` | Pemilik tagihan | Hasil, pembayaran, dan link berbagi |
| `/history` | Akun aktif atau admin | Riwayat draft dan hasil |
| `/s/[token]` | Pemegang link valid | Rincian baca-saja tanpa login |
