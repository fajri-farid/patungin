/**
 * Utilitas Uang & Algoritma Alokasi Integer H(M, weights)
 *
 * Sesuai spesifikasi perhitungan:
 * - Seluruh uang adalah integer Rupiah non-negatif.
 * - Operasi perkalian dan pembagian perantara menggunakan BigInt agar bebas galat floating-point.
 * - Pembagian sisa menggunakan metode Largest Remainder dengan tie-break stabil:
 *   allocationOrder terkecil, lalu ID secara leksikografis.
 */

import { MAX_IDR_AMOUNT } from "./types";

const ZERO_BI = BigInt(0);
const ONE_BI = BigInt(1);
const TWO_BI = BigInt(2);
const TEN_THOUSAND_BI = BigInt(10_000);

export interface AllocationTarget {
  id: string;
  allocationOrder: number;
  weight: number;
}

export function isValidIdrInteger(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= MAX_IDR_AMOUNT
  );
}

export function isValidPositiveQuantity(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isSafeInteger(value) &&
    value >= 1 &&
    value <= 10_000
  );
}

export function isValidRateBps(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= 100_000 // Maksimum 1000%
  );
}

/**
 * Pembulatan Round-Half-Up presisi tepat menggunakan BigInt:
 * Menghitung roundHalfUp(numerator / denominator) untuk nilai non-negatif.
 */
export function roundHalfUpBigInt(numerator: bigint, denominator: bigint): number {
  if (denominator <= ZERO_BI) {
    throw new Error("Denominator harus lebih besar dari nol.");
  }
  if (numerator < ZERO_BI) {
    throw new Error("Numerator tidak boleh negatif.");
  }
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  // Jika 2 * remainder >= denominator, bulatkan ke atas
  const rounded = remainder * TWO_BI >= denominator ? quotient + ONE_BI : quotient;
  return Number(rounded);
}

/**
 * Menghitung nilai komponen dari dasar dan tarif bps:
 * roundHalfUp(base * rateBps / 10000)
 */
export function computeAmountFromRateBps(baseAmount: number, rateBps: number): number {
  if (!isValidIdrInteger(baseAmount) || !isValidRateBps(rateBps)) {
    throw new Error("Input dasar atau rate bps tidak valid.");
  }
  return roundHalfUpBigInt(
    BigInt(baseAmount) * BigInt(rateBps),
    TEN_THOUSAND_BI
  );
}

/**
 * Menghitung pajak inklusif informasional untuk satu pajak yang sudah termasuk dalam harga gross P:
 * includedTax = roundHalfUp(P * rateBps / (10000 + rateBps))
 */
export function computeIncludedTaxFromGross(grossAmount: number, rateBps: number): number {
  if (!isValidIdrInteger(grossAmount) || !isValidRateBps(rateBps)) {
    throw new Error("Input gross atau rate bps tidak valid.");
  }
  return roundHalfUpBigInt(
    BigInt(grossAmount) * BigInt(rateBps),
    TEN_THOUSAND_BI + BigInt(rateBps)
  );
}

/**
 * Algoritma H(M, weights) — Largest Remainder Integer Allocation
 *
 * Membagi M rupiah secara proporsional ke daftar target berdasarkan weight:
 * 1. q[j] = floor(M * w[j] / W)
 * 2. r[j] = (M * w[j]) mod W
 * 3. Sisa R = M - sum(q[j]) dibagikan +1 rupiah ke R target berbobot > 0 dengan r[j] terbesar.
 * 4. Jika r[j] seri, urutkan berdasarkan allocationOrder terkecil, lalu id secara leksikografis.
 */
export function allocateLargestRemainder(
  amount: number,
  targets: readonly AllocationTarget[]
): Record<string, number> {
  if (!isValidIdrInteger(amount)) {
    throw new Error(`Nominal alokasi tidak valid: ${String(amount)}`);
  }

  const result: Record<string, number> = {};
  for (const t of targets) {
    if (
      typeof t.weight !== "number" ||
      !Number.isFinite(t.weight) ||
      !Number.isSafeInteger(t.weight) ||
      t.weight < 0
    ) {
      throw new Error(`Bobot target ${t.id} tidak valid: ${String(t.weight)}`);
    }
    result[t.id] = 0;
  }

  if (amount === 0 || targets.length === 0) {
    if (amount > 0 && targets.length === 0) {
      throw new Error("Tidak dapat mengalokasikan nominal positif tanpa target.");
    }
    return result;
  }

  let totalWeight = ZERO_BI;
  for (const t of targets) {
    totalWeight += BigInt(t.weight);
  }

  if (totalWeight <= ZERO_BI) {
    throw new Error("Total bobot harus lebih besar dari nol ketika nominal > 0.");
  }

  const M = BigInt(amount);
  let sumQuotients = ZERO_BI;

  const entries = targets.map((t) => {
    const w = BigInt(t.weight);
    const product = M * w;
    const q = product / totalWeight;
    const r = product % totalWeight;
    sumQuotients += q;
    return {
      id: t.id,
      allocationOrder: t.allocationOrder,
      weight: t.weight,
      quotient: q,
      remainder: r,
    };
  });

  const remainderUnits = Number(M - sumQuotients);

  // Target berbobot > 0 yang berhak menerima sisa rupiah
  const positiveTargets = entries
    .filter((e) => e.weight > 0)
    .sort((a, b) => {
      if (a.remainder !== b.remainder) {
        return a.remainder > b.remainder ? -1 : 1;
      }
      if (a.allocationOrder !== b.allocationOrder) {
        return a.allocationOrder - b.allocationOrder;
      }
      return a.id.localeCompare(b.id);
    });

  const bonusWinners = new Set<string>();
  for (let i = 0; i < remainderUnits && i < positiveTargets.length; i++) {
    bonusWinners.add(positiveTargets[i].id);
  }

  for (const entry of entries) {
    const bonus = bonusWinners.has(entry.id) ? ONE_BI : ZERO_BI;
    result[entry.id] = Number(entry.quotient + bonus);
  }

  return result;
}

/**
 * Format angka Rupiah dengan locale id-ID (mis. Rp115.500 atau -Rp1.000).
 */
export function formatRupiah(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) {
    return "—";
  }
  const isNegative = amount < 0;
  const absFormatted = Math.abs(Math.round(amount)).toLocaleString("id-ID");
  return isNegative ? `-Rp${absFormatted}` : `Rp${absFormatted}`;
}
