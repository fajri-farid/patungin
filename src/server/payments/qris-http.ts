import crypto from "node:crypto";
import { PRIVATE_HEADERS } from "../receipts/http";
import { AuthGuardError } from "../auth/session";
import { AppServiceError } from "../store/repository";

/** Never expose SDK messages: they can contain bucket names, account details or request URLs. */
export function qrisError(
  error: unknown,
  operation: "upload" | "read" = "read",
) {
  const requestId = crypto.randomUUID();
  let status = 503;
  let code = "QRIS_ERROR";
  let message =
    operation === "upload"
      ? "Gambar QRIS belum bisa disimpan. Coba lagi."
      : "Gambar QRIS belum bisa diakses. Coba lagi.";
  if (error instanceof AppServiceError || error instanceof AuthGuardError) {
    status = error.statusCode;
    code = error.code;
    message = error.message;
  } else {
    const downloadCode = (error as { code?: unknown } | null)?.code;
    const providerCode = Number((error as { code?: unknown } | null)?.code);
    if (
      downloadCode === "STORAGE_DOWNLOAD_CONNECTION_FAILED" ||
      downloadCode === "STORAGE_DOWNLOAD_TIMEOUT"
    ) {
      code =
        downloadCode === "STORAGE_DOWNLOAD_TIMEOUT"
          ? "QRIS_STORAGE_TIMEOUT"
          : "QRIS_STORAGE_CONNECTION_FAILED";
      message =
        "Koneksi ke Storage terputus atau terlalu lama saat membaca QRIS. Coba muat ulang gambarnya.";
    } else if (
      downloadCode === "STORAGE_DOWNLOAD_INTEGRITY" ||
      downloadCode === "STORAGE_DOWNLOAD_TOO_LARGE"
    ) {
      code = "QRIS_STORAGE_INTEGRITY_ERROR";
      message =
        "Gambar QRIS belum berhasil dibaca secara utuh. Coba lagi atau unggah ulang gambar.";
    } else if (providerCode === 404) {
      code =
        operation === "upload"
          ? "QRIS_BUCKET_NOT_FOUND"
          : "QRIS_IMAGE_NOT_FOUND";
      status = operation === "upload" ? 503 : 404;
      message =
        operation === "upload"
          ? "Bucket QRIS tidak ditemukan. Periksa FIREBASE_QRIS_STORAGE_BUCKET; kosongkan untuk memakai FIREBASE_STORAGE_BUCKET."
          : "Gambar QRIS tidak ditemukan atau sudah dihapus.";
    } else if (providerCode === 403) {
      code = "QRIS_STORAGE_PERMISSION_DENIED";
      message =
        "Server belum mendapat izin mengakses bucket QRIS. Periksa izin Storage Object User pada service account aplikasi.";
    } else if (providerCode === 401) {
      code = "QRIS_STORAGE_AUTH_FAILED";
      message =
        "Autentikasi server ke Storage gagal. Periksa konfigurasi service account Firebase.";
    } else if (providerCode === 400) {
      code = "QRIS_STORAGE_CONFIG_ERROR";
      message =
        "Konfigurasi Storage QRIS tidak valid. Isi nama bucket tanpa gs:// atau URL console.";
    } else if (providerCode === 429) {
      code = "QRIS_STORAGE_BUSY";
      message =
        "Layanan penyimpanan QRIS sedang dibatasi. Tunggu sebentar lalu coba lagi.";
    }
  }
  if (status >= 500)
    console.warn("qris_request_failed", { requestId, operation, code });
  return Response.json(
    { ok: false, code, error: message, requestId },
    {
      status,
      headers: { ...PRIVATE_HEADERS, "X-Request-ID": requestId },
    },
  );
}
export function qrisResponse(bytes: Buffer, download = false) {
  return new Response(new Uint8Array(bytes), {
    headers: {
      ...PRIVATE_HEADERS,
      "Content-Type": "image/png",
      "Content-Length": String(bytes.length),
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="qris.png"`,
    },
  });
}
