/** Keep narrow, long receipts readable without allocating an unbounded canvas. */
export function receiptImageDimensions(width: number, height: number) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error("Ukuran foto belum bisa dibaca. Pilih foto lain.");
  }
  const scale = Math.min(1, 2400 / Math.min(width, height), 7200 / Math.max(width, height),
    Math.sqrt(4_000_000 / (width * height)));
  return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) };
}

/** Retry JPEG quality, never silently upload bytes above the server's 2 MiB limit. */
export async function encodeReceiptCanvas(canvas: HTMLCanvasElement): Promise<Blob> {
  for (const quality of [0.86, 0.78, 0.68]) {
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", quality));
    if (!blob) throw new Error("Gagal memproses gambar struk.");
    if (blob.size <= 2 * 1024 * 1024) return blob;
  }
  throw new Error("Foto masih terlalu besar. Potong bagian luar struk atau pilih foto lain.");
}
