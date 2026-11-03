import { AccessError } from "../access/types";

export const ADMIN_PAGE_SIZE = 25;
export type MonitorPeriod = "today" | "week" | "month";

export function validUid(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 128 ||
    value.includes("/")
  )
    throw new AccessError("INVALID_ACCOUNT", "Akun tidak valid.", 400);
  return value;
}

/** Scope includes every filter: a cursor from another search must never be reused. */
export function encodeCursor(scope: string, values: string[]) {
  return Buffer.from(JSON.stringify({ scope, values })).toString("base64url");
}
export function decodeCursor(
  raw: string | undefined,
  scope: string,
  count: number,
): string[] | null {
  if (!raw) return null;
  try {
    if (typeof raw !== "string" || raw.length > 2048 || !/^[\w-]+$/.test(raw))
      throw new Error();
    const cursor = JSON.parse(Buffer.from(raw, "base64url").toString());
    if (
      cursor.scope !== scope ||
      !Array.isArray(cursor.values) ||
      cursor.values.length !== count ||
      cursor.values.some(
        (value: unknown) => typeof value !== "string" || value.length > 512,
      )
    )
      throw new Error();
    return cursor.values;
  } catch {
    throw new AccessError(
      "INVALID_CURSOR",
      "Halaman tidak valid. Mulai dari halaman pertama.",
      400,
    );
  }
}

export function periodBounds(period: MonitorPeriod, now = Date.now()) {
  if (!["today", "week", "month"].includes(period) || !Number.isFinite(now))
    throw new AccessError("INVALID_PERIOD", "Periode tidak valid.", 400);
  const local = new Date(now + 8 * 3600000).toISOString();
  const day = Date.parse(`${local.slice(0, 10)}T00:00:00+08:00`);
  const start =
    period === "month"
      ? Date.parse(`${local.slice(0, 7)}-01T00:00:00+08:00`)
      : period === "week"
        ? day - 6 * 86400000
        : day;
  return {
    start: new Date(start).toISOString(),
    end: new Date(now).toISOString(),
  };
}
