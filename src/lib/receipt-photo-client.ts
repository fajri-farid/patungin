import type { BillDocument } from "@/domain/billing/types";
import type { ReceiptPhotoInfo } from "@/domain/receipts";
import { requestJson } from "./request-json";

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
  const { response, result } = await requestJson<{ bill: BillDocument; photo: ReceiptPhotoInfo }>(`/api/bills/${bill.id}/receipt-photo`, {
    method: "POST",
    body: form,
  });
  if (result.code === "UPLOAD_RETRY_REQUIRED" && allowFreshAttempt) {
    return uploadReceiptFile(bill, blob, crypto.randomUUID(), false);
  }
  if (!response.ok || !result.ok || !result.data)
    throw new Error(result.error ?? "Foto belum tersimpan.");
  return result.data as { bill: BillDocument; photo: ReceiptPhotoInfo };
}

/** Reconcile uncertain upload commits before issuing a revision-dependent scan. */
export async function loadReceiptState(billId: string) {
  const { response, result } = await requestJson<{ bill: BillDocument; photo: ReceiptPhotoInfo }>(`/api/bills/${billId}/receipt-photo?info=1`, {
    cache: "no-store",
  }, 15_000);
  if (!response.ok || !result.ok || !result.data)
    throw new Error(
      result.error ?? "Status tagihan belum bisa diperiksa. Coba lagi.",
    );
  return result.data as { bill: BillDocument; photo: ReceiptPhotoInfo };
}
