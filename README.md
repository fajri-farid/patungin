# Patungin

<p align="center">
  <img src="public/patungin.png" alt="Patungin — Bagi tagihan makan sesuai pesanan" width="240" />
</p>

![Patungin 1.1.2](https://img.shields.io/badge/Patungin-1.1.2-2855D9?style=flat-square)
![Next.js 16.4.5](https://img.shields.io/badge/Next.js-16.4.5-000000?style=flat-square&logo=nextdotjs&logoColor=white)
![React 19.3.0](https://img.shields.io/badge/React-19.3.0-149ECA?style=flat-square&logo=react&logoColor=white)
![TypeScript 5.9.3](https://img.shields.io/badge/TypeScript-5.9.3-3178C6?style=flat-square&logo=typescript&logoColor=white)
![Tailwind CSS 4.3.3](https://img.shields.io/badge/Tailwind_CSS-4.3.3-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white)
![pnpm 12.10.1](https://img.shields.io/badge/pnpm-12.10.1-F69220?style=flat-square&logo=pnpm&logoColor=white)
[![Lisensi MIT](https://img.shields.io/badge/License-MIT-16A34A?style=flat-square)](LICENSE)

**Makan bareng. Bayar sesuai pesanan.**

Patungin adalah aplikasi untuk membagi tagihan makan sesuai pesanan setiap orang. Masukkan struk, pilih siapa memesan apa, lalu bagikan jumlah yang perlu dibayar ke grup.

Pembuat tagihan masuk dengan akun Google. Teman yang menerima link bisa langsung melihat bagiannya tanpa login atau memasang aplikasi.

[Fitur](#fitur) · [Cara menjalankan](#cara-menjalankan) · [Teknologi](#teknologi) · [Panduan](#panduan-lengkap)

## Versi saat ini

**1.1.2** merupakan pembaruan patch dari 1.1.1 untuk memperbaiki pembacaan konteks struk, review diskon ambigu, validasi gambar sebelum kuota scan dipakai, serta dependency keamanan. Hasil pembacaan AI tetap perlu diperiksa pengguna.

Versi aplikasi mengacu pada `version` di [package.json](package.json). Rincian pembaruan tersedia di [catatan perubahan](CHANGELOG.md).

## Fitur

- **Foto struk atau isi sendiri.** AI membantu membaca pesanan dari foto. Kamu juga bisa memasukkan pesanan secara manual.
- **Bagi sesuai pesanan.** Pilih pemilik setiap menu, bagi menu yang dimakan bersama, atau bagi semua pesanan rata.
- **Pajak dan diskon ikut dihitung.** Jumlah seluruh bagian tetap sesuai total tagihan yang sudah kamu periksa.
- **Bagikan ke grup.** Salin ringkasan WhatsApp atau kirim link rincian beserta QR. Link berlaku tujuh hari dan bisa dinonaktifkan.
- **Cantumkan tujuan pembayaran.** Pilih rekening bank, e-wallet, atau gambar QRIS tersimpan; informasi pembayaran ikut ditampilkan pada rincian tagihan.
- **Lanjutkan nanti.** Simpan tagihan yang belum selesai dan lihat tagihan sebelumnya di halaman riwayat.

Satu tagihan mendukung hingga **30 orang**, **100 baris pesanan**, dan **10 tujuan pembayaran**.

## Cara pakai

1. **Masukkan struk.** Foto, unggah gambar, atau isi pesanan sendiri. Periksa harga, jumlah, dan totalnya.
2. **Pilih pesanan teman.** Tambahkan nama, pilih siapa memesan apa, lalu tentukan siapa yang membayar lebih dulu.
3. **Bagikan hasilnya.** Periksa bagian masing-masing, tambahkan tujuan transfer, lalu kirim ke grup.

AI membantu membaca struk, jadi hasilnya tetap perlu diperiksa. Transfer dilakukan melalui aplikasi bank atau e-wallet masing-masing.

## Cara menjalankan

### Yang perlu disiapkan

- **Node.js 24.x**, sesuai `engines.node` di `package.json` dan runtime deployment.
- **pnpm 12.10.1** untuk memasang dan menjalankan proyek.
- **Project Firebase** untuk login Google dan menyimpan tagihan.
- **API key Gemini**, hanya jika ingin membaca struk dari foto. Input manual tidak memerlukannya.

### 1. Pasang kebutuhan proyek

Buka terminal di folder `splitbill-webapp`, lalu jalankan:

```bash
pnpm install --frozen-lockfile
```

### 2. Siapkan konfigurasi

Salin file [.env.example](.env.example) menjadi `.env.local`:

```bash
cp .env.example .env.local
```

Jika memakai PowerShell:

```powershell
Copy-Item .env.example .env.local
```

Isi `.env.local` mengikuti [panduan setup](docs/setup.md). Panduan tersebut menjelaskan cara menyiapkan Firebase, menetapkan akun admin, dan mengaktifkan scan atau link berbagi.

> Hanya ingin melihat landing page? Kamu bisa langsung ke langkah 3. Untuk login dan membuat tagihan, konfigurasi Firebase harus diisi terlebih dahulu.

### 3. Jalankan aplikasi

```bash
pnpm dev
```

Buka **[http://localhost:3000](http://localhost:3000)** di browser. Pastikan alamatnya sama dengan nilai `APP_ORIGIN` di `.env.local`.

Setelah konfigurasi selesai, masuk dengan akun Google yang kamu tetapkan sebagai admin. Buka `/admin` untuk mengundang pengguna lain. Akun baru perlu diaktifkan melalui undangan atau admin sebelum bisa membuat tagihan.

Jika login atau koneksi layanan bermasalah, ikuti [daftar pemeriksaan setup](docs/setup.md#diagnosis-setup).

## Teknologi

Badge di atas menunjukkan versi dari konfigurasi dan lockfile proyek.

| Teknologi | Digunakan untuk |
| --- | --- |
| Next.js dan React | Halaman dan alur aplikasi |
| TypeScript | Membantu memeriksa kesalahan pada kode |
| Tailwind CSS dan CSS Modules | Tampilan aplikasi |
| Firebase Authentication | Login dengan Google |
| Cloud Firestore | Menyimpan akun dan tagihan |
| Google Gemini | Membaca pesanan dari gambar |

Perhitungan uang dilakukan oleh kode aplikasi, terpisah dari AI, agar pembagian dan pembulatan tetap konsisten.

## Perintah yang sering dipakai

| Perintah | Kegunaan |
| --- | --- |
| `pnpm dev` | Menjalankan aplikasi saat pengembangan |
| `pnpm lint` | Memeriksa aturan penulisan kode |
| `pnpm typecheck` | Memeriksa tipe data pada kode |
| `pnpm test` | Menjalankan seluruh test sekali, termasuk perhitungan dan keamanan akses |
| `pnpm build` | Menyiapkan aplikasi untuk deployment |
| `pnpm start` | Menjalankan aplikasi setelah build |

Folder `tests`, konfigurasi Vitest, dan helper `scripts/check-firestore-indexes.mjs` disertakan agar pengujian dapat dijalankan dari hasil clone. Test memakai mock layanan dan database sementara yang terisolasi dari kredensial serta data lokal. Utilitas diagnosis/migrasi lokal dan folder `output` tetap di-ignore.

## Letak file utama

| Folder | Isi |
| --- | --- |
| `src/app/` | Halaman dan proses di server |
| `src/components/` | Bagian tampilan yang dipakai bersama |
| `src/domain/billing/` | Aturan dan perhitungan pembagian tagihan |
| `src/server/` | Login, akses akun, scan, dan penyimpanan data |
| `tests/` | Test perhitungan, akses akun, kuota, scan, dan link berbagi |
| `docs/` | Panduan setup dan deployment |

## Data dan privasi

- Saat scan digunakan, gambar struk dikirim ke Gemini untuk dibaca. Jika penyimpanan foto sementara diaktifkan operator, foto disimpan di bucket privat dengan masa akses 24 jam sejak unggah, lalu dihapus otomatis. Bytes foto tidak disimpan di Firestore.
- Siapa pun yang memiliki link hasil dapat melihat nama peserta, pesanan, jumlah bayar, dan informasi transfer yang dicantumkan. Foto hanya ikut jika host memilih dan masa aksesnya belum berakhir. Email akun pemilik tidak ditampilkan.
- Tujuan pembayaran dapat disimpan di Pengaturan untuk dipilih ulang. Hanya rekening yang dipilih pada tagihan yang dibagikan; perubahan profil tidak mengubah tagihan lama.

Setup foto bersifat opsional. Lihat [foto sementara dan profil pembayaran](docs/receipt-storage.md) untuk bucket, biaya, scheduler cleanup, dan retensi.
- Pemilik bisa mencabut link. Mengedit ulang tagihan juga mencabut link aktif.
- Admin deployment dapat menutup pembuatan dan pembukaan semua link publik dengan `SHARE_LINKS_ENABLED=false`, lalu restart atau deploy ulang. Link yang belum dicabut atau kedaluwarsa dapat diakses lagi jika fitur diaktifkan kembali dengan secret yang sama.
- Scan memiliki batas pemakaian per akun. Biaya layanan Firebase, Gemini, dan hosting mengikuti pemakaian deployment masing-masing.

## Panduan lengkap

- [Panduan admin](docs/admin.md) — pencarian akun, periode monitoring, profil, undangan, peringatan, dan batas pembacaan Firestore.
- [Setup dan troubleshooting](docs/setup.md) — konfigurasi Firebase, Gemini, dan file `.env.local`.
- [Deploy ke Vercel untuk pemula](docs/deploy-vercel.md) — dari menghubungkan GitHub sampai aplikasi bisa dibuka dan dipakai.
- [Deployment dan operasi](docs/operations.md) — menjalankan aplikasi di server, mengelola pengguna, kuota, dan penyimpanan data.
- [Contoh konfigurasi](.env.example) — daftar pengaturan aplikasi yang perlu diisi.
- [Keamanan deployment](docs/security-deployment.md) — hasil audit, pengaturan Vercel/Firebase, dan batas verifikasi.
- [Kebijakan keamanan](SECURITY.md) — pelaporan privat dan pemeriksaan sebelum publikasi.

## Kontribusi

Temukan bug atau punya usulan? Buat issue dengan langkah untuk menjelaskan masalahnya. Untuk perbaikan kode, buat branch terpisah lalu ajukan pull request yang menjelaskan perubahan dan cara memeriksanya.

Sebelum mengajukan perubahan, jalankan `pnpm lint`, `pnpm typecheck`, `pnpm test`, dan `pnpm build`. Jika mengubah perhitungan, sertakan contoh input serta hasil yang diharapkan untuk memastikan jumlah seluruh bagian tetap cocok dengan total tagihan.

Gunakan data contoh saat melaporkan masalah. Hindari menyertakan kredensial, kode undangan aktif, link tagihan nyata, atau data pribadi.

## Lisensi

Proyek ini menggunakan [lisensi MIT](LICENSE). Kamu dapat menggunakan dan mengubah kodenya dengan tetap menyertakan pemberitahuan hak cipta dan lisensi.
