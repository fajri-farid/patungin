"use client";
import { useEffect, useState } from "react";
import type { ReceiptPhotoInfo } from "@/domain/receipts";

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
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
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
  if (info.status === "disabled")
    return (
      <p className="text-xs text-[#4A5B7C]">
        Penyimpanan foto sementara belum tersedia.
      </p>
    );
  if (info.status === "unavailable")
    return (
      <p className="text-xs text-[#4A5B7C]">
        Foto belum bisa dimuat. Muat ulang halaman untuk mencoba lagi.
      </p>
    );
  if (!available)
    return (
      <p className="text-xs text-[#4A5B7C]">
        {info.status === "expired" ||
        (info.status === "available" && info.expiresAt)
          ? "Foto struk sudah kedaluwarsa. Rincian tagihan tetap tersedia."
          : "Belum ada foto struk tersimpan."}
      </p>
    );
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="min-h-11 px-3 rounded-xl bg-[#E6EDFF] text-[#2855D9] font-bold text-sm"
          onClick={() => setShow((current) => !current)}
        >
          {show ? "Tutup foto" : "Lihat foto struk"}
        </button>
        <p className="text-xs text-[#4A5B7C]">
          {localOnly
            ? "Foto hanya tersedia di tab ini, belum tersimpan online"
            : "Tersedia selama 24 jam"}
          {expiryLabel ? ` · sampai ${expiryLabel}` : ""}.
        </p>
      </div>
      {show &&
        (failed ? (
          <div className="text-xs text-[#4A5B7C] space-y-2">
            <p>Foto tidak tersedia atau aksesnya sudah berakhir.</p>
            <button
              type="button"
              className="min-h-11 font-bold text-[#2855D9]"
              onClick={() => {
                setFailed(false);
                setRetry((current) => current + 1);
              }}
            >
              Coba muat lagi
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <button
              type="button"
              className="min-h-11 text-sm font-bold text-[#2855D9]"
              onClick={() => setZoom((current) => !current)}
            >
              {zoom ? "Perkecil" : "Perbesar"}
            </button>
            <div className="max-h-[480px] overflow-auto rounded-xl border border-[#D8E2F2] bg-white p-2">
              {/* Authenticated expiring bytes must bypass image optimizer and shared caches. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                key={retry}
                src={
                  localOnly
                    ? src
                    : `${src}${src.includes("?") ? "&" : "?"}retry=${retry}`
                }
                alt="Foto struk tagihan"
                referrerPolicy="no-referrer"
                onError={() => setFailed(true)}
                className={
                  zoom ? "w-[900px] max-w-none" : "max-h-[440px] w-auto mx-auto"
                }
              />
            </div>
          </div>
        ))}
    </div>
  );
}
