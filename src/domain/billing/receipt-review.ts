import { formatRupiah, isValidIdrInteger, isValidPositiveQuantity } from "./money";
import type { BillAdjustment, BillDocument, BillItem } from "./types";

export function receiptAdjustmentLabel(adjustment: BillAdjustment): string | null {
  // Discounts subtract in the calculation engine, including legacy drafts with a wrong mode.
  if (adjustment.kind.endsWith("discount")) return adjustment.discountNeedsReview ? "Diskon perlu dicek" : "Mengurangi harga pesanan";
  return adjustment.mode === "included" ? "Sudah termasuk dalam harga pesanan" : null;
}

/** Legacy drafts retain their warning, but model prose never becomes UI copy. */
export function needsQuantityReview(item: BillItem): boolean {
  if (item.quantityStatus === "confirmed") return false;
  if (item.quantityStatus === "not_printed" || item.quantityStatus === "unreadable") return true;
  return /jumlah belum terbaca|isian sementara/i.test(item.ambiguityReason ?? "");
}

export function hasUnitPriceMismatch(item: BillItem): boolean {
  return isValidIdrInteger(item.unitPrice) && isValidIdrInteger(item.lineAmount)
    && item.unitPrice * item.quantity !== item.lineAmount;
}

/** Only offer arithmetic using an actual, confirmed quantity and bounded amounts. */
export function unitPriceLineAmount(item: BillItem): number | null {
  if (!isValidIdrInteger(item.unitPrice) || !isValidPositiveQuantity(item.quantity) || needsQuantityReview(item)) return null;
  const amount = item.unitPrice * item.quantity;
  return isValidIdrInteger(amount) ? amount : null;
}

/** The host explicitly chose the printed unit price instead of the extracted total. */
export function applyReceiptUnitPrice(item: BillItem): BillItem {
  const lineAmount = unitPriceLineAmount(item);
  if (lineAmount === null || !item.name.trim()) return item;
  return confirmReceiptItem({ ...item, lineAmount, lineAmountSource: "derived", unitMismatchConfirmed: false });
}

export interface ReceiptItemFeedback {
  code: "NAME" | "AMOUNT" | "QUANTITY" | "MISMATCH" | "MODIFIER" | "DERIVED" | "CHECK";
  message: string;
}

export function receiptItemLabel(item: BillItem): string {
  return item.includedModifiers?.length ? `${item.name} (${item.includedModifiers.join(", ")})` : item.name;
}

/** Derive active issues from current values, not stale extraction paragraphs. */
export function receiptItemFeedback(item: BillItem): ReceiptItemFeedback[] {
  const issues: ReceiptItemFeedback[] = [];
  if (!item.name.trim()) issues.push({ code: "NAME", message: "Nama pesanan belum terbaca. Isi sesuai struk." });
  if (needsQuantityReview(item)) issues.push({ code: "QUANTITY", message: item.quantityStatus === "not_printed"
    ? "Jumlah tidak tertulis di struk. Pastikan jumlahnya sebelum lanjut."
    : "Jumlah belum terbaca, jadi diisi 1 sementara. Cek atau ubah sesuai struk." });
  if (!isValidIdrInteger(item.lineAmount)) issues.push({ code: "AMOUNT", message: "Harga belum terbaca. Isi total harga sesuai struk." });
  if (hasUnitPriceMismatch(item) && !item.unitMismatchConfirmed) issues.push({ code: "MISMATCH", message:
    `Harga satuan ${formatRupiah(item.unitPrice)}${item.quantity > 1 ? ` × ${item.quantity} = ${formatRupiah(item.unitPrice! * item.quantity)}` : ""}, total di struk ${formatRupiah(item.lineAmount)}. Pilih harga yang sesuai struk.` });
  if (!item.reviewConfirmed) {
    if (item.receiptIssues?.includes("MODIFIER_RELATION_UNKNOWN")) issues.push({ code: "MODIFIER", message: "Tambahan ini sudah termasuk pesanan lain? Gabungkan jika sudah, atau isi harga terpisah." });
    if (item.receiptIssues?.includes("PRICE_DERIVED") || item.lineAmountSource === "derived") issues.push({ code: "DERIVED", message: "Total ini dihitung dari harga satuan dan jumlah. Cocokkan dengan struk." });
    if (!issues.length && (item.ambiguityReason || item.receiptIssues?.includes("CHECK_ITEM"))) issues.push({ code: "CHECK", message: "Cocokkan nama, jumlah, dan harga pesanan ini dengan struk." });
  }
  return issues;
}

export function confirmReceiptItem(item: BillItem): BillItem {
  // Confirmation cannot fill missing fields or silently accept an unknown quantity.
  if (!item.name.trim() || !isValidIdrInteger(item.lineAmount) || needsQuantityReview(item)) return item;
  return { ...item, reviewConfirmed: true, ambiguityReason: null,
    unitMismatchConfirmed: hasUnitPriceMismatch(item) || item.unitMismatchConfirmed };
}

/** Host explicitly chose to include an existing row in another payable item. */
export function mergeReceiptItem(bill: BillDocument, childId: string, parentId: string): BillDocument {
  const child = bill.items.find(item => item.id === childId);
  const parent = bill.items.find(item => item.id === parentId);
  if (!child || !parent || childId === parentId || !isValidIdrInteger(parent.lineAmount)) return bill;
  // Do not silently discard previous ownership decisions when reopening a bill.
  const childAllocation = bill.allocations.find(a => a.itemId === childId);
  if (Object.keys(childAllocation?.unitCounts ?? {}).length || childAllocation?.participantIds?.length) return bill;
  return {
    ...bill,
    items: bill.items.filter(item => item.id !== childId).map(item => item.id === parentId ? {
      ...item,
      includedModifiers: [...(item.includedModifiers ?? []), child.name, ...(child.includedModifiers ?? [])],
      baseUnitPrice: item.baseUnitPrice ?? item.unitPrice ?? null,
      unitPrice: null,
      reviewConfirmed: false,
      ambiguityReason: null,
      receiptIssues: ["CHECK_ITEM"],
    } : { ...item, suggestedParentItemId: item.suggestedParentItemId === childId ? parentId : item.suggestedParentItemId ?? null }),
    allocations: bill.allocations.filter(a => a.itemId !== childId),
    adjustments: bill.adjustments.map(adj => ({ ...adj,
      eligibleItemIds: [...new Set(adj.eligibleItemIds.map(id => id === childId ? parentId : id))],
      scopeConfirmed: false,
    })),
  };
}

export const RECEIPT_WARNING_MESSAGES: Record<string, string> = {
  SOURCE_CROPPED: "Sebagian rincian belum terlihat. Foto ulang seluruh pesanan atau lengkapi manual.",
  SOURCE_UNCLEAR: "Sebagian foto kurang jelas. Cocokkan pesanan dan harga dengan struk.",
  CHECK_RECEIPT: "Ada bagian yang perlu dicek. Cocokkan rincian dengan foto struk.",
  DISCOUNT_TOTAL_MISMATCH: "Jumlah diskon belum cocok dengan ringkasan struk. Cek tiap diskon dan pesanan yang mendapatkannya.",
};

/** Old free-text warnings also receive a safe Indonesian fallback. */
export function receiptWarningMessages(warnings: readonly string[]): string[] {
  const knownMessages = new Map<string, string>([
    ...Object.values(RECEIPT_WARNING_MESSAGES).map(message => [message, message] as const),
    ["Diskon item sudah termasuk dalam total harga pesanan; tidak dikurangi lagi.",
      "Harga pesanan sudah termasuk diskon, jadi tidak dikurangi lagi."],
    ["Jumlah harga item berbeda dari subtotal pada gambar. Periksa kemungkinan baris terpotong, diskon, atau angka yang salah terbaca.",
      "Jumlah harga pesanan belum cocok dengan subtotal struk. Cek pesanan dan diskonnya."],
    ["Total jumlah barang belum sesuai dengan Qty pada gambar. Periksa seluruh baris, termasuk yang mungkin belum terlihat di layar.",
      "Jumlah pesanan belum cocok dengan struk. Cek apakah ada yang terlewat."],
    ["Total tagihan belum terbaca. Cocokkan dan isi total dari sumber sebelum melanjutkan.",
      "Total tagihan belum terbaca. Isi total akhir yang tertulis di struk."],
    ["Rincian harga belum lengkap. Total pada gambar bukan total rincian yang sudah berhasil dihitung.",
      "Ada harga pesanan yang belum terbaca. Lengkapi agar totalnya bisa dicek."],
  ]);
  return [...new Set(warnings.map(warning => Object.hasOwn(RECEIPT_WARNING_MESSAGES, warning)
    ? RECEIPT_WARNING_MESSAGES[warning] : (knownMessages.get(warning) ?? RECEIPT_WARNING_MESSAGES.CHECK_RECEIPT)))];
}
