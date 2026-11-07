import crypto from "node:crypto";
import {
  paymentSnapshot,
  validatePaymentProfile,
  type PaymentProfile,
  type PaymentProfileInput,
} from "@/domain/payment-profile";
import { AppServiceError } from "../store/repository";
import { productTransaction, readProductDocument } from "../store/transaction";
import { qrisIds, syncQrisReferences } from "./qris-references";

export async function getPaymentProfile(
  ownerUid: string,
): Promise<PaymentProfile> {
  return (
    (await readProductDocument<PaymentProfile>(
      "paymentProfiles",
      ownerUid,
    )) ?? {
      ownerUid,
      schemaVersion: 1,
      revision: 0,
      methods: [],
      defaultMethodId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastMutationAt: 0,
    }
  );
}

export async function savePaymentProfile(
  ownerUid: string,
  expectedRevision: number,
  input: PaymentProfileInput,
): Promise<PaymentProfile> {
  let normalized: PaymentProfileInput;
  try {
    normalized = validatePaymentProfile(input);
  } catch (error) {
    throw new AppServiceError(
      422,
      "INVALID_PAYMENT_PROFILE",
      (error as Error).message,
    );
  }
  return productTransaction(async (tx) => {
    const current = await tx.get<PaymentProfile>("paymentProfiles", ownerUid);
    if (
      !Number.isSafeInteger(expectedRevision) ||
      expectedRevision !== (current?.revision ?? 0)
    ) {
      throw new AppServiceError(
        409,
        "STALE_REVISION",
        "Pengaturan berubah di perangkat lain. Muat ulang dan periksa lagi.",
      );
    }
    if (current && Date.now() - current.lastMutationAt < 500)
      throw new AppServiceError(
        429,
        "PAYMENT_RATE_LIMIT",
        "Tunggu sebentar sebelum menyimpan lagi.",
      );
    // IDs supplied for new entries are temporary client keys; only server-created IDs persist.
    const ids = new Map(
      normalized.methods.map((method) => [
        method.id,
        current?.methods.some((saved) => saved.id === method.id)
          ? method.id
          : `pay_${crypto.randomUUID()}`,
      ]),
    );
    const now = new Date().toISOString();
    const next: PaymentProfile = {
      ownerUid,
      schemaVersion: 1,
      revision: expectedRevision + 1,
      methods: normalized.methods.map((method) => ({
        ...method,
        id: ids.get(method.id)!,
      })),
      defaultMethodId: normalized.defaultMethodId
        ? ids.get(normalized.defaultMethodId)!
        : null,
      createdAt: current?.createdAt ?? now,
      updatedAt: now,
      lastMutationAt: Date.now(),
    };
    await syncQrisReferences(tx, ownerUid, qrisIds(current?.methods), qrisIds(next.methods));
    tx.set("paymentProfiles", ownerUid, next);
    return next;
  });
}

export async function selectPaymentMethods(ownerUid: string, ids: string[]) {
  if (
    !Array.isArray(ids) ||
    !ids.length ||
    ids.length > 10 ||
    ids.some((id) => typeof id !== "string") ||
    new Set(ids).size !== ids.length
  ) {
    throw new AppServiceError(
      422,
      "INVALID_SELECTION",
      "Pilih tujuan pembayaran yang ingin dipakai.",
    );
  }
  const profile = await getPaymentProfile(ownerUid);
  return ids.map((id) => {
    const method = profile.methods.find((saved) => saved.id === id);
    if (!method)
      throw new AppServiceError(
        409,
        "PAYMENT_REMOVED",
        "Rekening sudah berubah/dihapus. Buka ulang pemilih rekening.",
      );
    return paymentSnapshot(method);
  });
}
