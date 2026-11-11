import { MAX_PAYMENT_METHODS, normalizePaymentNote } from "./billing/payment";
import type { PaymentMethodNote } from "./billing/types";

export interface SavedPaymentMethod extends PaymentMethodNote {
  id: string;
  label: string;
  method: "bank" | "ewallet" | "qris";
}
export interface PaymentProfile {
  ownerUid: string;
  schemaVersion: number;
  revision: number;
  methods: SavedPaymentMethod[];
  defaultMethodId: string | null;
  createdAt: string;
  updatedAt: string;
  lastMutationAt: number;
}
export type PaymentProfileInput = Pick<
  PaymentProfile,
  "methods" | "defaultMethodId"
>;

export function validatePaymentProfile(
  input: PaymentProfileInput,
): PaymentProfileInput {
  if (
    !input ||
    !Array.isArray(input.methods) ||
    input.methods.length > MAX_PAYMENT_METHODS ||
    Object.keys(input).some(
      (key) => !["methods", "defaultMethodId"].includes(key),
    )
  ) {
    throw new Error("Simpan maksimal 10 tujuan pembayaran.");
  }
  const ids = new Set<string>();
  const methods = input.methods.map((raw) => {
    if (
      !raw ||
      typeof raw.id !== "string" ||
      !/^pay_[a-zA-Z0-9-]{8,64}$/.test(raw.id) ||
      ids.has(raw.id) ||
      typeof raw.label !== "string" ||
      raw.label.length > 60 ||
      !["bank", "ewallet", "qris"].includes(raw.method) ||
      Object.keys(raw).some(
        (key) =>
          ![
            "id",
            "label",
            "method",
            "bankOrWalletName",
            "accountNumber",
            "accountHolderName",
            "note",
            "qrisImageId",
          ].includes(key),
      )
    ) {
      throw new Error(
        "Periksa nama pengingat dan jenis pembayaran, lalu simpan lagi.",
      );
    }
    ids.add(raw.id);
    if (raw.method === "qris" && !raw.qrisImageId)
      throw new Error(
        "Unggah gambar QRIS sebelum menyimpan tujuan pembayaran.",
      );
    return {
      ...normalizePaymentNote(raw)!,
      id: raw.id,
      label: raw.label.trim(),
      method: raw.method,
    };
  });
  if (input.defaultMethodId !== null && !ids.has(input.defaultMethodId))
    throw new Error("Pilih tujuan pembayaran utama dari daftar yang tersimpan.");
  return { methods, defaultMethodId: input.defaultMethodId };
}

export function paymentSnapshot(method: SavedPaymentMethod): PaymentMethodNote {
  return normalizePaymentNote(method)!;
}
