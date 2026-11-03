# Panduan admin

[Kembali ke README](../README.md) · [Setup](setup.md) · [Deployment dan operasi](operations.md)

Buka `/admin` setelah masuk dengan akun Google yang tercantum di `ADMIN_EMAILS` atau `ADMIN_UIDS`. Tampilan monitoring memakai ruang desktop, sedangkan pengelolaan akun dan bonus tetap nyaman di HP.

## Sebelum mulai

Terapkan konfigurasi Firestore dari root project, memakai ID project milikmu:

```bash
firebase deploy --only firestore:rules,firestore:indexes --project YOUR_PROJECT_ID
```

Tunggu semua indeks berstatus **Enabled**. Deployment Vercel tidak menerapkan indeks atau TTL Firestore secara otomatis.

Jika tab Peringatan atau filter Log menampilkan bahwa indeks belum siap, terapkan indeks dengan akun Google yang memiliki izin mengelola indeks pada project:

```bash
npm install -g firebase-tools
firebase login
firebase deploy --only firestore:indexes --project YOUR_PROJECT_ID
```

Jalankan dari folder yang memuat `firebase.json`, dan ganti `YOUR_PROJECT_ID` dengan project yang sama dengan environment aplikasi. Izin membaca/menulis dokumen pada service account aplikasi tidak selalu memberikan izin membuat indeks. Gunakan akun deployment untuk proses ini; tidak perlu memperluas izin akun runtime aplikasi.

Tunggu indeks selesai dibangun, lalu klik **Perbarui data**. Daftar tanpa akun yang memenuhi syarat akan menampilkan keterangan kosong; indeks yang belum siap tetap dilaporkan sebagai kendala konfigurasi, bukan dianggap tidak ada peringatan.

Jika sudah ada akun sebelum fitur admin ini dipasang:

1. Buka tab **Pengguna** atau **Peringatan**.
2. Buka **Persiapan akun lama & ringkasan bulan ini**.
3. Klik **Proses hingga 25 akun**, lalu lanjutkan sampai selesai.

Persiapan melengkapi field pencarian nama dan ringkasan kuota bulan ini. Akses, bonus, dan pemakaian tidak diubah. Proses dapat diulang; ringkasan yang sudah ada tidak direset. Progress tombol hanya disimpan selama panel terbuka. Jika halaman ditutup, proses dimulai dari awal dengan aman.

Akun baru memperoleh field pencarian ketika dibuat. Ringkasan kuota terbentuk saat akun menggunakan scan atau pengaturan kuotanya diubah. Pada awal bulan, jalankan persiapan lagi jika ingin mendeteksi semua akun dengan jatah dasar maksimal 5 yang belum melakukan scan bulan tersebut.

## Cari pengguna

1. Pilih pencarian berdasarkan **Email**, **Nama**, atau **UID lengkap**.
2. Masukkan teks, lalu klik **Cari** atau tekan Enter.
3. Pilih **Kelola** pada akun yang ditemukan.

Email dan nama dicari dari awal teks, tanpa membedakan huruf besar/kecil. Contoh: `faj` menemukan nama `Fajri`. Pencarian tidak mencocokkan potongan di tengah nama atau memperbaiki typo. UID harus lengkap. Pencarian email/nama membutuhkan minimal 2 karakter.

Pencarian mencakup seluruh akun, dengan maksimal 25 hasil per halaman. **Filter status dan urutan hanya mengatur hasil pada halaman yang sudah dimuat.** Gunakan **Berikutnya** untuk melanjutkan.

## Pantau scan

Di tab **Monitoring**, pilih:

- **Hari ini:** sejak pukul 00.00 WITA.
- **7 hari terakhir:** hari ini dan 6 hari sebelumnya.
- **Bulan ini:** sejak tanggal 1 pukul 00.00 WITA.

Aktivitas diurutkan dari yang terbaru dan dimuat per 25 data. Batas akhir periode dipertahankan ketika melanjutkan halaman, sehingga scan baru tidak menggeser halaman yang sedang ditelusuri. Pilih **Perbarui data** untuk mengambil kondisi terbaru.

Angka pemakaian di bagian atas tetap menunjukkan **bulan berjalan**, sedangkan distribusi hasil hanya menghitung aktivitas pada **halaman yang dimuat**. Pencarian teks dan filter hasil di daftar aktivitas juga berlaku pada halaman tersebut.

Catatan scan memiliki retensi sekitar **30 hari**. Pada akhir bulan yang berisi 31 hari, sebagian aktivitas awal bulan mungkin sudah terhapus. Menghapus tagihan juga dapat menghapus catatan scan terkait; daftar aktivitas bukan arsip permanen seluruh pemakaian.

**Perlu dicek** berarti hasil belum pasti atau scan belum selesai lebih dari satu menit. Status tersebut tidak otomatis berarti gagal.

## Buka profil dan tambah bonus

Panel pengguna memiliki tiga bagian:

| Bagian | Isi |
| --- | --- |
| Ringkasan | Status akses, kuota, bonus, dan detail akun |
| Aktivitas | Scan akun tersebut dengan pilihan periode dan pagination |
| Perubahan | Riwayat perubahan akses dan kuota oleh admin |

Untuk menambah bonus:

1. Buka **Ringkasan**.
2. Gunakan **+5**, **+10**, atau **+25 scan**, atau isi total bonus yang diinginkan.
3. Periksa **Perkiraan sisa setelah disimpan**.
4. Klik **Simpan perubahan**.

Tombol tambah belum menyimpan perubahan. Bonus hanya berlaku bulan ini dan tidak menghapus pemakaian. Menurunkan jatah atau menonaktifkan akses memerlukan centang konfirmasi di panel akun.

Jika akun atau bonus telah berubah dari perangkat lain, server menolak penyimpanan dengan data lama. Tutup panel, perbarui data, lalu buka kembali akun tersebut.

Riwayat perubahan menyimpan admin pelaksana, waktu, nilai sebelum/sesudah, dan bulan bonus. Pencatatan dimulai sejak fitur ini diterapkan; perubahan lama serta aktivasi otomatis lewat undangan tidak ditambahkan sebagai perubahan admin. Retensi riwayat adalah 1 tahun. Waktu perubahan akun bukan waktu login terakhir.

## Bagikan undangan

Setelah membuat undangan kode, pilih **Salin pesan WhatsApp**. Pesan berisi alamat `APP_ORIGIN`, kode, langkah login/aktivasi, serta batas klaim dan masa akses jika diisi.

Tempel pesan tersebut di WhatsApp atau aplikasi chat pilihanmu. Aplikasi tidak mengirim pesan otomatis. Kode dan pesan tersedia pada saat pembuatan; server menyimpan verifikator kode, bukan salinan kode yang dapat ditampilkan ulang.

Undangan email tidak memerlukan kode. Beri tahu penerima untuk membuka website dan masuk menggunakan email Google yang sudah diizinkan.

## Tinjau peringatan

| Jenis | Kondisi |
| --- | --- |
| Kuota menipis | Sisa maksimal 5 scan pada bulan berjalan |
| Akses segera berakhir | Akun aktif akan kedaluwarsa dalam 7 hari ke depan |
| Kegagalan tinggi | Minimal 5 hasil berhasil/gagal tercatat bulan ini, dan minimal 50% gagal |

Admin deployment, akun nonaktif, dan akun yang sudah kedaluwarsa tidak ditampilkan. Kandidat diperiksa per halaman; jika kandidat di suatu halaman sudah tidak aktif, halaman tersebut bisa berisi kurang dari 25 akun. Lanjutkan jika tombol **Berikutnya** masih tersedia.

Peringatan kuota dan kegagalan memakai ringkasan per akun per bulan. Hasil berhasil/gagal mulai dihitung ketika fitur ini aktif; riwayat scan sebelumnya tidak dihitung ulang. Tanggal awal pencatatan ditampilkan pada peringatan kegagalan. Hasil **Perlu dicek** tidak masuk perbandingan berhasil/gagal.

Peringatan hanya membantu peninjauan. Izin akses dan pembatas kuota tetap diperiksa menggunakan data utama.

## Telusuri log aktivitas

Pilih **Log aktivitas** di halaman admin untuk membuka `/admin/logs`. Tersedia tiga kategori:

| Kategori | Isi |
| --- | --- |
| Scan | Hasil pembacaan, kendala, serta alasan hasil diterapkan atau tidak diterapkan ke draft |
| Perubahan admin | Pelaku, waktu, akun tujuan, dan nilai sebelum/sesudah pengaturan akses atau kuota |
| Penolakan & gangguan | Kuota habis, pembatas permintaan, konflik request, akses ditolak, dan kegagalan operasi penting |

Setiap kategori memiliki periode hari ini, 7 hari, atau bulan ini. Klik **Terapkan filter** setelah memilih periode/hasil/tingkat. Filter dijalankan di server terhadap seluruh catatan yang masih tersimpan. Pagination memuat maksimal 25 catatan ditambah satu untuk memeriksa halaman berikutnya.

Klik **Detail** untuk membaca apa yang terjadi, dampak, serta langkah berikutnya. Penjelasan yang sama tersedia pada **Detail aktivitas scan** di monitoring dan aktivitas profil pengguna. Rincian lengkap ditampilkan langsung: status, nama/email pengguna, ID akun/scan/tagihan, model, waktu mulai/dikirim/selesai, durasi, penerapan hasil, kode, dan ID referensi request. Data yang belum tersimpan diberi keterangan, bukan disembunyikan. ID referensi scan baru juga dikembalikan pada response API dan header `X-Request-Id` untuk penelusuran log hosting.

Panel dapat ditutup melalui tombol tutup, Escape, atau klik area di luar panel jika area tersebut tersedia. Klik isi panel tidak menutupnya, dan penutupan dicegah saat penyimpanan berjalan. Pada layar kecil, panel memenuhi layar sehingga tombol tutup tetap tersedia.

**Berhasil** berarti pembacaan berhasil; catatan baru juga menjelaskan apakah hasil diterapkan. Jika draft berubah, akses pemilik tidak aktif, atau tagihan sudah difinalisasi, hasil tidak menimpa data pengguna. Catatan lama yang belum menyimpan informasi tersebut ditandai **penerapan belum tercatat**. Filter **Hasil tidak diterapkan** hanya mencakup catatan dengan alasan penerapan yang sudah tersimpan.

**Perlu dicek** dibedakan menjadi timeout dan hasil akhir yang belum tercatat. Proses yang belum selesai lebih dari satu menit tidak otomatis dianggap gagal. Membuka halaman log tidak melakukan retry AI atau mengubah status scan.

### Arti tingkat dan flag

| Tingkat | Arti | Contoh flag |
| --- | --- | --- |
| Normal | Permintaan ditolak sesuai aturan atau kondisi ditangani | `QUOTA_REJECTED`, `SCAN_BUSY`, `INPUT_REJECTED`, `DUPLICATE_REQUEST` |
| Perhatian | Perlu ditinjau, tetapi belum membuktikan gangguan sistem | `RATE_LIMITED`, `REQUEST_CONFLICT`, `PROVIDER_TIMEOUT`, `RESULT_NOT_APPLIED` |
| Gangguan | Operasi tidak dapat diselesaikan | `PERSISTENCE_FAILED`, `PROVIDER_UNAVAILABLE`, `UNEXPECTED_ERROR` |
| Keamanan | Pemeriksaan izin menolak operasi | `ACCESS_DENIED` pada kepemilikan tagihan atau operasi admin |

Kesalahan pembacaan memakai penyebab terstruktur: hasil kosong, jenis sumber tidak dikenali, pesanan tidak ditemukan, seluruh harga belum terbaca, atau komponen pajak/biaya tidak valid. Respons AI mentah dan isi struk tidak ditampilkan. Kode layanan 429, 401/403, 404, serta gangguan 5xx diterjemahkan dari status terstruktur, bukan ditebak dari teks error.

Penolakan berulang dapat ditandai `REPEATED_REJECTIONS`, sedangkan gangguan berulang ditandai `REPEATED_ERRORS`. Pengulangan tidak membuktikan penyalahgunaan; periksa kemungkinan retry aplikasi, jaringan, atau pengguna menekan tombol berulang.

### Batas pencatatan dan biaya

Scan tetap memakai `scanAttempts`; perubahan admin memakai `accountAudits`. Keduanya tidak disalin ke koleksi log tambahan. Alasan penerapan hasil disimpan pada penulisan hasil scan yang sudah ada.

`operationalEvents` dipakai untuk kejadian penting yang tidak terwakili oleh hasil scan, termasuk permintaan yang ditolak sebelum reservasi serta kegagalan menyimpan hasil. Kegagalan pembacaan yang status akhirnya berhasil disimpan cukup muncul pada kategori Scan. Perubahan akun biasa tetap ada di audit; kegagalan pengaturan akun/undangan dan pemuatan data admin dapat masuk kategori gangguan. Penolakan atau gangguan pada operasi tagihan juga dicatat setelah identitas terverifikasi.

Kejadian digabung per akun, kode, tahap, dan jendela 5 menit. Dalam satu worker yang tetap hidup, database hanya diperbarui pada hitungan ke-1, 5, 25, dan 100. Setiap checkpoint memakai satu transaksi baca/tulis dokumen, dengan maksimal 2 percobaan transaksi. Jumlah di layar adalah **minimum kejadian yang sempat tersimpan**; kejadian di antara checkpoint atau setelah checkpoint terakhir tidak seluruhnya dihitung.

Penggabungan lokal dibatasi maksimal 1.024 entri. Cold start, restart, atau penggusuran cache dapat menambah checkpoint dari worker lain. Ini bukan batas biaya global, bukan penghitung request yang presisi, serta bukan mekanisme pencegahan serangan. Pembatas kuota dan izin tetap dijalankan terpisah. Jika perlu audit seluruh request, gunakan observability hosting dengan kebijakan volume dan retensi tersendiri.

Request anonim atau yang gagal pemeriksaan origin tidak membuat dokumen Firestore untuk log. Pencatatan tidak menyimpan cookie, token, API key, gambar, isi pesanan, atau pesan error mentah. Jika database log tidak dapat ditulis, server mengeluarkan diagnostik terstruktur yang aman ke log hosting; halaman admin mungkin tidak memuat kejadian tersebut. Kegagalan logging tidak mengubah penolakan menjadi keberhasilan.

Log bukan pengganti log lengkap hosting: gangguan sebelum handler berjalan, proses mati mendadak, kegagalan login anonim, dan error yang hanya terjadi di browser tidak seluruhnya tercakup. Batas yang terlihat di admin adalah pengamatan aplikasi, bukan jaminan jumlah biaya AI.

Kueri daftar penolakan/gangguan dan audit membaca maksimal 26 dokumen. Kueri scan membaca maksimal 26 scan serta maksimal 25 akun berbeda. Hanya kategori aktif dimuat, tanpa polling. Cache log maksimal 12 halaman selama 1 menit di memori halaman. **Perbarui log** membersihkan cache dan kembali ke halaman pertama filter aktif.

Terapkan ulang `firestore.indexes.json` untuk indeks hasil scan, alasan penerapan, dan tingkat kejadian. Field yang tidak dicari dikecualikan dari indeks. `operationalEvents` memakai TTL sekitar 30 hari. Penolakan dan gangguan lama sebelum fitur ini dipasang tidak dibuat ulang.

## Cara pembacaan Firestore dibatasi

Data hanya diambil untuk tab aktif. Detail aktivitas dan riwayat pengguna dimuat ketika dibuka. Tidak ada polling, listener real-time, query seluruh koleksi tanpa batas, atau perhitungan total hasil setiap membuka daftar.

Halaman yang sudah dimuat disimpan sementara di memori panel admin: maksimal 12 halaman selama 1 menit. Detail pengguna menyimpan maksimal 8 halaman selama profil terbuka. Menutup halaman menghapus cache ini. Perubahan akun membatalkan cache panel; perubahan undangan membatalkan cache undangan. **Perbarui data** membatalkan cache panel dan memuat ulang tab aktif.

Perkiraan batas dokumen pada request normal:

| Operasi | Batas dokumen yang dibaca |
| --- | --- |
| Monitoring | 26 scan + maksimal 25 akun berbeda + 1 dokumen pemakaian |
| Daftar/pencarian pengguna | 26 akun + 1 dokumen pemakaian; pencarian UID memakai 1 akun |
| Daftar undangan | 26 undangan |
| Buka ringkasan profil | 1 akun + 1 dokumen pemakaian |
| Aktivitas satu pengguna | 26 scan + maksimal 1 akun |
| Riwayat perubahan | 26 catatan |
| Peringatan kuota/kegagalan | 26 ringkasan + maksimal 25 akun |
| Peringatan kedaluwarsa | 26 akun |
| Persiapan 25 akun lama | Hingga 77 pembacaan dan 50 penulisan, sebelum retry |

Daftar mengambil 1 dokumen tambahan untuk mengetahui apakah ada halaman berikutnya. Navigasi memakai cursor, bukan `offset`. Query kosong tetap dapat dikenai minimum biaya pembacaan. Angka di atas bukan jaminan total tagihan: pembacaan indeks, retry transaksi, TTL, transfer data, dan layanan lain juga dapat berpengaruh. Lihat [penagihan Firestore](https://firebase.google.com/docs/firestore/pricing).

Ringkasan monitoring menambah **1 read dan 1 write** pada reservasi scan, serta **1 read dan 1 write** saat hasil scan pertama diselesaikan. Pengulangan hasil tidak menggandakan penghitung. Perubahan pengaturan akun menambah 1 read ringkasan dan 2 write untuk ringkasan serta audit. Penyimpanan tanpa perubahan tidak menulis audit.

Field besar yang tidak dicari dikecualikan dari indeks. Pemilihan field mengurangi transfer data, bukan jumlah biaya baca dokumen. Ringkasan disimpan sampai akhir bulan terkait ditambah 30 hari, sedangkan audit disimpan hingga 1 tahun; kebijakan TTL harus aktif dan penghapusannya dapat tertunda.

Dokumen `usageMonths` saat ini masih menyimpan penghitung seluruh akun dalam satu dokumen. Ini sesuai skala deployment kecil, tetapi bukan rancangan penghitung tanpa batas. Jika jumlah akun atau scan bersamaan meningkat, evaluasi ukuran dokumen dan contention sebelum memindahkan kuota ke dokumen per pengguna.
