import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getAuthenticatedHost } from "@/server/auth/session";
import { AppServiceError, getBillForOwner } from "@/server/store/repository";
import { SplitClient } from "./SplitClient";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Bagi pesanan" };

export default async function BillSplitPage({
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

  return <SplitClient initialBill={bill} />;
}
