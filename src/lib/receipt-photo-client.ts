import type { BillDocument } from "@/domain/billing/types";
import type { ReceiptPhotoInfo } from "@/domain/receipts";

export async function uploadReceiptFile(
  bill: Pick<BillDocument, "id" | "revision">,
  blob: Blob,
  key: string,
  allowFreshAttempt = true,
): Promise<{ bill: BillDocument; photo: ReceiptPhotoInfo }> {
  const form = new FormData();
  form.append(
    "receipt",
    new File([blob], "receipt.jpg", { type: "image/jpeg" }),
  );
  form.append("expectedRevision", String(bill.revision));
  form.append("idempotencyKey", key);
  const response = await fetch(`/api/bills/${bill.id}/receipt-photo`, {
    method: "POST",
    body: form,
  });
  const result = await response.json();
  if (result.code === "UPLOAD_RETRY_REQUIRED" && allowFreshAttempt) {
    return uploadReceiptFile(bill, blob, crypto.randomUUID(), false);
  }
  if (!response.ok || !result.ok)
    throw new Error(result.error ?? "Foto belum tersimpan.");
  return result.data as { bill: BillDocument; photo: ReceiptPhotoInfo };
}

/** Reconcile uncertain upload commits before issuing a revision-dependent scan. */
export async function loadReceiptState(billId: string) {
  const response = await fetch(`/api/bills/${billId}/receipt-photo?info=1`, {
    cache: "no-store",
  });
  const result = await response.json();
  if (!response.ok || !result.ok)
    throw new Error(
      result.error ?? "Status tagihan belum bisa diperiksa. Coba lagi.",
    );
  return result.data as { bill: BillDocument; photo: ReceiptPhotoInfo };
}
