/**
 * Mengoptimasi gambar struk di browser (rotasi, crop vertikal opsional, dan resize <= 2400px)
 * agar angka tetap tajam namun ukuran upload di bawah batas 2 MiB server.
 */
export async function processReceiptImageOnClient(params: {
  dataUrl: string;
  rotationDeg: number;
  cropVerticalMarginPct: number;
}): Promise<{ blob: Blob; previewDataUrl: string }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const cropRatio =
        Math.max(0, Math.min(25, params.cropVerticalMarginPct)) / 100;
      const srcX = 0;
      const srcY = Math.round(img.height * cropRatio);
      const srcW = img.width;
      const srcH = Math.max(10, Math.round(img.height * (1 - cropRatio * 2)));

      const isRotated90 = params.rotationDeg % 180 !== 0;
      const rawOutW = isRotated90 ? srcH : srcW;
      const rawOutH = isRotated90 ? srcW : srcH;

      const maxSide = 2400;
      const scale =
        Math.max(rawOutW, rawOutH) > maxSide
          ? maxSide / Math.max(rawOutW, rawOutH)
          : 1;

      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(rawOutW * scale));
      canvas.height = Math.max(1, Math.round(rawOutH * scale));

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

      const previewDataUrl = canvas.toDataURL("image/jpeg", 0.86);
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error("Gagal memproses gambar struk."));
            return;
          }
          resolve({ blob, previewDataUrl });
        },
        "image/jpeg",
        0.86,
      );
    };
    img.onerror = () =>
      reject(
        new Error(
          "Format gambar tidak dapat dibaca browser. Gunakan JPEG, PNG, atau WebP.",
        ),
      );
    img.src = params.dataUrl;
  });
}
