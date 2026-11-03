import { redirect } from "next/navigation";
import { getSessionIdentity } from "@/server/auth/session";
import { ensureAccount, hasProductAccess } from "@/server/access/accounts";
import { ActivationClient } from "./ActivationClient";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Aktifkan akses",
  robots: { index: false, follow: false },
};

export default async function ActivatePage() {
  const identity = await getSessionIdentity();
  if (!identity) redirect("/login");
  const account = await ensureAccount(identity);
  if (await hasProductAccess(identity.uid, identity.email)) redirect("/app");
  return (
    <ActivationClient
      email={identity.email}
      canClaim={account.status === "pending"}
    />
  );
}
