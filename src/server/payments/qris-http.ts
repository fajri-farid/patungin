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
        "Gambar QRIS belum bisa dimuat. Periksa koneksi lalu coba lagi.";
    } else if (
      downloadCode === "STORAGE_DOWNLOAD_INTEGRITY" ||
      downloadCode === "STORAGE_DOWNLOAD_TOO_LARGE"
    ) {
      code = "QRIS_STORAGE_INTEGRITY_ERROR";
      message =
        "Gambar QRIS belum bisa dibuka. Coba lagi atau pilih ulang gambar.";
    } else if (providerCode === 404) {
      code =
        operation === "upload"
          ? "QRIS_BUCKET_NOT_FOUND"
          : "QRIS_IMAGE_NOT_FOUND";
      status = operation === "upload" ? 503 : 404;
      message =
        operation === "upload"
          ? "Gambar QRIS belum bisa disimpan saat ini. Coba lagi nanti."
          : "Gambar QRIS tidak ditemukan atau sudah dihapus.";
    } else if (providerCode === 403) {
      code = "QRIS_STORAGE_PERMISSION_DENIED";
      message =
        "Gambar QRIS belum bisa diakses saat ini. Coba lagi nanti.";
    } else if (providerCode === 401) {
      code = "QRIS_STORAGE_AUTH_FAILED";
      message =
        "Gambar QRIS belum bisa diakses saat ini. Coba lagi nanti.";
    } else if (providerCode === 400) {
      code = "QRIS_STORAGE_CONFIG_ERROR";
      message =
        "Gambar QRIS belum bisa diakses saat ini. Coba lagi nanti.";
    } else if (providerCode === 429) {
      code = "QRIS_STORAGE_BUSY";
      message =
        "Banyak gambar QRIS sedang diproses. Tunggu sebentar lalu coba lagi.";
    }
  }
  if (status >= 500 || (operation === "upload" && status === 422))
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
