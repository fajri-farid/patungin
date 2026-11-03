/**
 * Hash Canonical Input Finansial
 *
 * Digunakan untuk memastikan host telah mengonfirmasi review angka struk terbaru.
 * Mengubah nama peserta atau alokasi kepemilikan tidak membatalkan review angka,
 * namun mengubah item, kuantitas, harga, komponen pajak/diskon/biaya, scope,
 * atau grand total otomatis mengubah hash ini sehingga wajib direview ulang.
 */

import type { BillAdjustment, BillItem, CurrencyCode } from "./types";

export interface FinancialHashPayload {
  currency: CurrencyCode;
  confirmedGrandTotal: number | null;
  items: readonly BillItem[];
  adjustments: readonly BillAdjustment[];
}

/**
 * Menghasilkan representasi string kanonik dari seluruh field finansial struk.
 */
export function serializeCanonicalFinancialInput(input: FinancialHashPayload): string {
  const canonicalItems = [...input.items]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((item) => ({
      id: item.id,
      allocationOrder: item.allocationOrder,
      quantity: item.quantity,
      unitPrice: item.unitPrice ?? null,
      lineAmount: item.lineAmount ?? null,
      reviewConfirmed: Boolean(item.reviewConfirmed),
      unitMismatchConfirmed: Boolean(item.unitMismatchConfirmed),
    }));

  const canonicalAdjustments = [...input.adjustments]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((adj) => ({
      id: adj.id,
      allocationOrder: adj.allocationOrder,
      kind: adj.kind,
      amount: adj.amount ?? null,
      sign: adj.sign ?? "positive",
      amountSource: adj.amountSource,
      mode: adj.mode,
      basis: adj.basis,
      eligibleItemIds: [...adj.eligibleItemIds].sort(),
      scopeConfirmed: Boolean(adj.scopeConfirmed),
      dependsOnAdjustmentIds: [...(adj.dependsOnAdjustmentIds ?? [])].sort(),
      rateBps: adj.rateBps ?? null,
      reviewConfirmed: Boolean(adj.reviewConfirmed),
    }));

  return JSON.stringify({
    currency: input.currency,
    confirmedGrandTotal: input.confirmedGrandTotal ?? null,
    items: canonicalItems,
    adjustments: canonicalAdjustments,
  });
}

/**
 * Menghitung hash deterministik (kombinasi dua 32-bit FNV-1a dengan seed berbeda)
 * yang berjalan identik di browser (Client Preview) dan Node.js (Server Finalize).
 */
export function computeFinancialInputHash(input: FinancialHashPayload): string {
  const canonical = serializeCanonicalFinancialInput(input);
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;

  for (let i = 0; i < canonical.length; i++) {
    const code = canonical.charCodeAt(i);
    h1 ^= code;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= code ^ (i & 0xff);
    h2 = Math.imul(h2, 0x85ebca6b);
  }

  const hex1 = (h1 >>> 0).toString(16).padStart(8, "0");
  const hex2 = (h2 >>> 0).toString(16).padStart(8, "0");
  return `fin_v1_${hex1}${hex2}`;
}
