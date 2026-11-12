/**
 * Mengoptimasi foto dengan batas piksel; struk panjang mempertahankan detail teks.
 * Ukuran upload tetap di bawah batas 2 MiB server.
 */
import { encodeReceiptCanvas, receiptImageDimensions } from "./receipt-image-layout";
export async function processReceiptImageOnClient(params: {
  dataUrl: string;
  rotationDeg: number;
  cropVerticalMarginPct: number;
}): Promise<{ blob: Blob; previewDataUrl: string }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const cropRatio =
          Math.max(0, Math.min(25, params.cropVerticalMarginPct)) / 100;
        const srcX = 0;
        const srcY = Math.round(img.height * cropRatio);
        const srcW = img.width;
        const srcH = Math.max(10, Math.round(img.height * (1 - cropRatio * 2)));

        const isRotated90 = params.rotationDeg % 180 !== 0;
        const rawOutW = isRotated90 ? srcH : srcW;
        const rawOutH = isRotated90 ? srcW : srcH;

        const dimensions = receiptImageDimensions(rawOutW, rawOutH);
        const scale = Math.min(dimensions.width / rawOutW, dimensions.height / rawOutH);

        const canvas = document.createElement("canvas");
        canvas.width = dimensions.width;
        canvas.height = dimensions.height;

        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(
            new Error(
              "Foto belum bisa diolah. Coba browser lain atau isi manual.",
            ),
          );
          return;
        }

        ctx.fillStyle = "#FFFFFF";
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.save();
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate((params.rotationDeg * Math.PI) / 180);
        const drawW = Math.round(srcW * scale);
        const drawH = Math.round(srcH * scale);
        ctx.drawImage(
          img,
          srcX,
          srcY,
          srcW,
          srcH,
          -drawW / 2,
          -drawH / 2,
          drawW,
          drawH,
        );
        ctx.restore();

        // Preview and upload use the same encoded bytes within the server limit.
        void encodeReceiptCanvas(canvas).then((blob) => {
          const reader = new FileReader();
          reader.onload = () => {
            if (typeof reader.result === "string") resolve({ blob, previewDataUrl: reader.result });
            else reject(new Error("Foto belum bisa ditampilkan. Coba lagi."));
          };
          reader.onerror = () => reject(new Error("Foto belum bisa ditampilkan. Coba lagi."));
          reader.onabort = reader.onerror;
          reader.readAsDataURL(blob);
        }).catch(reject);
      } catch {
        reject(new Error("Foto belum bisa diolah. Pilih foto yang lebih kecil atau isi manual."));
      }
    };
    img.onerror = () =>
      reject(
        new Error(
          "Foto belum bisa dibuka. Pilih JPG, PNG, atau WebP.",
        ),
      );
    img.src = params.dataUrl;
  });
}
