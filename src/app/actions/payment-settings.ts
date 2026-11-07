"use server";
import {
  AuthGuardError,
  requireAuthenticatedHost,
  verifyRequestOrigin,
} from "@/server/auth/session";
import {
  getPaymentProfile,
  savePaymentProfile,
  selectPaymentMethods,
} from "@/server/payments/profiles";
import { AppServiceError } from "@/server/store/repository";
import type { PaymentProfileInput } from "@/domain/payment-profile";
import type { ActionResponse } from "./bills";

function failure<T>(error: unknown): ActionResponse<T> {
  return error instanceof AppServiceError || error instanceof AuthGuardError
    ? {
        ok: false,
        error: error.message,
        code: error.code,
        statusCode: error.statusCode,
      }
    : {
        ok: false,
        error: "Pengaturan belum bisa diakses. Periksa koneksi lalu coba lagi.",
      };
}
export async function getPaymentProfileAction() {
  try {
    const host = await requireAuthenticatedHost();
    return { ok: true as const, data: await getPaymentProfile(host.uid) };
  } catch (error) {
    return failure<Awaited<ReturnType<typeof getPaymentProfile>>>(error);
  }
}
export async function savePaymentProfileAction(
  expectedRevision: number,
  input: PaymentProfileInput,
) {
  try {
    await verifyRequestOrigin();
    const host = await requireAuthenticatedHost();
    return {
      ok: true as const,
      data: await savePaymentProfile(host.uid, expectedRevision, input),
    };
  } catch (error) {
    return failure<Awaited<ReturnType<typeof savePaymentProfile>>>(error);
  }
}
export async function selectPaymentMethodsAction(ids: string[]) {
  try {
    await verifyRequestOrigin();
    const host = await requireAuthenticatedHost();
    return {
      ok: true as const,
      data: await selectPaymentMethods(host.uid, ids),
    };
  } catch (error) {
    return failure<Awaited<ReturnType<typeof selectPaymentMethods>>>(error);
  }
}
