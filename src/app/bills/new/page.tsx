import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAuthenticatedHost } from "@/server/auth/session";
import { getScanQuotaStatus } from "@/server/store/repository";
import { NewBillClient } from "./NewBillClient";
import { getServerConfig } from "@/server/config/env";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Tagihan baru" };

export default async function NewBillPage() {
  let host = null;
  try {
    host = await getAuthenticatedHost();
  } catch {
    redirect("/login");
  }
  if (!host) {
    redirect("/login");
  }

  const quotaStatus = await getScanQuotaStatus(host.uid);
  return <NewBillClient quotaStatus={quotaStatus} receiptsEnabled={getServerConfig().receipts.enabled} />;
}
