"use client";

import { useRef, useState } from "react";
import { AlertTriangle, Loader2, Trash2 } from "lucide-react";
import type { BillDocument } from "@/domain/billing/types";
import type { ReceiptPhotoInfo } from "@/domain/receipts";
import { ReceiptPhoto } from "./ReceiptPhoto";
import { loadReceiptState } from "@/lib/receipt-photo-client";
import { forgetReceiptPreview, useReceiptPreview } from "@/lib/local-receipt-preview";
import { requestJson } from "@/lib/request-json";
import { SlowOperationNotice } from "./SlowOperationNotice";
import ui from "./product/product.module.css";

export function OwnerReceiptPhoto({
  bill, initialPhoto, prepareBill, onChange, onBusy,
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
  const guard = useRef(false);
  const enabled = photo.status !== "disabled";
  const preview = useReceiptPreview(bill.id);
  const localOnly = !bill.receiptPhotoId &&
    ["missing", "disabled", "unavailable"].includes(photo.status) && !!preview;
  const displayPhoto: ReceiptPhotoInfo = localOnly
    ? { status: "available", expiresAt: new Date(preview!.expiresAt).toISOString() }
    : photo;

  async function removePhoto() {
    if (guard.current || !window.confirm(
      "Hapus foto struk? Foto juga tidak bisa dibuka dari link yang sudah dibagikan.",
    )) return;
    guard.current = true;
    setBusy(true);
    onBusy?.(true);
    setError(null);
    let prepared = false;
    try {
      const current = prepareBill ? await prepareBill() : bill;
      if (!current) throw new Error("Simpan perubahan tagihan dahulu sebelum menghapus foto.");
      prepared = true;
      const { response, result } = await requestJson<{ bill: BillDocument; photo: ReceiptPhotoInfo }>(
        `/api/bills/${bill.id}/receipt-photo`,
        { method: "DELETE", headers: { "x-bill-revision": String(current.revision) } },
      );
      if (!response.ok || !result.ok || !result.data)
        throw new Error(result.error ?? "Foto belum terhapus.");
      onChange(result.data.bill, result.data.photo);
      setPhoto(result.data.photo);
      forgetReceiptPreview(bill.id);
      try { sessionStorage.removeItem(`patungin_receipt_photo_${bill.id}`); }
      catch { /* Optional legacy cache. */ }
    } catch (error) {
      setError(error instanceof Error ? error.message : "Foto belum terhapus. Coba lagi.");
      if (prepared) {
        try {
          const state = await loadReceiptState(bill.id);
          onChange(state.bill, state.photo);
          setPhoto(state.photo);
        } catch { /* Keep the last known photo until the user retries. */ }
      }
    } finally {
      guard.current = false;
      setBusy(false);
      onBusy?.(false);
    }
  }

  return (
    <section className="space-y-3" aria-label="Foto struk" aria-busy={busy}>
      {busy ? (
        <>
          <SlowOperationNotice />
          <div role="status" aria-live="polite" className="flex items-center gap-3 rounded-2xl border border-[#F5CA86] bg-[#FFF8F0] p-3.5 text-xs font-semibold text-[#9A4A12]">
            <Loader2 size={17} className={`${ui.spinner} shrink-0`} aria-hidden="true" />
            <span>Menghapus foto...</span>
          </div>
        </>
      ) : (
        <ReceiptPhoto
          key={photo.id ?? `${photo.status}_${localOnly}`}
          info={displayPhoto}
          localOnly={localOnly}
          src={localOnly ? preview!.dataUrl : `/api/bills/${bill.id}/receipt-photo?photo=${photo.id ?? ""}`}
        />
      )}
      {error && (
        <div role="alert" className="flex items-start gap-2 rounded-xl border border-[#F5B5B5] bg-[#FDECEC] p-3 text-xs font-semibold text-[#B42318]">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}
      {(localOnly || (enabled && photo.id)) && (
        <div className="flex flex-wrap items-center gap-2 text-xs font-bold">
          {localOnly && (
            <button type="button" disabled={busy}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-[#F5B5B5] bg-white px-3 py-2 text-[#B42318] hover:bg-[#FDECEC] disabled:opacity-50 cursor-pointer"
              onClick={() => forgetReceiptPreview(bill.id)}>
              <Trash2 size={14} aria-hidden="true" /> Hapus foto di tab ini
            </button>
          )}
          {enabled && photo.id && (
            <button type="button" disabled={busy}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-[#D8E2F2] bg-white px-3 py-2 text-[#B42318] hover:border-[#F5B5B5] hover:bg-[#FDECEC] disabled:opacity-50 cursor-pointer"
              onClick={() => { void removePhoto(); }}>
              <Trash2 size={14} aria-hidden="true" /> Hapus foto
            </button>
          )}
        </div>
      )}
      {enabled && (photo.id || localOnly) && (
        <p className="text-xs text-[#4A5B7C]">Foto tersedia selama 24 jam sejak disimpan.</p>
      )}
    </section>
  );
}
