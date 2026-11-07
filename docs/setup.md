# Setup dan konfigurasi

Fitur opsional v1.1.0: [foto struk sementara dan pengaturan pembayaran](receipt-storage.md). Penyimpanan foto perlu bucket privat serta scheduler cleanup terpisah; pengaturan rekening memakai Firestore yang sudah ada.

[Kembali ke README](../README.md) · [Deployment dan operasi](operations.md) · [Deploy ke Vercel](deploy-vercel.md)

Panduan ini menyiapkan login Google, penyimpanan tagihan, pembacaan struk, dan link hasil. Semua perintah dijalankan dari direktori `splitbill-webapp`.

Jika ingin aplikasi bisa dibuka lewat internet, lanjutkan ke **[panduan deploy ke Vercel](deploy-vercel.md)** setelah menyiapkan Firebase. Konfigurasi yang disimpan di laptop perlu dimasukkan juga ke environment variables hosting.

## 1. Siapkan environment lokal

Salin [.env.example](../.env.example) ke `.env.local` dan isi nilainya. `.env` juga didukung; jika keduanya tersedia, nilai di `.env.local` mengungguli `.env`. File `.env.example` tidak dimuat sebagai konfigurasi aplikasi.

Konfigurasi dengan awalan `NEXT_PUBLIC_` digunakan di browser. Kredensial Admin, API key Gemini, serta secret penandatanganan hanya boleh berada di server. Restart server pengembangan atau build ulang setelah mengubah konfigurasi publik.

Jangan masukkan file environment berisi secret, JSON service account, atau database sandbox ke version control.

## 2. Konfigurasikan Firebase

1. Buat project di [Firebase Console](https://console.firebase.google.com/) dan daftarkan Web App.
2. Inisialisasi **Authentication**, lalu aktifkan provider **Google** dan pilih support email yang diminta.
3. Tambahkan hostname aplikasi pada **Authentication → Settings → Authorized domains**. Untuk lokal, tambahkan `localhost` secara eksplisit. `127.0.0.1` dan alamat LAN merupakan hostname yang berbeda.
4. Buat database Cloud Firestore `(default)` dan aktifkan Cloud Firestore API jika belum tersedia.
5. Ambil konfigurasi Web App dari **Project settings → General** untuk mengisi tiga variabel `NEXT_PUBLIC_FIREBASE_*`.
6. Buka **Project settings → Service accounts → Generate new private key**. Simpan JSON yang diunduh di perangkatmu, lalu gunakan field `project_id`, `client_email`, dan `private_key` untuk mengisi variabel server `FIREBASE_*`. Project server dan browser harus sama. File JSON tersebut berisi kredensial dan tidak dimasukkan ke GitHub.
7. Tetapkan akun admin melalui `ADMIN_EMAILS` atau `ADMIN_UIDS`. Pendaftar pertama tidak otomatis menjadi admin.

Untuk private key yang ditulis dalam satu baris environment, pertahankan tanda kutip dan karakter newline `\n`:

```dotenv
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

### Aturan dan indeks database

Firebase CLI adalah alat terminal untuk menerapkan konfigurasi database. Jika belum terpasang, jalankan perintah berikut di terminal yang sudah memiliki Node.js dan npm:

```bash
npm install -g firebase-tools
firebase login
```

Selesaikan login melalui browser. Setelah itu, buka terminal di folder aplikasi yang berisi `firebase.json`, lalu terapkan konfigurasi pada project tujuan:

```bash
firebase deploy --only firestore:rules,firestore:indexes --project YOUR_PROJECT_ID
```

Ganti `YOUR_PROJECT_ID` dengan ID project Firebase yang dikonfigurasi untuk aplikasi. Perintah ini mengubah rules dan indeks pada project tersebut.

Langkah pemasangan dan login mengikuti [panduan Firebase CLI](https://firebase.google.com/docs/cli).

[firestore.rules](../firestore.rules) menolak akses langsung ke database dari browser. Akses produk dilakukan server menggunakan kredensial Admin setelah memeriksa sesi dan kepemilikan; rules tersebut tidak menggantikan pemeriksaan akses di server.

[firestore.indexes.json](../firestore.indexes.json) memuat indeks query tagihan serta admin (aktivitas per pengguna, filter log, riwayat perubahan, dan peringatan). Tunggu hingga seluruh indeks **Enabled** di Firebase Console sebelum mencoba fitur terkait.

## 3. Tetapkan admin dan secret undangan

Isi setidaknya satu identitas admin dan secret acak minimal 32 karakter:

```dotenv
ADMIN_EMAILS=you@example.com
INVITE_SIGNING_SECRET=
```

Bangkitkan secret dengan Node.js, lalu salin hasilnya ke `INVITE_SIGNING_SECRET`:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Jalankan perintah lagi jika mengaktifkan link hasil, dan gunakan nilai yang berbeda untuk `SHARE_SIGNING_SECRET`.

Setelah login sebagai admin, buka `/admin` untuk mengundang pengguna melalui email atau kode. Pengguna lain yang baru login diarahkan ke `/activate` sampai memiliki akses aktif. Detail pengelolaan akun ada di [panduan operasi](operations.md#akun-dan-undangan).

## 4. Aktifkan scan gambar jika diperlukan

Buat API key di [Google AI Studio](https://aistudio.google.com/), lalu isi:

```dotenv
GEMINI_API_KEY=
GEMINI_MODEL=
GEMINI_SCAN_ENABLED=true
```

Isi `GEMINI_MODEL` secara eksplisit dengan model yang tersedia pada project Anda dan mendukung input gambar serta structured output JSON. Nilai pada `.env.example` merupakan konfigurasi contoh. Ketersediaan dan biaya model dapat diperiksa melalui [katalog model](https://ai.google.dev/gemini-api/docs/models) dan [halaman harga Gemini](https://ai.google.dev/gemini-api/docs/pricing).

Tidak ada perpindahan model atau fallback berbayar otomatis. Model yang tercantum dalam katalog belum tentu dapat digunakan dengan key dan kuota project Anda. Evaluasi satu gambar transaksi yang representatif untuk memeriksa akses model dan kualitas hasil; percobaan tersebut memakai kuota Gemini.

Pertahankan `GEMINI_SCAN_ENABLED=false` untuk menggunakan input manual tanpa memanggil Gemini.

### Batas input gambar

- Server menerima JPEG, PNG, dan WebP, dengan batas gambar teroptimasi **2 MiB**. HEIC/HEIF perlu dikonversi terlebih dahulu.
- Seluruh pesanan, jumlah, harga, dan total sebaiknya terlihat. Menu harga tanpa transaksi atau gambar yang hanya memuat total tidak cukup untuk pembagian otomatis.
- Nilai yang tidak terbaca ditandai untuk diperiksa, bukan diasumsikan nol. Pengguna tetap perlu meninjau hasil sebelum finalisasi.

## 5. Aktifkan link hasil jika diperlukan

```dotenv
SHARE_LINKS_ENABLED=true
SHARE_SIGNING_SECRET=
```

Isi secret acak minimal 32 karakter, terpisah dari secret undangan. Link dilindungi tanda tangan HMAC-SHA-256 dan berlaku selama tujuh hari sejak dibuat. QR berisi link yang sama dan dibuat secara lokal di browser.

`SHARE_LINKS_ENABLED=false` menghentikan pembuatan link baru dan pembukaan seluruh link lama. Restart server atau deploy ulang setelah mengubahnya. Sakelar ini tidak mencabut atau memperpanjang link: jika diaktifkan kembali dengan secret yang sama, link yang masih valid dan belum dicabut bisa dibuka lagi. Untuk mencabut satu link secara permanen, gunakan tindakan pencabutan pada tagihan tersebut.

Atur `APP_ORIGIN` ke origin aplikasi yang dapat diakses penerima link. `http://localhost:3000` hanya cocok untuk pengembangan pada perangkat yang sama; gunakan origin HTTPS untuk deployment. Origin tidak memuat path, query, atau garis miring di akhir.

## Referensi environment

| Variabel | Kegunaan | Ketentuan |
| --- | --- | --- |
| `APP_ORIGIN` | Origin untuk validasi request dan URL hasil | Harus cocok dengan scheme, hostname, dan port yang dibuka di browser |
| `ADMIN_EMAILS` / `ADMIN_UIDS` | Identitas admin | Isi setidaknya satu; beberapa nilai dipisahkan koma |
| `INVITE_SIGNING_SECRET` | Verifikator kode undangan | Secret server acak minimal 32 karakter |
| `NEXT_PUBLIC_FIREBASE_API_KEY` | Konfigurasi Firebase Web App | Wajib untuk login Google |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | Domain autentikasi Firebase | Wajib untuk login Google |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | ID project Firebase browser | Harus sesuai project server |
| `FIREBASE_PROJECT_ID` | ID project Firebase server | Jika kosong, kode memakai ID project browser |
| `FIREBASE_CLIENT_EMAIL` | Email service account | Wajib untuk koneksi server ke Firebase |
| `FIREBASE_PRIVATE_KEY` | Private key service account | PEM valid; mendukung newline `\n` |
| `GEMINI_SCAN_ENABLED` | Sakelar scan struk | `false` pada konfigurasi contoh |
| `GEMINI_API_KEY` | API key Gemini di server | Wajib saat scan diaktifkan |
| `GEMINI_MODEL` | Model ekstraksi | Tetapkan model yang tersedia untuk project |
| `SCAN_MONTHLY_LIMIT` | Jatah awal scan per akun per bulan | Default `30`; admin dapat mengatur kuota akun |
| `SCAN_PER_MINUTE_LIMIT` | Pembatas scan per akun per menit | Default `3` |
| `USAGE_TIMEZONE` | Penanda zona waktu pada contoh konfigurasi | Implementasi memakai zona tetap `Asia/Makassar` |
| `SHARE_LINKS_ENABLED` | Sakelar pembuatan dan pembukaan seluruh link hasil publik | `true` pada konfigurasi contoh; memerlukan secret yang valid |
| `SHARE_SIGNING_SECRET` | Secret penandatanganan link | Minimal 32 karakter saat link diaktifkan |
| `ALLOWED_EMAILS` | Pengaturan internal daftar email | Untuk pengelolaan pengguna, gunakan undangan dan halaman admin |

Kuota bulanan mengikuti WITA (`Asia/Makassar`), dimulai kembali tanggal 1 pukul 00.00. Zona ini ditetapkan oleh implementasi server, bukan zona perangkat pengguna.

## Diagnosis setup

Gunakan daftar berikut bila konfigurasi belum berjalan:

1. Cocokkan project Firebase pada konfigurasi browser dan server.
2. Pastikan Google Sign-In aktif dan hostname aplikasi terdaftar di Authorized domains.
3. Cocokkan alamat browser dengan `APP_ORIGIN`, termasuk scheme dan port.
4. Pastikan database Firestore `(default)` tersedia, rules sudah diterapkan, dan semua indeks query berstatus Enabled.
5. Periksa bahwa service account dan private key berasal dari project yang benar serta memiliki izin yang dibutuhkan server.
6. Restart aplikasi setelah mengubah environment. Untuk deployment, build ulang jika nilai `NEXT_PUBLIC_*` berubah.
7. Coba login sebagai admin, buat tagihan manual, lalu buka riwayat. Uji scan dan link hasil secara terpisah setelah fitur tersebut diaktifkan.

Utilitas diagnosis lokal belum disertakan dalam repositori ini. Daftar pemeriksaan di atas dapat diikuti tanpa folder `scripts`.

### Troubleshooting

| Gejala | Langkah pemeriksaan |
| --- | --- |
| `auth/configuration-not-found` / `CONFIGURATION_NOT_FOUND` | Inisialisasi Firebase Authentication dan aktifkan Google pada project yang sama dengan API key Web App. |
| `auth/operation-not-allowed` | Aktifkan provider Google, pilih support email, lalu simpan. |
| `auth/unauthorized-domain` | Tambahkan hostname yang benar pada Authorized domains, termasuk `localhost` untuk pengembangan. |
| `auth/invalid-api-key` | Periksa konfigurasi Web App dan pembatasan key, lalu restart atau build ulang. |
| `ORIGIN_MISMATCH` | Cocokkan scheme, hostname, dan port browser dengan `APP_ORIGIN`. Jika server memakai port lain, perbarui origin dan restart. |
| `FIREBASE_SERVICE_UNAVAILABLE` | Periksa kredensial Admin, izin service account, dan koneksi sesuai daftar diagnosis di atas. |
| Firestore `SERVICE_DISABLED` | Aktifkan Cloud Firestore API dan buat database `(default)`. |
| Firestore `FAILED_PRECONDITION` dengan pesan indeks | Terapkan `firestore.indexes.json` dan tunggu semua indeks berstatus Enabled. |
| Login berhasil tetapi diarahkan ke `/activate` | Aktifkan akun lewat undangan atau admin; login Google saja tidak memberikan akses produk. |
| Scan tidak tersedia | Periksa sakelar scan, key, model, kuota akun, dan pembatas permintaan. |

## Sandbox dan pengujian

Adapter sandbox tersedia untuk pengujian terisolasi saat mode development/test dan seluruh konfigurasi Firebase kosong. Konfigurasi parsial tidak mengaktifkan sandbox; adapter ini juga tidak aktif pada production atau konfigurasi Firebase nyata.

Antarmuka login tidak menyediakan tombol masuk sandbox. Landing page dapat ditinjau tanpa layanan nyata.

Jalankan `pnpm test` setelah memasang dependency untuk menjalankan seluruh test sekali. Folder `tests`, konfigurasi Vitest, dan helper pemeriksaan indeks yang dibutuhkan test disertakan dalam repo. Setup test mengganti kredensial layanan dengan nilai uji, memakai mock untuk panggilan layanan, dan membuat database sementara per worker yang dibersihkan setelah pengujian. Test tidak memakai Firebase/Gemini nyata atau database sandbox lokal.

Jalankan juga `pnpm lint`, `pnpm typecheck`, dan `pnpm build`. Lanjutkan dengan pemeriksaan alur aplikasi memakai project Firebase khusus pengembangan.
