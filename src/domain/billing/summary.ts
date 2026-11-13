import { billTrackingView, trackingLabel } from "./tracking";
import type { BillDocument } from "./types";

export type BillSummary = Pick<
  BillDocument,
  | "id"
  | "title"
  | "merchant"
  | "status"
  | "confirmedGrandTotal"
  | "confirmedInputHash"
> & {
  itemCount: number;
  paymentTrackingLabel?: string;
  participantCount: number;
};

/** Explicit allowlist: full items, allocations and payment details stay on the server. */
export function summarizeBill(bill: BillDocument): BillSummary {
  return {
    paymentTrackingLabel: trackingLabel(billTrackingView(bill)),
    id: bill.id,
    title: bill.title,
    merchant: bill.merchant,
    status: bill.status,
    confirmedGrandTotal: bill.confirmedGrandTotal,
    confirmedInputHash: bill.confirmedInputHash,
    itemCount: bill.items.length,
    participantCount: bill.participants.length,
  };
}
