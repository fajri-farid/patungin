"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Clock,
  Eye,
  EyeOff,
  Image as ImageIcon,
  ImageOff,
  RefreshCw,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { ReceiptPhotoInfo } from "@/domain/receipts";
import { ReceiptImageSkeleton } from "./product/ProductLoading";
import ui from "./product/product.module.css";

export function usePhotoAvailable(info: ReceiptPhotoInfo) {
  const [checkedAt, setCheckedAt] = useState(0);
  useEffect(() => {
    if (!info.expiresAt) return;
    const check = () => setCheckedAt(Date.now());
    const timer = setTimeout(
      check,
      Math.max(0, Date.parse(info.expiresAt) - Date.now()),
    );
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [info.expiresAt]);
  return (
    info.status === "available" &&
    !!info.expiresAt &&
    checkedAt < Date.parse(info.expiresAt)
  );
}

export function ReceiptPhoto({
  info,
  src,
  localOnly = false,
}: {
  info: ReceiptPhotoInfo;
  src: string;
  localOnly?: boolean;
}) {
  const available = usePhotoAvailable(info);
  const [show, setShow] = useState(false);
  const [zoom, setZoom] = useState(false);
  const [retry, setRetry] = useState(0);
  const [loadedSrc, setLoadedSrc] = useState<string | null>(
    localOnly ? "local" : null,
  );
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const [expiryLabel, setExpiryLabel] = useState("");

  useEffect(() => {
    if (!info.expiresAt) return;
    const format = () =>
      setExpiryLabel(
        new Intl.DateTimeFormat("id-ID", {
          dateStyle: "medium",
          timeStyle: "short",
        }).format(new Date(info.expiresAt!)),
      );
    const timer = setTimeout(format, 0);
    return () => clearTimeout(timer);
  }, [info.expiresAt]);

  if (info.status === "disabled") {
    return (
      <div className="flex items-center gap-2.5 rounded-xl border border-[#D8E2F2] bg-[#F4F7FC] px-3.5 py-2.5 text-xs text-[#4A5B7C]">
        <ImageOff size={16} className="shrink-0 text-[#7687A6]" aria-hidden="true" />
        <span>Foto struk belum bisa disimpan.</span>
      </div>
    );
  }

  if (info.status === "unavailable") {
    return (
      <div className="flex items-center gap-2.5 rounded-xl border border-[#F5CA86] bg-[#FFF8F0] px-3.5 py-2.5 text-xs text-[#9A4A12]">
        <AlertTriangle size={16} className="shrink-0" aria-hidden="true" />
        <span>Foto belum bisa dimuat. Muat ulang halaman untuk mencoba lagi.</span>
      </div>
    );
  }

  if (!available) {
    const isExpired =
      info.status === "expired" ||
      (info.status === "available" && Boolean(info.expiresAt));
    return (
      <div className="flex items-center gap-2.5 rounded-xl border border-[#D8E2F2] bg-[#F4F7FC] px-3.5 py-2.5 text-xs text-[#4A5B7C]">
        {isExpired ? (
          <Clock size={16} className="shrink-0 text-[#7687A6]" aria-hidden="true" />
        ) : (
          <ImageIcon size={16} className="shrink-0 text-[#7687A6]" aria-hidden="true" />
        )}
        <span>
          {isExpired
            ? "Foto struk sudah tidak tersedia. Rincian tagihan tetap bisa dibuka."
            : "Belum ada foto struk tersimpan."}
        </span>
      </div>
    );
  }

  const resolvedSrc = localOnly
    ? src
    : `${src}${src.includes("?") ? "&" : "?"}retry=${retry}`;
  const requestKey = localOnly ? "local" : resolvedSrc;
  const isLoaded = localOnly || loadedSrc === requestKey;
  const isFailed = !localOnly && failedSrc === requestKey;
  const isDownloading = !isLoaded && !isFailed;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-2xl border border-[#D8E2F2] bg-[#F4F7FC] p-3">
        <div className="flex flex-wrap items-center gap-2 text-xs text-[#4A5B7C]">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-bold ${
              localOnly
                ? "bg-[#FFF3E6] text-[#9A4A12]"
                : "bg-[#E6F5EF] text-[#146346]"
            }`}
          >
            <Clock size={13} aria-hidden="true" />
            {localOnly ? "Hanya di tab ini" : "Foto tersimpan"}
          </span>
          <span>
            {localOnly
              ? "Belum bisa dibuka di perangkat lain"
              : expiryLabel
                ? `Bisa dibuka sampai ${expiryLabel}`
                : "Tersedia sementara"}
          </span>
        </div>

        <button
          type="button"
          aria-expanded={show}
          className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#2855D9] px-3.5 py-2 text-xs font-bold text-white hover:bg-[#1E44B8] cursor-pointer"
          onClick={() => setShow((current) => !current)}
        >
          {show ? (
            <>
              <EyeOff size={15} aria-hidden="true" />
              Tutup foto
            </>
          ) : (
            <>
              <Eye size={15} aria-hidden="true" />
              Lihat foto struk
            </>
          )}
        </button>
      </div>

      {show &&
        (isFailed ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#F5CA86] bg-[#FFF8F0] p-3.5 text-xs text-[#9A4A12]">
            <div className="flex items-center gap-2">
              <ImageOff size={17} className="shrink-0" aria-hidden="true" />
              <span>Foto sudah tidak tersedia. Rincian tagihan tetap bisa dibuka.</span>
            </div>
            <button
              type="button"
              className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-[#9A4A12] bg-white px-3 py-1.5 font-bold text-[#9A4A12] cursor-pointer"
              onClick={() => {
                setFailedSrc(null);
                setRetry((current) => current + 1);
              }}
            >
              <RefreshCw size={14} aria-hidden="true" />
              Coba muat lagi
            </button>
          </div>
        ) : (
          <div className="space-y-2 rounded-2xl border border-[#D8E2F2] bg-[#F8FAFF] p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-[#4A5B7C]">
                {isDownloading
                  ? "Memuat foto struk…"
                  : zoom
                    ? "Geser gambar untuk melihat rincian angka"
                    : "Foto struk"}
              </span>
              <button
                type="button"
                disabled={isDownloading}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-[#D8E2F2] bg-white px-3 py-1.5 text-xs font-bold text-[#2855D9] hover:bg-[#E6EDFF] disabled:opacity-40 cursor-pointer"
                onClick={() => setZoom((current) => !current)}
              >
                {zoom ? (
                  <>
                    <ZoomOut size={15} aria-hidden="true" />
                    Perkecil
                  </>
                ) : (
                  <>
                    <ZoomIn size={15} aria-hidden="true" />
                    Perbesar
                  </>
                )}
              </button>
            </div>

            {isDownloading && (
              <ReceiptImageSkeleton label="Memuat foto struk…" />
            )}

            <div
              className={
                isDownloading
                  ? "sr-only"
                  : "max-h-[480px] overflow-auto rounded-xl border border-[#D8E2F2] bg-white p-2"
              }
            >
              {/* Authenticated expiring bytes must bypass image optimizer and shared caches. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                key={retry}
                ref={(node) => {
                  if (
                    node?.complete &&
                    node.naturalWidth > 0 &&
                    loadedSrc !== requestKey
                  ) {
                    setLoadedSrc(requestKey);
                  }
                }}
                src={resolvedSrc}
                alt="Foto struk tagihan"
                referrerPolicy="no-referrer"
                onLoad={() => setLoadedSrc(requestKey)}
                onError={() => setFailedSrc(requestKey)}
                className={`${ui.imageReveal} ${
                  isLoaded ? ui.imageLoaded : ui.imageLoading
                } ${
                  zoom
                    ? "w-[900px] max-w-none"
                    : "mx-auto max-h-[440px] w-auto"
                }`}
              />
            </div>
          </div>
        ))}
    </div>
  );
}
