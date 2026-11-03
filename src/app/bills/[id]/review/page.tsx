import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getAuthenticatedHost } from "@/server/auth/session";
import { AppServiceError, getBillForOwner } from "@/server/store/repository";
import { ReviewClient } from "./ReviewClient";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Cek struk" };

export default async function BillReviewPage({
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
  try {
    bill = await getBillForOwner(id, host.uid);
  } catch (err) {
    if (err instanceof AppServiceError && err.statusCode === 404) {
      notFound();
    }
    redirect("/app");
  }

  return <ReviewClient initialBill={bill} />;
}
