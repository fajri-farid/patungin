"use client";
import { useRef, useState } from "react";
import { MAX_QRIS_BYTES } from "@/domain/qris";
import { QrisImage } from "./QrisImage";
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
  const [error, setError] = useState<string | null>(null);
  const guard = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  async function upload(file: File) {
    if (guard.current) return;
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
      const form = new FormData();
      form.append("image", file);
      const response = await fetch("/api/payments/qris", {
        method: "POST",
        body: form,
      });
      const result = await response.json();
      if (!response.ok || !result.ok)
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
      onBusy(false);
    }
  }
  return (
    <div className="space-y-3">
      {imageId && <QrisImage key={imageId} imageId={imageId} />}
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
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          disabled={disabled || pending}
          className="min-h-11 rounded-xl bg-[#E6EDFF] px-4 font-bold text-[#2855D9]"
          onClick={() => input.current?.click()}
        >
          {pending
            ? "Mengunggah QRIS…"
            : imageId
              ? "Ganti gambar QRIS"
              : "Unggah gambar QRIS"}
        </button>
        {imageId && (
          <button
            type="button"
            disabled={disabled || pending}
            className="min-h-11 text-[#B42318] font-bold"
            onClick={() => onChange(undefined)}
          >
            Hapus gambar dari tujuan ini
          </button>
        )}
      </div>
      {pending && (
        <p role="status" className="text-xs">
          Sedang menyimpan gambar QRIS…
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-[#B42318]">
          {error}
        </p>
      )}
      <p className="text-xs text-[#4A5B7C]">
        Gunakan QRIS statis untuk dipakai ulang. JPG, PNG, atau WebP maksimal 2 MiB. Gambar QRIS tetap tersedia selama
        masih dipakai profil atau tagihan, terpisah dari foto struk 24 jam.
      </p>
    </div>
  );
}
