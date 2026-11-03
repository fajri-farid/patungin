import { requireAdmin } from "../auth/session";
import { getServerConfig } from "../config/env";
import { getAdminFirestore } from "../firebase/admin";
import { readDevDb } from "../store/dev-database";
import { monthKey } from "../access/accounts";
import { AccessError } from "../access/types";
import type { ScanAttemptRecord, UsageBucketRecord } from "../store/repository";
import { FieldPath } from "@google-cloud/firestore";
import {
  ADMIN_PAGE_SIZE,
  decodeCursor,
  encodeCursor,
  periodBounds,
  validUid,
  type MonitorPeriod,
} from "./pagination";

const RECENT_LIMIT = 25;
export type ScanLogFilter =
  "all" | "failed" | "unknown" | "processing" | "not_applied";

export type AdminScanActivity = Pick<
  ScanAttemptRecord,
  | "id"
  | "ownerUid"
  | "billId"
  | "state"
  | "reservedAt"
  | "dispatchedAt"
  | "completedAt"
  | "model"
  | "errorCode"
  | "applicationOutcome"
  | "requestId"
> & { displayName: string; email: string | null };

export interface AdminMonitoring {
  monthKey: string;
  evaluatedAt: number;
  monthlyAttempts: number;
  accountsWithUsage: number;
  activeScans: number;
  scanEnabled: boolean;
  hasMoreActivity: boolean;
  activity: AdminScanActivity[];
  period: MonitorPeriod;
  next: string | null;
}

/** An explicit projection keeps OCR payloads, image hashes and raw errors off the client. */
export function projectMonitoring(
  usage: UsageBucketRecord | undefined,
  attempts: ScanAttemptRecord[],
  owners: Map<string, { displayName: string; email: string }>,
  now: number,
  key: string,
  scanEnabled: boolean,
): AdminMonitoring {
  const counts = Object.values(usage?.userAttempts ?? {});
  return {
    monthKey: key,
    evaluatedAt: now,
    monthlyAttempts: counts.reduce((total, count) => total + count, 0),
    accountsWithUsage: counts.filter((count) => count > 0).length,
    activeScans: Object.values(usage?.activeLeases ?? {}).filter(
      (until) => until > now,
    ).length,
    scanEnabled,
    period: "month",
    next: null,
    hasMoreActivity: attempts.length > RECENT_LIMIT,
    activity: attempts.slice(0, RECENT_LIMIT).map((attempt) => ({
      id: attempt.id,
      ownerUid: attempt.ownerUid,
      billId: attempt.billId,
      state: attempt.state,
      reservedAt: attempt.reservedAt,
      dispatchedAt: attempt.dispatchedAt,
      completedAt: attempt.completedAt,
      requestId:
        attempt.requestId && /^[\w-]{1,128}$/.test(attempt.requestId)
          ? attempt.requestId
          : null,
      applicationOutcome: [
        "applied",
        "draft_changed",
        "access_inactive",
        "bill_finalized",
        "bill_deleted",
        "not_requested",
      ].includes(attempt.applicationOutcome ?? "")
        ? attempt.applicationOutcome
        : null,
      model: attempt.model,
      errorCode:
        attempt.errorCode && /^[A-Z0-9_]{1,80}$/.test(attempt.errorCode)
          ? attempt.errorCode
          : null,
      displayName:
        owners.get(attempt.ownerUid)?.displayName || "Akun tidak tersedia",
      email: owners.get(attempt.ownerUid)?.email ?? null,
    })),
  };
}

export async function getAdminMonitoring(
  options: { period?: MonitorPeriod; after?: string } = {},
): Promise<AdminMonitoring> {
  // Guard before any database read, including when called outside the admin page.
  await requireAdmin();
  const config = getServerConfig();
  const now = Date.now();
  const key = monthKey(new Date(now));
  const [page, usage] = await Promise.all([
    readActivityPage({ ...options, now }),
    config.isDevSandbox
      ? Promise.resolve(readDevDb().usageMonths[key])
      : getAdminFirestore()
          .collection("usageMonths")
          .doc(key)
          .get()
          .then((doc) => doc.data() as UsageBucketRecord | undefined),
  ]);
  return {
    ...projectMonitoring(
      usage,
      [],
      new Map(),
      now,
      key,
      config.gemini.scanEnabled,
    ),
    activity: page.activity,
    hasMoreActivity: !!page.next,
    next: page.next,
    period: options.period ?? "month",
  };
}

export interface ActivityPage {
  activity: AdminScanActivity[];
  next: string | null;
  evaluatedAt: number;
}

export async function getUserActivity(
  uid: string,
  options: { period?: MonitorPeriod; after?: string } = {},
): Promise<ActivityPage> {
  await requireAdmin();
  return readActivityPage({ ...options, uid: validUid(uid), now: Date.now() });
}

export async function getScanLogs(
  options: {
    period?: MonitorPeriod;
    after?: string;
    filter?: ScanLogFilter;
  } = {},
): Promise<ActivityPage> {
  await requireAdmin();
  if (
    !["all", "failed", "unknown", "processing", "not_applied"].includes(
      options.filter ?? "all",
    )
  )
    throw new AccessError("INVALID_FILTER", "Filter log tidak valid.", 400);
  return readActivityPage({ ...options, now: Date.now() });
}

async function readActivityPage(options: {
  period?: MonitorPeriod;
  after?: string;
  uid?: string;
  now: number;
  filter?: ScanLogFilter;
}): Promise<ActivityPage> {
  const period = options.period ?? "month";
  const scope = JSON.stringify([
    "scans",
    period,
    options.uid ?? null,
    ...(options.filter ? [options.filter] : []),
  ]);
  const cursor = decodeCursor(options.after, scope, 3);
  const bounds = periodBounds(
    period,
    cursor ? Date.parse(cursor[2]) : options.now,
  );
  if (
    cursor &&
    (cursor[2] !== bounds.end ||
      cursor[0] < bounds.start ||
      cursor[0] > bounds.end ||
      cursor[1].includes("/"))
  )
    throw new AccessError(
      "INVALID_CURSOR",
      "Halaman aktivitas tidak valid. Mulai dari halaman pertama.",
      400,
    );
  const config = getServerConfig();
  let attempts: ScanAttemptRecord[];
  const owners = new Map<string, { displayName: string; email: string }>();
  if (config.isDevSandbox) {
    const data = readDevDb();
    attempts = Object.values(data.scanAttempts)
      .filter(
        (scan) =>
          (!options.uid || scan.ownerUid === options.uid) &&
          scan.reservedAt >= bounds.start &&
          scan.reservedAt <= bounds.end,
      )
      .filter(
        (scan) =>
          !options.filter ||
          options.filter === "all" ||
          (options.filter === "processing"
            ? ["reserved", "dispatched"].includes(scan.state)
            : options.filter === "not_applied"
              ? !!scan.applicationOutcome &&
                scan.applicationOutcome !== "applied"
              : scan.state === options.filter),
      )
      .sort((a, b) =>
        a.reservedAt !== b.reservedAt
          ? a.reservedAt < b.reservedAt
            ? 1
            : -1
          : a.id < b.id
            ? 1
            : a.id > b.id
              ? -1
              : 0,
      )
      .filter(
        (scan) =>
          !cursor ||
          scan.reservedAt < cursor[0] ||
          (scan.reservedAt === cursor[0] && scan.id < cursor[1]),
      )
      .slice(0, RECENT_LIMIT + 1);
    for (const scan of attempts) {
      const owner = data.users[scan.ownerUid];
      if (owner) owners.set(scan.ownerUid, owner);
    }
  } else {
    const db = getAdminFirestore();
    let query = db
      .collection("scanAttempts")
      .where("reservedAt", ">=", bounds.start)
      .where("reservedAt", "<=", bounds.end)
      .orderBy("reservedAt", "desc")
      .orderBy(FieldPath.documentId(), "desc")
      .limit(RECENT_LIMIT + 1)
      .select(
        "id",
        "ownerUid",
        "billId",
        "state",
        "reservedAt",
        "dispatchedAt",
        "completedAt",
        "model",
        "errorCode",
        "applicationOutcome",
        "requestId",
      );
    if (options.uid) query = query.where("ownerUid", "==", options.uid);
    if (options.filter === "failed" || options.filter === "unknown")
      query = query.where("state", "==", options.filter);
    if (options.filter === "processing")
      query = query.where("state", "in", ["reserved", "dispatched"]);
    if (options.filter === "not_applied")
      query = query.where("applicationOutcome", "in", [
        "draft_changed",
        "access_inactive",
        "bill_finalized",
        "bill_deleted",
        "not_requested",
      ]);
    if (cursor) query = query.startAfter(cursor[0], cursor[1]);
    const recent = await query.get();
    attempts = recent.docs.map(
      (doc) => ({ ...doc.data(), id: doc.id }) as ScanAttemptRecord,
    );
    const ownerIds = [
      ...new Set(
        attempts.slice(0, RECENT_LIMIT).map((attempt) => attempt.ownerUid),
      ),
    ];
    if (ownerIds.length) {
      const accounts = await db.getAll(
        ...ownerIds.map((uid) => db.collection("users").doc(uid)),
        { fieldMask: ["displayName", "email"] },
      );
      accounts.forEach((doc) => {
        if (doc.exists)
          owners.set(
            doc.id,
            doc.data() as { displayName: string; email: string },
          );
      });
    }
  }
  const last = attempts[Math.min(attempts.length, ADMIN_PAGE_SIZE) - 1];
  return {
    activity: projectMonitoring(
      undefined,
      attempts,
      owners,
      options.now,
      "",
      config.gemini.scanEnabled,
    ).activity,
    next:
      attempts.length > ADMIN_PAGE_SIZE && last
        ? encodeCursor(scope, [last.reservedAt, last.id, bounds.end])
        : null,
    evaluatedAt: options.now,
  };
}
