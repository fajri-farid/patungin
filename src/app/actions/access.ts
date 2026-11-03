"use server";

import { revalidatePath } from "next/cache";
import {
  AuthGuardError,
  requireAdmin,
  requireSessionIdentity,
  verifyRequestOrigin,
} from "@/server/auth/session";
import {
  claimInvite,
  createInvite,
  setInviteActive,
  updateAccount,
  type CreateInviteInput,
  type UpdateAccountInput,
} from "@/server/access/accounts";
import { AccessError } from "@/server/access/types";
import { recordOperationalEvent } from "@/server/observability/events";
import { DIAGNOSTICS } from "@/domain/diagnostics";

async function perform<T>(action: () => Promise<T>) {
  try {
    await verifyRequestOrigin();
    const data = await action();
    // Admin refreshes only its active panel after a mutation. Invalidating its
    // route here would also re-run the initial monitoring query in the same POST.
    revalidatePath("/app");
    revalidatePath("/activate");
    return { ok: true as const, data };
  } catch (error) {
    return {
      ok: false as const,
      error:
        error instanceof AccessError || error instanceof AuthGuardError
          ? error.message
          : "Belum berhasil menyimpan. Coba lagi.",
      code:
        error instanceof AccessError || error instanceof AuthGuardError
          ? error.code
          : "UNAVAILABLE",
    };
  }
}

async function adminOperation<T>(
  action: (admin: Awaited<ReturnType<typeof requireAdmin>>) => Promise<T>,
  subjectUid?: string,
) {
  const admin = await requireAdmin();
  try {
    return await action(admin);
  } catch (error) {
    if (
      !(error instanceof AccessError) ||
      Object.hasOwn(DIAGNOSTICS, error.code)
    )
      await recordOperationalEvent({
        ownerUid: admin.uid,
        code: error instanceof AccessError ? error.code : "UNEXPECTED_ERROR",
        stage: "account",
        subjectUid,
      });
    throw error;
  }
}

export async function createInviteAction(input: CreateInviteInput) {
  return perform(async () => {
    return adminOperation(() => createInvite(input));
  });
}
export async function setInviteActiveAction(id: string, active: boolean) {
  return perform(async () => {
    return adminOperation(() => setInviteActive(id, active));
  });
}
export async function updateAccountAction(input: UpdateAccountInput) {
  return perform(async () => {
    return adminOperation((admin) => updateAccount(admin, input), input.uid);
  });
}
export async function claimInviteAction(code: string) {
  return perform(async () => {
    const identity = await requireSessionIdentity();
    await claimInvite(identity, code);
  });
}
