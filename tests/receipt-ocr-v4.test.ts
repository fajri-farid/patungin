import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeExtraction } from "../src/server/scans/normalize-extraction";
import { calculateBill, calculateBillForReview } from "../src/domain/billing/calculation";
import { computeFinancialInputHash } from "../src/domain/billing/hash";
import { confirmReceiptItem, mergeReceiptItem, needsQuantityReview, receiptItemFeedback, receiptItemLabel, receiptWarningMessages, unitPriceLineAmount, applyReceiptUnitPrice } from "../src/domain/billing/receipt-review";
import { MAX_IDR_AMOUNT } from "../src/domain/billing/types";
import { proposeLineAmountRecovery } from "../src/domain/billing/recovery";
import { completeScanAttempt, createDraftBill, getBillForOwner, reserveScanAttempt, saveBillDraft } from "../src/server/store/repository";
import { extractReceiptWithGemini } from "../src/server/scans/gemini";
import type { BillDocument, BillItem } from "../src/domain/billing/types";

const { generateContent } = vi.hoisted(() => ({ generateContent: vi.fn() }));
vi.mock("@google/genai", async importOriginal => ({
  ...await importOriginal<typeof import("@google/genai")>(),
  GoogleGenAI: class { models = { generateContent }; },
}));
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

const item = (extra: Record<string, unknown> = {}) => ({ name: "Milk Tea (R)", quantity: 1, quantityStatus: "observed",
  unitPrice: 12000, lineAmount: 17000, rowRole: "item", unitPriceRole: "base", priceRelation: "separate", ...extra });
const topping = (extra: Record<string, unknown> = {}) => ({ name: "Toping Boba Minum", quantity: null, quantityStatus: "not_printed",
  unitPrice: null, lineAmount: null, rowRole: "modifier", parentItemIndex: 1, priceRelation: "included_in_parent", ...extra });
const receipt = (items: unknown[], adjustments: unknown[] = [], extra: Record<string, unknown> = {}) => ({
  sourceType: "printed_receipt", currency: "IDR", merchant: null, receiptDate: null,
  printedSubtotal: 17000, displayedQuantity: null, printedGrandTotal: 17000, items, adjustments, warnings: [], ...extra,
});
function reviewed(raw: ReturnType<typeof normalizeExtraction>) {
  const input = { currency: "IDR" as const, items: raw.items.map(confirmReceiptItem),
    adjustments: raw.adjustments.map(adj => ({ ...adj, reviewConfirmed: true, scopeConfirmed: true })),
    confirmedGrandTotal: raw.printedGrandTotal,
    participants: [{ id: "p", name: "Host", allocationOrder: 0 }], payerParticipantId: "p",
    allocations: raw.items.map(i => ({ itemId: i.id, mode: "units" as const, unitCounts: { p: i.quantity } })),
  };
  return calculateBill({ ...input, confirmedInputHash: computeFinancialInputHash(input) });
}

describe("OCR v4 relationships and money", () => {
  it("preserves a printed multi-unit group total that already includes paid toppings", () => {
    const result = normalizeExtraction(receipt([
      item({ name: "Teh Susu", quantity: 2, unitPrice: 11000, lineAmount: 30000 }),
      topping({ name: "Boba", quantity: 2, quantityStatus: "observed", unitPrice: 4000, lineAmount: 8000 }),
      item({ name: "Roti Panggang", quantity: 1, unitPrice: 9000, unitPriceRole: "effective", lineAmount: 9000 }),
    ], [], { printedSubtotal: 39000, printedGrandTotal: 39000 }));
    expect(result.items.map(i => i.lineAmount)).toEqual([30000, 9000]);
    expect(result.items[0]).toMatchObject({ quantity: 2, unitPrice: null, baseUnitPrice: 11000, includedModifiers: ["Boba"] });
    expect(reviewed(result)).toMatchObject({ computedGrandTotal: 39000, canFinalize: true });
  });

  it("blocks the live topping regression without inventing a replacement total or adjustment", () => {
    const result = normalizeExtraction(receipt([
      item({ name: "Teh Susu", quantity: 2, unitPrice: 11000, lineAmount: 22000 }),
      topping({ name: "Boba", quantity: 2, quantityStatus: "observed", unitPrice: 4000, lineAmount: 8000 }),
      item({ name: "Roti Panggang", quantity: 1, unitPrice: 9000, unitPriceRole: "effective", lineAmount: 9000 }),
    ], [], { printedSubtotal: 39000, printedGrandTotal: 39000 }));
    expect(result.items.map(i => i.lineAmount)).toEqual([22000, 9000]);
    expect(result.adjustments).toEqual([]);
    const calculated = reviewed(result);
    expect(calculated.canFinalize).toBe(false);
    expect(calculated.grandTotalDifference).toBe(-8000);
    expect(calculated.issues.map(issue => issue.code)).toContain("GRAND_TOTAL_MISMATCH");
  });

  it("keeps one payable item and printed base price for an included topping", () => {
    const result = normalizeExtraction(receipt([item(), topping()]));
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ name: "Milk Tea (R)", baseUnitPrice: 12000, unitPrice: null,
      lineAmount: 17000, includedModifiers: ["Toping Boba Minum"], reviewConfirmed: false });
    expect(receiptItemLabel(result.items[0])).toBe("Milk Tea (R) (Toping Boba Minum)");
    expect(receiptItemFeedback(result.items[0])).toEqual([]);
    expect(reviewed(result).computedGrandTotal).toBe(17000);
    expect(reviewed(result).canFinalize).toBe(true);
  });

  it("does not charge an included breakdown twice", () => {
    const result = normalizeExtraction(receipt([item(), topping({ lineAmount: 5000, quantity: 1 })]));
    expect(result.items).toHaveLength(1);
    expect(reviewed(result).computedGrandTotal).toBe(17000);
  });

  it("reconciles the full Yappay receipt without charging its printed +5000 topping twice", () => {
    const result = normalizeExtraction(receipt([
      item({ name: "Lemonade Strawberry (R)", unitPrice: 12000, lineAmount: 12000, unitPriceRole: "effective" }),
      item({ name: "Roti Bakar Cokelat+Keju", unitPrice: 27000, lineAmount: 27000, unitPriceRole: "effective" }),
      item({ name: "Roti Bakar Choco Crunchy", unitPrice: 28000, lineAmount: 28000, unitPriceRole: "effective" }),
      item(),
      topping({ parentItemIndex: 4, quantity: 1, quantityStatus: "observed", unitPrice: 5000, lineAmount: 5000 }),
    ], [], { merchant: "YAPPAY GOA RIA", receiptDate: "2026-07-28", printedSubtotal: 84000, printedGrandTotal: 84000 }));
    expect(result.items).toHaveLength(4);
    expect(result.items[3]).toMatchObject({ baseUnitPrice: 12000, unitPrice: null, lineAmount: 17000,
      quantity: 1, includedModifiers: ["Toping Boba Minum"] });
    expect(result.warnings).toEqual([]);
    const calculation = reviewed(result);
    expect(calculation.computedGrandTotal).toBe(84000);
    expect(calculation.canFinalize).toBe(true);
  });

  it("collapses explicit inclusion through multiple levels and remaps adjustment scopes to the payable root", () => {
    const result = normalizeExtraction(receipt([item(), topping(),
      topping({ name: "Extra Boba", parentItemIndex: 2, quantity: 1, lineAmount: 2000 }),
    ], [{ name: "Diskon topping", kind: "item-discount", amount: 1000, rateBps: null, mode: "added", appliesToItemIndexes: [2, 3] }],
    { printedGrandTotal: 16000 }));
    expect(result.items).toHaveLength(1);
    expect(result.items[0].includedModifiers).toEqual(["Toping Boba Minum", "Extra Boba"]);
    expect(result.adjustments[0].eligibleItemIds).toEqual(["ocr-item-1"]);
    expect(reviewed(result).computedGrandTotal).toBe(16000);
    expect(reviewed(result).canFinalize).toBe(true);
  });

  it("retains a nested row when an ancestor inclusion is uncertain", () => {
    const result = normalizeExtraction(receipt([item(), topping({ priceRelation: "unknown" }),
      topping({ name: "Extra Boba", parentItemIndex: 2, lineAmount: 2000 }),
    ]));
    expect(result.items).toHaveLength(3);
    expect(result.items.slice(1).every(i => i.receiptIssues?.includes("MODIFIER_RELATION_UNKNOWN"))).toBe(true);
  });

  it("includes a sub-topping in a separately billed topping without merging that topping into the drink", () => {
    const result = normalizeExtraction(receipt([item({ lineAmount: 12000, unitPriceRole: "effective" }),
      topping({ quantity: 1, quantityStatus: "observed", lineAmount: 5000, unitPrice: 5000, priceRelation: "separate" }),
      topping({ name: "Boba detail", rowRole: "description", parentItemIndex: 2 }),
    ]));
    expect(result.items).toHaveLength(2);
    expect(result.items[1].includedModifiers).toEqual(["Boba detail"]);
    expect(reviewed(result).computedGrandTotal).toBe(17000);
    expect(reviewed(result).canFinalize).toBe(true);
  });

  it("retains review flags from an included topping on the payable parent", () => {
    const result = normalizeExtraction(receipt([item(), topping({ needsReview: true })]));
    expect(result.items).toHaveLength(1);
    expect(receiptItemFeedback(result.items[0]).map(f => f.code)).toEqual(["CHECK"]);
  });

  it("keeps invalid description links visible for review", () => {
    const result = normalizeExtraction(receipt([item(), topping({ rowRole: "description", parentItemIndex: 99 })]));
    expect(result.items).toHaveLength(2);
    expect(result.items[1].receiptIssues).toContain("MODIFIER_RELATION_UNKNOWN");
  });

  it("keeps a separately charged topping payable", () => {
    const result = normalizeExtraction(receipt([item({ lineAmount: 12000, unitPriceRole: "effective" }),
      topping({ priceRelation: "separate", quantity: 1, quantityStatus: "observed", unitPrice: 5000, lineAmount: 5000 })]));
    expect(result.items).toHaveLength(2);
    expect(reviewed(result).computedGrandTotal).toBe(17000);
    expect(reviewed(result).canFinalize).toBe(true);
  });

  it.each([0, 1, 99, 1.5])("does not collapse an invalid/self parent reference %s", parentItemIndex => {
    const result = normalizeExtraction(receipt([item(), topping({ parentItemIndex: parentItemIndex === 1 ? 2 : parentItemIndex })]));
    expect(result.items).toHaveLength(2);
    expect(result.items[1].lineAmount).toBeNull();
    expect(result.items[1].receiptIssues).toContain("MODIFIER_RELATION_UNKNOWN");
  });

  it("does not collapse a cycle or a modifier into another modifier", () => {
    const result = normalizeExtraction(receipt([item(), topping({ parentItemIndex: 3 }), topping({ parentItemIndex: 2 })]));
    expect(result.items).toHaveLength(3);
  });

  it("does not collapse if the parent price is unreadable or smaller than the child", () => {
    expect(normalizeExtraction(receipt([item({ lineAmount: null }), topping()])).items).toHaveLength(2);
    expect(normalizeExtraction(receipt([item(), topping({ lineAmount: 18000 })])).items).toHaveLength(2);
  });

  it("does not infer a topping price or relationship from English prose", () => {
    const result = normalizeExtraction(receipt([item(), topping({ priceRelation: "unknown", ambiguityReason: "Likely bundled into Milk Tea." })]));
    expect(result.items).toHaveLength(2);
    expect(result.items[1].lineAmount).toBeNull();
    expect(result.items[1].ambiguityReason).not.toContain("Likely");
    expect(receiptItemFeedback(result.items[1]).some(f => f.code === "MODIFIER")).toBe(true);
  });

  it("does not apply an informational net item discount a second time", () => {
    const result = normalizeExtraction(receipt([item({ unitPrice: 20000, lineAmount: 18000, lineAmountBasis: "net" })], [
      { name: "Diskon item", kind: "item-discount", amount: 2000, mode: "added", rateBps: null,
        amountAlreadyIncluded: true, appliesToItemIndexes: [1], scopeEvidence: "label", needsReview: false },
    ], { printedSubtotal: 18000, printedGrandTotal: 18000 }));
    expect(result.adjustments).toEqual([]);
    expect(reviewed(result).computedGrandTotal).toBe(18000);
  });

  it("keeps a separate gross discount and its item-specific scope", () => {
    const result = normalizeExtraction(receipt([item({ unitPrice: 20000, lineAmount: 20000, lineAmountBasis: "gross" }),
      item({ name: "Air", lineAmount: 10000, unitPrice: 10000 })], [
      { name: "Diskon makanan", kind: "item-discount", amount: 2000, rateBps: null, mode: "added", appliesToItemIndexes: [1] },
    ], { printedSubtotal: 30000, printedGrandTotal: 28000 }));
    expect(result.adjustments[0].eligibleItemIds).toEqual(["ocr-item-1"]);
    expect(result.adjustments[0].scopeConfirmed).toBe(false);
    expect(reviewed(result).computedGrandTotal).toBe(28000);
  });

  it("does not skip a discount from a vague already-included flag without net targets", () => {
    const result = normalizeExtraction(receipt([item()], [{ name: "Diskon", kind: "item-discount", amount: 2000,
      rateBps: null, mode: "added", amountAlreadyIncluded: true, appliesToItemIndexes: [] }]));
    expect(result.adjustments).toHaveLength(1);
  });

  it("calculates an explicitly linked service and rate-only tax correctly", () => {
    const result = normalizeExtraction(receipt([item({ unitPrice: 100000, lineAmount: 100000 })], [
      { name: "Service", kind: "service", amount: 5000, mode: "added", rateBps: 500, basis: "net" },
      { name: "Pajak", kind: "tax", amount: null, mode: "added", rateBps: 1000, basis: "net", dependsOnAdjustmentIndexes: [1] },
    ], { printedSubtotal: 100000, printedGrandTotal: 115500 }));
    expect(result.adjustments[1].dependsOnAdjustmentIds).toEqual(["ocr-adj-1"]);
    expect(reviewed(result).computedGrandTotal).toBe(115500);
    expect(reviewed(result).canFinalize).toBe(true);
  });

  it("requires review when a rate-only tax has no stated basis", () => {
    const result = normalizeExtraction(receipt([item()], [{ name: "Pajak", kind: "tax", amount: null,
      mode: "added", rateBps: 1000, basis: null }]));
    expect(reviewed(result).issues.some(i => i.code === "ADJUSTMENT_BASIS_UNCONFIRMED")).toBe(true);
  });

  it("requires rounding direction even if its name contains a minus", () => {
    const result = normalizeExtraction(receipt([item({ lineAmount: 20000 })], [{ name: "Pembulatan -500", kind: "rounding",
      amount: 500, rateBps: null, mode: "added", sign: null }], { printedGrandTotal: 19500 }));
    expect(result.adjustments[0].directionNeedsReview).toBe(true);
    expect(reviewed(result).issues.some(i => i.code === "ROUNDING_DIRECTION_UNCONFIRMED")).toBe(true);
    result.adjustments[0] = { ...result.adjustments[0], sign: "negative", directionNeedsReview: false };
    expect(reviewed(result).computedGrandTotal).toBe(19500);
  });

  it.each(["USD", "SGD", "EUR"])("rejects %s instead of relabelling amounts as rupiah", currency => {
    expect(() => normalizeExtraction(receipt([item()], [], { currency }))).toThrow("mata uang lain");
  });

  it("rejects invalid adjustment targets and dependencies", () => {
    const adj = { name: "Pajak", kind: "tax", amount: 100, mode: "added", rateBps: null };
    expect(() => normalizeExtraction(receipt([item()], [{ ...adj, appliesToItemIndexes: [99] }]))).toThrow();
    expect(() => normalizeExtraction(receipt([item()], [{ ...adj, dependsOnAdjustmentIndexes: [1] }]))).toThrow();
  });
});

describe("review state, legacy drafts and localization", () => {
  it.each(["unreadable", "not_printed"])("keeps %s quantity unresolved after generic review confirmation", quantityStatus => {
    const result = normalizeExtraction(receipt([item({ quantity: null, quantityStatus, unitPrice: null })]));
    const original = result.items[0];
    expect(needsQuantityReview(original)).toBe(true);
    expect(confirmReceiptItem(original)).toBe(original);
    original.reviewConfirmed = true;
    original.ambiguityReason = null;
    expect(reviewed(result).issues.some(i => i.code === "ITEM_QUANTITY_UNCONFIRMED")).toBe(true);
    original.quantityStatus = "confirmed";
    expect(reviewed(result).canFinalize).toBe(true);
  });

  it("does not trust a numeric placeholder when the model says unreadable", () => {
    const result = normalizeExtraction(receipt([item({ quantity: 1, quantityStatus: "unreadable" })]));
    expect(needsQuantityReview(result.items[0])).toBe(true);
  });

  it("refuses arithmetic recovery while quantity remains unknown", () => {
    const result = normalizeExtraction(receipt([item({ quantity: null, unitPrice: 17000, lineAmount: null })]));
    result.items[0].ambiguityReason = null;
    expect(proposeLineAmountRecovery({ ...result, confirmedGrandTotal: 17000 })).toBeNull();
  });

  it("localizes legacy English warnings and never confirms an empty amount", () => {
    const legacy: BillItem = { id: "i", allocationOrder: 0, name: "Milk Tea", quantity: 1, unitPrice: 12000,
      lineAmount: null, reviewConfirmed: false, ambiguityReason: "The line amount is not explicitly stated." };
    expect(receiptItemFeedback(legacy)).toEqual([{ code: "AMOUNT", message: "Harga belum terbaca. Isi total harga sesuai struk." }]);
    expect(confirmReceiptItem(legacy)).toBe(legacy);
    expect(receiptWarningMessages(["The line amount is missing.", "Some other English text.", "toString"])).toEqual([
      "Ada bagian yang perlu dicek. Cocokkan rincian dengan foto struk.",
    ]);
  });

  it("shows one localized mismatch and accepts the exact payable total in one action", () => {
    const result = normalizeExtraction(receipt([item({ ambiguityReason: "The price does not match." })]));
    expect(receiptItemFeedback(result.items[0]).map(f => f.code)).toEqual(["MISMATCH"]);
    const confirmed = confirmReceiptItem(result.items[0]);
    expect(confirmed.unitMismatchConfirmed).toBe(true);
    expect(receiptItemFeedback(confirmed)).toEqual([]);
  });

  it.each([1, 2, 3])("allows choosing the printed original unit price for %s units without changing the receipt grand total", quantity => {
    const result = normalizeExtraction(receipt([item({ quantity, lineAmount: 17000 * quantity })], [],
      { printedSubtotal: 17000 * quantity, printedGrandTotal: 17000 * quantity }));
    const original = result.items[0];
    const changed = applyReceiptUnitPrice(original);
    expect(changed).toMatchObject({ unitPrice: 12000, quantity, lineAmount: 12000 * quantity, lineAmountSource: "derived",
      reviewConfirmed: true, unitMismatchConfirmed: false, ambiguityReason: null });
    expect(receiptItemFeedback(changed)).toEqual([]);
    expect(original.lineAmount).toBe(17000 * quantity);
    expect(reviewed({ ...result, items: [changed] }).computedGrandTotal).toBe(12000 * quantity);
    expect(reviewed({ ...result, items: [changed] }).canFinalize).toBe(false);
    const payload = { currency: "IDR" as const, adjustments: [], confirmedGrandTotal: result.printedGrandTotal };
    expect(computeFinancialInputHash({ ...payload, items: [changed] })).not.toBe(computeFinancialInputHash({ ...payload, items: [original] }));
  });

  it.each([
    { quantityStatus: "unreadable" as const }, { quantityStatus: "not_printed" as const },
    { quantity: 0 }, { quantity: 1.5 }, { quantity: 10001 }, { unitPrice: null },
    { unitPrice: -1 }, { unitPrice: MAX_IDR_AMOUNT, quantity: 2 },
  ])("does not offer an original price calculated from unsafe values: %j", extra => {
    const original: BillItem = { id: "i", name: "Milk Tea", allocationOrder: 0, quantity: 1, unitPrice: 12000,
      lineAmount: 17000, reviewConfirmed: false, ...extra };
    expect(unitPriceLineAmount(original)).toBeNull();
    expect(applyReceiptUnitPrice(original)).toBe(original);
  });

  it("preserves a legitimate zero unit price and clears a previous mismatch confirmation", () => {
    const original: BillItem = { id: "i", name: "Promo", allocationOrder: 0, quantity: 2, unitPrice: 0,
      lineAmount: 17000, reviewConfirmed: true, unitMismatchConfirmed: true };
    expect(unitPriceLineAmount(original)).toBe(0);
    expect(applyReceiptUnitPrice(original)).toMatchObject({ lineAmount: 0, unitMismatchConfirmed: false, reviewConfirmed: true });
  });

  it("merges only after host choice, retaining the parent amount and invalidating scope", () => {
    const extracted = normalizeExtraction(receipt([item(), topping({ priceRelation: "unknown" })]));
    const bill = { items: extracted.items, allocations: [], adjustments: [{ eligibleItemIds: ["ocr-item-2"], scopeConfirmed: true }] } as unknown as BillDocument;
    const merged = mergeReceiptItem(bill, "ocr-item-2", "ocr-item-1");
    expect(merged.items).toHaveLength(1);
    expect(merged.items[0]).toMatchObject({ lineAmount: 17000, unitPrice: null, baseUnitPrice: 12000,
      includedModifiers: ["Toping Boba Minum"] });
    expect(merged.adjustments[0]).toMatchObject({ eligibleItemIds: ["ocr-item-1"], scopeConfirmed: false });
    expect(bill.items).toHaveLength(2);
    bill.allocations = [{ itemId: "ocr-item-2", mode: "units", unitCounts: { p: 1 } }];
    expect(mergeReceiptItem(bill, "ocr-item-2", "ocr-item-1")).toBe(bill);
  });

  it("invalidates the review hash when quantity status changes", () => {
    const result = normalizeExtraction(receipt([item()]));
    const payload = { currency: "IDR" as const, items: result.items, adjustments: [], confirmedGrandTotal: 17000 };
    expect(computeFinancialInputHash(payload)).not.toBe(computeFinancialInputHash({ ...payload,
      items: payload.items.map(i => ({ ...i, quantityStatus: "unreadable" })) }));
  });

  it("rejects server review confirmation while quantity is unresolved", async () => {
    const ownerUid = "dev-uid-host-patungin-local";
    const bill = await createDraftBill({ ownerUid, ownerVerifiedEmail: "host@patungin.local" });
    const result = normalizeExtraction(receipt([item({ quantity: null })]));
    await expect(saveBillDraft(bill.id, ownerUid, { expectedRevision: bill.revision, items: result.items.map(i => ({ ...i, reviewConfirmed: true, ambiguityReason: null })),
      confirmedGrandTotal: 17000, markReviewConfirmed: true })).rejects.toMatchObject({ code: "INCOMPLETE_REVIEW" });
  });

  it("preserves the observed total through later host corrections", async () => {
    vi.stubEnv("GEMINI_SCAN_ENABLED", "true");
    const ownerUid = "dev-uid-host-patungin-local";
    const bill = await createDraftBill({ ownerUid, ownerVerifiedEmail: "host@patungin.local" });
    const { attempt } = await reserveScanAttempt({ ownerUid, billId: bill.id, expectedRevision: bill.revision,
      idempotencyKey: "ocr-v4-original-total", imageHash: "synthetic", model: "test", promptVersion: "v4" });
    await completeScanAttempt({ attemptId: attempt.id, state: "succeeded", extractedData: normalizeExtraction(receipt([item(), topping()])), applyToBillIfRevisionMatches: true });
    const scanned = await getBillForOwner(bill.id, ownerUid);
    const changed = await saveBillDraft(bill.id, ownerUid, { expectedRevision: scanned.revision, confirmedGrandTotal: 18000 });
    expect(changed.observedGrandTotal).toBe(17000);
    expect(changed.confirmedGrandTotal).toBe(18000);
  });
});

describe("provider result completeness", () => {
  it("rejects a valid JSON fragment if provider reports token truncation", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-only"); vi.stubEnv("GEMINI_MODEL", "test-only-model");
    generateContent.mockResolvedValue({ text: JSON.stringify(receipt([item()])), candidates: [{ finishReason: "MAX_TOKENS" }] });
    await expect(extractReceiptWithGemini({ imageBuffer: Buffer.from([255, 216, 255]), mimeType: "image/jpeg" })).rejects.toMatchObject({ code: "INVALID_EXTRACTION" });
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it("uses schema-supported fields, default sampling and a single provider call", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-only"); vi.stubEnv("GEMINI_MODEL", "test-only-model");
    generateContent.mockResolvedValue({ text: JSON.stringify(receipt([item(), topping()])), candidates: [{ finishReason: "STOP" }] });
    const result = await extractReceiptWithGemini({ imageBuffer: Buffer.from([255, 216, 255]), mimeType: "image/jpeg" });
    expect(result.items).toHaveLength(1);
    const request = generateContent.mock.calls[0][0];
    expect(request.config).not.toHaveProperty("temperature");
    expect(request.config.responseSchema.properties.items.items.required).toContain("parentItemIndex");
    expect(generateContent).toHaveBeenCalledTimes(1);
    const preview = calculateBillForReview({ currency: "IDR", items: result.items, adjustments: [], confirmedGrandTotal: 17000,
      participants: [], payerParticipantId: null, allocations: [] });
    expect(preview.computedGrandTotal).toBe(17000);
  });
});
