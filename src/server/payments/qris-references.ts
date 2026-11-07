import type { BillDocument, PaymentMethodNote } from "@/domain/billing/types";
import type { QrisImageRecord } from "@/domain/qris";
import type { ProductTransaction } from "../store/transaction";
import { AppServiceError } from "../store/repository";

export function qrisIds(methods: PaymentMethodNote[] = []) {
  return [
    ...new Set(
      methods
        .filter((method) => method.method === "qris" && method.qrisImageId)
        .map((method) => method.qrisImageId!),
    ),
  ];
}
export function billQrisIds(bill: BillDocument) {
  return [
    ...new Set([
      ...qrisIds(bill.paymentMethods),
      ...qrisIds(bill.finalResult?.paymentMethods),
    ]),
  ];
}
/** Counts one reference per profile/bill, including its retained final snapshot. All reads precede writes. */
export async function syncQrisReferences(
  tx: ProductTransaction,
  ownerUid: string,
  previous: string[],
  next: string[],
) {
  const ids = [...new Set([...previous, ...next])];
  const records = await Promise.all(
    ids.map((id) => tx.get<QrisImageRecord>("qrisImages", id)),
  );
  for (let i = 0; i < ids.length; i++) {
    const asset = records[i];
    if (
      next.includes(ids[i]) &&
      (!asset || asset.ownerUid !== ownerUid || asset.status !== "ready")
    ) {
      throw new AppServiceError(
        422,
        "QRIS_UNAVAILABLE",
        "Gambar QRIS tidak tersedia atau bukan milik akunmu. Unggah ulang melalui Pengaturan.",
      );
    }
  }
  for (let i = 0; i < ids.length; i++) {
    const asset = records[i];
    if (!asset || asset.ownerUid !== ownerUid) continue;
    const delta =
      Number(next.includes(ids[i])) - Number(previous.includes(ids[i]));
    if (!delta) continue;
    tx.set("qrisImages", asset.id, {
      ...asset,
      referenceCount: Math.max(0, asset.referenceCount + delta),
      nextCleanupAt: new Date(Date.now() + 86400000).toISOString(),
    });
  }
}
