import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAuthenticatedHost } from "@/server/auth/session";
import { getPaymentProfile } from "@/server/payments/profiles";
import { PaymentSettingsClient } from "./PaymentSettingsClient";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Tujuan pembayaran",
  robots: { index: false, follow: false },
};

export default async function PaymentSettingsPage() {
  const host = await getAuthenticatedHost();
  if (!host) redirect("/login");
  return (
    <PaymentSettingsClient
      initialProfile={await getPaymentProfile(host.uid)}
      email={host.email}
      admin={host.isAdmin}
    />
  );
}
