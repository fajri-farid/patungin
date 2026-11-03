import { describe, expect, it } from "vitest";
import { buildReceiptDetails, calculateBill, calculateBillForReview } from "../src/domain/billing/calculation";
import { GOLDEN_FIXTURES } from "../src/domain/billing/fixtures";
import { computeFinancialInputHash } from "../src/domain/billing/hash";
import { allocateLargestRemainder } from "../src/domain/billing/money";
import type { BillCalculationInput } from "../src/domain/billing/types";
import {
  buildParticipantVisualMap,
  getParticipantChipStyle,
} from "../src/lib/palette";

function confirmInput(
  input: Omit<BillCalculationInput, "confirmedInputHash">
): BillCalculationInput {
  return {
    ...input,
    confirmedInputHash: computeFinancialInputHash({
      currency: input.currency,
      confirmedGrandTotal: input.confirmedGrandTotal,
      items: input.items,
      adjustments: input.adjustments,
    }),
  };
}

describe("Mesin Hitung Patungin — Golden Fixtures (M-01 s/d M-08)", () => {
  it.each(GOLDEN_FIXTURES)("calculates the same receipt totals before allocation for $code", ({ input }) => {
    const allocated = calculateBill(input);
    const receipt = buildReceiptDetails(input, allocated);
    expect(receipt.subtotal + receipt.adjustments.filter(adjustment => adjustment.mode !== "included").reduce((sum, adjustment) => sum + adjustment.signedAmount, 0)).toBe(allocated.computedGrandTotal);
    const review = calculateBillForReview({ ...input, allocations: [] });
    expect(review.computedItemsSubtotal).toBe(allocated.computedItemsSubtotal);
    expect(review.computedDiscountsTotal).toBe(allocated.computedDiscountsTotal);
    expect(review.computedAddedChargesTotal).toBe(allocated.computedAddedChargesTotal);
    expect(review.computedRoundingSignedTotal).toBe(allocated.computedRoundingSignedTotal);
    expect(review.computedGrandTotal).toBe(allocated.computedGrandTotal);
  });
  it("M-01 / CALC-T02: Service lalu pajak atas item + service", () => {
    const preset = GOLDEN_FIXTURES.find((f) => f.code === "M-01")!;
    const res = calculateBill(preset.input);

    expect(res.canFinalize).toBe(true);
    expect(res.computedGrandTotal).toBe(115_500);

    const ayu = res.participantBreakdowns.find((p) => p.participantId === "p-ayu")!;
    const bima = res.participantBreakdowns.find((p) => p.participantId === "p-bima")!;

    expect(ayu.itemsNetTotal).toBe(60_000);
    expect(ayu.serviceTotal).toBe(3_000);
    expect(ayu.taxAddedTotal).toBe(6_300);
    expect(ayu.consumptionTotal).toBe(69_300);
    expect(ayu.transferToPayerAmount).toBe(0); // Pembayar tidak transfer ke diri sendiri

    expect(bima.itemsNetTotal).toBe(40_000);
    expect(bima.serviceTotal).toBe(2_000);
    expect(bima.taxAddedTotal).toBe(4_200);
    expect(bima.consumptionTotal).toBe(46_200);
    expect(bima.transferToPayerAmount).toBe(46_200);
    expect(res.totalReceivableByPayer).toBe(46_200);
  });

  it("M-02 / CALC-T03: Diskon sebelum service dan pajak", () => {
    const preset = GOLDEN_FIXTURES.find((f) => f.code === "M-02")!;
    const res = calculateBill(preset.input);

    expect(res.canFinalize).toBe(true);
    expect(res.computedGrandTotal).toBe(103_950);

    const ayu = res.participantBreakdowns.find((p) => p.participantId === "p-ayu")!;
    const bima = res.participantBreakdowns.find((p) => p.participantId === "p-bima")!;

    expect(ayu.discountsTotal).toBe(6_000);
    expect(ayu.itemsNetTotal).toBe(54_000);
    expect(ayu.serviceTotal).toBe(2_700);
    expect(ayu.taxAddedTotal).toBe(5_670);
    expect(ayu.consumptionTotal).toBe(62_370);

    expect(bima.discountsTotal).toBe(4_000);
    expect(bima.itemsNetTotal).toBe(36_000);
    expect(bima.serviceTotal).toBe(1_800);
    expect(bima.taxAddedTotal).toBe(3_780);
    expect(bima.consumptionTotal).toBe(41_580);
  });

  it("M-03 / CALC-T09: Shared item Rp10.000 dibagi 3 orang & tie-break stabil saat nama diubah", () => {
    const preset = GOLDEN_FIXTURES.find((f) => f.code === "M-03")!;
    const res = calculateBill(preset.input);

    expect(res.canFinalize).toBe(true);
    expect(res.computedGrandTotal).toBe(10_000);
    expect(res.participantBreakdowns.map((p) => p.consumptionTotal)).toEqual([
      3_334, 3_333, 3_333,
    ]);

    // Ubah urutan array & ganti nama peserta: tie-break tetap mengikuti allocationOrder
    const reorderedInput = confirmInput({
      ...preset.input,
      participants: [
        { id: "p-c", allocationOrder: 2, name: "Aaron" },
        { id: "p-a", allocationOrder: 0, name: "Zack" },
        { id: "p-b", allocationOrder: 1, name: "Bella" },
      ],
    });
    const resReordered = calculateBill(reorderedInput);
    const pA = resReordered.participantBreakdowns.find(
      (p) => p.participantId === "p-a"
    )!;
    const pB = resReordered.participantBreakdowns.find(
      (p) => p.participantId === "p-b"
    )!;
    const pC = resReordered.participantBreakdowns.find(
      (p) => p.participantId === "p-c"
    )!;
    expect([pA.consumptionTotal, pB.consumptionTotal, pC.consumptionTotal]).toEqual([
      3_334, 3_333, 3_333,
    ]);
  });

  it("M-04 / CALC-T04: Pajak parsial dengan service mempertahankan provenance item", () => {
    const preset = GOLDEN_FIXTURES.find((f) => f.code === "M-04")!;
    const res = calculateBill(preset.input);

    expect(res.canFinalize).toBe(true);
    expect(res.computedGrandTotal).toBe(109_200);

    const ayu = res.participantBreakdowns.find((p) => p.participantId === "p-a")!;
    const bima = res.participantBreakdowns.find((p) => p.participantId === "p-b")!;

    expect(ayu.serviceTotal).toBe(2_000);
    expect(ayu.taxAddedTotal).toBe(4_200);
    expect(ayu.consumptionTotal).toBe(46_200);

    expect(bima.serviceTotal).toBe(3_000);
    expect(bima.taxAddedTotal).toBe(0);
    expect(bima.consumptionTotal).toBe(63_000);
  });

  it("M-05 / CALC-T05: Pajak inclusive tidak menambah grand total", () => {
    const preset = GOLDEN_FIXTURES.find((f) => f.code === "M-05")!;
    const res = calculateBill(preset.input);

    expect(res.canFinalize).toBe(true);
    expect(res.computedGrandTotal).toBe(110_000);

    const ayu = res.participantBreakdowns.find((p) => p.participantId === "p-a")!;
    const bima = res.participantBreakdowns.find((p) => p.participantId === "p-b")!;

    expect(ayu.consumptionTotal).toBe(66_000);
    expect(ayu.taxIncludedInfoTotal).toBe(6_000);
    expect(bima.consumptionTotal).toBe(44_000);
    expect(bima.taxIncludedInfoTotal).toBe(4_000);
  });

  it("M-06 / CALC-T08: Pembagian per unit 2:1 tidak mengalikan lineAmount dengan quantity lagi", () => {
    const preset = GOLDEN_FIXTURES.find((f) => f.code === "M-06")!;
    const res = calculateBill(preset.input);

    expect(res.canFinalize).toBe(true);
    expect(res.computedGrandTotal).toBe(30_000);
    expect(res.participantBreakdowns.map((p) => p.consumptionTotal)).toEqual([
      20_000, 10_000,
    ]);
  });

  it("M-07 / CALC-T10: Penyesuaian pembulatan positif (+Rp1) dan negatif (-Rp1)", () => {
    const preset = GOLDEN_FIXTURES.find((f) => f.code === "M-07")!;
    const resPlus = calculateBill(preset.input);
    expect(resPlus.canFinalize).toBe(true);
    expect(resPlus.computedGrandTotal).toBe(10_001);
    expect(resPlus.participantBreakdowns.map((p) => p.consumptionTotal)).toEqual([
      6_002, 3_999,
    ]);

    // Uji pembulatan negatif -Rp1
    const minusInput = confirmInput({
      ...preset.input,
      confirmedGrandTotal: 9_999,
      adjustments: [
        {
          ...preset.input.adjustments[0],
          sign: "negative",
        },
      ],
    });
    const resMinus = calculateBill(minusInput);
    expect(resMinus.canFinalize).toBe(true);
    expect(resMinus.computedGrandTotal).toBe(9_999);
    expect(resMinus.participantBreakdowns.map((p) => p.consumptionTotal)).toEqual([
      6_000, 3_999,
    ]);
  });

  it("M-08 & CALC-T06..T16: Kasus invalid wajib ditolak dan tidak boleh canFinalize=true", () => {
    const base = GOLDEN_FIXTURES[0].input;

    // 1. Diskon Rp11.000 atas dasar Rp10.000
    const discountOverflow = calculateBill(
      confirmInput({
        ...base,
        items: [
          {
            id: "item-a",
            allocationOrder: 0,
            name: "Kopi",
            quantity: 1,
            lineAmount: 10_000,
            reviewConfirmed: true,
          },
        ],
        allocations: [{ itemId: "item-a", mode: "units", unitCounts: { "p-ayu": 1 } }],
        adjustments: [
          {
            id: "adj-d",
            allocationOrder: 0,
            name: "Diskon Berlebih",
            kind: "bill-discount",
            amount: 11_000,
            amountSource: "observed",
            mode: "added",
            basis: "net",
            eligibleItemIds: ["item-a"],
            scopeConfirmed: true,
            reviewConfirmed: true,
          },
        ],
        confirmedGrandTotal: 0,
      })
    );
    expect(discountOverflow.canFinalize).toBe(false);
    expect(
      discountOverflow.issues.some((i) => i.code === "DISCOUNT_EXCEEDS_BASE")
    ).toBe(true);

    // 2. Alokasi 4 unit untuk quantity 3
    const unitMismatch = calculateBill(
      confirmInput({
        ...base,
        items: [
          {
            id: "item-a",
            allocationOrder: 0,
            name: "Es Teh",
            quantity: 3,
            lineAmount: 30_000,
            reviewConfirmed: true,
          },
        ],
        allocations: [
          {
            itemId: "item-a",
            mode: "units",
            unitCounts: { "p-ayu": 2, "p-bima": 2 },
          },
        ],
        adjustments: [],
        confirmedGrandTotal: 30_000,
      })
    );
    expect(unitMismatch.canFinalize).toBe(false);
    expect(unitMismatch.issues.some((i) => i.code === "ITEM_UNITS_MISMATCH")).toBe(
      true
    );

    // 3. Revision review basi (stale hash)
    const staleHash = calculateBill({
      ...base,
      confirmedInputHash: "fin_v1_stale0000",
    });
    expect(staleHash.canFinalize).toBe(false);
    expect(staleHash.issues.some((i) => i.code === "REVIEW_HASH_STALE")).toBe(true);

    // 4. CALC-T07: 1 rupiah, 3 orang, 1 berbobot nol
    const shares = allocateLargestRemainder(1, [
      { id: "zero", allocationOrder: 0, weight: 0 },
      { id: "one", allocationOrder: 1, weight: 1 },
      { id: "two", allocationOrder: 2, weight: 1 },
    ]);
    expect(shares.zero).toBe(0);
    expect(shares.one).toBe(1);
    expect(shares.two).toBe(0);
  });
});

describe("Palet Chip Peserta >8 Orang & Inisial Unik", () => {
  it("Mendukung 25 peserta sekaligus dengan disambiguasi inisial dan tier warna otomatis", () => {
    const participants = Array.from({ length: 25 }, (_, idx) => ({
      id: `p-${idx + 1}`,
      allocationOrder: idx,
      name: idx % 5 === 0 ? "Ayu" : `Teman ${idx + 1}`,
    }));

    const visualMap = buildParticipantVisualMap(participants);
    expect(Object.keys(visualMap)).toHaveLength(25);

    // Pastikan peserta ke-1 (order 0), ke-9 (order 8), ke-17 (order 16), ke-25 (order 24) punya tier berbeda
    expect(getParticipantChipStyle(0).tier).toBe(0);
    expect(getParticipantChipStyle(8).tier).toBe(1);
    expect(getParticipantChipStyle(16).tier).toBe(2);
    expect(getParticipantChipStyle(24).tier).toBe(3);

    // Pastikan 5 peserta bernama "Ayu" mendapat inisial pembeda AY1..AY5 dan label #1..#5
    const ayuEntries = participants
      .filter((p) => p.name === "Ayu")
      .map((p) => visualMap[p.id]);
    expect(ayuEntries.map((e) => e.initials)).toEqual([
      "AY1",
      "AY2",
      "AY3",
      "AY4",
      "AY5",
    ]);
    expect(ayuEntries.map((e) => e.displayLabel)).toEqual([
      "Ayu #1",
      "Ayu #2",
      "Ayu #3",
      "Ayu #4",
      "Ayu #5",
    ]);
  });
});

