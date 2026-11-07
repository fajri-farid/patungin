"use client";
import { useRef, useState } from "react";
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryFile, setRetryFile] = useState<{
    blob: Blob;
    key: string;
  } | null>(null);
  const guard = useRef(false);
  const input = useRef<HTMLInputElement>(null);
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
    task: (
      current: BillDocument,
    ) => Promise<{ bill: BillDocument; photo: ReceiptPhotoInfo }>,
  ) {
    if (guard.current) return;
    guard.current = true;
    setBusy(true);
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
      setBusy(false);
      onBusy?.(false);
    }
  }
  return (
    <section className="space-y-3" aria-label="Foto struk" aria-busy={busy}>
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
      {error && (
        <p role="alert" className="text-xs text-[#B42318]">
          {error}
        </p>
      )}
      {busy && (
        <p role="status" className="text-xs text-[#4A5B7C]">
          Menyimpan foto…
        </p>
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
          void mutate(async (current) => {
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
            rememberReceiptPreview(bill.id, processed.previewDataUrl);
            const next = { blob: processed.blob, key: crypto.randomUUID() };
            setRetryFile(next);
            return uploadReceiptFile(current, next.blob, next.key);
          });
        }}
      />
      <div className="flex flex-wrap gap-4 text-xs font-bold">
        {localOnly && (
          <button
            type="button"
            className="min-h-11 text-[#B42318]"
            onClick={() => forgetReceiptPreview(bill.id)}
          >
            Hapus salinan di tab ini
          </button>
        )}
        {enabled && bill.status === "draft" && (
          <button
            type="button"
            disabled={busy}
            className="min-h-11 text-[#2855D9] disabled:opacity-50"
            onClick={() => input.current?.click()}
          >
            {photo.status === "available" ? "Ganti foto" : "Pilih foto struk"}
          </button>
        )}
        {retryFile && (
          <button
            type="button"
            disabled={busy}
            className="min-h-11 text-[#2855D9]"
            onClick={() =>
              void mutate(async (current) => {
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
              })
            }
          >
            Coba simpan foto lagi
          </button>
        )}
        {enabled && photo.id && (
          <button
            type="button"
            disabled={busy}
            className="min-h-11 text-[#B42318] disabled:opacity-50"
            onClick={() => {
              if (
                !window.confirm(
                  "Hapus foto struk? Foto juga tidak bisa dibuka dari link yang sudah dibagikan.",
                )
              )
                return;
              void mutate(async (current) => {
                const response = await fetch(
                  `/api/bills/${bill.id}/receipt-photo`,
                  {
                    method: "DELETE",
                    headers: { "x-bill-revision": String(current.revision) },
                  },
                );
                const result = await response.json();
                if (!response.ok || !result.ok)
                  throw new Error(result.error ?? "Foto belum terhapus.");
                return result.data;
              });
            }}
          >
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
