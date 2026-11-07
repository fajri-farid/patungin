import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getAuthenticatedHost } from "@/server/auth/session";
import { getServerConfig } from "@/server/config/env";
import { isCurrentShareId, signShareToken } from "@/server/shares/token";
import {
  AppServiceError,
  getActiveFinalizationForBill,
  getBillForOwner,
  resolvePublicShareToken,
} from "@/server/store/repository";
import { ResultClient } from "./ResultClient";
import { getOwnerPhotoInfo } from "@/server/receipts/photos";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Hasil pembagian" };

export default async function BillResultPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  let host = null;
  try {
    host = await getAuthenticatedHost();
  } catch {
    redirect("/login");
  }
  if (!host) {
    redirect("/login");
  }

  const { id } = await params;

  let bill = null;
  let activeSnapshot = null;
  try {
    [bill, activeSnapshot] = await Promise.all([
      getBillForOwner(id, host.uid),
      getActiveFinalizationForBill(id, host.uid),
    ]);
  } catch (err) {
    if (err instanceof AppServiceError && err.statusCode === 404) {
      notFound();
    }
    redirect("/app");
  }

  const config = getServerConfig();
  const candidateShareToken =
    bill.activeShareId &&
    isCurrentShareId(bill.activeShareId) &&
    config.share.isConfigured
      ? signShareToken(bill.activeShareId)
      : null;
  const existingShareToken =
    candidateShareToken && (await resolvePublicShareToken(candidateShareToken))
      ? candidateShareToken
      : null;

  return (
    <ResultClient
      initialBill={bill}
      initialSnapshot={activeSnapshot}
      initialShareToken={existingShareToken}
      appOrigin={config.appOrigin}
      shareLinksEnabled={config.share.linksEnabled}
      initialPhoto={await getOwnerPhotoInfo(bill)}
      photoSharingEnabled={config.receipts.sharingEnabled}
    />
  );
}
