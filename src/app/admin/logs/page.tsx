import { notFound, redirect } from "next/navigation";
import { getSessionIdentity } from "@/server/auth/session";
import { isAdmin } from "@/server/access/accounts";
import { getLogsPage, type LogQuery } from "@/server/admin/logs";
import { LogsClient } from "./LogsClient";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Log aktivitas admin",
  robots: { index: false, follow: false },
};

export default async function LogsPage() {
  const identity = await getSessionIdentity();
  if (!identity) redirect("/login");
  if (!isAdmin(identity)) notFound();
  const query: LogQuery = { category: "scans", period: "today", filter: "all" };
  return <LogsClient initial={await getLogsPage(query)} initialQuery={query} />;
}
