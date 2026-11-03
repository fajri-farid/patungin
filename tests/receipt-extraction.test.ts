import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeExtraction } from "../src/server/scans/normalize-extraction";
import { calculateBill, calculateBillForReview } from "../src/domain/billing/calculation";
import { computeFinancialInputHash } from "../src/domain/billing/hash";
import { proposeLineAmountRecovery } from "../src/domain/billing/recovery";
import { extractReceiptWithGemini, PROMPT_VERSION } from "../src/server/scans/gemini";
import { completeScanAttempt, createDraftBill, getBillForOwner, reserveScanAttempt, saveBillDraft } from "../src/server/store/repository";

const { generateContent } = vi.hoisted(() => ({ generateContent: vi.fn() }));
vi.mock("@google/genai", async (importOriginal) => ({
  ...await importOriginal<typeof import("@google/genai")>(),
  GoogleGenAI: class { models = { generateContent }; },
}));

// Manually transcribed from the supplied customer-display photo; not live OCR.
function cashierPhoto() {
  return {
    sourceType: "cashier_screen", merchant: null, receiptDate: null,
    items: [
      { name: "CAH KANGKUNG", quantity: 2, unitPrice: 7000, lineAmount: 14000 },
      { name: "AYAM BAKAR RICA", quantity: 2, unitPrice: 12000, lineAmount: 24000 },
      { name: "AYAM BAKAR COBE", quantity: 1, unitPrice: 11000, lineAmount: 11000 },
      { name: "NASI PUTIH", quantity: 5, unitPrice: 5000, lineAmount: 25000 },
      { name: "MIE GRG SEAFOOD", quantity: 1, unitPrice: 18000, lineAmount: 18000 },
      { name: "BOLU BAKAR COBE", quantity: 1, unitPrice: 11000, lineAmount: 11000 },
      { name: "AIR MINERAL", quantity: 3, unitPrice: 5000, lineAmount: 15000 },
    ],
    adjustments: [{ name: "PPN", kind: "tax", amount: 11800, rateBps: null, mode: "added" }],
    printedSubtotal: 118000, displayedQuantity: 15, printedGrandTotal: 129800, warnings: [] as string[],
  };
}

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe("Cashier screens and transaction image extraction", () => {
  it("rejects review confirmation on the server when a line amount is still missing", async () => {
    const ownerUid = "dev-uid-host-patungin-local";
    const bill = await createDraftBill({ ownerUid, ownerVerifiedEmail: "host@patungin.local" });
    await expect(saveBillDraft(bill.id, ownerUid, { expectedRevision: bill.revision,
      items: bill.items.map((i) => ({ ...i, lineAmount: null, reviewConfirmed: true })), markReviewConfirmed: true })).rejects.toMatchObject({ code: "INCOMPLETE_REVIEW", statusCode: 422 });
    expect((await getBillForOwner(bill.id, ownerUid)).revision).toBe(bill.revision);
  });
  it("recovers the real missing-field response only when observed totals reconcile, without auto-confirming", () => {
    const raw = cashierPhoto();
    raw.items.forEach((i) => Reflect.deleteProperty(i, "lineAmount"));
    const extracted = normalizeExtraction(raw);
    expect(extracted.items.map((i) => i.lineAmount)).toEqual([14000, 24000, 11000, 25000, 18000, 11000, 15000]);
    expect(extracted.items.every((i) => i.lineAmountSource === "derived" && !i.reviewConfirmed)).toBe(true);
    expect(extracted.items.every((i) => i.ambiguityReason?.includes("bukan dibaca langsung"))).toBe(true);
    expect(extracted.warnings.join(" ")).toContain("7 total baris");
  });

  it("does not auto-fill an explicitly unreadable amount or hide a conflicting subtotal", () => {
    const raw = cashierPhoto();
    Object.assign(raw.items[0], { lineAmount: null });
    expect(normalizeExtraction(raw).items[0].lineAmount).toBeNull();
    raw.items.forEach((i) => Reflect.deleteProperty(i, "lineAmount"));
    raw.printedSubtotal = 100000;
    const extracted = normalizeExtraction(raw);
    expect(extracted.items.every((i) => i.lineAmount === null)).toBe(true);
    expect(proposeLineAmountRecovery({ ...extracted, confirmedGrandTotal: extracted.printedGrandTotal })).toBeNull();
  });

  it("offers a safe proposal for already-saved drafts with null row amounts, keeping observed totals intact", () => {
    const extracted = normalizeExtraction(cashierPhoto());
    const items = extracted.items.map((i) => ({ ...i, lineAmount: null }));
    const proposal = proposeLineAmountRecovery({ items, adjustments: extracted.adjustments, confirmedGrandTotal: 129800 });
    expect(proposal).toMatchObject({ recoveredCount: 7, subtotal: 118000, grandTotal: 129800 });
    expect(items.every((i) => i.lineAmount === null)).toBe(true);
    expect(proposal!.items.every((i) => !i.reviewConfirmed)).toBe(true);
    expect(proposeLineAmountRecovery({ items, adjustments: extracted.adjustments, confirmedGrandTotal: 129801 })).toBeNull();
    items[0].ambiguityReason = "Jumlah belum terbaca. Angka 1 hanya isian sementara";
    expect(proposeLineAmountRecovery({ items, adjustments: extracted.adjustments, confirmedGrandTotal: 129800 })).toBeNull();
  });

  it("does not mask a genuine free item or derive from missing tax amounts", () => {
    const extracted = normalizeExtraction(cashierPhoto());
    const items = extracted.items.map((i) => ({ ...i, lineAmount: null }));
    const missingTax = extracted.adjustments.map((a) => ({ ...a, amount: null }));
    expect(proposeLineAmountRecovery({ items, adjustments: missingTax, confirmedGrandTotal: 129800 })).toBeNull();
    const withFreeItem = items.map((i, index) => index === 0 ? { ...i, lineAmount: 0 } : i);
    expect(proposeLineAmountRecovery({ items: withFreeItem, adjustments: extracted.adjustments, confirmedGrandTotal: 115800 })!.items[0].lineAmount).toBe(0);
  });
  it("persists screen classification and scan warnings so review still shows them after reloading", async () => {
    vi.stubEnv("GEMINI_SCAN_ENABLED", "true");
    const ownerUid = "dev-uid-host-patungin-local";
    const bill = await createDraftBill({ ownerUid, ownerVerifiedEmail: "host@patungin.local" });
    const raw = cashierPhoto();
    raw.items.pop();
    const extracted = normalizeExtraction(raw);
    const { attempt } = await reserveScanAttempt({ ownerUid, billId: bill.id, expectedRevision: bill.revision,
      idempotencyKey: "cashier-screen", imageHash: "test-only", model: "test-only", promptVersion: PROMPT_VERSION });
    const completion = await completeScanAttempt({ attemptId: attempt.id, state: "succeeded", extractedData: extracted, applyToBillIfRevisionMatches: true });
    expect(completion.appliedToBill).toBe(true);
    const stored = await getBillForOwner(bill.id, ownerUid);
    expect(stored.receiptSourceType).toBe("cashier_screen");
    expect(stored.extractionWarnings).toEqual(extracted.warnings);
    expect(stored.confirmedInputHash).toBeNull();
    expect(stored.items.every((i) => !i.reviewConfirmed)).toBe(true);
    expect(stored.allocations.every(allocation => Object.keys(allocation.unitCounts ?? {}).length === 0)).toBe(true);
  });
  it("preserves seven rows / fifteen units and calculates observed PPN exactly once after host review", () => {
    const extracted = normalizeExtraction(cashierPhoto());
    expect(extracted.items).toHaveLength(7);
    expect(extracted.items.reduce((sum, i) => sum + i.quantity, 0)).toBe(15);
    expect(extracted.merchant).toBeNull();
    expect(extracted.receiptDate).toBeNull();
    expect(extracted.items[5].name).toBe("BOLU BAKAR COBE");
    expect(extracted.adjustments[0]).toMatchObject({ amount: 11800, amountSource: "observed", rateBps: null, scopeConfirmed: false });
    expect(extracted.warnings).toEqual([]);
    const input = {
      currency: "IDR" as const, items: extracted.items.map((i) => ({ ...i, reviewConfirmed: true })),
      adjustments: extracted.adjustments.map((a) => ({ ...a, scopeConfirmed: true, reviewConfirmed: true })),
      participants: [{ id: "a", name: "Aku", allocationOrder: 0 }, { id: "b", name: "Teman", allocationOrder: 1 }],
      payerParticipantId: "a", allocations: extracted.items.map((i) => ({ itemId: i.id, mode: "shared" as const, participantIds: ["a", "b"] })),
      confirmedGrandTotal: extracted.printedGrandTotal,
    };
    const result = calculateBill({ ...input, confirmedInputHash: computeFinancialInputHash(input) });
    expect(result.canFinalize).toBe(true);
    expect(result.computedItemsSubtotal).toBe(118000);
    expect(result.computedGrandTotal).toBe(129800);
    expect(result.participantBreakdowns.map((p) => p.taxAddedTotal)).toEqual([5900, 5900]);
    expect(result.participantBreakdowns.map((p) => p.consumptionTotal)).toEqual([64900, 64900]);
  });

  it("shows the observed tax and correct receipt total before orders are allocated", () => {
    const extracted = normalizeExtraction(cashierPhoto());
    const input = {
      currency: "IDR" as const, items: extracted.items, adjustments: extracted.adjustments,
      participants: [{ id: "payer", name: "Pembayar", allocationOrder: 0 }],
      payerParticipantId: "payer", allocations: [], confirmedGrandTotal: extracted.printedGrandTotal,
    };
    const review = calculateBillForReview(input);
    expect(review.computedItemsSubtotal).toBe(118_000);
    expect(review.computedAddedChargesTotal).toBe(11_800);
    expect(review.computedGrandTotal).toBe(129_800);
    expect(review.grandTotalDifference).toBe(0);
    expect(input.allocations).toEqual([]);
    expect(calculateBill(input).canFinalize).toBe(false);
  });

  it("warns for a cropped/scrolled table without inventing missing rows or balancing amounts", () => {
    const raw = cashierPhoto();
    raw.items.pop();
    const result = normalizeExtraction(raw);
    expect(result.warnings.join(" ")).toMatch(/subtotal.*Qty/s);
    expect(result.items).toHaveLength(6);
    expect(result.printedGrandTotal).toBe(129800);
    expect(result.adjustments).toHaveLength(1);
  });

  it("keeps unreadable quantity explicit and invalid money null instead of rounding or silently choosing values", () => {
    const raw = cashierPhoto();
    Object.assign(raw.items[0], { quantity: null, unitPrice: 7000.5, lineAmount: null });
    const result = normalizeExtraction(raw);
    expect(result.items[0]).toMatchObject({ quantity: 1, unitPrice: null, lineAmount: null, reviewConfirmed: false });
    expect(result.items[0].ambiguityReason).toContain("isian sementara");
    expect(result.warnings.join(" ")).toContain("Harga satuan");
  });

  it("preserves zero amounts, inclusive taxes and existing discount subtotal semantics", () => {
    const raw = cashierPhoto();
    raw.adjustments.push({ name: "Diskon", kind: "bill-discount", amount: 1000, rateBps: null, mode: "added" });
    raw.printedSubtotal = 117000;
    raw.items[0].lineAmount = 0;
    raw.items[0].unitPrice = 0;
    raw.printedSubtotal -= 14000;
    raw.adjustments[0].mode = "included";
    const result = normalizeExtraction(raw);
    expect(result.warnings).toEqual([]);
    expect(result.items[0].lineAmount).toBe(0);
    expect(result.adjustments[0].mode).toBe("included");
  });

  it.each([null, {}, { ...cashierPhoto(), sourceType: "unsupported", items: [] }, { ...cashierPhoto(), items: [] },
    { ...cashierPhoto(), adjustments: [{ kind: "unknown", mode: "added" }] },
    { ...cashierPhoto(), items: Array(101).fill(cashierPhoto().items[0]) }])("rejects unsupported or malformed output without silently truncating", (raw) => {
    expect(() => normalizeExtraction(raw)).toThrow();
  });

  it.each(["printed_receipt", "transaction_screenshot", "other_transaction"])("accepts %s through the same normalization", (sourceType) => {
    expect(normalizeExtraction({ ...cashierPhoto(), sourceType }).sourceType).toBe(sourceType);
  });

  it("sends screen-aware structured instructions and normalizes the SDK output with one call", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-only");
    vi.stubEnv("GEMINI_MODEL", "test-only-model");
    generateContent.mockResolvedValue({ text: JSON.stringify(cashierPhoto()) });
    const result = await extractReceiptWithGemini({ imageBuffer: Buffer.from([255, 216, 255]), mimeType: "image/jpeg" });
    expect(result.sourceType).toBe("cashier_screen");
    expect(result.printedGrandTotal).toBe(129800);
    expect(generateContent).toHaveBeenCalledTimes(1);
    const request = generateContent.mock.calls[0][0];
    expect(request.config.systemInstruction).toContain("layar kasir/POS");
    expect(request.config.systemInstruction).toContain("Jangan menambahkan pajak dua kali");
    expect(request.config.responseSchema.properties.sourceType.enum).toContain("cashier_screen");
    expect(request.config.responseSchema.properties.items.items.required).toContain("lineAmount");
    expect(PROMPT_VERSION).toBe("patungin_transaction_image_v3");
  });

  it("returns an actionable validation error for truncated provider JSON", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-only");
    vi.stubEnv("GEMINI_MODEL", "test-only-model");
    generateContent.mockResolvedValue({ text: '{"items":[' });
    await expect(extractReceiptWithGemini({ imageBuffer: Buffer.from([255, 216, 255]), mimeType: "image/jpeg" })).rejects.toMatchObject({ statusCode: 422, code: "INVALID_EXTRACTION" });
  });
  it.each([[429, "PROVIDER_RATE_LIMIT"], [401, "PROVIDER_AUTH_ERROR"], [403, "PROVIDER_AUTH_ERROR"], [404, "PROVIDER_MODEL_NOT_FOUND"], [503, "PROVIDER_UNAVAILABLE"]])("classifies structured provider status %s without exposing its raw message", async (status, code) => {
    vi.stubEnv("GEMINI_API_KEY", "test-only");
    vi.stubEnv("GEMINI_MODEL", "test-only-model");
    generateContent.mockRejectedValue(Object.assign(new Error("PRIVATE_KEY_IN_ERROR"), { status }));
    const error = await extractReceiptWithGemini({ imageBuffer: Buffer.from([255, 216, 255]), mimeType: "image/jpeg" }).catch(error => error);
    expect(error.code).toBe(code);
    expect(error.message).not.toContain("PRIVATE_KEY_IN_ERROR");
  });
  it("records the specific missing-prices validation without copying receipt text", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-only");
    vi.stubEnv("GEMINI_MODEL", "test-only-model");
    const raw = { ...cashierPhoto(), items: cashierPhoto().items.map(item => ({ ...item, name: "PRIVATE_RECEIPT_NAME", lineAmount: null, unitPrice: null })) };
    generateContent.mockResolvedValue({ text: JSON.stringify(raw) });
    const error = await extractReceiptWithGemini({ imageBuffer: Buffer.from([255, 216, 255]), mimeType: "image/jpeg" }).catch(error => error);
    expect(error.code).toBe("EXTRACTION_PRICES_MISSING");
    expect(error.message).not.toContain("PRIVATE_RECEIPT_NAME");
  });

});
