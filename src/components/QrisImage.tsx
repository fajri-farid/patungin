"use client";
import { useState } from "react";
export function QrisImage({
  imageId,
  shareToken,
}: {
  imageId: string;
  shareToken?: string;
}) {
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const src = shareToken
    ? `/api/s/${encodeURIComponent(shareToken)}/qris/${imageId}`
    : `/api/payments/qris/${imageId}`;
  return (
    <div className="space-y-2">
      {failed ? (
        <div className="text-sm text-[#4A5B7C]">
          <p>
            Gambar QRIS belum bisa dimuat. Coba lagi atau hubungi pembayar
            tagihan.
          </p>
          <button
            type="button"
            className="min-h-11 font-bold text-[#2855D9]"
            onClick={() => {
              setFailed(false);
              setRetry((value) => value + 1);
            }}
          >
            Muat ulang QRIS
          </button>
        </div>
      ) : (
        <>
          {/* Private payment images must bypass shared image caches and optimization. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            key={retry}
            src={`${src}?retry=${retry}`}
            alt="Kode QRIS tujuan pembayaran"
            loading="lazy"
            referrerPolicy="no-referrer"
            className="w-full max-w-[320px] h-auto rounded-xl border border-[#D8E2F2] bg-white p-2 mx-auto"
            onError={() => setFailed(true)}
          />
          <a
            className="min-h-11 inline-flex items-center font-bold text-sm text-[#2855D9]"
            href={`${src}?download=1`}
            download="qris.png"
          >
            Unduh gambar QRIS
          </a>
        </>
      )}
      <p className="text-xs text-[#4A5B7C]">
        Periksa nama penerima dan nominal di aplikasi pembayaran sebelum membayar.
      </p>
    </div>
  );
}
