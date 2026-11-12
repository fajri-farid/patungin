import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { alfamartProducts, alfamartReceipt } from "./fixtures/alfamart-receipt";
import { normalizeExtraction } from "../src/server/scans/normalize-extraction";
import { buildDetailedParticipantShares, buildReceiptDetails, calculateBill } from "../src/domain/billing/calculation";
import { computeFinancialInputHash } from "../src/domain/billing/hash";
import { confirmReceiptItem, receiptAdjustmentLabel } from "../src/domain/billing/receipt-review";
import { proposeLineAmountRecovery } from "../src/domain/billing/recovery";
import { DiscountTreatmentNotice } from "../src/components/DiscountTreatmentNotice";
import type { BillCalculationInput, BillAdjustment } from "../src/domain/billing/types";
import { createDraftBill, finalizeBillOnServer, saveBillDraft } from "../src/server/store/repository";

function calculationInput(raw: ReturnType<typeof normalizeExtraction>): BillCalculationInput {
  const participants = raw.items.map((_, index) => ({ id: `person-${index}`, name: `Teman ${index + 1}`, allocationOrder: index }));
  return { currency: "IDR", items: raw.items.map(confirmReceiptItem),
    adjustments: raw.adjustments.map(adj => ({ ...adj, reviewConfirmed: true, scopeConfirmed: true })),
    confirmedGrandTotal: raw.printedGrandTotal, participants, payerParticipantId: participants[0].id,
    allocations: raw.items.map((item, index) => ({ itemId: item.id, mode: "units", unitCounts: { [participants[index].id]: item.quantity } })),
  };
}
function calculate(raw: ReturnType<typeof normalizeExtraction>) {
  const input = calculationInput(raw);
  return calculateBill({ ...input, confirmedInputHash: computeFinancialInputHash(input) });
}

describe("retail item discounts and summary evidence", () => {
  it("reconciles all nine Alfamart products and assigns each discount only to its owner", () => {
    const result = normalizeExtraction(alfamartReceipt());
    expect(result.items).toHaveLength(9);
    expect(result.items.reduce((sum, item) => sum + item.quantity, 0)).toBe(26);
    expect(result.adjustments).toHaveLength(9);
    expect(result.warnings).toEqual([]);
    expect(result.adjustments[0]).toMatchObject({ name: `Diskon ${alfamartProducts[0].name}`, amount: 3000,
      mode: "added", scopeConfirmed: true, eligibleItemIds: [result.items[0].id] });
    const calculated = calculate(result);
    expect(calculated).toMatchObject({ computedItemsSubtotal: 285800, computedDiscountsTotal: 74800,
      computedGrandTotal: 211000, grandTotalDifference: 0, canFinalize: true });
    expect(calculated.participantBreakdowns.map(p => p.consumptionTotal)).toEqual([24000, 53800, 14500, 14500, 39700, 44500, 5000, 5000, 10000]);
    expect(calculated.adjustmentParticipantAllocations[result.adjustments[0].id]).toMatchObject({ "person-0": 3000, "person-1": 0 });
  });

  it("corrects an included flag against explicit gross prices without multiplying a discount by product quantity", () => {
    const raw = alfamartReceipt();
    raw.adjustments.forEach(adj => { adj.mode = "included"; adj.amountAlreadyIncluded = true; adj.amount *= -1; });
    const result = normalizeExtraction(raw);
    expect(result.adjustments.every(adj => adj.mode === "added" && !adj.discountNeedsReview)).toBe(true);
    expect(result.adjustments[0].amount).toBe(3000);
    expect(calculate(result).computedGrandTotal).toBe(211000);
    expect(calculate(result).canFinalize).toBe(true);
  });

  it("does not subtract a declared discount summary in addition to its detail rows", () => {
    const raw = alfamartReceipt();
    raw.adjustments.push({ ...raw.adjustments[0], name: "Total Diskon", kind: "bill-discount", amount: -74800,
      appliesToItemIndexes: [], summaryOfAdjustmentIndexes: raw.adjustments.map((_, index) => index + 1), scopeEvidence: "label" });
    const result = normalizeExtraction(raw);
    expect(result.adjustments).toHaveLength(9);
    expect(result.warnings).toEqual([]);
    expect(calculate(result).computedGrandTotal).toBe(211000);
  });

  it.each([{ refs: [1, 1] }, { refs: [0] }, { refs: [99] }, { refs: [10] }])("rejects invalid, duplicated or cyclic summary detail references $refs", ({ refs }) => {
    const raw = alfamartReceipt();
    raw.adjustments.push({ ...raw.adjustments[0], name: "Total Diskon", kind: "bill-discount", amount: 74800, summaryOfAdjustmentIndexes: refs });
    expect(() => normalizeExtraction(raw)).toThrow("Ringkasan diskon belum cocok");
  });

  it("rejects a summary whose stated amount does not equal the referenced details", () => {
    const raw = alfamartReceipt();
    raw.adjustments.push({ ...raw.adjustments[0], name: "Total Diskon", kind: "bill-discount", amount: 74801,
      summaryOfAdjustmentIndexes: raw.adjustments.map((_, index) => index + 1) });
    expect(() => normalizeExtraction(raw)).toThrow("Ringkasan diskon belum cocok");
  });

  it("keeps a genuinely independent bill coupon even if its amount equals an item discount", () => {
    const raw = alfamartReceipt();
    raw.adjustments.push({ ...raw.adjustments[0], name: "Voucher tambahan", kind: "bill-discount", amount: 3000,
      appliesToItemIndexes: raw.items.map((_, index) => index + 1), scopeEvidence: "label" });
    raw.printedDiscountTotal = 77800; raw.printedGrandTotal = 208000;
    const result = normalizeExtraction(raw);
    expect(result.adjustments).toHaveLength(10);
    expect(calculate(result)).toMatchObject({ computedDiscountsTotal: 77800, computedGrandTotal: 208000, canFinalize: true });
  });

  it("keeps unknown scopes unresolved even when the overall total happens to match", () => {
    const raw = alfamartReceipt();
    raw.adjustments[0].scopeEvidence = "unknown";
    const result = normalizeExtraction(raw);
    expect(result.adjustments[0].scopeConfirmed).toBe(false);
    const input = calculationInput(result);
    input.adjustments[0].scopeConfirmed = false;
    expect(calculateBill({ ...input, confirmedInputHash: computeFinancialInputHash(input) }).canFinalize).toBe(false);
  });

  it("requires a discount decision when included/net evidence is missing even after a generic confirmation", () => {
    const raw = alfamartReceipt();
    raw.items[0].lineAmountBasis = "unknown";
    raw.adjustments[0].mode = "included";
    const result = normalizeExtraction(raw);
    expect(result.adjustments[0].discountNeedsReview).toBe(true);
    expect(calculate(result).issues.map(issue => issue.code)).toContain("DISCOUNT_TREATMENT_UNCONFIRMED");
    expect(calculate(result).canFinalize).toBe(false);
    const input = calculationInput(result);
    const before = computeFinancialInputHash(input);
    input.adjustments[0].discountNeedsReview = false;
    expect(computeFinancialInputHash(input)).not.toBe(before);
    expect(calculateBill({ ...input, confirmedInputHash: computeFinancialInputHash(input) }).canFinalize).toBe(true);
  });

  it("removes informational discounts only when their prices are explicitly net", () => {
    const raw = alfamartReceipt();
    raw.items.forEach((item, index) => { item.lineAmount -= alfamartProducts[index].discount; item.lineAmountBasis = "net"; });
    raw.adjustments.forEach(adj => { adj.amountAlreadyIncluded = true; });
    raw.printedSubtotal = 211000;
    const result = normalizeExtraction(raw);
    expect(result.adjustments).toEqual([]);
    expect(calculate(result)).toMatchObject({ computedGrandTotal: 211000, computedDiscountsTotal: 0, canFinalize: true });
  });

  it.each(["adjustment", "scope", "missing-scope", "target"])("preserves an included net discount when its %s is uncertain", uncertainty => {
    const raw = alfamartReceipt();
    raw.items.forEach((item, index) => { item.lineAmount -= alfamartProducts[index].discount; item.lineAmountBasis = "net"; });
    raw.adjustments.forEach(adj => { adj.amountAlreadyIncluded = true; });
    raw.printedSubtotal = 211000;
    if (uncertainty === "adjustment") raw.adjustments[0].needsReview = true;
    if (uncertainty === "scope") raw.adjustments[0].scopeEvidence = "unknown";
    if (uncertainty === "missing-scope") Reflect.deleteProperty(raw.adjustments[0], "scopeEvidence");
    if (uncertainty === "target") raw.items[0].needsReview = true;
    const result = normalizeExtraction(raw);
    expect(result.adjustments).toHaveLength(1);
    expect(result.adjustments[0]).toMatchObject({ amount: 3000, eligibleItemIds: [result.items[0].id], discountNeedsReview: true });
    const calculated = calculate(result);
    expect(calculated.canFinalize).toBe(false);
    expect(calculated.issues.map(issue => issue.code)).toContain("DISCOUNT_TREATMENT_UNCONFIRMED");
    // The host explicitly chose "Sudah masuk harga pesanan".
    expect(calculate({ ...result, adjustments: [] })).toMatchObject({ computedGrandTotal: 211000, canFinalize: true });
  });

  it("rejects generic server review for a net discount that the model still considers ambiguous", async () => {
    const raw = alfamartReceipt();
    raw.items.forEach((item, index) => { item.lineAmount -= alfamartProducts[index].discount; item.lineAmountBasis = "net"; });
    raw.adjustments.forEach(adj => { adj.amountAlreadyIncluded = true; });
    raw.adjustments[0].needsReview = true;
    raw.adjustments[0].scopeEvidence = "unknown";
    raw.printedSubtotal = 211000;
    const input = calculationInput(normalizeExtraction(raw));
    const ownerUid = "dev-uid-host-patungin-local";
    const draft = await createDraftBill({ ownerUid, ownerVerifiedEmail: "host@patungin.local" });
    await expect(saveBillDraft(draft.id, ownerUid, { expectedRevision: draft.revision, items: input.items,
      adjustments: input.adjustments, confirmedGrandTotal: 211000, markReviewConfirmed: true }))
      .rejects.toMatchObject({ code: "INCOMPLETE_REVIEW" });
  });

  it("does not create a payment adjustment for zero delivery or an included-tax footer without a rate", () => {
    const raw = alfamartReceipt();
    const adjustments = [...raw.adjustments,
      { name: "Biaya Pengiriman", kind: "fee", amount: 0, rateBps: null, mode: "added" },
      { name: "Harga sudah termasuk PPN", kind: "tax", amount: null, rateBps: null, mode: "included" }];
    const result = normalizeExtraction({ ...raw, adjustments });
    expect(result.adjustments).toHaveLength(9);
    expect(calculate(result).computedGrandTotal).toBe(211000);
  });

  it("keeps a printed discount-total disagreement visible instead of creating a balancing adjustment", () => {
    const raw = alfamartReceipt(); raw.printedDiscountTotal = 75000;
    const result = normalizeExtraction(raw);
    expect(result.adjustments).toHaveLength(9);
    expect(result.warnings).toContain("Jumlah diskon belum cocok dengan ringkasan struk. Cek tiap diskon dan pesanan yang mendapatkannya.");
    expect(calculate(result).canFinalize).toBe(false);
    expect(result.adjustments.every(adj => adj.discountNeedsReview)).toBe(true);
  });

  it("blocks arithmetic price recovery while the discount treatment remains unknown", () => {
    const raw = normalizeExtraction(alfamartReceipt());
    raw.items[0].lineAmount = null;
    raw.adjustments[0].discountNeedsReview = true;
    expect(proposeLineAmountRecovery({ ...raw, confirmedGrandTotal: 211000 })).toBeNull();
  });

  it("enforces discount review on the server and finalizes only after the explicit correction", async () => {
    const raw = alfamartReceipt(); raw.items[0].lineAmountBasis = "unknown"; raw.adjustments[0].mode = "included";
    const input = calculationInput(normalizeExtraction(raw));
    const ownerUid = "dev-uid-host-patungin-local";
    const draft = await createDraftBill({ ownerUid, ownerVerifiedEmail: "host@patungin.local" });
    const patch = { items: input.items, adjustments: input.adjustments, participants: input.participants,
      payerParticipantId: input.payerParticipantId, allocations: input.allocations, confirmedGrandTotal: input.confirmedGrandTotal };
    await expect(saveBillDraft(draft.id, ownerUid, { ...patch, expectedRevision: draft.revision, markReviewConfirmed: true }))
      .rejects.toMatchObject({ code: "INCOMPLETE_REVIEW" });
    const saved = await saveBillDraft(draft.id, ownerUid, { ...patch, expectedRevision: draft.revision });
    await expect(finalizeBillOnServer({ billId: draft.id, ownerUid, expectedRevision: saved.revision }))
      .rejects.toMatchObject({ code: "FINALIZATION_VALIDATION_FAILED" });
    patch.adjustments[0].discountNeedsReview = false;
    const reviewed = await saveBillDraft(draft.id, ownerUid, { ...patch, expectedRevision: saved.revision, markReviewConfirmed: true });
    const finalized = await finalizeBillOnServer({ billId: draft.id, ownerUid, expectedRevision: reviewed.revision });
    expect(finalized.snapshot.calculationResult.computedGrandTotal).toBe(211000);
  });
});

describe("discount review display", () => {
  it("labels legacy included discounts by their actual subtracting behavior", () => {
    const adjustment = { kind: "item-discount", mode: "included" } as BillAdjustment;
    expect(receiptAdjustmentLabel(adjustment)).toBe("Mengurangi harga pesanan");
    expect(receiptAdjustmentLabel({ ...adjustment, kind: "tax" })).toBe("Sudah termasuk dalam harga pesanan");
  });

  it("keeps negative discount signs consistent in receipt and participant projections for legacy drafts", () => {
    const raw = normalizeExtraction(alfamartReceipt());
    raw.adjustments.forEach(adj => { adj.mode = "included"; });
    const input = calculationInput(raw);
    const result = calculateBill({ ...input, confirmedInputHash: computeFinancialInputHash(input) });
    expect(result.computedGrandTotal).toBe(211000);
    expect(buildReceiptDetails(input, result).adjustments[0]).toMatchObject({ mode: "added", signedAmount: -3000 });
    expect(buildDetailedParticipantShares(input, result)[0].adjustments[0]).toMatchObject({ mode: "added", signedAmount: -3000 });
  });

  it("shows an explicit price decision for ambiguous discounts and no extra buttons for known discounts", () => {
    const adjustment = { kind: "item-discount", amount: 3000, discountNeedsReview: true } as BillAdjustment;
    const props = { adjustment, locked: false, onSubtract: () => {}, onAlreadyIncluded: () => {} };
    const html = renderToStaticMarkup(createElement(DiscountTreatmentNotice, props));
    expect(html).toContain("Potong dari harga pesanan");
    expect(html).toContain("Sudah masuk harga pesanan");
    expect(renderToStaticMarkup(createElement(DiscountTreatmentNotice, { ...props, locked: true }))).not.toContain("<button");
    expect(renderToStaticMarkup(createElement(DiscountTreatmentNotice, { ...props, adjustment: { ...adjustment, discountNeedsReview: false } }))).toBe("");
  });
});
