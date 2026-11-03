import {
  isValidIdrInteger,
  isValidPositiveQuantity,
  isValidRateBps,
} from "@/domain/billing/money";
import { proposeLineAmountRecovery } from "@/domain/billing/recovery";
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
    .flatMap((w) => (text(w) ? [text(w)!] : []))
    .slice(0, 20);
  function money(value: unknown, label: string) {
    if (isValidIdrInteger(value)) return value;
    if (value != null)
      warnings.push(`${label} tidak valid; periksa nominalnya secara manual.`);
    return null;
  }
  const items: BillItem[] = raw.items.map((value, index) => {
    const row = record(value);
    const reasons = [text(row.ambiguityReason)].filter((s): s is string => !!s);
    const name = text(row.name, 100);
    if (!name)
      reasons.push("Nama item belum terbaca; periksa dan ganti nama item.");
    const quantityKnown = isValidPositiveQuantity(row.quantity);
    if (!quantityKnown)
      reasons.push(
        "Jumlah belum terbaca. Angka 1 hanya isian sementara; wajib diperiksa.",
      );
    const unitPrice = money(row.unitPrice, `Harga satuan item ${index + 1}`);
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
    return {
      id: `ocr-item-${index + 1}`,
      allocationOrder: index,
      name: name ?? `Item ${index + 1}`,
      quantity: quantityKnown ? (row.quantity as number) : 1,
      unitPrice,
      lineAmount,
      lineAmountSource: "observed",
      reviewConfirmed: false,
      ambiguityReason: reasons.join(" ") || null,
    };
  });
  const adjustments: BillAdjustment[] = raw.adjustments.map((value, index) => {
    const row = record(value);
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
    const amount = money(row.amount, `Nominal komponen ${index + 1}`);
    const rateBps = isValidRateBps(row.rateBps) ? row.rateBps : null;
    if (row.rateBps != null && rateBps === null)
      warnings.push(`Tarif komponen ${index + 1} tidak valid; periksa manual.`);
    return {
      id: `ocr-adj-${index + 1}`,
      allocationOrder: index,
      name: text(row.name, 80) ?? `Komponen ${index + 1}`,
      kind: row.kind as BillAdjustment["kind"],
      amount,
      amountSource: amount === null ? "derived" : "observed",
      mode: row.mode as BillAdjustment["mode"],
      sign: row.sign === "negative" ? "negative" : "positive",
      basis: "net",
      eligibleItemIds: items.map((item) => item.id),
      scopeConfirmed: false,
      rateBps,
      reviewConfirmed: false,
    };
  });
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
    (items.some((i) => i.ambiguityReason?.includes("Jumlah belum terbaca")) ||
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
    displayedQuantity,
    printedGrandTotal,
    warnings: [...new Set(warnings)].slice(0, 40),
  };
}
