import { describe, expect, it } from "vitest";
import { editablePaymentMethod, normalizePaymentNote, normalizePaymentMethods } from "../src/domain/billing/payment";
import { buildDetailedParticipantShares, calculateBill, formatSummaryText } from "../src/domain/billing/calculation";
import { GOLDEN_FIXTURES } from "../src/domain/billing/fixtures";
import type { BillCalculationInput, PaymentMethodNote } from "../src/domain/billing/types";
import { createDraftBill, finalizeBillOnServer, publishBillShareLink, resolvePublicShareToken, saveBillDraft } from "../src/server/store/repository";

function summary(paymentNote: PaymentMethodNote) {
  const input = GOLDEN_FIXTURES[0].input;
  const result = calculateBill(input);
  return formatSummaryText({
    title: "Makan bareng",
    grandTotal: result.computedGrandTotal,
    payerName: "Ayu",
    participants: buildDetailedParticipantShares(input, result),
    paymentNote,
  });
}

describe("Manual transfer and QRIS instructions", () => {
  it("recognizes banks and e-wallets in older bills", () => {
    expect(editablePaymentMethod({ bankOrWalletName: "BCA" }).method).toBe("bank");
    expect(editablePaymentMethod({ method: "transfer", bankOrWalletName: "GoPay" }).method).toBe("ewallet");
    expect(editablePaymentMethod({ method: "bank", bankOrWalletName: "GoPay" }).method).toBe("bank");
  });
  const multiple: PaymentMethodNote[] = [
    { method: "bank", bankOrWalletName: "BCA", accountNumber: "0012345678", accountHolderName: "Ayu" },
    { method: "ewallet", bankOrWalletName: "GoPay", accountNumber: "08123456789", accountHolderName: "Ayu" },
    { method: "qris", note: "Minta QR lewat chat" },
  ];

  it("distinguishes multiple payment choices in shared summaries", () => {
    const input = GOLDEN_FIXTURES[0].input;
    const result = calculateBill(input);
    const text = formatSummaryText({ title: "Makan", grandTotal: result.computedGrandTotal, payerName: "Ayu",
      participants: buildDetailedParticipantShares(input, result), paymentMethods: multiple });
    expect(text).toContain("Bisa bayar ke aku lewat salah satu ini");
    expect(text).toContain("Rekening bank: *BCA · 0012345678 · a.n. Ayu*");
    expect(text).toContain("E-wallet: *GoPay · 08123456789 · a.n. Ayu*");
    expect(text).toContain("Bayar lewat *QRIS*");
    expect(text).not.toContain("Ayu*,");
  });

  it("validates required account fields, array shape and count", () => {
    expect(() => normalizePaymentMethods([{ method: "bank" }])).toThrow(/Lengkapi nama bank/);
    expect(() => normalizePaymentMethods([{ method: "ewallet", bankOrWalletName: "GoPay" }])).toThrow(/nomor HP/);
    expect(() => normalizePaymentMethods({ method: "bank" })).toThrow(/maksimal/);
    expect(() => normalizePaymentMethods(Array.from({ length: 11 }, () => ({ method: "qris" })))).toThrow(/maksimal/);
    expect(normalizePaymentMethods([], multiple[0])).toEqual([]);
    expect(normalizePaymentMethods(undefined, { method: "qris" })).toEqual([{ method: "qris", note: "" }]);
    expect(normalizePaymentMethods([{ ...multiple[0], method: "qris" }])).toEqual([{ method: "qris", note: "" }]);
  });

  it("preserves all methods across save, finalization and publication", async () => {
    const ownerUid = "dev-uid-host-patungin-local";
    const draft = await createDraftBill({ ownerUid, ownerVerifiedEmail: "host@patungin.local", presetCode: "M-01" });
    const saved = await saveBillDraft(draft.id, ownerUid, { expectedRevision: draft.revision, paymentMethods: multiple, markReviewConfirmed: true });
    expect(saved.paymentMethods).toHaveLength(3);
    const finalized = await finalizeBillOnServer({ billId: draft.id, ownerUid, expectedRevision: saved.revision });
    expect(finalized.snapshot.paymentMethods).toEqual(saved.paymentMethods);
    const published = await publishBillShareLink({ billId: draft.id, ownerUid, expectedRevision: finalized.bill.revision });
    const projection = await resolvePublicShareToken(published.shareToken);
    expect(projection?.paymentMethods).toEqual(saved.paymentMethods);
    expect(projection?.grandTotal).toBe(115_500);
  });

  it("clears legacy payment details instead of restoring them when the last method is removed", async () => {
    const ownerUid = "dev-uid-host-patungin-local";
    const draft = await createDraftBill({ ownerUid, ownerVerifiedEmail: "host@patungin.local", presetCode: "M-01" });
    const legacy = await saveBillDraft(draft.id, ownerUid, { expectedRevision: draft.revision, paymentNote: multiple[0] });
    const cleared = await saveBillDraft(draft.id, ownerUid, { expectedRevision: legacy.revision, paymentMethods: [] });
    expect(cleared.paymentMethods).toEqual([]);
    expect(cleared.paymentNote).toBeUndefined();
    const savedAgain = await saveBillDraft(draft.id, ownerUid, { expectedRevision: cleared.revision, title: "Tanpa pembayaran" });
    expect(savedAgain.paymentMethods).toEqual([]);
  });

  it("starts manual bills with empty prices and no assigned orders", async () => {
    const draft = await createDraftBill({ ownerUid: "dev-uid-host-patungin-local", ownerVerifiedEmail: "host@patungin.local" });
    expect(draft.items[0].lineAmount).toBeNull();
    expect(draft.items[0].unitPrice).toBeNull();
    expect(draft.confirmedGrandTotal).toBeNull();
    expect(draft.allocations[0].unitCounts).toEqual({});
  });
  it("keeps existing transfer details and leading zeros without requiring a migration", () => {
    const payment = { bankOrWalletName: " BCA ", accountNumber: "0012345678", accountHolderName: " Ayu " };
    expect(normalizePaymentNote(payment)).toEqual({ method: "transfer", bankOrWalletName: "BCA", accountNumber: "0012345678", accountHolderName: "Ayu", note: "" });
    expect(summary(payment)).toContain("Transfer ke: *BCA · 0012345678 · a.n. Ayu*");
  });

  it("includes QRIS instructions without an account number or custom note", () => {
    const text = summary({ method: "qris" });
    expect(text).toContain("Bayar lewat *QRIS* ya.");
    expect(text).toContain("Kode QR-nya aku kirim di chat.");
    expect(text.match(/QRIS/g)).toHaveLength(1);
    expect(text).not.toContain("boleh transfer ke");
    expect(text).not.toContain("Versi hasil");
    expect(text).toContain("- Aku: *Rp69.300* (sudah dibayar)");
    expect(text).toContain("- Bima: *Rp46.200*");
    expect(text).not.toContain("Ayu");
    expect(text).not.toContain("Nasi");
    expect(text).not.toContain("Service");
  });

  it("does not leak stale bank details after switching to QRIS", () => {
    const payment = { method: "qris" as const, bankOrWalletName: "PRIVATE_BANK", accountNumber: "PRIVATE_ACCOUNT", accountHolderName: "PRIVATE_HOLDER", note: "Kabari kalau sudah bayar ya" };
    expect(normalizePaymentNote(payment)).toEqual({ method: "qris", note: payment.note });
    const text = summary(payment);
    expect(text).toContain(payment.note);
    expect(text).not.toMatch(/PRIVATE_BANK|PRIVATE_ACCOUNT|PRIVATE_HOLDER/);
  });

  it("supports clearing optional instructions and rejects malformed metadata", () => {
    expect(normalizePaymentNote(null)).toBeNull();
    expect(normalizePaymentNote({ method: "transfer" })).toBeNull();
    expect(() => normalizePaymentNote({ method: "automatic-payment" })).toThrow(/transfer atau QRIS/);
    expect(() => normalizePaymentNote({ accountNumber: 1234 })).toThrow(/tidak valid/);
    expect(() => normalizePaymentNote({ note: "x".repeat(301) })).toThrow(/terlalu panjang/);
  });

  it("persists QRIS through finalization/publication without changing the split amounts", async () => {
    const ownerUid = "dev-uid-host-patungin-local";
    const draft = await createDraftBill({ ownerUid, ownerVerifiedEmail: "host@patungin.local", presetCode: "M-01" });
    const saved = await saveBillDraft(draft.id, ownerUid, {
      expectedRevision: draft.revision,
      paymentNote: { method: "qris", accountNumber: "DO_NOT_PUBLISH", note: "QR dikirim lewat chat" },
      markReviewConfirmed: true,
    });
    expect(saved.paymentMethods).toEqual([{ method: "qris", note: "QR dikirim lewat chat" }]);
    const finalized = await finalizeBillOnServer({ billId: draft.id, ownerUid, expectedRevision: saved.revision });
    expect(finalized.snapshot.calculationResult.computedGrandTotal).toBe(115_500);
    const published = await publishBillShareLink({ billId: draft.id, ownerUid, expectedRevision: finalized.bill.revision });
    const projection = await resolvePublicShareToken(published.shareToken);
    expect(projection?.paymentMethods).toEqual(saved.paymentMethods);
    expect(JSON.stringify(projection)).not.toContain("DO_NOT_PUBLISH");
    expect(projection?.grandTotal).toBe(115_500);
  });

  it("rejects an unsupported payment method at the server save boundary", async () => {
    const ownerUid = "dev-uid-host-patungin-local";
    const draft = await createDraftBill({ ownerUid, ownerVerifiedEmail: "host@patungin.local" });
    await expect(saveBillDraft(draft.id, ownerUid, {
      expectedRevision: draft.revision,
      paymentNote: { method: "unknown" } as unknown as PaymentMethodNote,
    })).rejects.toMatchObject({ statusCode: 422, code: "INVALID_PAYMENT_NOTE" });
  });
});

describe("WhatsApp summary detail levels and payer phrasing", () => {
  const sampleInput = (payerParticipantId: string): BillCalculationInput => ({
    currency: "IDR",
    participants: [
      { id: "p-host-1", allocationOrder: 0, name: "Ayu" },
      { id: "p-2", allocationOrder: 1, name: "Bima" },
      { id: "p-3", allocationOrder: 2, name: "Dina" },
    ],
    payerParticipantId,
    items: [
      {
        id: "item-1",
        allocationOrder: 0,
        name: "Bakmi Ayam",
        quantity: 2,
        lineAmount: 50_000,
        reviewConfirmed: true,
      },
      {
        id: "item-2",
        allocationOrder: 1,
        name: "Kentang Goreng",
        quantity: 1,
        lineAmount: 20_000,
        reviewConfirmed: true,
      },
    ],
    allocations: [
      { itemId: "item-1", mode: "units", unitCounts: { "p-host-1": 1, "p-2": 1 } },
      { itemId: "item-2", mode: "shared", participantIds: ["p-host-1", "p-2"] },
    ],
    adjustments: [
      {
        id: "adj-disc",
        allocationOrder: 0,
        name: "Diskon promo",
        kind: "bill-discount",
        amount: 7_000,
        amountSource: "observed",
        mode: "added",
        basis: "gross",
        eligibleItemIds: ["item-1", "item-2"],
        scopeConfirmed: true,
        reviewConfirmed: true,
      },
      {
        id: "adj-svc",
        allocationOrder: 1,
        name: "Biaya layanan 5%",
        kind: "service",
        amount: 3_500,
        amountSource: "observed",
        mode: "added",
        basis: "gross",
        eligibleItemIds: ["item-1", "item-2"],
        scopeConfirmed: true,
        reviewConfirmed: true,
      },
      {
        id: "adj-tax",
        allocationOrder: 2,
        name: "Pajak 10%",
        kind: "tax",
        amount: 6_045,
        amountSource: "observed",
        mode: "included",
        basis: "net",
        eligibleItemIds: ["item-1", "item-2"],
        scopeConfirmed: true,
        reviewConfirmed: true,
      },
    ],
    confirmedGrandTotal: 66_500,
  });

  it("formats itemized WhatsApp text with units, shared splits, adjustments, Rp0 handling, and share URL", () => {
    const input = sampleInput("p-host-1");
    const result = calculateBill(input);
    const participants = buildDetailedParticipantShares(input, result);
    const text = formatSummaryText({
      title: "Makan Siang Kantor",
      grandTotal: result.computedGrandTotal,
      payerName: "Ayu",
      payerIsHost: true,
      detailLevel: "itemized",
      participants,
      paymentMethods: [
        { method: "bank", bankOrWalletName: "BCA", accountNumber: "1234567890", accountHolderName: "Ayu" },
      ],
      shareUrl: "https://patungin.app/s/abc123",
    });

    expect(text).toContain("*Makan Siang Kantor*");
    expect(text).toContain("Total *Rp66.500*, sudah aku bayar dulu ya.");
    expect(text).toContain("- Aku: *Rp33.250* (sudah dibayar)");
    expect(text).toContain("- Bima: *Rp33.250*");
    expect(text).toContain("  · 1x Bakmi Ayam: Rp25.000");
    expect(text).toContain("  · Kentang Goreng (bagi 2 orang): Rp10.000");
    expect(text).toContain("  · Diskon promo: -Rp3.500");
    expect(text).toContain("  · Biaya layanan 5%: +Rp1.750");
    expect(text).toMatch(/· Pajak 10%: Rp3\.02[23] \(sudah termasuk\)/);
    expect(text).toContain("- Dina: *Rp0* (tidak perlu bayar)\n\nRekening bank: *BCA · 1234567890 · a.n. Ayu*");
    expect(text).toContain("Rincian: https://patungin.app/s/abc123");
  });

  it("uses the payer name instead of Aku when payerIsHost is false across summary and itemized modes", () => {
    const input = sampleInput("p-2");
    const result = calculateBill(input);
    const participants = buildDetailedParticipantShares(input, result);

    const summaryOnly = formatSummaryText({
      title: "Patungan makan",
      merchant: "Bakmi GM",
      grandTotal: result.computedGrandTotal,
      payerName: "Bima",
      payerIsHost: false,
      detailLevel: "summary",
      participants,
      paymentMethods: [],
    });

    expect(summaryOnly).toContain("*Bakmi GM*");
    expect(summaryOnly).toContain("Total *Rp66.500*, sudah dibayar dulu sama *Bima* ya.");
    expect(summaryOnly).toContain("- Ayu: *Rp33.250*");
    expect(summaryOnly).toContain("- Bima: *Rp33.250* (sudah dibayar)");
    expect(summaryOnly).toContain("Bisa transfer ke *Bima* ya.");
    expect(summaryOnly.toLowerCase()).not.toMatch(/\baku\b/);

    const itemizedMulti = formatSummaryText({
      title: "Bakmi GM",
      grandTotal: result.computedGrandTotal,
      payerName: "Bima",
      payerIsHost: false,
      detailLevel: "itemized",
      participants,
      paymentMethods: [
        { method: "qris" },
        {
          method: "ewallet",
          bankOrWalletName: "GoPay",
          accountNumber: "08123456789",
          accountHolderName: "Bima",
        },
      ],
    });

    expect(itemizedMulti).toContain("Bisa bayar ke *Bima* lewat salah satu ini:");
    expect(itemizedMulti).toContain("Bayar lewat *QRIS* ya. Kode QR-nya minta di chat ke *Bima* ya.");
    expect(itemizedMulti).toContain("E-wallet: *GoPay · 08123456789 · a.n. Bima*");
    expect(itemizedMulti.toLowerCase()).not.toMatch(/\baku\b/);
  });
});
