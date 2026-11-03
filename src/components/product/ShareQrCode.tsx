"use client";

import { useRef, useState } from "react";
import { Download } from "lucide-react";
import { QRCodeCanvas } from "qrcode.react";
import ui from "./product.module.css";

export function ShareQrCode({ url }: { url: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState(false);

  function downloadQr() {
    try {
      if (!canvasRef.current) throw new Error("QR belum tersedia");
      const link = document.createElement("a");
      link.href = canvasRef.current.toDataURL("image/png");
      link.download = "patungin-qr-rincian.png";
      document.body.appendChild(link);
      link.click();
      link.remove();
      setError(false);
    } catch {
      setError(true);
    }
  }

  return (
    <div id="share-qr-panel" className={ui.shareQr}>
      <div className={ui.shareQrHeading}>
        <h3>QR rincian tagihan</h3>
        <p>Teman bisa scan untuk membuka rincian.</p>
      </div>
      <div className={ui.shareQrCanvas}>
        <QRCodeCanvas
          ref={canvasRef}
          value={url}
          size={256}
          style={{ width: "100%", height: "auto" }}
          level="M"
          marginSize={4}
          bgColor="#ffffff"
          fgColor="#17233b"
          role="img"
          aria-label="QR untuk membuka rincian tagihan"
        />
      </div>
      <p className={ui.shareQrHint}>
        QR ini membuka rincian, bukan untuk membayar.
      </p>
      <button type="button" className={ui.secondary} onClick={downloadQr}>
        <Download size={16} aria-hidden="true" /> Unduh QR
      </button>
      {error && (
        <p role="alert" className={ui.shareQrError}>
          QR belum bisa diunduh. Coba lagi atau ambil screenshot.
        </p>
      )}
    </div>
  );
}
