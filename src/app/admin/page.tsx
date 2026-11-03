import { redirect } from "next/navigation";

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  const routes: Record<string, string> = { monitor: "monitoring", users: "users", invites: "invites", alerts: "alerts" };
  redirect(`/admin/${tab && Object.hasOwn(routes, tab) ? routes[tab] : "monitoring"}`);
}
