import { hasProductAccess } from "@/server/access/accounts";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthGuardError, getSessionIdentity } from "@/server/auth/session";
import { getServerConfig } from "@/server/config/env";
import { LoginClient } from "./LoginClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Masuk",
  description:
    "Masuk ke Patungin dengan Google untuk membuat tagihan dan menyimpan rincian patunganmu.",
};

export default async function LoginPage() {
  let host = null;
  let initialErrorCode: string | null = null;

  try {
    host = await getSessionIdentity();
  } catch (err) {
    initialErrorCode =
      err instanceof AuthGuardError ? err.code : "SESSION_EXCHANGE_FAILED";
  }

  if (host) {
    redirect(await hasProductAccess(host.uid, host.email) ? "/app" : "/activate");
  }

  const config = getServerConfig();

  return (
    <LoginClient
      isFirebaseConfigured={config.firebase.isConfigured}
      initialErrorCode={initialErrorCode}
    />
  );
}
