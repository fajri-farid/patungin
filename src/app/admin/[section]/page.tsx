import { notFound, redirect } from "next/navigation";
import { getSessionIdentity } from "@/server/auth/session";
import { isAdmin } from "@/server/access/accounts";
import { getAdminPanel, type AdminTab, type PanelQuery } from "@/server/admin/data";
import { getServerConfig } from "@/server/config/env";
import { AdminClient } from "../AdminClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Kelola akses", robots: { index: false, follow: false } };

export default async function AdminSectionPage({ params }: { params: Promise<{ section: string }> }) {
  const identity = await getSessionIdentity();
  if (!identity) redirect("/login");
  if (!isAdmin(identity)) notFound();
  const { section } = await params;
  const routes: Record<string, AdminTab> = { monitoring: "monitor", users: "users", invites: "invites", alerts: "alerts" };
  const tab = Object.hasOwn(routes, section) ? routes[section] : undefined;
  if (!tab) notFound();
  const query: PanelQuery = { tab };
  const initial = await getAdminPanel(query);
  return <AdminClient key={tab} email={identity.email} initial={initial} initialQuery={query} appOrigin={getServerConfig().appOrigin} />;
}
