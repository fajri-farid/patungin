import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getAuthenticatedHost } from "@/server/auth/session";
import { AppServiceError, getBillForOwner } from "@/server/store/repository";
import { ReviewClient } from "./ReviewClient";
import { getOwnerPhotoInfo } from "@/server/receipts/photos";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Cek struk" };

export default async function BillReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ photo?: string }>;
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
  try {
    bill = await getBillForOwner(id, host.uid);
  } catch (err) {
    if (err instanceof AppServiceError && err.statusCode === 404) {
      notFound();
    }
    redirect("/app");
  }

  return <ReviewClient initialBill={bill} initialPhoto={await getOwnerPhotoInfo(bill)} photoNotSaved={(await searchParams).photo === "not-saved"} />;
}
