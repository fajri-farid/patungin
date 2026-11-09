"use client";

import { requestJson } from "@/lib/request-json";
import { SlowOperationNotice } from "./SlowOperationNotice";

import { useRef, useState } from "react";
import {
  AlertTriangle,
  CloudUpload,
  QrCode,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { MAX_QRIS_BYTES } from "@/domain/qris";
import { QrisImage } from "./QrisImage";
import ui from "./product/product.module.css";

export function QrisImageUpload({
  imageId,
  onChange,
  onBusy,
  disabled,
}: {
  imageId?: string;
  onChange: (id?: string) => void;
  onBusy: (busy: boolean) => void;
  disabled?: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const guard = useRef(false);
  const input = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    if (guard.current || disabled) return;
    setError(null);
    if (
      file.size > MAX_QRIS_BYTES ||
      !["image/jpeg", "image/png", "image/webp"].includes(file.type)
    ) {
      setError("Pilih JPG, PNG, atau WebP maksimal 2 MiB.");
      return;
    }
    guard.current = true;
    setPending(true);
    onBusy(true);
    try {
      const thumb = await new Promise<string | null>((resolve) => {
        const reader = new FileReader();
        reader.onload = () =>
          resolve(typeof reader.result === "string" ? reader.result : null);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(file);
      });
      setLocalPreview(thumb);

      const form = new FormData();
      form.append("image", file);
      const { response, result } = await requestJson<{ id: string }>("/api/payments/qris", {
        method: "POST",
        body: form,
      });
      if (!response.ok || !result.ok || !result.data)
        throw new Error(result.error ?? "Gambar QRIS belum tersimpan.");
      onChange(result.data.id);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Periksa koneksi dan pilih ulang gambar QRIS.",
      );
    } finally {
      guard.current = false;
      setPending(false);
      setLocalPreview(null);
      onBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {pending && <SlowOperationNotice />}
      {pending ? (
        <div
          role="status"
          aria-live="polite"
          className="rounded-2xl border border-[#9DC0FB] bg-gradient-to-b from-[#F4F8FF] to-white p-4 space-y-3"
        >
          <div className="flex items-center gap-3.5">
            <div className="relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-[#C9DAFC] bg-[#E6EDFF]">
              {localPreview ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={localPreview}
                    alt=""
                    aria-hidden="true"
                    className="h-full w-full object-contain bg-white p-1 opacity-85"
                  />
                  <span className={ui.scanBeam} aria-hidden="true" />
                </>
              ) : (
                <CloudUpload
                  size={22}
                  className={`${ui.uploadPulse} text-[#2855D9]`}
                  aria-hidden="true"
                />
              )}
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              <p className="text-sm font-extrabold text-[#17233B]">
                Menyimpan gambar QRIS…
              </p>
              <p className="text-xs text-[#4A5B7C]">
                Mengoptimalkan ketajaman kode QR agar mudah dipindai teman.
              </p>
            </div>
          </div>
          <div className={ui.indeterminateTrack} aria-hidden="true">
            <div className={ui.indeterminateBar} />
          </div>
        </div>
      ) : imageId ? (
        <QrisImage key={imageId} imageId={imageId} />
      ) : (
        <button
          type="button"
          disabled={disabled || pending}
          onClick={() => input.current?.click()}
          className="flex w-full flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-[#9DC0FB] bg-white px-4 py-6 text-center hover:bg-[#F4F8FF] disabled:opacity-50 cursor-pointer"
        >
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#E6EDFF] text-[#2855D9]">
            <QrCode size={22} aria-hidden="true" />
          </span>
          <span className="text-sm font-bold text-[#2855D9]">
            Pilih gambar QRIS
          </span>
          <span className="text-xs text-[#4A5B7C]">
            JPG, PNG, atau WebP · maks. 2 MiB
          </span>
        </button>
      )}

      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void upload(file);
        }}
        disabled={disabled || pending}
      />

      {imageId && !pending && (
        <div className="flex flex-wrap gap-2 text-xs font-bold">
          <button
            type="button"
            disabled={disabled || pending}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-[#C9DAFC] bg-[#E6EDFF] px-3.5 py-2 text-[#1E44B8] hover:bg-[#D8E5FF] cursor-pointer"
            onClick={() => input.current?.click()}
          >
            <RefreshCw size={14} aria-hidden="true" />
            Ganti gambar QRIS
          </button>
          <button
            type="button"
            disabled={disabled || pending}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-[#D8E2F2] bg-white px-3.5 py-2 text-[#B42318] hover:border-[#F5B5B5] hover:bg-[#FDECEC] cursor-pointer"
            onClick={() => onChange(undefined)}
          >
            <Trash2 size={14} aria-hidden="true" />
            Hapus gambar dari tujuan ini
          </button>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-xl border border-[#F5B5B5] bg-[#FDECEC] p-3 text-xs font-semibold text-[#B42318]"
        >
          <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      <p className="text-xs text-[#4A5B7C]">
        Gunakan QRIS statis untuk dipakai ulang. JPG, PNG, atau WebP maksimal 2
        MiB. Gambar QRIS tetap tersedia selama masih dipakai profil atau
        tagihan, terpisah dari foto struk 24 jam.
      </p>
    </div>
  );
}
