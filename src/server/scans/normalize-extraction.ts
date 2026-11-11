import {
  isValidIdrInteger,
  isValidPositiveQuantity,
  isValidRateBps,
} from "@/domain/billing/money";
import { proposeLineAmountRecovery } from "@/domain/billing/recovery";
import { needsQuantityReview, RECEIPT_WARNING_MESSAGES } from "@/domain/billing/receipt-review";
import type {
  BillAdjustment,
  BillItem,
  ReceiptSourceType,
} from "@/domain/billing/types";

export class ExtractionValidationError extends Error {
  constructor(
    message: string,
    public readonly code = "INVALID_EXTRACTION",
  ) {
    super(message);
  }
}

const sourceTypes: ReceiptSourceType[] = [
  "printed_receipt",
  "cashier_screen",
  "transaction_screenshot",
  "other_transaction",
  "unsupported",
];
const kinds: BillAdjustment["kind"][] = [
  "item-discount",
  "bill-discount",
  "service",
  "tax",
  "fee",
  "rounding",
];
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ExtractionValidationError(
      "Hasil pembacaan tidak valid. Coba foto ulang atau isi manual.",
    );
  }
  return value as Record<string, unknown>;
}
function text(value: unknown, max = 300): string | null {
  return typeof value === "string" ? value.trim().slice(0, max) || null : null;
}

/** Validate provider output without inventing missing amounts or balancing the bill. */
export function normalizeExtraction(value: unknown) {
  const raw = record(value);
  if (raw.currency != null && raw.currency !== "IDR" && raw.currency !== "unknown") {
    throw new ExtractionValidationError("Struk ini memakai mata uang lain. Saat ini Patungin mendukung rupiah.", "EXTRACTION_CURRENCY_UNSUPPORTED");
  }
  if (!sourceTypes.includes(raw.sourceType as ReceiptSourceType)) {
    throw new ExtractionValidationError(
      "Jenis gambar tidak dapat dikenali. Gunakan foto struk, layar kasir, atau screenshot rincian transaksi.",
      "EXTRACTION_SOURCE_UNKNOWN",
    );
  }
  if (
    raw.sourceType === "unsupported" ||
    !Array.isArray(raw.items) ||
    raw.items.length === 0
  ) {
    throw new ExtractionValidationError(
      "Belum terlihat rincian transaksi yang bisa dibagi. Foto seluruh daftar pesanan beserta jumlah dan harganya, atau isi manual.",
      "EXTRACTION_ITEMS_MISSING",
    );
  }
  if (
    raw.items.length > 100 ||
    !Array.isArray(raw.adjustments) ||
    raw.adjustments.length > 20 ||
    !Array.isArray(raw.warnings)
  ) {
    throw new ExtractionValidationError(
      "Rincian gambar terlalu banyak atau tidak lengkap. Periksa gambar atau lanjut isi manual.",
      "EXTRACTION_STRUCTURE_INVALID",
    );
  }
  const warnings = raw.warnings
    .flatMap((w) => typeof w === "string" && w.trim() ? [Object.hasOwn(RECEIPT_WARNING_MESSAGES, w) ? RECEIPT_WARNING_MESSAGES[w] : RECEIPT_WARNING_MESSAGES.CHECK_RECEIPT] : [])
    .slice(0, 20);
  const rows = raw.items.map(record);
  const includedIn = new Map<number, number>();
  function parentIndexOf(row: Record<string, unknown>): number {
    return typeof row.parentItemIndex === "number" && Number.isInteger(row.parentItemIndex)
      && row.parentItemIndex >= 1 && row.parentItemIndex <= rows.length ? row.parentItemIndex - 1 : -1;
  }
  rows.forEach((row, index) => {
    if ((row.rowRole !== "modifier" && row.rowRole !== "description") || row.priceRelation !== "included_in_parent") return;
    // Follow only explicit inclusion links, retaining every row if the chain is unsafe.
    // Nested descriptions/modifiers may omit their own total; the payable root may not.
    const visited = new Set<number>();
    const path: number[] = [];
    let current = index;
    while (true) {
      if (visited.has(current)) return;
      visited.add(current);
      const child = rows[current];
      if ((child.rowRole !== "modifier" && child.rowRole !== "description") || child.priceRelation !== "included_in_parent") break;
      if (!text(child.name) || (child.lineAmount != null && !isValidIdrInteger(child.lineAmount))) return;
      const parentIndex = parentIndexOf(child);
      if (parentIndex < 0) return;
      const parent = rows[parentIndex];
      if (parent.lineAmount != null && (!isValidIdrInteger(parent.lineAmount)
        || (isValidIdrInteger(child.lineAmount) && child.lineAmount > parent.lineAmount))) return;
      path.push(current);
      current = parentIndex;
    }
    const root = rows[current];
    if ((root.rowRole == null || root.rowRole === "item" || (root.rowRole === "modifier" && root.priceRelation === "separate"))
      && isValidIdrInteger(root.lineAmount)
      && path.every(childIndex => rows[childIndex].lineAmount == null || (rows[childIndex].lineAmount as number) <= (root.lineAmount as number))) {
      includedIn.set(index, current);
    }
  });
  function money(value: unknown, label: string) {
    if (isValidIdrInteger(value)) return value;
    if (value != null)
      warnings.push(`${label} tidak valid; periksa nominalnya secara manual.`);
    return null;
  }
  const items: BillItem[] = raw.items.map((value, index): BillItem => {
    const row = record(value);
    const reasons: string[] = [];
    const receiptIssues: NonNullable<BillItem["receiptIssues"]> = [];
    if (text(row.ambiguityReason) || row.needsReview === true) receiptIssues.push("CHECK_ITEM");
    const name = text(row.name, 100);
    if (!name)
      reasons.push("Nama item belum terbaca; periksa dan ganti nama item.");
    const quantityKnown = isValidPositiveQuantity(row.quantity) && row.quantityStatus !== "unreadable" && row.quantityStatus !== "not_printed";
    if (!quantityKnown)
      reasons.push(
        "Jumlah belum terbaca. Angka 1 hanya isian sementara; wajib diperiksa.",
      );
    const printedUnitPrice = money(row.unitPrice, `Harga satuan item ${index + 1}`);
    const modifiers = rows.flatMap((child, childIndex) => includedIn.get(childIndex) === index ? [text(child.name, 100)!] : []);
    if (!receiptIssues.includes("CHECK_ITEM") && rows.some((child, childIndex) => includedIn.get(childIndex) === index
      && (child.needsReview === true || text(child.ambiguityReason)))) receiptIssues.push("CHECK_ITEM");
    const usesBasePrice = row.unitPriceRole === "base" && modifiers.length > 0;
    const unitPrice = usesBasePrice ? null : printedUnitPrice;
    const lineAmount = money(row.lineAmount, `Jumlah harga item ${index + 1}`);
    if (lineAmount === null)
      reasons.push("Jumlah harga baris belum terbaca; wajib diisi.");
    if (
      quantityKnown &&
      unitPrice !== null &&
      lineAmount !== null &&
      unitPrice * (row.quantity as number) !== lineAmount
    ) {
      reasons.push(
        "Harga satuan × jumlah berbeda dari total baris; periksa diskon atau angka pada gambar.",
      );
    }
    const directParentIndex = parentIndexOf(row);
    const parentIndex = includedIn.get(directParentIndex) ?? directParentIndex;
    const validParent = rows[parentIndex] && parentIndex !== index && !includedIn.has(parentIndex);
    if ((row.rowRole === "modifier" || row.rowRole === "description") && row.priceRelation !== "separate" && !includedIn.has(index)) {
      receiptIssues.push("MODIFIER_RELATION_UNKNOWN");
      reasons.push("Pastikan apakah tambahan ini sudah termasuk pesanan lain.");
    }
    if (receiptIssues.includes("CHECK_ITEM") && !reasons.length) reasons.push("Cocokkan pesanan ini dengan struk.");
    return {
      id: `ocr-item-${index + 1}`,
      allocationOrder: index,
      name: name ?? `Item ${index + 1}`,
      quantity: quantityKnown ? (row.quantity as number) : 1,
      quantityStatus: quantityKnown ? "observed" : row.quantityStatus === "not_printed" ? "not_printed" : "unreadable",
      unitPrice,
      lineAmount,
      lineAmountSource: "observed",
      reviewConfirmed: false,
      ambiguityReason: reasons.join(" ") || null,
      receiptIssues,
      ...(modifiers.length ? { includedModifiers: modifiers } : {}),
      ...(usesBasePrice ? { baseUnitPrice: printedUnitPrice } : {}),
      ...(validParent && row.rowRole === "modifier" ? { suggestedParentItemId: `ocr-item-${parentIndex + 1}` } : {}),
    };
  }).filter((_, index) => !includedIn.has(index));
  function resolveItemIndexes(value: unknown): string[] | null {
    if (!Array.isArray(value) || !value.length) return null;
    const indexes = value as unknown[];
    if (indexes.some(i => typeof i !== "number" || !Number.isInteger(i) || i < 1 || i > rows.length)) return null;
    return [...new Set(indexes.map(i => `ocr-item-${(includedIn.get((i as number) - 1) ?? (i as number) - 1) + 1}`))];
  }
  const adjustmentRows = raw.adjustments.map(record);
  const isDiscount = (row: Record<string, unknown>) => row.kind === "item-discount" || row.kind === "bill-discount";
  const discountAmount = (row: Record<string, unknown>): number | null =>
    typeof row.amount === "number" && isValidIdrInteger(Math.abs(row.amount)) ? Math.abs(row.amount) : null;
  const summaryIndexes = new Set<number>();
  adjustmentRows.forEach((row, index) => {
    const refs = row.summaryOfAdjustmentIndexes;
    if (refs == null || (Array.isArray(refs) && refs.length === 0)) return;
    if (!isDiscount(row) || !Array.isArray(refs) || new Set(refs).size !== refs.length
      || refs.some(i => !Number.isInteger(i) || i < 1 || i > adjustmentRows.length || i === index + 1
        || !isDiscount(adjustmentRows[i - 1]) || discountAmount(adjustmentRows[i - 1]) === null
        || (Array.isArray(adjustmentRows[i - 1].summaryOfAdjustmentIndexes) && (adjustmentRows[i - 1].summaryOfAdjustmentIndexes as unknown[]).length > 0))
      || discountAmount(row) === null
      || refs.reduce((sum: number, i: number) => sum + discountAmount(adjustmentRows[i - 1])!, 0) !== discountAmount(row)) {
      throw new ExtractionValidationError("Ringkasan diskon belum cocok dengan rinciannya. Cek struk atau isi manual.", "EXTRACTION_ADJUSTMENTS_INVALID");
    }
    summaryIndexes.add(index);
  });
  const adjustments: BillAdjustment[] = adjustmentRows.flatMap((value, index) => {
    const row = record(value);
    // A printed total is evidence for its detail rows, never an extra discount.
    if (summaryIndexes.has(index)) return [];
    if (
      !kinds.includes(row.kind as BillAdjustment["kind"]) ||
      !["added", "included"].includes(row.mode as string) ||
      (row.sign != null && row.sign !== "positive" && row.sign !== "negative")
    ) {
      throw new ExtractionValidationError(
        "Komponen pajak, biaya, atau diskon belum terbaca dengan benar. Periksa gambar atau isi manual.",
        "EXTRACTION_ADJUSTMENTS_INVALID",
      );
    }
    const discount = isDiscount(row);
    // Minus is a printed reduction marker. Discount kind already carries its sign.
    const amount = money(discount && discountAmount(row) !== null ? discountAmount(row) : row.amount, `Nominal komponen ${index + 1}`);
    const rateBps = isValidRateBps(row.rateBps) ? row.rateBps : null;
    if (row.rateBps != null && rateBps === null)
      warnings.push(`Tarif komponen ${index + 1} tidak valid; periksa manual.`);
    const targetIds = resolveItemIndexes(row.appliesToItemIndexes);
    if (Array.isArray(row.appliesToItemIndexes) && row.appliesToItemIndexes.length && !targetIds) {
      throw new ExtractionValidationError("Pesanan yang dikenai pajak atau diskon belum sesuai. Periksa struk.", "EXTRACTION_ADJUSTMENTS_INVALID");
    }
    if (amount === 0 && (rateBps === null || rateBps === 0)) return [];
    // An included-tax footer with no printed amount/rate does not create a charge to fill.
    if (row.kind === "tax" && row.mode === "included" && amount === null && rateBps === null) return [];
    const scopeIsClear = Boolean(targetIds && (row.scopeEvidence === "layout" || row.scopeEvidence === "label"));
    const targetsNeedReview = Boolean(targetIds && (row.appliesToItemIndexes as number[]).some(i =>
      rows[i - 1].needsReview === true || text(rows[i - 1].ambiguityReason)));
    // Remove informational discounts only when the model is certain about both
    // their net prices and their targets. Otherwise preserve the host's decision.
    if (discount && row.amountAlreadyIncluded === true && scopeIsClear && row.needsReview !== true && !targetsNeedReview
      && (row.appliesToItemIndexes as number[]).every(i => rows[i - 1].lineAmountBasis === "net")) {
      warnings.push("Diskon item sudah termasuk dalam total harga pesanan; tidak dikurangi lagi.");
      return [];
    }
    const grossTargets = Boolean(targetIds && (row.appliesToItemIndexes as number[]).every(i => rows[i - 1].lineAmountBasis === "gross"));
    const discountNeedsReview = discount && (row.needsReview === true || (!grossTargets && (row.mode === "included" || row.amountAlreadyIncluded === true)));
    const targetItem = targetIds?.length === 1 ? items.find(item => item.id === targetIds[0]) : null;
    const printedName = text(row.name, 80);
    const name = discount && targetItem && /^(?:disc(?:ount)?|diskon)\b[\s.:\d,\-+%]*$/i.test(printedName ?? "")
      ? `Diskon ${targetItem.name}`.slice(0, 80) : printedName ?? `Komponen ${index + 1}`;
    const deps = Array.isArray(row.dependsOnAdjustmentIndexes) ? row.dependsOnAdjustmentIndexes : [];
    if (deps.some(i => !Number.isInteger(i) || i < 1 || i > adjustmentRows.length || i === index + 1)) {
      throw new ExtractionValidationError("Dasar perhitungan pajak atau biaya belum sesuai. Periksa kembali struk.", "EXTRACTION_ADJUSTMENTS_INVALID");
    }
    return [{
      id: `ocr-adj-${index + 1}`,
      allocationOrder: index,
      name,
      kind: row.kind as BillAdjustment["kind"],
      amount,
      amountSource: amount === null ? "derived" : "observed",
      // Discount amounts always reduce prices in the billing engine. 'included' is tax/fee metadata.
      mode: discount ? "added" : row.mode as BillAdjustment["mode"],
      sign: row.sign === "negative" ? "negative" : "positive",
      basis: row.basis === "gross" ? "gross" : "net",
      eligibleItemIds: targetIds ?? items.map((item) => item.id),
      scopeConfirmed: Boolean(targetIds && (row.scopeEvidence === "layout" || row.scopeEvidence === "label") && row.needsReview !== true),
      rateBps,
      reviewConfirmed: false,
      directionNeedsReview: row.kind === "rounding" && row.sign !== "positive" && row.sign !== "negative",
      basisNeedsReview: amount === null && (row.kind === "tax" || row.kind === "service" || row.kind === "fee") && row.basis == null,
      dependsOnAdjustmentIds: deps.map(i => `ocr-adj-${i}`),
      ...(discountNeedsReview ? { discountNeedsReview: true } : {}),
    } satisfies BillAdjustment];
  });
  const printedDiscountTotal = typeof raw.printedDiscountTotal === "number" && isValidIdrInteger(Math.abs(raw.printedDiscountTotal))
    ? Math.abs(raw.printedDiscountTotal) : money(raw.printedDiscountTotal, "Total diskon pada struk");
  const discountDetails = adjustmentRows.filter((row, index) => isDiscount(row) && !summaryIndexes.has(index));
  if (printedDiscountTotal !== null && (discountDetails.some(row => discountAmount(row) === null)
    || discountDetails.reduce((sum, row) => sum + (discountAmount(row) ?? 0), 0) !== printedDiscountTotal)) {
    warnings.push(RECEIPT_WARNING_MESSAGES.DISCOUNT_TOTAL_MISMATCH);
    adjustments.filter(adj => adj.kind.endsWith("discount")).forEach(adj => { adj.discountNeedsReview = true; });
  }
  const adjustmentIds = new Set(adjustments.map(adj => adj.id));
  if (adjustments.some(adj => adj.dependsOnAdjustmentIds?.some(id => !adjustmentIds.has(id)))) {
    throw new ExtractionValidationError("Dasar perhitungan biaya belum lengkap. Periksa pajak dan diskon pada struk.", "EXTRACTION_ADJUSTMENTS_INVALID");
  }
  const printedSubtotal = money(raw.printedSubtotal, "Subtotal pada gambar");
  const displayedQuantity = isValidPositiveQuantity(raw.displayedQuantity)
    ? raw.displayedQuantity
    : null;
  if (items.every((i) => i.lineAmount !== null) && printedSubtotal !== null) {
    const sum = items.reduce((sum, i) => sum + i.lineAmount!, 0);
    // Some registers show subtotal after discounts. Accept either explicit basis.
    const discounts = adjustments
      .filter((a) => a.kind.endsWith("discount") && a.amount !== null)
      .reduce((sum, a) => sum + a.amount!, 0);
    if (sum !== printedSubtotal && sum - discounts !== printedSubtotal)
      warnings.push(
        "Jumlah harga item berbeda dari subtotal pada gambar. Periksa kemungkinan baris terpotong, diskon, atau angka yang salah terbaca.",
      );
  }
  if (
    displayedQuantity !== null &&
    (items.some(needsQuantityReview) ||
      items.reduce((sum, i) => sum + i.quantity, 0) !== displayedQuantity)
  ) {
    warnings.push(
      "Total jumlah barang belum sesuai dengan Qty pada gambar. Periksa seluruh baris, termasuk yang mungkin belum terlihat di layar.",
    );
  }
  const printedGrandTotal = money(raw.printedGrandTotal, "Total tagihan");
  if (printedGrandTotal === null)
    warnings.push(
      "Total tagihan belum terbaca. Cocokkan dan isi total dari sumber sebelum melanjutkan.",
    );
  // Older/model-incomplete responses can omit the optional row total entirely.
  // Recover only omitted fields (never explicit null/invalid values), with exact
  // reconciliation against the observed subtotal AND grand total when available.
  const omittedOnly = raw.items.every((value) => {
    const row = record(value);
    return (
      isValidIdrInteger(row.lineAmount) || !Object.hasOwn(row, "lineAmount")
    );
  });
  const recovery =
    omittedOnly && items.some((i) => i.lineAmount === null)
      ? proposeLineAmountRecovery({
          items,
          adjustments,
          confirmedGrandTotal: printedGrandTotal,
          printedSubtotal,
        })
      : null;
  const normalizedItems = recovery?.items ?? items;
  if (recovery)
    warnings.push(
      `${recovery.recoveredCount} total baris tidak dikirim oleh AI dan dihitung dari harga satuan × jumlah. Hasil cocok dengan total gambar; periksa setiap baris sebelum konfirmasi.`,
    );
  else if (items.some((i) => i.lineAmount === null))
    warnings.push(
      "Rincian harga belum lengkap. Total pada gambar bukan total rincian yang sudah berhasil dihitung.",
    );
  if (
    normalizedItems.every((i) => i.lineAmount === null && i.unitPrice === null)
  ) {
    throw new ExtractionValidationError(
      "Nama pesanan terbaca, tetapi seluruh harga belum terbaca. Foto ulang rincian dengan lebih jelas atau isi harga secara manual.",
      "EXTRACTION_PRICES_MISSING",
    );
  }
  const date = text(raw.receiptDate, 10);
  const validDate =
    date &&
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    !Number.isNaN(Date.parse(date)) &&
    new Date(date).toISOString().slice(0, 10) === date
      ? date
      : null;
  return {
    sourceType: raw.sourceType as ReceiptSourceType,
    merchant: text(raw.merchant, 100),
    receiptDate: validDate,
    items: normalizedItems,
    adjustments,
    printedSubtotal,
    printedDiscountTotal,
    displayedQuantity,
    printedGrandTotal,
    warnings: [...new Set(warnings)].slice(0, 40),
  };
}
