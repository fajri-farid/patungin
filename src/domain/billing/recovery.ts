import { isValidIdrInteger, isValidPositiveQuantity } from "./money";
import type { BillAdjustment, BillItem } from "./types";

/** A reviewable arithmetic proposal, never a replacement for an observed row total. */
export function proposeLineAmountRecovery(input: {
  items: BillItem[];
  adjustments: BillAdjustment[];
  confirmedGrandTotal: number | null;
  printedSubtotal?: number | null;
}) {
  if (!isValidIdrInteger(input.confirmedGrandTotal) || !input.items.length || !input.items.some((i) => i.lineAmount === null)) return null;
  let recoveredCount = 0;
  const items: BillItem[] = [];
  for (const item of input.items) {
    if (item.lineAmount !== null) {
      if (!isValidIdrInteger(item.lineAmount)) return null;
      items.push(item);
      continue;
    }
    // Unknown quantities use a temporary 1 in the editor; that is not evidence.
    if (!isValidPositiveQuantity(item.quantity) || !isValidIdrInteger(item.unitPrice) || /jumlah belum terbaca|isian sementara/i.test(item.ambiguityReason ?? "")) return null;
    const amount = item.quantity * item.unitPrice;
    if (!isValidIdrInteger(amount)) return null;
    recoveredCount++;
    items.push({ ...item, lineAmount: amount, lineAmountSource: "derived", reviewConfirmed: false,
      ambiguityReason: "Total baris dihitung dari harga satuan × jumlah, bukan dibaca langsung. Cocokkan dengan gambar sebelum konfirmasi." });
  }
  const subtotal = items.reduce((sum, i) => sum + BigInt(i.lineAmount!), BigInt(0));
  if (subtotal > BigInt(1_000_000_000_000)) return null;
  let total = subtotal;
  let discounts = BigInt(0);
  for (const adj of input.adjustments) {
    if (!isValidIdrInteger(adj.amount) || adj.amountSource !== "observed") return null;
    if (adj.amount === 0) continue;
    if (adj.mode === "included") {
      if (adj.kind !== "tax" && adj.kind !== "service") return null;
      continue;
    }
    if (adj.mode !== "added") return null;
    const negative = adj.kind === "item-discount" || adj.kind === "bill-discount" || (adj.kind === "rounding" && adj.sign === "negative");
    total += BigInt(adj.amount) * BigInt(negative ? -1 : 1);
    if (adj.kind.endsWith("discount")) discounts += BigInt(adj.amount);
  }
  if (isValidIdrInteger(input.printedSubtotal) && subtotal !== BigInt(input.printedSubtotal) && subtotal - discounts !== BigInt(input.printedSubtotal)) return null;
  if (total !== BigInt(input.confirmedGrandTotal)) return null;
  return { items, recoveredCount, subtotal: Number(subtotal), grandTotal: Number(total) };
}
