# Keamanan

Gunakan versi terbaru dengan seluruh patch keamanan. MIT adalah lisensi kode, bukan jaminan keamanan deployment.

## Melaporkan kerentanan

Gunakan tab **Security → Report a vulnerability** pada repository GitHub jika private vulnerability reporting sudah diaktifkan pengelola. Bila belum tersedia, buat issue yang hanya meminta kanal pelaporan privat, tanpa detail eksploitasi atau data sensitif. Jangan mengunggah `.env`, private key, token sesi, undangan aktif, foto asli, rekening, atau link share nyata ke issue/PR.

Jika credential pernah terpublikasi, cabut/rotasi di penyedia terlebih dahulu, lalu tangani salinan dan riwayat Git. Menghapus file pada commit terbaru tidak mencabut credential yang sudah bocor.

## Sebelum publikasi

- Jalankan `pnpm check:publication --history`, `pnpm audit --audit-level moderate`, lint, tes, dan build. Pemeriksaan publikasi memakai pola terbatas serta membandingkan secret server lokal bila tersedia; hasil bersih bukan bukti tidak ada seluruh jenis secret.
- Pertahankan `.env*`, service-account JSON, data sandbox, dan `output/` di luar Git serta deployment. `.env.example` hanya memuat placeholder dan fitur cloud opsional dinonaktifkan.
- Aktifkan secret scanning, push protection, dependency alerts, dan private vulnerability reporting di GitHub bila tersedia. Lindungi branch utama dengan review dan status check.
- CI pull request tidak membutuhkan credential Firebase/Gemini. Jangan memakai `pull_request_target` untuk menjalankan kode kontribusi, atau menambahkan secret production pada workflow/preview dari fork.
- Review perubahan dependency, override, dan `patches/` sebelum merge. Pertahankan pnpm lockfile dan patch saat deployment.

## Batas kepercayaan

Autentikasi Google diverifikasi server; identitas dan akses produk/admin dipisahkan. Mutasi memeriksa Origin, sedangkan ownership dan revisi diperiksa di service. Firestore dan Storage browser rules menolak akses langsung; Admin SDK tetap memerlukan pembatasan IAM karena melewati rules.

Link share merupakan bearer credential: setiap pemegang link dapat melihat data yang sengaja dibagikan. Pencabutan memblokir akses berikutnya, tetapi tidak menghapus screenshot atau salinan yang telah diunduh. Gambar QRIS yang diunggah pengguna tidak membuktikan keaslian merchant atau rekening.

Kebijakan CSP membatasi framing, base URL, objek, dan tujuan form. Belum ada CSP berbasis nonce yang membatasi eksekusi script; jangan menyebut kebijakan ini sebagai perlindungan XSS menyeluruh.

Konfigurasi operasional dan batas verifikasi tercantum di [panduan keamanan Vercel](docs/security-deployment.md).
