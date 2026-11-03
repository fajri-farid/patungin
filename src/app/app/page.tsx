import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAuthenticatedHost } from "@/server/auth/session";
import {
  getScanQuotaStatus,
  getLatestDraftByOwner,
  listBillsByOwner,
} from "@/server/store/repository";
import { DashboardClient } from "./DashboardClient";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Tagihan saya" };

export default async function AppHomePage() {
  let host = null;
  try {
    host = await getAuthenticatedHost();
  } catch {
    redirect("/login");
  }

  if (!host) {
    redirect("/login");
  }

  const [billPage, latestDraft, quotaStatus] = await Promise.all([
    listBillsByOwner(host.uid, { pageSize: 5 }),
    getLatestDraftByOwner(host.uid),
    getScanQuotaStatus(host.uid),
  ]);

  return (
    <DashboardClient
      host={host}
      initialBills={billPage.bills}
      hasMoreBills={!!billPage.nextCursor}
      latestDraft={latestDraft}
      quotaStatus={quotaStatus}
    />
  );
}
