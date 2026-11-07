import type { PaymentMethodNote } from "./types";
import { QRIS_IMAGE_ID } from "../qris";

/** Validate payment metadata and keep only fields belonging to the chosen method. */
export function normalizePaymentNote(input: unknown): PaymentMethodNote | null {
  if (input === null || input === undefined) return null;
  if (typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Format informasi pembayaran tidak valid.");
  }
  const record = input as Record<string, unknown>;
  const method = record.method ?? "transfer"; // Existing bills remain transfers.
  if (!["transfer", "bank", "ewallet", "qris"].includes(String(method))) {
    throw new Error("Pilih rekening bank, e-wallet, transfer atau QRIS.");
  }
  const field = (name: string, maximum: number): string => {
    const value = record[name];
    if (value === undefined || value === null) return "";
    if (typeof value !== "string" || value.length > maximum) {
      throw new Error("Informasi pembayaran tidak valid atau terlalu panjang.");
    }
    return value.trim();
  };
  const note = field("note", 300);
  if (method === "qris") {
    const qrisImageId = field("qrisImageId", 64);
    if (qrisImageId && !QRIS_IMAGE_ID.test(qrisImageId)) throw new Error("Gambar QRIS tidak valid.");
    return { method, note, ...(qrisImageId ? { qrisImageId } : {}) };
  }
  const bankOrWalletName = field("bankOrWalletName", 80);
  const accountNumber = field("accountNumber", 64);
  const accountHolderName = field("accountHolderName", 100);
  if (method === "transfer" && !bankOrWalletName && !accountNumber && !accountHolderName && !note) return null;
  if ((method === "bank" || method === "ewallet") && (!bankOrWalletName || !accountNumber || !accountHolderName)) {
    throw new Error(method === "bank"
      ? "Lengkapi nama bank, nomor rekening, dan nama pemilik."
      : "Lengkapi nama e-wallet, nomor HP, dan nama pemilik.");
  }
  return { method: method as PaymentMethodNote["method"], bankOrWalletName, accountNumber, accountHolderName, note };
}

export const MAX_PAYMENT_METHODS = 10;

/** An explicit empty array clears payments; absent arrays read legacy bills. */
export function normalizePaymentMethods(input: unknown, legacy?: PaymentMethodNote | null): PaymentMethodNote[] {
  if (input === undefined) {
    const payment = normalizePaymentNote(legacy);
    return payment ? [payment] : [];
  }
  if (!Array.isArray(input) || input.length > MAX_PAYMENT_METHODS) {
    throw new Error(`Tambahkan maksimal ${MAX_PAYMENT_METHODS} tujuan pembayaran.`);
  }
  return input.map((payment, index) => {
    try { return normalizePaymentNote(payment); }
    catch (error) {
      throw new Error(`Tujuan pembayaran ${index + 1}: ${error instanceof Error ? error.message : "Periksa kembali isian pembayaran."}`);
    }
  }).filter((payment): payment is PaymentMethodNote => payment !== null);
}

export function paymentMethodLabel(payment: PaymentMethodNote): string {
  if (payment.method === "qris") return "QRIS";
  if (payment.method === "ewallet") return "E-wallet";
  if (payment.method === "bank") return "Rekening bank";
  return "Transfer";
}

/** Older bills kept banks and wallets together; recognize common wallet names. */
export function editablePaymentMethod(payment: PaymentMethodNote): PaymentMethodNote {
  if (payment.method && payment.method !== "transfer") return payment;
  const isWallet = /\b(gopay|go pay|ovo|dana|shopeepay|shopee pay|linkaja|link aja|isaku|i\.saku|sakuku)\b/i.test(payment.bankOrWalletName ?? "");
  return { ...payment, method: isWallet ? "ewallet" : "bank" };
}
