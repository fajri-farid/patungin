"use server";

import { revalidatePath } from "next/cache";
import type {
  BillDocument,
  FinalizationSnapshot,
} from "@/domain/billing/types";
import {
  AuthGuardError,
  requireAuthenticatedHost,
  verifyRequestOrigin,
  getSessionIdentity,
} from "@/server/auth/session";
import {
  AppServiceError,
  createDraftBill,
  deleteBillForOwner,
  finalizeBillOnServer,
  publishBillShareLink,
  reopenBillToDraft,
  revokeBillShareLink,
  saveBillDraft,
  type SaveBillDraftPatch,
  type ShareRecord,
} from "@/server/store/repository";
import { recordOperationalEvent } from "@/server/observability/events";
import { DIAGNOSTICS } from "@/domain/diagnostics";

export interface ActionResponse<T> {
  ok: boolean;
  data?: T;
  error?: string;
  code?: string;
  statusCode?: number;
}

async function handleActionError<T>(err: unknown): Promise<ActionResponse<T>> {
  if (err instanceof AuthGuardError) {
    return {
      ok: false,
      error: err.message,
      code: err.code,
      statusCode: err.statusCode,
    };
  }
  if (err instanceof AppServiceError) {
    if (Object.hasOwn(DIAGNOSTICS, err.code)) {
      const identity = await getSessionIdentity().catch(() => null);
      if (identity)
        await recordOperationalEvent({
          ownerUid: identity.uid,
          code: err.code,
          stage: "bill",
        });
    }
    return {
      ok: false,
      error: err.message,
      code: err.code,
      statusCode: err.statusCode,
    };
  }
  const identity = await getSessionIdentity().catch(() => null);
  if (identity)
    await recordOperationalEvent({
      ownerUid: identity.uid,
      code: "UNEXPECTED_ERROR",
      stage: "bill",
    });
  return {
    ok: false,
    error: "Perubahan belum berhasil disimpan. Periksa koneksi lalu coba lagi.",
    code: "INTERNAL_ERROR",
    statusCode: 500,
  };
}

export async function createBillAction(params: {
  title?: string;
  merchant?: string;
}): Promise<ActionResponse<BillDocument>> {
  try {
    await verifyRequestOrigin();
    const host = await requireAuthenticatedHost();
    const bill = await createDraftBill({
      ownerUid: host.uid,
      ownerVerifiedEmail: host.email,
      ownerDisplayName: host.displayName,
      title: params.title,
      merchant: params.merchant,
    });
    revalidatePath("/app");
    revalidatePath("/history");
    return { ok: true, data: bill };
  } catch (err) {
    return handleActionError(err);
  }
}

export async function saveDraftAction(
  billId: string,
  patch: SaveBillDraftPatch,
): Promise<ActionResponse<BillDocument>> {
  try {
    await verifyRequestOrigin();
    const host = await requireAuthenticatedHost();
    const updated = await saveBillDraft(billId, host.uid, patch);
    revalidatePath(`/bills/${billId}/review`);
    revalidatePath(`/bills/${billId}/split`);
    revalidatePath(`/bills/${billId}/result`);
    revalidatePath("/app");
    return { ok: true, data: updated };
  } catch (err) {
    return handleActionError(err);
  }
}

export async function finalizeBillAction(params: {
  billId: string;
  expectedRevision: number;
}): Promise<
  ActionResponse<{ bill: BillDocument; snapshot: FinalizationSnapshot }>
> {
  try {
    await verifyRequestOrigin();
    const host = await requireAuthenticatedHost();
    const result = await finalizeBillOnServer({
      billId: params.billId,
      ownerUid: host.uid,
      expectedRevision: params.expectedRevision,
    });
    revalidatePath(`/bills/${params.billId}/result`);
    revalidatePath("/app");
    revalidatePath("/history");
    return { ok: true, data: result };
  } catch (err) {
    return handleActionError(err);
  }
}

export async function reopenBillAction(params: {
  billId: string;
  expectedRevision: number;
}): Promise<ActionResponse<BillDocument>> {
  try {
    await verifyRequestOrigin();
    const host = await requireAuthenticatedHost();
    const updated = await reopenBillToDraft({
      billId: params.billId,
      ownerUid: host.uid,
      expectedRevision: params.expectedRevision,
    });
    revalidatePath(`/bills/${params.billId}/review`);
    revalidatePath(`/bills/${params.billId}/split`);
    revalidatePath(`/bills/${params.billId}/result`);
    revalidatePath("/app");
    return { ok: true, data: updated };
  } catch (err) {
    return handleActionError(err);
  }
}

export async function publishShareAction(params: {
  billId: string;
  expectedRevision: number;
}): Promise<
  ActionResponse<{
    shareToken: string;
    shareRecord: ShareRecord;
    bill: BillDocument;
  }>
> {
  try {
    await verifyRequestOrigin();
    const host = await requireAuthenticatedHost();
    const result = await publishBillShareLink({
      billId: params.billId,
      ownerUid: host.uid,
      expectedRevision: params.expectedRevision,
    });
    revalidatePath(`/bills/${params.billId}/result`);
    return { ok: true, data: result };
  } catch (err) {
    return handleActionError(err);
  }
}

export async function revokeShareAction(params: {
  billId: string;
}): Promise<ActionResponse<BillDocument>> {
  try {
    await verifyRequestOrigin();
    const host = await requireAuthenticatedHost();
    const updated = await revokeBillShareLink({
      billId: params.billId,
      ownerUid: host.uid,
    });
    revalidatePath(`/bills/${params.billId}/result`);
    return { ok: true, data: updated };
  } catch (err) {
    return handleActionError(err);
  }
}

export async function deleteBillAction(params: {
  billId: string;
}): Promise<ActionResponse<{ deleted: true }>> {
  try {
    await verifyRequestOrigin();
    const host = await requireAuthenticatedHost();
    await deleteBillForOwner({
      billId: params.billId,
      ownerUid: host.uid,
    });
    revalidatePath("/app");
    revalidatePath("/history");
    return { ok: true, data: { deleted: true } };
  } catch (err) {
    return handleActionError(err);
  }
}
