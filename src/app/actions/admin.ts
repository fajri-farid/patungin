"use server";

import { AuthGuardError, verifyRequestOrigin } from "@/server/auth/session";
import { AccessError } from "@/server/access/types";
import {
  getAdminPanel,
  getAlertsPage,
  getUserProfile,
  getAccountAudits,
  prepareAdminAccounts,
  type PanelQuery,
} from "@/server/admin/data";
import { getUserActivity } from "@/server/admin/monitoring";
import type { MonitorPeriod } from "@/server/admin/pagination";
import { requireAdmin } from "@/server/auth/session";
import { recordOperationalEvent } from "@/server/observability/events";
import { getLogsPage, type LogQuery } from "@/server/admin/logs";
import { classifyQueryError } from "@/server/firebase/query-errors";

async function read<T>(operation: () => Promise<T>) {
  let actor: string | undefined;
  try {
    await verifyRequestOrigin();
    actor = (await requireAdmin()).uid;
    return { ok: true as const, data: await operation() };
  } catch (error) {
    const queryError = classifyQueryError(error);
    if (
      actor &&
      !(error instanceof AccessError) &&
      !(error instanceof AuthGuardError)
    )
      await recordOperationalEvent({
        ownerUid: actor,
        code: queryError?.code ?? "DATABASE_FAILED",
        stage: "admin_read",
      });
    return {
      ok: false as const,
      error:
        error instanceof AccessError || error instanceof AuthGuardError
          ? error.message
          : (queryError?.message ??
            "Data belum dapat dimuat. Periksa koneksi dan coba lagi."),
      code:
        error instanceof AccessError || error instanceof AuthGuardError
          ? error.code
          : (queryError?.code ?? "UNAVAILABLE"),
    };
  }
}

export async function loadAdminPanel(input: PanelQuery) {
  return read(() => getAdminPanel(input));
}
export async function loadUserProfile(uid: string) {
  return read(() => getUserProfile(uid));
}
export async function loadUserActivity(
  uid: string,
  period: MonitorPeriod,
  after?: string,
) {
  return read(() => getUserActivity(uid, { period, after }));
}
export async function loadAccountAudits(uid: string, after?: string) {
  return read(() => getAccountAudits(uid, after));
}
export async function prepareAdminAccountsAction(after?: string) {
  return read(() => prepareAdminAccounts(after));
}
export async function loadLogsPage(input: LogQuery) {
  return read(() => getLogsPage(input));
}

/** A bounded preview per category; failures are kept distinct from empty results. */
export async function loadAdminAlertCounts() {
  const kinds = ["low", "expiry", "failures"] as const;
  const results = await Promise.all(
    kinds.map((kind) => read(async () => {
      const page = await getAlertsPage(kind);
      return { count: page.items.length, more: !!page.next };
    })),
  );
  return { low: results[0], expiry: results[1], failures: results[2] };
}
