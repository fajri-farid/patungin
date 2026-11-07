# Deploy Patungin ke Vercel

[Kembali ke README](../README.md) · [Setup Firebase](setup.md) · [Deployment dan operasi](operations.md)

Panduan ini memakai dashboard Vercel dan repository GitHub untuk menjalankan Patungin secara online.

Sebelum production, ikuti [pemeriksaan keamanan deployment](security-deployment.md), termasuk pemisahan credential Preview/Production, indeks QRIS, firewall, dan scheduler gambar.

**Vercel menjalankan website dan server aplikasi. Firebase menangani login dan penyimpanan data.** Keduanya tetap perlu dikonfigurasi.

Alurnya: **siapkan repo → hubungkan ke Vercel → dapatkan domain → isi konfigurasi → izinkan domain di Firebase → deploy ulang → coba aplikasi**.

## 1. Siapkan kebutuhan awal

- Akun GitHub dan salinan repo Patungin di akunmu, misalnya melalui fork.
- Akun [Vercel](https://vercel.com/) yang dapat mengakses repo tersebut.
- Project Firebase, Google Sign-In, database Firestore, dan kredensial server sesuai [panduan setup](setup.md#2-konfigurasikan-firebase).
- Email Google yang akan menjadi admin.

Gemini bisa disiapkan setelah aplikasi berjalan. Untuk percobaan pertama, gunakan input pesanan manual.

Pastikan `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, dan folder `patches/` sudah ada di GitHub. File `.env`, `.env.local`, JSON service account, dan data sandbox tetap disimpan di perangkatmu.

## 2. Import repo ke Vercel

1. Masuk ke dashboard Vercel.
2. Pilih **Add New → Project**.
3. Hubungkan akun GitHub jika diminta, lalu beri akses ke repo Patungin.
4. Pilih repo tersebut dan klik **Import**.
5. Isi nama project yang kamu inginkan.

Pada halaman konfigurasi, periksa pengaturan berikut:

| Pengaturan | Pilihan |
| --- | --- |
| Framework Preset | **Next.js** |
| Root Directory | Folder yang memuat `package.json` Patungin; lihat penjelasan di bawah |
| Build Command | Biarkan otomatis mengikuti script `build` pada `package.json` |
| Install Command | Biarkan otomatis; aktifkan Corepack seperti petunjuk berikut |
| Output Directory | Biarkan default Next.js |

**Cara memilih Root Directory:** buka repo di GitHub. Jika `package.json` langsung terlihat pada halaman utama repo, gunakan `./`. Jika halaman utama berisi folder `splitbill-webapp` dan `package.json` ada di dalamnya, pilih `splitbill-webapp`. Nama folder di laptop tidak selalu sama dengan struktur repo di GitHub.

Di bagian **Environment Variables**, tambahkan pengaturan build berikut untuk environment **Production**:

| Key | Value |
| --- | --- |
| `ENABLE_EXPERIMENTAL_COREPACK` | `1` |

Corepack membuat Vercel memakai versi pnpm pada `packageManager` di `package.json`, yaitu `pnpm@12.10.1`. Biarkan instalasi otomatis agar tidak memakai pnpm bawaan yang berbeda. Pengaturan ini mengikuti [petunjuk Corepack Vercel](https://vercel.com/docs/builds/configure-a-build#corepack).

Gunakan **Node.js 24.x** untuk build dan runtime. Project menetapkan `engines.node` ke `24.x` di `package.json`, yang dapat mengungguli pilihan Node.js di dashboard. Setelah mengubah versi Node.js, buat deployment baru; detailnya ada di [pengaturan Node.js Vercel](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions#version-overrides-in-packagejson).

Firebase Auth memakai `jwks-rsa@4.1.0`, yang secara bawaan memuat ESM `jose` melalui `require()`. Pada runtime yang menonaktifkan `require(esm)`, hal ini menyebabkan `ERR_REQUIRE_ESM` meskipun build berhasil. Patch di `patches/jwks-rsa@4.1.0.patch` mengubah pemuatan tersebut menjadi `await import('jose')`. pnpm menerapkannya otomatis melalui `patchedDependencies` di `pnpm-workspace.yaml`; jangan menghapus patch atau mengganti instalasi dengan npm. Jika deployment masih memakai dependency lama, deploy commit terbaru dengan build cache dinonaktifkan. Tes `tests/firebase-auth-runtime.test.ts` memeriksa pemuatan Firebase Auth dan pengambilan kunci publik dengan `require(esm)` dinonaktifkan, tanpa kredensial atau akses jaringan.

## 3. Deploy pertama untuk mendapatkan domain

Klik **Deploy** dan tunggu hingga statusnya **Ready**. Pada tahap ini, kamu boleh belum mengisi konfigurasi Firebase di Vercel. Landing page dapat tampil, tetapi login dan pembuatan tagihan belum siap digunakan.

Setelah project dibuat, buka **Settings → Domains** dan salin domain production yang terpasang. Contoh di panduan ini:

```text
https://patungin-kamu.vercel.app
```

Itu hanya contoh. Gunakan domain yang benar-benar diberikan Vercel untuk projectmu, bukan menebak dari nama project. Pilih domain production yang tetap, bukan URL unik untuk satu deployment atau URL preview sebuah branch.

## 4. Isi environment variables aplikasi

Buka project Vercel → **Settings → Environment Variables**. Tambahkan key dan value berikut, lalu pilih environment **Production**.

| Key | Nilai yang diisi |
| --- | --- |
| `APP_ORIGIN` | Domain production lengkap, misalnya `https://patungin-kamu.vercel.app`, tanpa `/` di akhir |
| `ADMIN_EMAILS` | Email Google milikmu yang akan menjadi admin |
| `INVITE_SIGNING_SECRET` | Secret acak milikmu, minimal 32 karakter |
| `NEXT_PUBLIC_FIREBASE_API_KEY` | API key dari konfigurasi Firebase Web App |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | Auth domain dari konfigurasi Firebase Web App, biasanya `PROJECT_ID.firebaseapp.com` |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | ID project Firebase |
| `FIREBASE_PROJECT_ID` | ID project Firebase yang sama |
| `FIREBASE_CLIENT_EMAIL` | Nilai `client_email` dari service account |
| `FIREBASE_PRIVATE_KEY` | Nilai `private_key` dari service account |
| `GEMINI_SCAN_ENABLED` | `false` untuk percobaan pertama |
| `SHARE_LINKS_ENABLED` | `false` untuk percobaan pertama |
| `SCAN_MONTHLY_LIMIT` | `30`, atau jatah awal yang kamu tentukan |
| `SCAN_PER_MINUTE_LIMIT` | `3` |

Environment variables adalah pengaturan aplikasi yang disimpan pada hosting. `.env` di laptop tidak otomatis tersedia di Vercel. Di dashboard, masukkan nama pengaturan pada kolom **Key** dan isinya pada kolom **Value**, bukan seluruh baris `KEY=value` ke kolom Value.

### Membuat secret undangan

Jalankan di terminal laptop yang sudah memiliki Node.js:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Salin hasilnya ke Value untuk `INVITE_SIGNING_SECRET`. Simpan nilainya agar tetap sama pada deployment berikutnya.

### Memasukkan private key Firebase

Salin hanya isi field `private_key` dari JSON service account, mulai dari `-----BEGIN PRIVATE KEY-----` sampai `-----END PRIVATE KEY-----`. Jangan menempel seluruh file JSON.

Pada kolom Value Vercel, gunakan isi key tanpa tanda kutip pembungkus. Aplikasi menerima baris baru asli maupun karakter `\n` di dalam key. Pertahankan bagian BEGIN, END, dan seluruh isi key. Kredensial ini tetap menjadi pengaturan server; jangan mengubah namanya menjadi `NEXT_PUBLIC_*`.

`NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` tetap mengikuti konfigurasi Firebase Web App. Domain Vercel dimasukkan ke `APP_ORIGIN` dan Authorized domains pada langkah berikut.

## 5. Izinkan domain di Firebase dan terapkan rules

1. Buka Firebase Console untuk project yang sama.
2. Pilih **Authentication → Settings → Authorized domains**.
3. Klik **Add domain**, lalu masukkan hostname production, misalnya `patungin-kamu.vercel.app`.
4. Masukkan hostname saja, tanpa `https://`, path, atau `/` di akhir.
5. Pastikan provider Google sudah aktif pada **Authentication → Sign-in method**.

Lalu ikuti [cara menerapkan aturan dan indeks Firestore](setup.md#aturan-dan-indeks-database). Langkah ini dijalankan dari terminal melalui Firebase CLI, terpisah dari deployment Vercel. Tunggu semua indeks query berstatus Enabled di Firebase Console.

**Deploy ke Vercel tidak otomatis menerapkan `firebase.json`, `firestore.rules`, atau `firestore.indexes.json` ke Firebase.** File-file tersebut dipakai saat kamu menjalankan deployment konfigurasi Firestore.

## 6. Deploy ulang setelah konfigurasi selesai

Kembali ke Vercel → **Deployments**, pilih deployment production, lalu gunakan **Redeploy**. Pastikan deployment ulang memakai environment Production dan tunggu status Ready.

Perubahan environment variables berlaku pada deployment baru. Khusus `NEXT_PUBLIC_FIREBASE_*`, nilainya juga dimasukkan ke kode browser saat build, sehingga perlu build ulang. Ini mengikuti [cara kerja environment variables Vercel](https://vercel.com/docs/environment-variables).

## 7. Coba aplikasi dari domain production

1. Buka domain production yang sama dengan `APP_ORIGIN`.
2. Masuk memakai email Google pada `ADMIN_EMAILS`.
3. Buka `/admin` untuk memastikan akunmu memiliki akses admin.
4. Buat satu tagihan manual, tambahkan peserta, bagi pesanan, dan selesaikan hasilnya.
5. Buka riwayat dan periksa bahwa tagihan tersimpan.
6. Undang pengguna lain lewat `/admin` jika diperlukan.

Pada percobaan ini, scan foto dan link publik masih dimatikan sesuai pengaturan langkah 4. Keduanya dapat diaktifkan setelah alur dasar berhasil.

## 8. Aktifkan scan dan link berbagi

Untuk scan foto, isi `GEMINI_API_KEY` dan `GEMINI_MODEL` sesuai [setup Gemini](setup.md#4-aktifkan-scan-gambar-jika-diperlukan), lalu ubah `GEMINI_SCAN_ENABLED=true`.

Untuk link berbagi, buat secret acak lain untuk `SHARE_SIGNING_SECRET`, lalu ubah `SHARE_LINKS_ENABLED=true`. Gunakan secret yang berbeda dari `INVITE_SIGNING_SECRET`.

Jika perlu menutup semua akses link publik, ubah `SHARE_LINKS_ENABLED=false` dan lakukan Redeploy. Pengaturan ini menghentikan pembuatan link baru sekaligus pembukaan link lama. Link yang belum dicabut atau kedaluwarsa dapat dibuka lagi setelah fitur diaktifkan kembali dengan secret yang sama.

Simpan perubahan di environment Production dan lakukan Redeploy lagi. Coba satu scan, lalu buka link hasil dari jendela incognito atau perangkat teman. Penerima link tidak perlu login ke Patungin.

Jika penerima justru diminta login ke Vercel, periksa **Deployment Protection**. Pastikan domain production yang memang ingin dibagikan dapat diakses publik sesuai pengaturan project; perlindungan deployment preview dapat dikelola terpisah. Lihat [pengaturan Deployment Protection](https://vercel.com/docs/deployment-protection).

## Mengubah aplikasi setelah online

Setelah integrasi Git terpasang, push ke branch production yang ditetapkan di Vercel akan memicu deployment baru. Perubahan pada branch lain biasanya menghasilkan preview untuk ditinjau. [Panduan integrasi Git Vercel](https://vercel.com/docs/git)

Untuk awal, gunakan domain production saat mencoba login atau mengirim link. URL preview yang berbeda memerlukan `APP_ORIGIN` serta izin domain Firebase yang sesuai. Jika menyiapkan preview, gunakan environment Preview dan project Firebase pengembangan yang terpisah.

Jika memasang custom domain, tambahkan domain tersebut di Vercel, daftarkan hostname-nya di Authorized domains Firebase, lalu ubah `APP_ORIGIN` ke alamat HTTPS yang dipilih dan lakukan Redeploy. Pengaturan Google Sign-In mengikuti [panduan Firebase](https://firebase.google.com/docs/auth/web/google-signin).

## Jika ada masalah

| Masalah | Yang perlu diperiksa |
| --- | --- |
| Vercel tidak menemukan Next.js atau `package.json` | Root Directory harus menunjuk ke folder aplikasi |
| Instalasi gagal atau versi pnpm berbeda | Pastikan ketiga file package/lock/workspace ikut di repo, `ENABLE_EXPERIMENTAL_COREPACK=1` sudah diisi, dan periksa versi pnpm pada Build Logs |
| Build gagal | Buka deployment → Build Logs, lalu lihat pesan error pertama; jalankan `pnpm build` di lokal untuk membantu memeriksa |
| Login menampilkan konfigurasi belum lengkap | Lengkapi variabel Firebase browser dan server untuk Production, lalu Redeploy |
| `auth/unauthorized-domain` | Tambahkan hostname yang sedang dibuka ke Authorized domains Firebase |
| `ORIGIN_MISMATCH` | Gunakan domain yang sama persis dengan `APP_ORIGIN`; jangan tertukar dengan URL preview |
| Private key tidak valid | Periksa isi key, tanda BEGIN/END, dan newline; jangan menempel seluruh JSON service account |
| Query membutuhkan indeks | Terapkan indeks Firestore dan tunggu status Enabled |
| Setelah mengubah environment, hasil tetap sama | Pastikan scope Production dipilih dan deployment ulang sudah Ready |
| Scan mengalami timeout | Periksa Runtime Logs, akses model Gemini, serta batas durasi function pada paket Vercel yang dipakai |

Detail nama menu dashboard dapat berubah. Petunjuk resmi tersedia di [konfigurasi build Vercel](https://vercel.com/docs/builds/configure-a-build) dan [panduan setup aplikasi](setup.md).
