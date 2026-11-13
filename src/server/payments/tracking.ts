import "server-only";
import { snapshotObligations, trackingView } from "@/domain/billing/tracking";
import type { BillDocument } from "@/domain/billing/types";
import { AppServiceError } from "../store/repository";
import { productTransaction } from "../store/transaction";

export interface TrackingMutation {
  billId: string;
  expectedRevision: number;
  finalizationId: string;
  participantId?: string;
  status?: "paid" | "unpaid";
}
const validId = (value: unknown): value is string =>
  typeof value === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
function validateInput(input: TrackingMutation): void {
  const allowed = new Set([
    "billId",
    "expectedRevision",
    "finalizationId",
    "participantId",
    "status",
  ]);
  if (
    !input ||
    typeof input !== "object" ||
    Object.keys(input).some((key) => !allowed.has(key)) ||
    !validId(input.billId) ||
    !validId(input.finalizationId) ||
    !Number.isSafeInteger(input.expectedRevision) ||
    input.expectedRevision < 1 ||
    (input.participantId === undefined
      ? input.status !== undefined
      : !validId(input.participantId) ||
        !["paid", "unpaid"].includes(input.status ?? ""))
  ) {
    throw new AppServiceError(
      400,
      "INVALID_PAYMENT_INPUT",
      "Pembayaran belum bisa disimpan. Muat ulang halaman lalu coba lagi.",
    );
  }
}

/** Caller checks session/product access and origin; transaction enforces ownership. */
export async function updatePaymentTracking(
  ownerUid: string,
  input: TrackingMutation,
): Promise<BillDocument> {
  validateInput(input);
  return productTransaction(async (tx) => {
    const bill = await tx.get<BillDocument>("bills", input.billId);
    if (!bill)
      throw new AppServiceError(
        404,
        "BILL_NOT_FOUND",
        "Tagihan tidak ditemukan.",
      );
    if (bill.ownerUid !== ownerUid)
      throw new AppServiceError(403, "FORBIDDEN", "Akses ditolak.");
    if (bill.revision !== input.expectedRevision)
      throw new AppServiceError(
        409,
        "STALE_REVISION",
        "Tagihan sudah berubah. Muat ulang halaman lalu coba lagi.",
      );
    if (
      bill.status !== "finalized" ||
      bill.currentFinalizationId !== input.finalizationId
    )
      throw new AppServiceError(
        409,
        "FINALIZATION_CHANGED",
        "Tagihan sudah berubah. Muat ulang halaman.",
      );
    const snapshot =
      bill.finalResult ??
      (await tx.finalization(bill.id, input.finalizationId));
    if (
      !snapshot ||
      snapshot.id !== input.finalizationId ||
      snapshot.billId !== bill.id ||
      snapshot.ownerUid !== ownerUid
    )
      throw new AppServiceError(
        409,
        "FINALIZATION_CHANGED",
        "Tagihan belum bisa dibuka. Muat ulang halaman.",
      );
    const obligations = snapshotObligations(snapshot);
    const view = trackingView(
      bill.paymentTracking,
      input.finalizationId,
      obligations,
    );
    if (
      view.state === "unavailable" ||
      view.total !== snapshot.calculationResult.totalReceivableByPayer
    )
      throw new AppServiceError(
        409,
        "TRACKING_UNAVAILABLE",
        "Status pembayaran belum bisa dimuat. Coba muat ulang halaman.",
      );
    if (!view.count)
      throw new AppServiceError(
        400,
        "NO_PAYMENT_DUE",
        "Tidak ada yang perlu bayar.",
      );
    const now = new Date().toISOString();
    let tracking = bill.paymentTracking;
    if (input.participantId === undefined) {
      if (view.state === "active") return { ...bill, finalResult: snapshot };
      tracking = {
        schemaVersion: 1,
        finalizationId: input.finalizationId,
        startedAt: now,
        updatedAt: now,
        entries: Object.fromEntries(
          obligations
            .filter((p) => !p.isPayer && p.transferToPayerAmount > 0)
            .map((p) => [
              p.id,
              { status: "unpaid" as const, paidAt: null, updatedAt: now },
            ]),
        ),
      };
    } else {
      if (
        view.state !== "active" ||
        !Object.hasOwn(view.entries, input.participantId)
      )
        throw new AppServiceError(
          400,
          "INVALID_PARTICIPANT",
          "Pembayaran orang ini belum bisa diubah. Muat ulang halaman.",
        );
      if (view.entries[input.participantId].status === input.status)
        return { ...bill, finalResult: snapshot };
      tracking = {
        ...tracking!,
        updatedAt: now,
        entries: {
          ...view.entries,
          [input.participantId]: {
            status: input.status!,
            paidAt: input.status === "paid" ? now : null,
            updatedAt: now,
          },
        },
      };
    }
    const updated: BillDocument = {
      ...bill,
      finalResult: snapshot,
      paymentTracking: tracking,
      revision: bill.revision + 1,
      updatedAt: now,
    };
    tx.set("bills", bill.id, updated);
    return updated;
  });
}
