import type { UserAccount } from "@/server/access/types";
import type { getScanQuotaStatus } from "@/server/store/repository";
import type { AdminScanActivity } from "@/server/admin/monitoring";

export type Quota = Awaited<ReturnType<typeof getScanQuotaStatus>>;
export type ManagedUser = Omit<
  UserAccount,
  "claimWindowAt" | "claimFailures"
> & { isAdmin: boolean };
export type MessageHandler = (text: string, error?: boolean) => void;

const dateFormatter = new Intl.DateTimeFormat("id-ID", {
  timeZone: "Asia/Makassar",
  dateStyle: "medium",
  timeStyle: "short",
});
export const numberLabel = (value: number) =>
  new Intl.NumberFormat("id-ID").format(value);
export function dateLabel(
  value: string | null,
  fallback = "Tanpa batas waktu",
) {
  return value ? `${dateFormatter.format(new Date(value))} WITA` : fallback;
}
export function monthLabel(key: string) {
  return new Intl.DateTimeFormat("id-ID", {
    month: "long",
    year: "numeric",
    timeZone: "Asia/Makassar",
  }).format(new Date(`${key}-01T00:00:00+08:00`));
}
export function toWitaInput(value: string | null) {
  return value
    ? new Date(Date.parse(value) + 8 * 3600000).toISOString().slice(0, 16)
    : "";
}
export function fromWitaInput(value: string) {
  return value ? new Date(`${value}:00+08:00`).toISOString() : null;
}
export function accountState(user: ManagedUser, now: number) {
  if (user.isAdmin) return { key: "admin", label: "Admin", tone: "blue" };
  if (user.status === "disabled")
    return { key: "disabled", label: "Nonaktif", tone: "muted" };
  if (user.status === "pending")
    return { key: "pending", label: "Menunggu akses", tone: "amber" };
  if (user.accessUntil && Date.parse(user.accessUntil) <= now)
    return { key: "expired", label: "Akses berakhir", tone: "red" };
  return { key: "active", label: "Aktif", tone: "green" };
}
export function scanState(
  scan: Pick<AdminScanActivity, "state" | "reservedAt">,
  now: number,
) {
  if (scan.state === "succeeded")
    return { key: "succeeded", label: "Berhasil", tone: "green" };
  if (scan.state === "failed")
    return { key: "failed", label: "Gagal", tone: "red" };
  if (scan.state === "unknown" || now - Date.parse(scan.reservedAt) >= 60000)
    return { key: "unknown", label: "Perlu dicek", tone: "amber" };
  return { key: "running", label: "Diproses", tone: "blue" };
}
export function durationLabel(scan: AdminScanActivity) {
  if (!scan.completedAt) return "Belum selesai";
  const ms =
    Date.parse(scan.completedAt) -
    Date.parse(scan.dispatchedAt || scan.reservedAt);
  return `${Math.max(0, ms / 1000).toLocaleString("id-ID", { maximumFractionDigits: 1 })} dtk`;
}
export function sourceLabel(source: UserAccount["source"]) {
  return source === "admin"
    ? "Admin deployment"
    : source === "invite"
      ? "Kode undangan"
      : source === "direct"
        ? "Akses langsung"
        : source === "legacy"
          ? "Daftar email"
          : "Belum diaktifkan";
}
