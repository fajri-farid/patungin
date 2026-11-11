/** Safe, deterministic copy shared by monitoring and logs. Never render raw errors. */
export type DiagnosticLevel = "normal" | "attention" | "error" | "security";
export type ApplicationOutcome =
  | "applied"
  | "draft_changed"
  | "access_inactive"
  | "bill_finalized"
  | "bill_deleted"
  | "not_requested";
export interface Diagnostic {
  flag: string;
  level: DiagnosticLevel;
  title: string;
  explanation: string;
  action: string;
}
const entry = (
  flag: string,
  level: DiagnosticLevel,
  title: string,
  explanation: string,
  action: string,
): Diagnostic => ({ flag, level, title, explanation, action });
const manual =
  "Periksa draft. Pengguna dapat melanjutkan dengan pengisian manual.";
export const DIAGNOSTICS: Record<string, Diagnostic> = {
  EXTRACTION_CURRENCY_UNSUPPORTED: entry(
    "INVALID_EXTRACTION", "attention", "Mata uang struk belum didukung",
    "Hasil pembacaan menunjukkan mata uang selain rupiah.",
    "Gunakan struk rupiah. Jangan mengonversi nominal secara otomatis.",
  ),
  MONTHLY_QUOTA_REACHED: entry(
    "QUOTA_REJECTED",
    "normal",
    "Kuota scan bulan ini habis",
    "Permintaan ditolak sebelum pembacaan dimulai.",
    "Tinjau pemakaian dan bonus akun. Pengguna tetap dapat mengisi manual.",
  ),
  RATE_LIMIT_MINUTE: entry(
    "RATE_LIMITED",
    "attention",
    "Permintaan terlalu cepat",
    "Batas permintaan per menit tercapai. Pembacaan baru tidak dimulai.",
    "Tunggu sebelum mencoba lagi. Jika berulang, periksa pengiriman ulang dari aplikasi.",
  ),
  USER_CONCURRENCY_LIMIT: entry(
    "SCAN_BUSY",
    "normal",
    "Akun masih memiliki scan berjalan",
    "Permintaan baru ditolak karena slot scan akun masih terpakai.",
    "Tunggu hasil scan sebelumnya. Periksa catatannya jika sudah lebih dari satu menit.",
  ),
  CONCURRENCY_LIMIT: entry(
    "SCAN_BUSY",
    "normal",
    "Slot scan aplikasi sedang penuh",
    "Permintaan baru ditolak karena slot pembacaan aplikasi sedang terpakai.",
    "Tunggu sebelum mencoba lagi.",
  ),
  BILL_ATTEMPT_LIMIT_REACHED: entry(
    "QUOTA_REJECTED",
    "normal",
    "Batas scan tagihan tercapai",
    "Tagihan ini sudah mencapai batas percobaan pembacaan.",
    "Lanjutkan dengan mengisi atau memperbaiki rincian secara manual.",
  ),
  ACCESS_REQUIRED: entry(
    "ACCESS_DENIED",
    "normal",
    "Akses akun tidak aktif",
    "Operasi tidak diizinkan karena status atau masa akses akun.",
    "Periksa status dan masa akses akun.",
  ),
  FORBIDDEN: entry(
    "ACCESS_DENIED",
    "security",
    "Operasi tidak diizinkan",
    "Pemeriksaan kepemilikan menolak operasi pada tagihan ini. Catatan ini tidak membuktikan niat pengguna.",
    "Periksa akun dan referensi tagihan; tinjau jika berulang.",
  ),
  ADMIN_REQUIRED: entry(
    "ACCESS_DENIED",
    "security",
    "Operasi admin ditolak",
    "Akun terverifikasi tidak memiliki izin admin.",
    "Periksa konfigurasi admin bila akses ini memang diperlukan.",
  ),
  IDEMPOTENCY_CONFLICT: entry(
    "REQUEST_CONFLICT",
    "attention",
    "Identitas permintaan dipakai untuk gambar berbeda",
    "Permintaan ditolak agar hasil scan sebelumnya tidak tertukar.",
    "Periksa pembuatan kunci permintaan pada aplikasi.",
  ),
  DUPLICATE_REQUEST: entry(
    "DUPLICATE_REQUEST",
    "normal",
    "Permintaan scan yang sama diterima ulang",
    "Catatan sebelumnya digunakan. Tidak ada pembacaan baru dari permintaan ini.",
    "Tidak perlu tindakan jika aplikasi menerima hasil sebelumnya.",
  ),
  PROVIDER_TIMEOUT: entry(
    "PROVIDER_TIMEOUT",
    "attention",
    "Pembacaan melewati batas waktu",
    "Hasil belum diterima sebelum batas waktu pembacaan 45 detik. Hasil layanan belum dapat dipastikan.",
    "Periksa draft; jangan mengirim ulang otomatis. Pengguna dapat melanjutkan manual.",
  ),
  PROVIDER_RATE_LIMIT: entry(
    "PROVIDER_RATE_LIMIT",
    "attention",
    "Layanan pembacaan membatasi permintaan",
    "Layanan mengembalikan batas permintaan. Penyebabnya belum tentu kuota akun pengguna.",
    "Periksa batas dan pemakaian layanan AI sebelum mencoba lagi.",
  ),
  PROVIDER_UNAVAILABLE: entry(
    "PROVIDER_UNAVAILABLE",
    "error",
    "Layanan pembacaan sedang bermasalah",
    "Layanan mengembalikan gangguan server atau sementara tidak tersedia.",
    "Periksa status layanan dan log hosting menggunakan ID referensi.",
  ),
  PROVIDER_AUTH_ERROR: entry(
    "PROVIDER_AUTH_ERROR",
    "error",
    "Akses ke layanan pembacaan ditolak",
    "Layanan menolak autentikasi atau izin. Nilai kredensial tidak dicatat.",
    "Periksa konfigurasi kredensial, izin, dan model pada server.",
  ),
  PROVIDER_MODEL_NOT_FOUND: entry(
    "PROVIDER_MODEL_NOT_FOUND",
    "error",
    "Model pembacaan tidak ditemukan",
    "Layanan mengembalikan status tidak ditemukan untuk permintaan model.",
    "Periksa nama model dan ketersediaannya untuk project ini.",
  ),
  PROVIDER_ERROR: entry(
    "PROVIDER_ERROR",
    "error",
    "Pembacaan mengalami gangguan",
    "Pembacaan gagal, tetapi penyebab spesifik belum tersedia.",
    "Periksa log server menggunakan ID referensi. Jangan menyimpulkan masalah foto tanpa bukti.",
  ),
  EMPTY_MODEL_OUTPUT: entry(
    "EMPTY_MODEL_OUTPUT",
    "attention",
    "Layanan tidak mengembalikan hasil pembacaan",
    "Permintaan selesai tanpa teks yang dapat diproses.",
    "Periksa gambar dan layanan pembacaan; pengguna dapat mengisi manual.",
  ),
  INVALID_EXTRACTION: entry(
    "INVALID_EXTRACTION",
    "attention",
    "Hasil pembacaan tidak dapat digunakan",
    "Hasil tidak memenuhi format atau validasi rincian transaksi. Ini tidak selalu berarti foto buram.",
    "Periksa kualitas gambar dan validasi hasil. Pengguna dapat mengisi manual.",
  ),
  EXTRACTION_SOURCE_UNKNOWN: entry(
    "INVALID_EXTRACTION",
    "attention",
    "Jenis sumber transaksi belum dikenali",
    "Hasil AI tidak menyebut jenis sumber transaksi yang didukung.",
    "Periksa gambar dan keluaran model. Gunakan foto struk atau rincian transaksi yang lengkap.",
  ),
  EXTRACTION_ITEMS_MISSING: entry(
    "INVALID_EXTRACTION",
    "attention",
    "Rincian pesanan tidak ditemukan pada hasil",
    "AI menandai sumber tidak didukung atau tidak mengembalikan daftar pesanan.",
    "Periksa apakah gambar memuat transaksi beserta pesanan dan harga; pengguna dapat mengisi manual.",
  ),
  EXTRACTION_STRUCTURE_INVALID: entry(
    "INVALID_EXTRACTION",
    "attention",
    "Struktur rincian pembacaan tidak sesuai",
    "Daftar pesanan, biaya, atau peringatan tidak lengkap atau melampaui batas yang didukung.",
    "Periksa format keluaran model dan jumlah rincian transaksi.",
  ),
  EXTRACTION_ADJUSTMENTS_INVALID: entry(
    "INVALID_EXTRACTION",
    "attention",
    "Komponen pajak atau biaya tidak valid",
    "Hasil AI memuat jenis atau aturan pajak, biaya, atau diskon yang tidak didukung.",
    "Periksa validasi komponen pada keluaran model; pengguna dapat mengisi manual.",
  ),
  EXTRACTION_PRICES_MISSING: entry(
    "INVALID_EXTRACTION",
    "attention",
    "Seluruh harga pesanan belum terbaca",
    "Daftar pesanan tersedia, tetapi tidak ada harga satuan atau total baris yang dapat digunakan.",
    "Minta gambar yang memperlihatkan harga dengan jelas atau isi harga secara manual.",
  ),
  GEMINI_NOT_CONFIGURED: entry(
    "SERVICE_NOT_CONFIGURED",
    "error",
    "Layanan pembacaan belum dikonfigurasi",
    "Konfigurasi server untuk pembacaan belum lengkap.",
    "Periksa environment layanan AI pada deployment.",
  ),
  SCAN_DISABLED: entry(
    "SCAN_DISABLED",
    "normal",
    "Fitur scan sedang dinonaktifkan",
    "Server menolak pembacaan baru karena sakelar scan tidak aktif.",
    "Periksa pengaturan deployment jika scan seharusnya tersedia.",
  ),
  PERSISTENCE_FAILED: entry(
    "PERSISTENCE_FAILED",
    "error",
    "Hasil scan belum dapat disimpan",
    "Penyimpanan status atau hasil gagal setelah pembacaan dimulai. Status akhir database perlu diperiksa.",
    "Periksa database dan log hosting. Jangan mengulangi panggilan AI otomatis.",
  ),
  DATABASE_FAILED: entry(
    "DATABASE_FAILED",
    "error",
    "Operasi database belum berhasil",
    "Operasi penyimpanan tidak dapat diselesaikan. Penyebab lebih lanjut perlu ditelusuri pada server.",
    "Periksa koneksi, izin database, dan log hosting dengan ID referensi.",
  ),
  DATABASE_INDEX_REQUIRED: entry(
    "DATABASE_INDEX_REQUIRED",
    "error",
    "Indeks query database belum siap",
    "Database menolak query karena indeks yang diperlukan belum tersedia atau masih dibangun.",
    "Terapkan firestore.indexes.json pada project tujuan dan tunggu seluruh indeks terkait berstatus Enabled.",
  ),
  DATABASE_PERMISSION_DENIED: entry(
    "DATABASE_PERMISSION_DENIED",
    "error",
    "Izin akses database server ditolak",
    "Akun layanan server tidak memiliki izin menjalankan operasi database ini.",
    "Periksa IAM service account dan project Firebase yang dikonfigurasi.",
  ),
  DATABASE_UNAVAILABLE: entry(
    "DATABASE_UNAVAILABLE",
    "error",
    "Database sementara tidak dapat dihubungi",
    "Operasi database tidak tersedia atau melewati batas waktu.",
    "Periksa koneksi dan status layanan database, lalu coba lagi.",
  ),
  UNEXPECTED_ERROR: entry(
    "UNEXPECTED_ERROR",
    "error",
    "Operasi mengalami gangguan tak terduga",
    "Operasi gagal tanpa klasifikasi penyebab yang lebih spesifik.",
    "Gunakan ID referensi untuk memeriksa tahap operasi pada log server.",
  ),
  ACCOUNT_CHANGED: entry(
    "STALE_UPDATE_REJECTED",
    "normal",
    "Perubahan akun memakai data lama",
    "Penyimpanan ditolak agar pengaturan terbaru tidak tertimpa.",
    "Muat ulang profil, periksa nilainya, lalu simpan lagi.",
  ),
  MONTH_CHANGED: entry(
    "STALE_UPDATE_REJECTED",
    "normal",
    "Bulan kuota sudah berganti",
    "Penyimpanan bonus ditolak karena panel masih memakai bulan sebelumnya.",
    "Muat ulang profil sebelum mengubah bonus.",
  ),
  REVISION_CONFLICT: entry(
    "STALE_UPDATE_REJECTED",
    "normal",
    "Draft telah berubah",
    "Operasi ditolak untuk mempertahankan perubahan terbaru pada draft.",
    "Muat ulang draft sebelum mencoba lagi.",
  ),
  BILL_FINALIZED: entry(
    "REQUEST_REJECTED",
    "normal",
    "Tagihan sudah difinalisasi",
    "Pembacaan tidak dimulai karena tagihan bukan draft.",
    "Buka kembali sebagai draft jika perlu mengubah rincian.",
  ),
  BILL_NOT_FOUND: entry(
    "REQUEST_REJECTED",
    "normal",
    "Tagihan tidak tersedia",
    "Operasi tidak dapat dilanjutkan karena tagihan tidak ditemukan.",
    "Periksa apakah tagihan telah dihapus.",
  ),
};
for (const code of [
  "EMPTY_IMAGE",
  "IMAGE_TOO_LARGE",
  "HEIC_NOT_SUPPORTED",
  "UNSUPPORTED_IMAGE_FORMAT",
  "INVALID_IMAGE",
  "IMAGE_RESOLUTION_TOO_LARGE",
  "ANIMATED_IMAGE_NOT_SUPPORTED",
  "MISSING_FILE",
  "MISSING_IDEMPOTENCY_KEY",
  "INVALID_REVISION",
  "INVALID_FORM",
]) {
  const titles: Record<string, string> = {
    EMPTY_IMAGE: "File gambar kosong",
    IMAGE_TOO_LARGE: "Ukuran gambar melebihi batas",
    HEIC_NOT_SUPPORTED: "Format HEIC belum didukung",
    UNSUPPORTED_IMAGE_FORMAT: "Format gambar tidak didukung",
    INVALID_IMAGE: "Gambar rusak atau tidak dapat dibaca",
    IMAGE_RESOLUTION_TOO_LARGE: "Resolusi gambar melebihi batas",
    ANIMATED_IMAGE_NOT_SUPPORTED: "Gambar bergerak tidak didukung",
    MISSING_FILE: "Foto belum disertakan",
    MISSING_IDEMPOTENCY_KEY: "Identitas permintaan tidak valid",
    INVALID_REVISION: "Revisi draft tidak valid",
    INVALID_FORM: "Data unggahan tidak valid",
  };
  DIAGNOSTICS[code] = entry(
    "INPUT_REJECTED",
    "normal",
    titles[code],
    "Permintaan ditolak sebelum pembacaan dimulai.",
    code === "MISSING_IDEMPOTENCY_KEY" || code === "INVALID_REVISION"
      ? "Periksa data permintaan yang dikirim aplikasi."
      : "Pilih foto JPEG, PNG, atau WebP yang valid, maksimal 2 MiB setelah optimasi.",
  );
}
// Previously stored codes still receive the same explanation.
DIAGNOSTICS.GEMINI_TIMEOUT = DIAGNOSTICS.PROVIDER_TIMEOUT;
DIAGNOSTICS.GEMINI_UNAVAILABLE = DIAGNOSTICS.PROVIDER_UNAVAILABLE;
DIAGNOSTICS.GEMINI_RATE_LIMIT = DIAGNOSTICS.PROVIDER_RATE_LIMIT;
DIAGNOSTICS.EXTRACTION_INVALID = DIAGNOSTICS.INVALID_EXTRACTION;
DIAGNOSTICS.STALE_REVISION = DIAGNOSTICS.REVISION_CONFLICT;

export function diagnoseCode(code: string): Diagnostic {
  return (
    DIAGNOSTICS[code] ??
    entry(
      "UNCLASSIFIED",
      "attention",
      "Kendala belum memiliki penjelasan khusus",
      "Kode kejadian tercatat, tetapi penyebabnya belum dapat dijelaskan secara spesifik.",
      "Periksa ID referensi dan kode pada log server.",
    )
  );
}
export function repeatedFlag(code: string, count: number): string | null {
  if (count < 5 || code === "DUPLICATE_REQUEST") return null;
  const flag = diagnoseCode(code).flag;
  return [
    "QUOTA_REJECTED",
    "RATE_LIMITED",
    "INPUT_REJECTED",
    "ACCESS_DENIED",
    "SCAN_BUSY",
    "REQUEST_CONFLICT",
    "STALE_UPDATE_REJECTED",
    "REQUEST_REJECTED",
  ].includes(flag)
    ? "REPEATED_REJECTIONS"
    : "REPEATED_ERRORS";
}
export interface ExplainableScan {
  state: string;
  reservedAt: string;
  completedAt: string | null;
  errorCode: string | null;
  applicationOutcome?: ApplicationOutcome | null;
}
export function diagnoseScan(
  scan: ExplainableScan,
  now: number,
): Diagnostic & { impact: string } {
  const impact =
    "Percobaan ini memakai kuota scan aplikasi. Status ini tidak memastikan biaya dari layanan AI.";
  if (scan.state === "succeeded") {
    if (scan.applicationOutcome === "applied")
      return {
        ...entry(
          "SCAN_SUCCEEDED",
          "normal",
          "Struk berhasil dibaca dan diterapkan",
          "Hasil pembacaan sudah dimasukkan ke draft.",
          "Pengguna perlu memeriksa pesanan dan harga sebelum melanjutkan.",
        ),
        impact,
      };
    const reasons: Partial<Record<ApplicationOutcome, string>> = {
      draft_changed:
        "Draft berubah selama pembacaan. Perubahan terbaru pengguna dipertahankan.",
      access_inactive: "Akses pemilik tidak aktif saat hasil akan diterapkan.",
      bill_finalized: "Tagihan sudah bukan draft saat hasil akan diterapkan.",
      bill_deleted: "Tagihan sudah dihapus saat hasil akan diterapkan.",
      not_requested: "Permintaan ini tidak meminta penerapan hasil ke draft.",
    };
    return {
      ...entry(
        scan.applicationOutcome
          ? "RESULT_NOT_APPLIED"
          : "APPLICATION_NOT_RECORDED",
        "attention",
        scan.applicationOutcome
          ? "Pembacaan berhasil, hasil tidak diterapkan"
          : "Pembacaan berhasil; penerapan belum tercatat",
        reasons[scan.applicationOutcome!] ??
          "Catatan ini belum menyimpan informasi penerapan hasil ke draft.",
        manual,
      ),
      impact,
    };
  }
  if (scan.errorCode) return { ...diagnoseCode(scan.errorCode), impact };
  if (scan.state === "failed")
    return {
      ...entry(
        "SCAN_FAILED",
        "error",
        "Pembacaan gagal tanpa kode kendala",
        "Status gagal tercatat, tetapi penyebab spesifik tidak tersedia.",
        manual,
      ),
      impact,
    };
  if (scan.state === "unknown" || now - Date.parse(scan.reservedAt) >= 60000)
    return {
      ...entry(
        "COMPLETION_MISSING",
        "attention",
        "Hasil akhir scan belum dapat dipastikan",
        "Belum ada hasil akhir yang pasti pada catatan ini. Waktu yang lewat tidak membuktikan bahwa layanan gagal.",
        "Periksa draft dan log hosting. Jangan mengirim ulang otomatis.",
      ),
      impact,
    };
  return {
    ...entry(
      "SCAN_PROCESSING",
      "normal",
      "Pembacaan sedang diproses",
      "Belum ada hasil akhir pada saat data diperbarui.",
      "Tunggu lalu perbarui data untuk melihat status terbaru.",
    ),
    impact,
  };
}
