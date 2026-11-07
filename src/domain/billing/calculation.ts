/**
 * Mesin Hitung Deterministik & Rekonsiliasi Tagihan Patungin
 *
 * Mengimplementasikan seluruh kontrak di .agents/plan/03-calculation-spec.md:
 * - Konservasi uang hingga 1 rupiah terakhir memakai H(M, weights).
 * - Hierarki alokasi komponen: Komponen -> Item Eligible -> Peserta pada Item tersebut.
 * - Provenance per item dipertahankan agar pajak parsial di atas service tetap akurat (M-04).
 */

import { computeFinancialInputHash } from "./hash";
import { normalizePaymentMethods, paymentMethodLabel } from "./payment";
import {
  allocateLargestRemainder,
  computeAmountFromRateBps,
  computeIncludedTaxFromGross,
  formatRupiah,
  isValidIdrInteger,
  isValidPositiveQuantity,
  isValidRateBps,
  type AllocationTarget,
} from "./money";
import {
  CALCULATION_VERSION,
  MAX_ITEMS_COUNT,
  MAX_PARTICIPANTS_COUNT,
  type BillAdjustment,
  type BillCalculationInput,
  type CalculationResult,
  type ParticipantBreakdown,
  type PaymentMethodNote,
  type PublicShareProjection,
  type ReconciliationIssue,
  type ReceiptDetails,
} from "./types";

const STAGE_ORDER: Record<BillAdjustment["kind"], number> = {
  "item-discount": 1,
  "bill-discount": 2,
  service: 3,
  tax: 4,
  fee: 5,
  rounding: 6,
};

export function calculateBill(input: BillCalculationInput): CalculationResult {
  const issues: ReconciliationIssue[] = [];

  const currentInputHash = computeFinancialInputHash({
    currency: input.currency,
    confirmedGrandTotal: input.confirmedGrandTotal,
    items: input.items,
    adjustments: input.adjustments,
  });

  const isReviewHashMatching = Boolean(
    input.confirmedInputHash && input.confirmedInputHash === currentInputHash
  );

  // 1. Validasi kapasitas dan keunikan ID
  if (input.items.length === 0) {
    issues.push({
      code: "NO_ITEMS",
      stage: "review",
      severity: "error",
      message: "Tagihan harus memiliki minimal 1 item pesanan.",
    });
  } else if (input.items.length > MAX_ITEMS_COUNT) {
    issues.push({
      code: "TOO_MANY_ITEMS",
      stage: "review",
      severity: "error",
      message: `Maksimum ${MAX_ITEMS_COUNT} baris item per tagihan.`,
    });
  }

  if (input.participants.length === 0) {
    issues.push({
      code: "NO_PARTICIPANTS",
      stage: "split",
      severity: "error",
      message: "Tambahkan minimal 1 peserta untuk membagi tagihan.",
    });
  } else if (input.participants.length > MAX_PARTICIPANTS_COUNT) {
    issues.push({
      code: "TOO_MANY_PARTICIPANTS",
      stage: "split",
      severity: "error",
      message: `Maksimum ${MAX_PARTICIPANTS_COUNT} peserta per tagihan.`,
    });
  }

  const participantMap = new Map(input.participants.map((p) => [p.id, p]));
  if (participantMap.size !== input.participants.length) {
    issues.push({
      code: "DUPLICATE_PARTICIPANT_ID",
      stage: "split",
      severity: "error",
      message: "Data teman terulang. Muat ulang halaman lalu coba lagi.",
    });
  }

  for (const p of input.participants) {
    if (!p.name || !p.name.trim()) {
      issues.push({
        code: "EMPTY_PARTICIPANT_NAME",
        stage: "split",
        severity: "error",
        participantId: p.id,
        message: "Nama panggilan peserta tidak boleh kosong.",
      });
    }
  }

  if (!input.payerParticipantId || !participantMap.has(input.payerParticipantId)) {
    issues.push({
      code: "INVALID_PAYER",
      stage: "split",
      severity: "error",
      message: "Pilih satu peserta yang menalangi pembayaran struk.",
    });
  }

  const itemMap = new Map(input.items.map((item) => [item.id, item]));
  if (itemMap.size !== input.items.length) {
    issues.push({
      code: "DUPLICATE_ITEM_ID",
      stage: "review",
      severity: "error",
      message: "Data pesanan terulang. Muat ulang halaman lalu coba lagi.",
    });
  }

  const adjustmentMap = new Map(input.adjustments.map((adj) => [adj.id, adj]));
  if (adjustmentMap.size !== input.adjustments.length) {
    issues.push({
      code: "DUPLICATE_ADJUSTMENT_ID",
      stage: "review",
      severity: "error",
      message: "Data biaya atau diskon terulang. Muat ulang halaman lalu coba lagi.",
    });
  }

  // Matriks per item -> per participant
  const itemGrossAllocations: Record<string, Record<string, number>> = {};
  const itemNetAllocations: Record<string, Record<string, number>> = {};
  const itemDiscountByItemParticipant: Record<string, Record<string, number>> = {};
  const billDiscountByItemParticipant: Record<string, Record<string, number>> = {};
  const adjustmentParticipantAllocations: Record<string, Record<string, number>> = {};
  const adjustmentItemAllocations: Record<
    string,
    Record<string, Record<string, number>>
  > = {};

  for (const item of input.items) {
    itemGrossAllocations[item.id] = {};
    itemNetAllocations[item.id] = {};
    itemDiscountByItemParticipant[item.id] = {};
    billDiscountByItemParticipant[item.id] = {};
    for (const p of input.participants) {
      itemGrossAllocations[item.id][p.id] = 0;
      itemNetAllocations[item.id][p.id] = 0;
      itemDiscountByItemParticipant[item.id][p.id] = 0;
      billDiscountByItemParticipant[item.id][p.id] = 0;
    }
  }

  // 2. Validasi setiap item & alokasi item ke peserta
  const allocationByItemId = new Map(input.allocations.map((a) => [a.itemId, a]));
  let computedItemsSubtotal = 0;

  for (const item of input.items) {
    if (!item.name || !item.name.trim()) {
      issues.push({
        code: "ITEM_NAME_EMPTY",
        stage: "review",
        severity: "error",
        itemId: item.id,
        message: "Nama item pesanan tidak boleh kosong.",
      });
    }

    if (!isValidPositiveQuantity(item.quantity)) {
      issues.push({
        code: "ITEM_QUANTITY_INVALID",
        stage: "review",
        severity: "error",
        itemId: item.id,
        message: `Jumlah item "${item.name || "Tanpa nama"}" harus bilangan bulat positif.`,
      });
    }

    if (item.lineAmount === null || !isValidIdrInteger(item.lineAmount)) {
      issues.push({
        code: "ITEM_AMOUNT_INVALID",
        stage: "review",
        severity: "error",
        itemId: item.id,
        message: `Nominal baris untuk "${item.name || "Item"}" belum valid atau tidak terbaca.`,
      });
      continue;
    }

    if (item.unitPrice !== null && item.unitPrice !== undefined) {
      if (!isValidIdrInteger(item.unitPrice)) {
        issues.push({
          code: "ITEM_UNIT_PRICE_INVALID",
          stage: "review",
          severity: "error",
          itemId: item.id,
          message: `Harga satuan "${item.name}" tidak valid.`,
        });
      } else if (
        isValidPositiveQuantity(item.quantity) &&
        item.unitPrice * item.quantity !== item.lineAmount
      ) {
        if (!item.unitMismatchConfirmed) {
          issues.push({
            code: "ITEM_UNIT_MISMATCH",
            stage: "review",
            severity: "error",
            itemId: item.id,
            message: `Harga satuan × jumlah (${formatRupiah(
              item.unitPrice * item.quantity
            )}) berbeda dengan nominal baris (${formatRupiah(
              item.lineAmount
            )}). Konfirmasi jika nominal baris memang acuan.`,
          });
        }
      }
    }

    if (!item.reviewConfirmed) {
      issues.push({
        code: "ITEM_UNCONFIRMED",
        stage: "review",
        severity: "error",
        itemId: item.id,
        message: item.ambiguityReason
          ? `Item "${item.name}" perlu dicek: ${item.ambiguityReason}`
          : `Item "${item.name}" belum diperiksa. Buka Cek struk untuk melanjutkan.`,
      });
    }

    computedItemsSubtotal += item.lineAmount;

    // Alokasi item ke peserta
    const alloc = allocationByItemId.get(item.id);
    if (!alloc) {
      issues.push({
        code: "ITEM_UNALLOCATED",
        stage: "split",
        severity: "error",
        itemId: item.id,
        message: `Item "${item.name}" belum memiliki pemilik pesanan.`,
      });
      continue;
    }

    if (alloc.mode === "units") {
      const unitCounts = alloc.unitCounts ?? {};
      let sumUnits = 0;
      let hasInvalidUnit = false;
      const targets: AllocationTarget[] = [];

      for (const [pid, count] of Object.entries(unitCounts)) {
        if (!participantMap.has(pid)) {
          hasInvalidUnit = true;
          continue;
        }
        if (
          typeof count !== "number" ||
          !Number.isSafeInteger(count) ||
          count < 0
        ) {
          hasInvalidUnit = true;
          continue;
        }
        sumUnits += count;
      }

      for (const p of input.participants) {
        const w = unitCounts[p.id] ?? 0;
        if (Number.isSafeInteger(w) && w >= 0) {
          targets.push({
            id: p.id,
            allocationOrder: p.allocationOrder,
            weight: w,
          });
        }
      }

      if (hasInvalidUnit || sumUnits !== item.quantity) {
        issues.push({
          code: "ITEM_UNITS_MISMATCH",
          stage: "split",
          severity: "error",
          itemId: item.id,
          message: `Item "${item.name}" berjumlah ${item.quantity} unit, tetapi baru dialokasikan ${sumUnits} unit.`,
        });
        continue;
      }

      if (sumUnits > 0 && targets.length > 0) {
        const shares = allocateLargestRemainder(item.lineAmount, targets);
        for (const p of input.participants) {
          const val = shares[p.id] ?? 0;
          itemGrossAllocations[item.id][p.id] = val;
          itemNetAllocations[item.id][p.id] = val;
        }
      }
    } else if (alloc.mode === "shared") {
      const selectedIds = (alloc.participantIds ?? []).filter((pid) =>
        participantMap.has(pid)
      );
      const uniqueSelected = new Set(selectedIds);

      if (
        uniqueSelected.size === 0 ||
        uniqueSelected.size !== (alloc.participantIds ?? []).length
      ) {
        issues.push({
          code: "ITEM_SHARED_EMPTY_OR_INVALID",
          stage: "split",
          severity: "error",
          itemId: item.id,
          message: `Pilih minimal 1 peserta valid untuk berbagi item "${item.name}".`,
        });
        continue;
      }

      const targets: AllocationTarget[] = input.participants.map((p) => ({
        id: p.id,
        allocationOrder: p.allocationOrder,
        weight: uniqueSelected.has(p.id) ? 1 : 0,
      }));

      const shares = allocateLargestRemainder(item.lineAmount, targets);
      for (const p of input.participants) {
        const val = shares[p.id] ?? 0;
        itemGrossAllocations[item.id][p.id] = val;
        itemNetAllocations[item.id][p.id] = val;
      }
    } else {
      issues.push({
        code: "ITEM_MODE_INVALID",
        stage: "split",
        severity: "error",
        itemId: item.id,
        message: `Mode pembagian item "${item.name}" tidak dikenali.`,
      });
    }
  }

  // Helper untuk mengurutkan komponen secara deterministik
  const sortAdjustments = (list: BillAdjustment[]) =>
    [...list].sort((a, b) => {
      if (STAGE_ORDER[a.kind] !== STAGE_ORDER[b.kind]) {
        return STAGE_ORDER[a.kind] - STAGE_ORDER[b.kind];
      }
      if (a.allocationOrder !== b.allocationOrder) {
        return a.allocationOrder - b.allocationOrder;
      }
      return a.id.localeCompare(b.id);
    });

  const sortedAdjustments = sortAdjustments(input.adjustments);

  // Inisialisasi struktur alokasi per adjustment
  for (const adj of sortedAdjustments) {
    adjustmentParticipantAllocations[adj.id] = {};
    adjustmentItemAllocations[adj.id] = {};
    for (const p of input.participants) {
      adjustmentParticipantAllocations[adj.id][p.id] = 0;
    }
    for (const item of input.items) {
      adjustmentItemAllocations[adj.id][item.id] = {};
      for (const p of input.participants) {
        adjustmentItemAllocations[adj.id][item.id][p.id] = 0;
      }
    }
  }

  // Validasi umum komponen dan periksa siklus dependency
  const seenAddedIdsInOrder = new Set<string>();
  for (const adj of sortedAdjustments) {
    if (!adj.reviewConfirmed) {
      issues.push({
        code: "ADJUSTMENT_UNCONFIRMED",
        stage: "review",
        severity: "error",
        adjustmentId: adj.id,
        message: `Komponen "${adj.name}" belum diperiksa. Buka Cek struk untuk melanjutkan.`,
      });
    }

    if (!adj.scopeConfirmed) {
      issues.push({
        code: "ADJUSTMENT_SCOPE_UNCONFIRMED",
        stage: "review",
        severity: "error",
        adjustmentId: adj.id,
        message: `Cakupan item untuk "${adj.name}" belum dikonfirmasi.`,
      });
    }

    const validEligibleItems = adj.eligibleItemIds.filter((id) => itemMap.has(id));
    if (
      adj.kind !== "rounding" &&
      (validEligibleItems.length === 0 ||
        validEligibleItems.length !== adj.eligibleItemIds.length)
    ) {
      issues.push({
        code: "ADJUSTMENT_EMPTY_SCOPE",
        stage: "review",
        severity: "error",
        adjustmentId: adj.id,
        message: `Komponen "${adj.name}" harus memiliki minimal satu pesanan yang dikenai biaya atau diskon.`,
      });
    }

    const deps = adj.dependsOnAdjustmentIds ?? [];
    for (const depId of deps) {
      const depAdj = adjustmentMap.get(depId);
      if (
        !depAdj ||
        depId === adj.id ||
        depAdj.mode !== "added" ||
        !seenAddedIdsInOrder.has(depId)
      ) {
        issues.push({
          code: "DEPENDENCY_CYCLE_OR_INVALID",
          stage: "review",
          severity: "error",
          adjustmentId: adj.id,
          message: `Komponen "${adj.name}" merujuk ke komponen dasar yang tidak valid atau membentuk siklus.`,
        });
      }
    }

    if (
      (adj.kind === "service" || adj.kind === "tax" || adj.kind === "fee") &&
      adj.mode === "added"
    ) {
      seenAddedIdsInOrder.add(adj.id);
    }
  }

  // Fungsi bantu menentukan nominal absolut sebuah komponen (observed vs derived)
  const resolveAdjustmentNominal = (
    adj: BillAdjustment,
    baseSum: number,
    isInclusiveTax = false
  ): number | null => {
    if (adj.amountSource === "observed") {
      if (adj.amount === null || !isValidIdrInteger(adj.amount)) {
        issues.push({
          code: "ADJUSTMENT_AMOUNT_INVALID",
          stage: "review",
          severity: "error",
          adjustmentId: adj.id,
          message: `Nominal komponen "${adj.name}" tidak valid atau kosong.`,
        });
        return null;
      }
      if (adj.rateBps !== null && adj.rateBps !== undefined) {
        if (!isValidRateBps(adj.rateBps)) {
          issues.push({
            code: "ADJUSTMENT_RATE_INVALID",
            stage: "review",
            severity: "error",
            adjustmentId: adj.id,
            message: `Persentase "${adj.name}" tidak valid.`,
          });
        } else if (baseSum > 0) {
          const derived = isInclusiveTax
            ? computeIncludedTaxFromGross(baseSum, adj.rateBps)
            : computeAmountFromRateBps(baseSum, adj.rateBps);
          if (derived !== adj.amount) {
            issues.push({
              code: "ADJUSTMENT_RATE_MISMATCH",
              stage: "review",
              severity: "warning",
              adjustmentId: adj.id,
              message: `Nominal cetak "${adj.name}" (${formatRupiah(
                adj.amount
              )}) berbeda dengan hitungan ${(adj.rateBps / 100).toFixed(
                2
              )}% (${formatRupiah(derived)}). Nominal cetak dipakai sebagai acuan.`,
            });
          }
        }
      }
      return adj.amount;
    }

    // Derived dari persentase
    if (adj.rateBps === null || adj.rateBps === undefined || !isValidRateBps(adj.rateBps)) {
      issues.push({
        code: "ADJUSTMENT_RATE_MISSING",
        stage: "review",
        severity: "error",
        adjustmentId: adj.id,
        message: `Tarif persen untuk "${adj.name}" wajib diisi.`,
      });
      return null;
    }

    return isInclusiveTax
      ? computeIncludedTaxFromGross(baseSum, adj.rateBps)
      : computeAmountFromRateBps(baseSum, adj.rateBps);
  };

  let computedDiscountsTotal = 0;
  let computedAddedChargesTotal = 0;
  let computedRoundingSignedTotal = 0;

  // 3. Tahap Diskon (item-discount lalu bill-discount)
  const discountAdjustments = sortedAdjustments.filter(
    (a) => a.kind === "item-discount" || a.kind === "bill-discount"
  );

  for (const adj of discountAdjustments) {
    const eligibleItems = adj.eligibleItemIds
      .map((id) => itemMap.get(id))
      .filter((it): it is NonNullable<typeof it> => Boolean(it));

    if (eligibleItems.length === 0) continue;

    // Hitung dasar per item (gross atau net saat ini)
    const itemWeights: AllocationTarget[] = [];
    let baseSum = 0;

    for (const item of eligibleItems) {
      let itemCurrentSum = 0;
      for (const p of input.participants) {
        itemCurrentSum +=
          adj.basis === "gross" && adj.kind === "item-discount"
            ? itemGrossAllocations[item.id][p.id]
            : itemNetAllocations[item.id][p.id];
      }
      baseSum += itemCurrentSum;
      itemWeights.push({
        id: item.id,
        allocationOrder: item.allocationOrder,
        weight: itemCurrentSum,
      });
    }

    const discountNominal = resolveAdjustmentNominal(adj, baseSum, false);
    if (discountNominal === null) continue;

    // Diskon tidak boleh melebihi kontribusi net saat ini dari item eligible
    let currentNetEligibleSum = 0;
    for (const item of eligibleItems) {
      for (const p of input.participants) {
        currentNetEligibleSum += itemNetAllocations[item.id][p.id];
      }
    }

    if (discountNominal > currentNetEligibleSum || discountNominal > baseSum) {
      issues.push({
        code: "DISCOUNT_EXCEEDS_BASE",
        stage: "reconciliation",
        severity: "error",
        adjustmentId: adj.id,
        message: `Diskon "${adj.name}" (${formatRupiah(
          discountNominal
        )}) melebihi nilai pesanan yang dikenai diskon (${formatRupiah(
          currentNetEligibleSum
        )}).`,
      });
      continue;
    }

    computedDiscountsTotal += discountNominal;

    if (discountNominal === 0) continue;

    // Alokasikan diskon ke item eligible dahulu memakai H
    const itemDiscountShares = allocateLargestRemainder(discountNominal, itemWeights);

    for (const item of eligibleItems) {
      const itemDiscAmount = itemDiscountShares[item.id] ?? 0;
      if (itemDiscAmount === 0) continue;

      const participantTargets: AllocationTarget[] = input.participants.map((p) => ({
        id: p.id,
        allocationOrder: p.allocationOrder,
        weight: itemNetAllocations[item.id][p.id],
      }));

      const totalParticipantWeight = participantTargets.reduce(
        (acc, t) => acc + t.weight,
        0
      );
      if (totalParticipantWeight < itemDiscAmount) {
        issues.push({
          code: "DISCOUNT_ITEM_OVERFLOW",
          stage: "reconciliation",
          severity: "error",
          adjustmentId: adj.id,
          itemId: item.id,
          message: `Diskon "${adj.name}" pada item "${item.name}" membuat nilai item menjadi negatif.`,
        });
        continue;
      }

      const pShares = allocateLargestRemainder(itemDiscAmount, participantTargets);
      for (const p of input.participants) {
        const share = pShares[p.id] ?? 0;
        itemNetAllocations[item.id][p.id] -= share;
        adjustmentParticipantAllocations[adj.id][p.id] += share;
        adjustmentItemAllocations[adj.id][item.id][p.id] += share;

        if (adj.kind === "item-discount") {
          itemDiscountByItemParticipant[item.id][p.id] += share;
        } else {
          billDiscountByItemParticipant[item.id][p.id] += share;
        }
      }
    }
  }

  // 4. Tahap Biaya Added & Included (service, tax, fee)
  const chargeAdjustments = sortedAdjustments.filter(
    (a) => a.kind === "service" || a.kind === "tax" || a.kind === "fee"
  );

  for (const adj of chargeAdjustments) {
    const eligibleItems = adj.eligibleItemIds
      .map((id) => itemMap.get(id))
      .filter((it): it is NonNullable<typeof it> => Boolean(it));

    if (eligibleItems.length === 0) continue;

    const validDeps = (adj.dependsOnAdjustmentIds ?? []).filter(
      (depId) =>
        adjustmentItemAllocations[depId] !== undefined && depId !== adj.id
    );

    // Hitung bobot dasar per item & per peserta dalam item tersebut (mempertahankan provenance item!)
    const itemParticipantBase: Record<string, Record<string, number>> = {};
    const itemTargets: AllocationTarget[] = [];
    let totalBase = 0;

    for (const item of eligibleItems) {
      itemParticipantBase[item.id] = {};
      let itemSum = 0;
      for (const p of input.participants) {
        let pWeight =
          adj.basis === "gross"
            ? itemGrossAllocations[item.id][p.id]
            : itemNetAllocations[item.id][p.id];

        for (const depId of validDeps) {
          pWeight += adjustmentItemAllocations[depId]?.[item.id]?.[p.id] ?? 0;
        }

        itemParticipantBase[item.id][p.id] = pWeight;
        itemSum += pWeight;
      }
      totalBase += itemSum;
      itemTargets.push({
        id: item.id,
        allocationOrder: item.allocationOrder,
        weight: itemSum,
      });
    }

    const isInclusive = adj.mode === "included";
    const chargeNominal = resolveAdjustmentNominal(adj, totalBase, isInclusive);
    if (chargeNominal === null) continue;

    if (chargeNominal > 0 && totalBase <= 0) {
      issues.push({
        code: "ZERO_BASE_FOR_POSITIVE_CHARGE",
        stage: "reconciliation",
        severity: "error",
        adjustmentId: adj.id,
        message: `Komponen "${adj.name}" bernilai ${formatRupiah(
          chargeNominal
        )}, tetapi dasar item yang dipilih bernilai Rp0.`,
      });
      continue;
    }

    if (!isInclusive) {
      computedAddedChargesTotal += chargeNominal;
    }

    if (chargeNominal === 0) continue;

    // Alokasi ke item eligible terlebih dahulu memakai H
    const itemChargeShares = allocateLargestRemainder(chargeNominal, itemTargets);

    for (const item of eligibleItems) {
      const itemCharge = itemChargeShares[item.id] ?? 0;
      if (itemCharge === 0) continue;

      const pTargets: AllocationTarget[] = input.participants.map((p) => ({
        id: p.id,
        allocationOrder: p.allocationOrder,
        weight: itemParticipantBase[item.id][p.id] ?? 0,
      }));

      const pShares = allocateLargestRemainder(itemCharge, pTargets);
      for (const p of input.participants) {
        const share = pShares[p.id] ?? 0;
        adjustmentParticipantAllocations[adj.id][p.id] += share;
        adjustmentItemAllocations[adj.id][item.id][p.id] += share;
      }
    }
  }

  // 5. Hitung subtotal per peserta sebelum pembulatan/penyesuaian akhir
  const subtotalBeforeRounding: Record<string, number> = {};
  for (const p of input.participants) {
    let sub = 0;
    for (const item of input.items) {
      sub += itemNetAllocations[item.id][p.id];
    }
    for (const adj of chargeAdjustments) {
      if (adj.mode === "added") {
        sub += adjustmentParticipantAllocations[adj.id][p.id];
      }
    }
    subtotalBeforeRounding[p.id] = sub;
  }

  // 6. Tahap Pembulatan / Penyesuaian Akhir (kind === "rounding")
  const roundingAdjustments = sortedAdjustments.filter(
    (a) => a.kind === "rounding"
  );
  const participantRoundingSigned: Record<string, number> = {};
  for (const p of input.participants) {
    participantRoundingSigned[p.id] = 0;
  }

  for (const adj of roundingAdjustments) {
    if (!adj.name || !adj.name.trim()) {
      issues.push({
        code: "ROUNDING_NAME_EMPTY",
        stage: "review",
        severity: "error",
        adjustmentId: adj.id,
        message: "Komponen pembulatan/penyesuaian wajib memiliki nama yang jelas.",
      });
    }

    const totalBefore = Object.values(subtotalBeforeRounding).reduce(
      (a, b) => a + b,
      0
    );
    const nominal = resolveAdjustmentNominal(adj, totalBefore, false);
    if (nominal === null) continue;

    const signMultiplier = adj.sign === "negative" ? -1 : 1;
    computedRoundingSignedTotal += nominal * signMultiplier;

    if (nominal === 0) continue;

    const pTargets: AllocationTarget[] = input.participants.map((p) => ({
      id: p.id,
      allocationOrder: p.allocationOrder,
      weight: Math.max(
        0,
        subtotalBeforeRounding[p.id] + participantRoundingSigned[p.id]
      ),
    }));

    const totalWeight = pTargets.reduce((acc, t) => acc + t.weight, 0);
    if (totalWeight <= 0) {
      issues.push({
        code: "ROUNDING_ZERO_BASE",
        stage: "reconciliation",
        severity: "error",
        adjustmentId: adj.id,
        message: `Penyesuaian "${adj.name}" tidak dapat dialokasikan karena total kontribusi peserta Rp0.`,
      });
      continue;
    }

    if (signMultiplier < 0 && nominal > totalWeight) {
      issues.push({
        code: "ROUNDING_NEGATIVE_OVERFLOW",
        stage: "reconciliation",
        severity: "error",
        adjustmentId: adj.id,
        message: `Pengurangan "${adj.name}" (${formatRupiah(
          nominal
        )}) melebihi total tagihan sebelum penyesuaian.`,
      });
      continue;
    }

    const pShares = allocateLargestRemainder(nominal, pTargets);
    for (const p of input.participants) {
      const share = pShares[p.id] ?? 0;
      adjustmentParticipantAllocations[adj.id][p.id] = share;
      participantRoundingSigned[p.id] += share * signMultiplier;
    }
  }

  // 7. Susun ParticipantBreakdown & verifikasi non-negatif
  const participantBreakdowns: ParticipantBreakdown[] = [];
  let sumParticipantConsumption = 0;

  for (const p of input.participants) {
    let itemsGrossTotal = 0;
    let itemsNetTotal = 0;
    for (const item of input.items) {
      itemsGrossTotal += itemGrossAllocations[item.id][p.id];
      itemsNetTotal += itemNetAllocations[item.id][p.id];
    }

    const discountsTotal = itemsGrossTotal - itemsNetTotal;
    let serviceTotal = 0;
    let taxAddedTotal = 0;
    let taxIncludedInfoTotal = 0;
    let feeTotal = 0;

    for (const adj of chargeAdjustments) {
      const share = adjustmentParticipantAllocations[adj.id][p.id] ?? 0;
      if (adj.mode === "included") {
        taxIncludedInfoTotal += share;
      } else if (adj.kind === "service") {
        serviceTotal += share;
      } else if (adj.kind === "tax") {
        taxAddedTotal += share;
      } else if (adj.kind === "fee") {
        feeTotal += share;
      }
    }

    const roundingSignedTotal = participantRoundingSigned[p.id] ?? 0;
    const consumptionTotal =
      itemsNetTotal +
      serviceTotal +
      taxAddedTotal +
      feeTotal +
      roundingSignedTotal;

    if (consumptionTotal < 0) {
      issues.push({
        code: "NEGATIVE_PARTICIPANT_TOTAL",
        stage: "reconciliation",
        severity: "error",
        participantId: p.id,
        message: `Total bagian untuk "${p.name}" bernilai negatif (${formatRupiah(
          consumptionTotal
        )}).`,
      });
    }

    const isPayer = p.id === input.payerParticipantId;
    const transferToPayerAmount = isPayer ? 0 : Math.max(0, consumptionTotal);

    sumParticipantConsumption += consumptionTotal;

    participantBreakdowns.push({
      participantId: p.id,
      participantName: p.name,
      isPayer,
      itemsGrossTotal,
      discountsTotal,
      itemsNetTotal,
      serviceTotal,
      taxAddedTotal,
      taxIncludedInfoTotal,
      feeTotal,
      roundingSignedTotal,
      consumptionTotal,
      transferToPayerAmount,
    });
  }

  const computedGrandTotal =
    computedItemsSubtotal -
    computedDiscountsTotal +
    computedAddedChargesTotal +
    computedRoundingSignedTotal;

  // 8. Rekonsiliasi konservasi uang dan kesesuaian dengan confirmedGrandTotal
  if (
    input.participants.length > 0 &&
    sumParticipantConsumption !== computedGrandTotal
  ) {
    issues.push({
      code: "CONSERVATION_MISMATCH",
      stage: "reconciliation",
      severity: "error",
      message: `Jumlah bagian semua peserta (${formatRupiah(
        sumParticipantConsumption
      )}) belum cocok dengan total rincian (${formatRupiah(
        computedGrandTotal
      )}). Pastikan seluruh item telah memiliki pemilik.`,
    });
  }

  let grandTotalDifference: number | null = null;
  if (
    input.confirmedGrandTotal === null ||
    !isValidIdrInteger(input.confirmedGrandTotal)
  ) {
    issues.push({
      code: "GRAND_TOTAL_UNCONFIRMED",
      stage: "review",
      severity: "error",
      message: "Isi total yang dibayar di kasir.",
    });
  } else {
    grandTotalDifference = computedGrandTotal - input.confirmedGrandTotal;
    if (grandTotalDifference !== 0) {
      const direction =
        grandTotalDifference < 0
          ? `lebih kecil ${formatRupiah(Math.abs(grandTotalDifference))}`
          : `lebih besar ${formatRupiah(Math.abs(grandTotalDifference))}`;
      issues.push({
        code: "GRAND_TOTAL_MISMATCH",
        stage: "reconciliation",
        severity: "error",
        message: `Jumlah rincian ${direction} dari total struk (${formatRupiah(
          input.confirmedGrandTotal
        )}). Periksa kembali harga item, pajak/diskon, atau tambahkan komponen pembulatan.`,
      });
    }
  }

  if (!isReviewHashMatching) {
    issues.push({
      code: "REVIEW_HASH_STALE",
      stage: "review",
      severity: "error",
      message:
        "Angka pada tagihan berubah. Buka Cek struk untuk memeriksa kembali sebelum dibagikan.",
    });
  }

  const payerBreakdown = participantBreakdowns.find((b) => b.isPayer);
  const totalReceivableByPayer = payerBreakdown
    ? Math.max(0, computedGrandTotal - payerBreakdown.consumptionTotal)
    : 0;

  const canFinalize =
    issues.every((issue) => issue.severity !== "error") && isReviewHashMatching;

  return {
    calculationVersion: CALCULATION_VERSION,
    canFinalize,
    currentInputHash,
    isReviewHashMatching,
    issues,
    computedItemsSubtotal,
    computedDiscountsTotal,
    computedAddedChargesTotal,
    computedRoundingSignedTotal,
    computedGrandTotal,
    confirmedGrandTotal: input.confirmedGrandTotal,
    grandTotalDifference,
    payerParticipantId: input.payerParticipantId,
    totalReceivableByPayer,
    participantBreakdowns,
    itemGrossAllocations,
    itemNetAllocations,
    adjustmentParticipantAllocations,
  };
}

/**
 * Membentuk proyeksi rincian publik yang aman (tanpa email, UID, atau foto)
 * untuk halaman hasil dan link baca-saja (/s/[token]).
 */
export function buildDetailedParticipantShares(
  input: BillCalculationInput,
  result: CalculationResult
): PublicShareProjection["participants"] {
  const allocationByItemId = new Map(input.allocations.map((a) => [a.itemId, a]));

  return input.participants.map((p) => {
    const breakdown = result.participantBreakdowns.find(
      (b) => b.participantId === p.id
    );

    const items = input.items
      .map((item) => {
        const grossShare = result.itemGrossAllocations[item.id]?.[p.id] ?? 0;
        const netShare = result.itemNetAllocations[item.id]?.[p.id] ?? 0;
        if (grossShare === 0 && netShare === 0) return null;

        const alloc = allocationByItemId.get(item.id);
        let itemDiscountShare = 0;
        let billDiscountShare = 0;

        for (const adj of input.adjustments) {
          if (adj.kind === "item-discount" || adj.kind === "bill-discount") {
            // Estimasi proporsi diskon per item untuk tampilan rincian
            if (adj.eligibleItemIds.includes(item.id)) {
              const totalDisc = Math.max(0, grossShare - netShare);
              if (adj.kind === "item-discount") {
                itemDiscountShare = totalDisc;
              } else {
                billDiscountShare = Math.max(0, totalDisc - itemDiscountShare);
              }
            }
          }
        }

        return {
          itemId: item.id,
          itemName: item.name,
          mode: alloc?.mode ?? "shared",
          ...(alloc?.mode === "units" ? { units: alloc.unitCounts?.[p.id] ?? 0 } : {}),
          totalUnits: item.quantity,
          ...(alloc?.mode === "shared" ? { sharedParticipantCount: alloc.participantIds?.length ?? 1 } : {}),
          grossShare,
          itemDiscountShare,
          billDiscountShare,
          netShare,
        };
      })
      .filter((it): it is NonNullable<typeof it> => it !== null);

    const adjustments = input.adjustments
      .map((adj) => {
        const abs = result.adjustmentParticipantAllocations[adj.id]?.[p.id] ?? 0;
        if (abs === 0) return null;
        let signed = abs;
        if (adj.kind === "item-discount" || adj.kind === "bill-discount") {
          signed = -abs;
        } else if (adj.kind === "rounding") {
          signed = adj.sign === "negative" ? -abs : abs;
        }
        return {
          adjustmentId: adj.id,
          name: adj.name,
          kind: adj.kind,
          mode: adj.mode,
          signedAmount: signed,
          absoluteAmount: abs,
        };
      })
      .filter((a): a is NonNullable<typeof a> => a !== null);

    return {
      id: p.id,
      name: p.name,
      ...(p.label !== undefined ? { label: p.label } : {}),
      allocationOrder: p.allocationOrder,
      isPayer: p.id === input.payerParticipantId,
      consumptionTotal: breakdown?.consumptionTotal ?? 0,
      transferToPayerAmount: breakdown?.transferToPayerAmount ?? 0,
      items,
      adjustments,
      taxIncludedInfoTotal: breakdown?.taxIncludedInfoTotal ?? 0,
    };
  });
}

/**
 * Rincian seluruh pesanan dari hasil perhitungan, tanpa data akun pemilik.
 */
export function buildReceiptDetails(input: BillCalculationInput, result: CalculationResult): ReceiptDetails {
  return {
    items: input.items.map(item => ({
      id: item.id, name: item.name, quantity: item.quantity, lineAmount: item.lineAmount ?? 0,
    })),
    adjustments: input.adjustments.map(adjustment => {
      const amount = Object.values(result.adjustmentParticipantAllocations[adjustment.id] ?? {}).reduce((sum, value) => sum + value, 0);
      const negative = adjustment.kind.endsWith("discount") || (adjustment.kind === "rounding" && adjustment.sign === "negative");
      return { id: adjustment.id, name: adjustment.name, mode: adjustment.mode, signedAmount: negative ? -amount : amount };
    }),
    subtotal: result.computedItemsSubtotal,
  };
}

/** Ringkasan singkat siap salin untuk WhatsApp/chat. */
export function formatSummaryText(params: {
  title: string;
  merchant?: string;
  grandTotal: number;
  payerName: string;
  participants: PublicShareProjection["participants"];
  paymentNote?: PaymentMethodNote | null;
  paymentMethods?: PaymentMethodNote[];
  shareUrl?: string | null;
}): string {
  const title = params.title.trim();
  const isDefaultTitle = !title || /^(patungan baru|patungan makan)$/i.test(title);
  const headerLabel = isDefaultTitle ? params.merchant || "Patungan makan" : title;
  const payments = normalizePaymentMethods(params.paymentMethods, params.paymentNote);
  const lines: string[] = [
    `*${headerLabel}*`,
    `Total *${formatRupiah(params.grandTotal)}*, sudah aku bayar dulu ya.`,
    "",
  ];

  for (const person of params.participants) {
    const name = person.isPayer ? "Aku" : person.name;
    const amount = person.isPayer ? person.consumptionTotal : person.transferToPayerAmount;
    const status = person.isPayer ? " (sudah dibayar)" : amount === 0 ? " (tidak perlu bayar)" : "";
    lines.push(`- ${name}: *${formatRupiah(amount)}*${status}`);
  }

  if (payments.length === 0) lines.push("", "Bisa transfer ke aku ya.");
  if (payments.length > 1) lines.push("", "Bisa bayar ke aku lewat salah satu ini:");
  for (const payment of payments) {
    lines.push("");
    if (payment.method === "qris") {
      lines.push(payment.qrisImageId && params.shareUrl ? "Bayar lewat *QRIS* ya. Gambar QRIS tersedia di link rincian di bawah." : "Bayar lewat *QRIS* ya. Kode QR-nya aku kirim di chat.");
    } else {
      const accParts = [
      payment.bankOrWalletName,
      payment.accountNumber,
      payment.accountHolderName
        ? `a.n. ${payment.accountHolderName}`
        : null,
      ].filter(Boolean);
      if (accParts.length > 0) {
        lines.push(payment.method === "transfer" || !payment.method
          ? `Transfer ke: *${accParts.join(" · ")}*`
          : `${paymentMethodLabel(payment)}: *${accParts.join(" · ")}*`);
      }
    }
    if (payment.note) {
      lines.push(`Catatan: ${payment.note}`);
    }
  }

  lines.push("");
  lines.push("Makasih ya!");

  if (params.shareUrl) {
    lines.push("");
    lines.push(`Rincian: ${params.shareUrl}`);
  }

  return lines.join("\n");
}

/**
 * Receipt totals must be checked before orders are assigned to people.
 * Use a temporary allocation only for this calculation; it is never saved.
 */
export function calculateBillForReview(input: BillCalculationInput): CalculationResult {
  const previewId = "receipt-review-preview";
  return calculateBill({
    ...input,
    participants: [{ id: previewId, name: "Pratinjau", allocationOrder: 0 }],
    payerParticipantId: previewId,
    allocations: input.items.map((item) => ({
      itemId: item.id,
      mode: "units",
      unitCounts: { [previewId]: item.quantity },
    })),
  });
}
