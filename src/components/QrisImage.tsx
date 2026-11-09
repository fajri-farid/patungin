"use client";

import { useState } from "react";
import { AlertTriangle, Download, RefreshCw } from "lucide-react";
import { QrisImageSkeleton } from "./product/ProductLoading";
import ui from "./product/product.module.css";

export function QrisImage({
  imageId,
  shareToken,
}: {
  imageId: string;
  shareToken?: string;
}) {
  const [retry, setRetry] = useState(0);
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  const src = shareToken
    ? `/api/s/${encodeURIComponent(shareToken)}/qris/${imageId}`
    : `/api/payments/qris/${imageId}`;
  const resolvedSrc = `${src}?retry=${retry}`;
  const isLoaded = loadedSrc === resolvedSrc;
  const isFailed = failedSrc === resolvedSrc;
  const isDownloading = !isLoaded && !isFailed;

  return (
    <div className="space-y-2.5">
      {isFailed ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#F5CA86] bg-[#FFF8F0] p-3.5 text-xs text-[#9A4A12]">
          <div className="flex items-start gap-2">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
            <p>
              Gambar QRIS belum bisa dimuat. Coba lagi atau hubungi pembayar
              tagihan.
            </p>
          </div>
          <button
            type="button"
            className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-[#9A4A12] bg-white px-3 py-1.5 font-bold text-[#9A4A12] cursor-pointer"
            onClick={() => {
              setFailedSrc(null);
              setRetry((value) => value + 1);
            }}
          >
            <RefreshCw size={14} aria-hidden="true" />
            Muat ulang QRIS
          </button>
        </div>
      ) : (
        <div className="relative mx-auto w-full max-w-[310px]">
          {isDownloading && <div className="absolute inset-0 z-10 bg-white"><QrisImageSkeleton label="Memuat kode QRIS…" /></div>}

          <div
            aria-hidden={isDownloading}
            className="flex flex-col items-center gap-3 rounded-2xl border border-[#D8E2F2] bg-white p-3.5"
          >
            {/* Private payment images must bypass shared image caches and optimization. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              key={retry}
              ref={(node) => {
                if (
                  node?.complete &&
                  node.naturalWidth > 0 &&
                  loadedSrc !== resolvedSrc
                ) {
                  setLoadedSrc(resolvedSrc);
                }
              }}
              src={resolvedSrc}
              alt="Kode QRIS tujuan pembayaran"
              loading="lazy"
              width={280}
              height={280}
              referrerPolicy="no-referrer"
              className={`${ui.imageReveal} ${
                isLoaded ? ui.imageLoaded : ui.imageLoading
              } mx-auto aspect-square w-full max-w-[280px] rounded-xl object-contain`}
              onLoad={() => setLoadedSrc(resolvedSrc)}
              onError={() => setFailedSrc(resolvedSrc)}
            />
            <a
              tabIndex={isDownloading ? -1 : undefined}
              className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-[#C9DAFC] bg-[#E6EDFF] px-4 py-2 text-xs font-bold text-[#1E44B8] hover:bg-[#D8E5FF]"
              href={`${src}?download=1`}
              download="qris.png"
            >
              <Download size={15} aria-hidden="true" />
              Unduh gambar QRIS
            </a>
          </div>
        </div>
      )}
      <p className="text-xs text-[#4A5B7C]">
        Periksa nama penerima dan nominal di aplikasi pembayaran sebelum membayar.
      </p>
    </div>
  );
}
