import sharp from "sharp";
import { MAX_QRIS_BYTES } from "@/domain/qris";
import { AppServiceError } from "../store/repository";

const MAX_INPUT_PIXELS = 16_000_000;
const MAX_STORED_DIMENSION = 2400;

/** Bound both the upload and the decoded image; stored PNG size can exceed input size. */
export async function normalizeQrisImage(bytes: Buffer): Promise<Buffer> {
  if (!bytes.length || bytes.length > MAX_QRIS_BYTES) {
    throw new AppServiceError(422, "INVALID_QRIS", "Pilih gambar QRIS JPG, PNG, atau WebP maksimal 2 MB.");
  }
  try {
    // Metadata does not decode pixels. Check dimensions explicitly before decoding
    // so a pixel-limit failure is not reported as a file-size or corruption error.
    const metadata = await sharp(bytes, { limitInputPixels: false, failOn: "warning", animated: false }).metadata();
    if (!["jpeg", "png", "webp"].includes(metadata.format ?? "")) {
      throw new AppServiceError(422, "QRIS_UNSUPPORTED_FORMAT", "Gambar belum bisa dibuka. Pilih JPG, PNG, atau WebP.");
    }
    if ((metadata.pages ?? 1) > 1) {
      throw new AppServiceError(422, "QRIS_ANIMATED_IMAGE", "Pilih foto atau gambar QRIS yang tidak bergerak.");
    }
    if (!metadata.width || !metadata.height) throw new Error("Missing image dimensions");
    if (metadata.width * metadata.height > MAX_INPUT_PIXELS) {
      throw new AppServiceError(422, "QRIS_RESOLUTION_TOO_LARGE", "Ukuran gambar QRIS terlalu besar. Perkecil gambar lalu coba lagi.");
    }

    let dimension = MAX_STORED_DIMENSION;
    for (let attempt = 0; attempt < 4; attempt++) {
      const image = sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "warning", animated: false })
        .rotate()
        .resize({ width: dimension, height: dimension, fit: "inside", withoutEnlargement: true })
        .flatten({ background: "#ffffff" });
      // Preserve indexed PNGs instead of expanding their palette to full-colour RGB.
      // Full-colour inputs stay full-colour; no palette quantisation is applied to them.
      const { data, info } = await image.png(metadata.isPalette
        ? { compressionLevel: 9, palette: true, colours: 256, dither: 0 }
        : { compressionLevel: 9 })
        .toBuffer({ resolveWithObject: true });
      if (data.length <= MAX_QRIS_BYTES) return data;

      // Estimate a smaller pixel area, always starting from the original bytes.
      // This also handles JPEG/WebP uploads that expand when stored as PNG.
      dimension = Math.max(1, Math.floor(Math.max(info.width, info.height)
        * Math.min(0.85, Math.sqrt(MAX_QRIS_BYTES / data.length) * 0.9)));
    }
    throw new AppServiceError(422, "QRIS_OPTIMIZATION_FAILED", "Gambar QRIS masih terlalu besar. Potong bagian di luar kode QR lalu coba lagi.");
  } catch (error) {
    if (error instanceof AppServiceError) throw error;
    throw new AppServiceError(422, "INVALID_QRIS_IMAGE", "Gambar QRIS belum bisa dibuka. Simpan ulang sebagai PNG, JPG, atau WebP lalu coba lagi.");
  }
}
