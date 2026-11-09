"use client";

import { useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CloudUpload,
  ImagePlus,
  Loader2,
  RefreshCw,
  RotateCcw,
  Trash2,
} from "lucide-react";
import type { BillDocument } from "@/domain/billing/types";
import type { ReceiptPhotoInfo } from "@/domain/receipts";
import { ReceiptPhoto } from "./ReceiptPhoto";
import {
  loadReceiptState,
  uploadReceiptFile,
} from "@/lib/receipt-photo-client";
import { processReceiptImageOnClient } from "@/lib/receipt-image-client";
import {
  forgetReceiptPreview,
  rememberReceiptPreview,
  useReceiptPreview,
} from "@/lib/local-receipt-preview";
import ui from "./product/product.module.css";
import { requestJson } from "@/lib/request-json";
import { SlowOperationNotice } from "./SlowOperationNotice";

type PhotoBusyPhase = "idle" | "preparing" | "uploading" | "deleting";

export function OwnerReceiptPhoto({
  bill,
  initialPhoto,
  prepareBill,
  onChange,
  onBusy,
}: {
  bill: BillDocument;
  initialPhoto: ReceiptPhotoInfo;
  prepareBill?: () => Promise<BillDocument | null>;
  onChange: (bill: BillDocument, photo: ReceiptPhotoInfo) => void;
  onBusy?: (busy: boolean) => void;
}) {
  const [photo, setPhoto] = useState(initialPhoto);
  const [phase, setPhase] = useState<PhotoBusyPhase>("idle");
  const [uploadingThumb, setUploadingThumb] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryFile, setRetryFile] = useState<{
    blob: Blob;
    key: string;
    thumbUrl?: string;
  } | null>(null);
  const guard = useRef(false);
  const input = useRef<HTMLInputElement>(null);

  const busy = phase !== "idle";
  const enabled = photo.status !== "disabled";
  const preview = useReceiptPreview(bill.id);
  const localOnly =
    !bill.receiptPhotoId &&
    ["missing", "disabled", "unavailable"].includes(photo.status) &&
    !!preview;
  const displayPhoto: ReceiptPhotoInfo = localOnly
    ? {
        status: "available",
        expiresAt: new Date(preview!.expiresAt).toISOString(),
      }
    : photo;

  async function mutate(
    initialPhase: Exclude<PhotoBusyPhase, "idle">,
    task: (
      current: BillDocument,
    ) => Promise<{ bill: BillDocument; photo: ReceiptPhotoInfo }>,
  ) {
    if (guard.current) return;
    guard.current = true;
    setPhase(initialPhase);
    onBusy?.(true);
    setError(null);
    let prepared = false;
    try {
      const current = prepareBill ? await prepareBill() : bill;
      if (!current)
        throw new Error(
          "Simpan perubahan tagihan dahulu sebelum mengubah foto.",
        );
      prepared = true;
      const result = await task(current);
      onChange(result.bill, result.photo);
      setPhoto(result.photo);
      setRetryFile(null);
      setUploadingThumb(null);
      forgetReceiptPreview(bill.id);
      try {
        sessionStorage.removeItem(`patungin_receipt_photo_${bill.id}`);
      } catch {
        /* Optional legacy cache. */
      }
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Foto belum tersimpan. Coba lagi.",
      );
      // Keep unsaved field edits in the parent; reconcile only if no local draft editor is active.
      if (prepared) {
        try {
          const state = await loadReceiptState(bill.id);
          onChange(state.bill, state.photo);
          setPhoto(state.photo);
        } catch {
          /* Explicit retry is available. */
        }
      }
    } finally {
      guard.current = false;
      setPhase("idle");
      onBusy?.(false);
    }
  }

  return (
    <section className="space-y-3" aria-label="Foto struk" aria-busy={busy}>
      {busy && <SlowOperationNotice />}
      {!busy && (
        <ReceiptPhoto
          key={photo.id ?? `${photo.status}_${localOnly}`}
          info={displayPhoto}
          localOnly={localOnly}
          src={
            localOnly
              ? preview!.dataUrl
              : `/api/bills/${bill.id}/receipt-photo?photo=${photo.id ?? ""}`
          }
        />
      )}

      {busy && phase === "deleting" && (
        <div
          role="status"
          aria-live="polite"
          className="flex items-center gap-3 rounded-2xl border border-[#F5CA86] bg-[#FFF8F0] p-3.5 text-xs font-semibold text-[#9A4A12]"
        >
          <Loader2 size={17} className={`${ui.spinner} shrink-0`} aria-hidden="true" />
          <span>Menghapus foto struk dari penyimpanan…</span>
        </div>
      )}

      {busy && (phase === "preparing" || phase === "uploading") && (
        <div
          role="status"
          aria-live="polite"
          className="rounded-2xl border border-[#9DC0FB] bg-gradient-to-b from-[#F4F8FF] to-white p-4 space-y-3"
        >
          <div className="flex items-center gap-3.5">
            <div className="relative flex h-16 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-[#C9DAFC] bg-[#E6EDFF]">
              {uploadingThumb ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={uploadingThumb}
                    alt=""
                    aria-hidden="true"
                    className="h-full w-full object-cover opacity-80"
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
                {phase === "preparing"
                  ? "Menyiapkan & merapikan gambar…"
                  : "Menyimpan foto struk (akses 24 jam)…"}
              </p>
              <p className="text-xs text-[#4A5B7C]">
                {phase === "preparing"
                  ? "Menyesuaikan ukuran gambar agar cepat dibuka."
                  : "Mengunggah salinan privat. Jangan tutup halaman ini."}
              </p>
              <div className="flex flex-wrap items-center gap-2 pt-0.5 text-[11px] font-bold">
                <span
                  className={`inline-flex items-center gap-1 ${
                    phase === "uploading" ? "text-[#146346]" : "text-[#2855D9]"
                  }`}
                >
                  {phase === "uploading" ? (
                    <CheckCircle2 size={12} aria-hidden="true" />
                  ) : (
                    <Loader2 size={12} className={ui.spinner} aria-hidden="true" />
                  )}
                  1. Optimasi foto
                </span>
                <span className="text-[#A8BCE5]" aria-hidden="true">
                  ·
                </span>
                <span
                  className={`inline-flex items-center gap-1 ${
                    phase === "uploading" ? "text-[#2855D9]" : "text-[#7687A6]"
                  }`}
                >
                  {phase === "uploading" && (
                    <Loader2 size={12} className={ui.spinner} aria-hidden="true" />
                  )}
                  2. Simpan 24 jam
                </span>
              </div>
            </div>
          </div>

          <div className={ui.indeterminateTrack} aria-hidden="true">
            <div className={ui.indeterminateBar} />
          </div>
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

      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        aria-label="Pilih foto struk"
        disabled={busy || !enabled || bill.status !== "draft"}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file || busy) return;
          void mutate("preparing", async (current) => {
            if (
              file.size > 8 * 1024 * 1024 ||
              !["image/jpeg", "image/png", "image/webp"].includes(file.type)
            )
              throw new Error("Pilih JPG, PNG, atau WebP maksimal 8 MB.");
            const dataUrl = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(String(reader.result));
              reader.onerror = () =>
                reject(new Error("Foto belum bisa dibaca."));
              reader.readAsDataURL(file);
            });
            const processed = await processReceiptImageOnClient({
              dataUrl,
              rotationDeg: 0,
              cropVerticalMarginPct: 0,
            });
            setUploadingThumb(processed.previewDataUrl);
            rememberReceiptPreview(bill.id, processed.previewDataUrl);
            const next = {
              blob: processed.blob,
              key: crypto.randomUUID(),
              thumbUrl: processed.previewDataUrl,
            };
            setRetryFile(next);
            setPhase("uploading");
            return uploadReceiptFile(current, next.blob, next.key);
          });
        }}
      />

      <div className="flex flex-wrap items-center gap-2 text-xs font-bold">
        {enabled && bill.status === "draft" && (
          <button
            type="button"
            disabled={busy}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-[#C9DAFC] bg-[#E6EDFF] px-3.5 py-2 text-[#1E44B8] hover:bg-[#D8E5FF] disabled:opacity-50 cursor-pointer"
            onClick={() => input.current?.click()}
          >
            {photo.status === "available" ? (
              <>
                <RefreshCw size={14} aria-hidden="true" />
                Ganti foto
              </>
            ) : (
              <>
                <ImagePlus size={15} aria-hidden="true" />
                Pilih foto struk
              </>
            )}
          </button>
        )}

        {retryFile && (
          <button
            type="button"
            disabled={busy}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-[#2855D9] px-3.5 py-2 text-white hover:bg-[#1E44B8] disabled:opacity-50 cursor-pointer"
            onClick={() => {
              setUploadingThumb(retryFile.thumbUrl ?? null);
              void mutate("uploading", async (current) => {
                const state = await loadReceiptState(current.id);
                if (prepareBill && state.bill.revision !== current.revision)
                  throw new Error(
                    "Status tagihan berubah. Muat ulang sebelum mencoba lagi.",
                  );
                return uploadReceiptFile(
                  state.bill,
                  retryFile.blob,
                  retryFile.key,
                );
              });
            }}
          >
            <RotateCcw size={14} aria-hidden="true" />
            Coba simpan foto lagi
          </button>
        )}

        {localOnly && (
          <button
            type="button"
            disabled={busy}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-[#F5B5B5] bg-white px-3 py-2 text-[#B42318] hover:bg-[#FDECEC] disabled:opacity-50 cursor-pointer"
            onClick={() => forgetReceiptPreview(bill.id)}
          >
            <Trash2 size={14} aria-hidden="true" />
            Hapus salinan tab ini
          </button>
        )}

        {enabled && photo.id && (
          <button
            type="button"
            disabled={busy}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-[#D8E2F2] bg-white px-3 py-2 text-[#B42318] hover:border-[#F5B5B5] hover:bg-[#FDECEC] disabled:opacity-50 cursor-pointer"
            onClick={() => {
              if (
                !window.confirm(
                  "Hapus foto struk? Foto juga tidak bisa dibuka dari link yang sudah dibagikan.",
                )
              )
                return;
              void mutate("deleting", async (current) => {
                const { response, result } = await requestJson<{ bill: BillDocument; photo: ReceiptPhotoInfo }>(
                  `/api/bills/${bill.id}/receipt-photo`,
                  {
                    method: "DELETE",
                    headers: { "x-bill-revision": String(current.revision) },
                  },
                );
                if (!response.ok || !result.ok || !result.data)
                  throw new Error(result.error ?? "Foto belum terhapus.");
                return result.data;
              });
            }}
          >
            <Trash2 size={14} aria-hidden="true" />
            Hapus foto
          </button>
        )}
      </div>

      {enabled && (
        <p className="text-xs text-[#4A5B7C]">
          Foto dihapus otomatis setelah masa akses 24 jam. Mengganti foto
          referensi tidak menjalankan scan ulang.
        </p>
      )}
    </section>
  );
}
