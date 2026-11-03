import { FieldPath } from "@google-cloud/firestore";
import { requireAdmin } from "../auth/session";
import {
  accessTransaction,
  getAccount,
  isAdmin,
  listAccessRecords,
  monthKey,
} from "../access/accounts";
import {
  AccessError,
  type UserAccount,
  type InviteRecord,
} from "../access/types";
import { getServerConfig } from "../config/env";
import { getAdminFirestore } from "../firebase/admin";
import { readDevDb } from "../store/dev-database";
import { getScanQuotaStatuses } from "../store/repository";
import { getAdminMonitoring, type AdminMonitoring } from "./monitoring";
import {
  ADMIN_PAGE_SIZE,
  decodeCursor,
  encodeCursor,
  validUid,
  type MonitorPeriod,
} from "./pagination";
import {
  makeSummary,
  normalizeSearchName,
  summaryId,
  type AccountAudit,
  type UserMonthSummary,
} from "./summary";

export type SafeUser = Pick<
  UserAccount,
  | "uid"
  | "email"
  | "displayName"
  | "status"
  | "accessUntil"
  | "monthlyLimit"
  | "activatedAt"
  | "source"
  | "createdAt"
  | "updatedAt"
> & { isAdmin: boolean };
export type SearchField = "email" | "name" | "uid";
export type AlertKind = "low" | "expiry" | "failures";
export type AdminTab = "monitor" | "users" | "invites" | "alerts";
export interface PanelQuery {
  tab: AdminTab;
  after?: string;
  query?: string;
  field?: SearchField;
  period?: MonitorPeriod;
  alert?: AlertKind;
}
export interface UsersPage {
  users: SafeUser[];
  quotas: Awaited<ReturnType<typeof getScanQuotaStatuses>>;
  next: string | null;
  evaluatedAt: number;
}
export interface InvitesPage {
  invites: InviteRecord[];
  next: string | null;
  evaluatedAt: number;
}
export interface AlertItem {
  user: SafeUser;
  remaining: number | null;
  failed: number;
  completed: number;
  resultsSince: string | null;
}
export interface AlertsPage {
  items: AlertItem[];
  next: string | null;
  evaluatedAt: number;
  monthKey: string;
}
export type PanelData =
  | { tab: "monitor"; data: AdminMonitoring }
  | { tab: "users"; data: UsersPage }
  | { tab: "invites"; data: InvitesPage }
  | { tab: "alerts"; data: AlertsPage };

export function safeUser(user: UserAccount): SafeUser {
  return {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
    status: user.status,
    accessUntil: user.accessUntil,
    monthlyLimit: user.monthlyLimit,
    activatedAt: user.activatedAt,
    source: user.source,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    isAdmin: isAdmin(user),
  };
}

export async function getUsersPage(
  input: Pick<PanelQuery, "after" | "query" | "field"> = {},
): Promise<UsersPage> {
  await requireAdmin();
  const field = input.field ?? "email";
  if (
    !["email", "name", "uid"].includes(field) ||
    (input.query !== undefined &&
      (typeof input.query !== "string" || input.query.length > 254))
  )
    throw new AccessError("INVALID_SEARCH", "Pencarian tidak valid.", 400);
  const text =
    field === "uid"
      ? (input.query ?? "").trim()
      : normalizeSearchName(input.query ?? "");
  if (text && field !== "uid" && text.length < 2)
    throw new AccessError("INVALID_SEARCH", "Ketik minimal 2 karakter.", 400);
  const scope = JSON.stringify(["users", field, text]);
  const cursor = decodeCursor(input.after, scope, 2);
  let records: UserAccount[];
  if (field === "uid" && text) {
    const account = await getAccount(validUid(text));
    records = account ? [account] : [];
  } else if (getServerConfig().isDevSandbox) {
    const key = text ? (field === "name" ? "searchName" : "email") : "uid";
    records = Object.values(readDevDb().users)
      .filter((u) => !text || (u[key] ?? "").startsWith(text))
      .sort(
        (a, b) => compare(a[key] ?? "", b[key] ?? "") || compare(a.uid, b.uid),
      )
      .filter(
        (u) =>
          !cursor ||
          (u[key] ?? "") > cursor[0] ||
          ((u[key] ?? "") === cursor[0] && u.uid > cursor[1]),
      )
      .slice(0, ADMIN_PAGE_SIZE + 1);
  } else {
    const key = text ? (field === "name" ? "searchName" : "email") : null;
    let q = getAdminFirestore()
      .collection("users")
      .limit(ADMIN_PAGE_SIZE + 1);
    if (key)
      q = q
        .where(key, ">=", text)
        .where(key, "<", prefixEnd(text))
        .orderBy(key)
        .orderBy(FieldPath.documentId());
    else q = q.orderBy(FieldPath.documentId());
    if (cursor)
      q = key ? q.startAfter(cursor[0], cursor[1]) : q.startAfter(cursor[1]);
    const docs = await q
      .select(
        "uid",
        "email",
        "displayName",
        "searchName",
        "status",
        "accessUntil",
        "monthlyLimit",
        "activatedAt",
        "source",
        "createdAt",
        "updatedAt",
      )
      .get();
    records = docs.docs.map(
      (doc) => ({ ...doc.data(), uid: doc.id }) as UserAccount,
    );
  }
  const page = records.slice(0, ADMIN_PAGE_SIZE);
  const last = page.at(-1);
  const lastValue = last
    ? text
      ? field === "name"
        ? (last.searchName ?? "")
        : last.email
      : last.uid
    : "";
  return {
    users: page.map(safeUser),
    quotas: page.length ? await getScanQuotaStatuses(page) : [],
    evaluatedAt: Date.now(),
    next:
      records.length > ADMIN_PAGE_SIZE && last
        ? encodeCursor(scope, [lastValue, last.uid])
        : null,
  };
}

function compare(a: string, b: string) {
  return a < b ? -1 : a > b ? 1 : 0;
}
// Exclusive Unicode successor avoids relying on a suffix that excludes some names.
function prefixEnd(text: string) {
  const chars = Array.from(text);
  while (chars.length) {
    const last = chars.pop()!;
    if (last.codePointAt(0)! < 0x10ffff)
      return chars.join("") + String.fromCodePoint(last.codePointAt(0)! + 1);
  }
  throw new AccessError("INVALID_SEARCH", "Teks pencarian tidak valid.", 400);
}

export async function getUserProfile(uid: string) {
  await requireAdmin();
  const account = await getAccount(validUid(uid));
  if (!account)
    throw new AccessError("NOT_FOUND", "Akun tidak ditemukan.", 404);
  return {
    user: safeUser(account),
    quota: (await getScanQuotaStatuses([account]))[0],
    evaluatedAt: Date.now(),
  };
}

export async function getAccountAudits(uid: string, after?: string) {
  await requireAdmin();
  validUid(uid);
  const scope = JSON.stringify(["audits", uid]);
  const cursor = decodeCursor(after, scope, 2);
  let records: AccountAudit[];
  if (getServerConfig().isDevSandbox) {
    records = Object.values(readDevDb().accountAudits)
      .filter((record) => record.ownerUid === uid)
      .sort((a, b) => compare(b.createdAt, a.createdAt) || compare(b.id, a.id))
      .filter(
        (record) =>
          !cursor ||
          record.createdAt < cursor[0] ||
          (record.createdAt === cursor[0] && record.id < cursor[1]),
      )
      .slice(0, ADMIN_PAGE_SIZE + 1);
  } else {
    let q = getAdminFirestore()
      .collection("accountAudits")
      .where("ownerUid", "==", uid)
      .orderBy("createdAt", "desc")
      .orderBy(FieldPath.documentId(), "desc")
      .limit(ADMIN_PAGE_SIZE + 1);
    if (cursor) q = q.startAfter(cursor[0], cursor[1]);
    records = (await q.get()).docs.map(
      (doc) => ({ ...doc.data(), id: doc.id }) as AccountAudit,
    );
  }
  const page = records.slice(0, ADMIN_PAGE_SIZE);
  const last = page.at(-1);
  // TTL timestamps never cross the server/client boundary.
  return {
    records: page.map(
      ({ id, actorUid, actorEmail, createdAt, monthKey, before, after }) => ({
        id,
        actorUid,
        actorEmail,
        createdAt,
        monthKey,
        before,
        after,
      }),
    ),
    next:
      records.length > ADMIN_PAGE_SIZE && last
        ? encodeCursor(scope, [last.createdAt, last.id])
        : null,
  };
}

export async function getAlertsPage(
  kind: AlertKind = "low",
  after?: string,
): Promise<AlertsPage> {
  await requireAdmin();
  if (!["low", "expiry", "failures"].includes(kind))
    throw new AccessError("INVALID_FILTER", "Peringatan tidak valid.", 400);
  const now = Date.now();
  const month = monthKey(new Date(now));
  const scope = JSON.stringify(["alerts", kind, month]);
  const cursor = decodeCursor(after, scope, kind === "expiry" ? 3 : 1);
  const start =
    kind === "expiry" && cursor ? cursor[2] : new Date(now).toISOString();
  const end = new Date(Date.parse(start) + 7 * 86400000).toISOString();
  let accounts: UserAccount[] = [];
  let summaries: Array<UserMonthSummary & { id: string }> = [];
  let more = false;
  let next: string | null = null;
  if (kind === "expiry") {
    if (getServerConfig().isDevSandbox) {
      accounts = Object.values(readDevDb().users)
        .filter(
          (u) =>
            u.status === "active" &&
            u.accessUntil &&
            u.accessUntil > start &&
            u.accessUntil <= end,
        )
        .sort(
          (a, b) =>
            compare(a.accessUntil!, b.accessUntil!) || compare(a.uid, b.uid),
        )
        .filter(
          (u) =>
            !cursor ||
            u.accessUntil! > cursor[0] ||
            (u.accessUntil === cursor[0] && u.uid > cursor[1]),
        )
        .slice(0, 26);
    } else {
      let q = getAdminFirestore()
        .collection("users")
        .where("status", "==", "active")
        .where("accessUntil", ">", start)
        .where("accessUntil", "<=", end)
        .orderBy("accessUntil")
        .orderBy(FieldPath.documentId())
        .limit(26);
      if (cursor) q = q.startAfter(cursor[0], cursor[1]);
      accounts = (await q.get()).docs.map(
        (doc) => ({ ...doc.data(), uid: doc.id }) as UserAccount,
      );
    }
    more = accounts.length > 25;
    accounts = accounts.slice(0, 25);
    const last = accounts.at(-1);
    if (more && last)
      next = encodeCursor(scope, [last.accessUntil!, last.uid, start]);
  } else {
    const flag = kind === "low" ? "lowQuota" : "frequentFailures";
    if (getServerConfig().isDevSandbox) {
      summaries = Object.entries(readDevDb().adminUserMonths)
        .map(([id, s]) => ({ ...s, id }))
        .filter(
          (s) =>
            s.monthKey === month && s[flag] && (!cursor || s.id > cursor[0]),
        )
        .sort((a, b) => compare(a.id, b.id))
        .slice(0, 26);
    } else {
      let q = getAdminFirestore()
        .collection("adminUserMonths")
        .where("monthKey", "==", month)
        .where(flag, "==", true)
        .orderBy(FieldPath.documentId())
        .limit(26);
      if (cursor) q = q.startAfter(cursor[0]);
      summaries = (await q.get()).docs.map(
        (doc) =>
          ({ ...doc.data(), id: doc.id }) as UserMonthSummary & { id: string },
      );
    }
    more = summaries.length > 25;
    summaries = summaries.slice(0, 25);
    const last = summaries.at(-1);
    if (more && last) next = encodeCursor(scope, [last.id]);
    if (getServerConfig().isDevSandbox)
      accounts = summaries.map((s) => readDevDb().users[s.uid]).filter(Boolean);
    else if (summaries.length)
      accounts = (
        await getAdminFirestore().getAll(
          ...summaries.map((s) =>
            getAdminFirestore().collection("users").doc(s.uid),
          ),
        )
      )
        .filter((doc) => doc.exists)
        .map((doc) => ({ ...doc.data(), uid: doc.id }) as UserAccount);
  }
  const summaryMap = new Map(summaries.map((s) => [s.uid, s]));
  return {
    evaluatedAt: now,
    monthKey: month,
    next,
    items: accounts
      .filter(
        (u) =>
          !isAdmin(u) &&
          u.status === "active" &&
          (!u.accessUntil || Date.parse(u.accessUntil) > now),
      )
      .map((u) => {
        const s = summaryMap.get(u.uid);
        return {
          user: safeUser(u),
          remaining: s?.remaining ?? null,
          failed: s?.failed ?? 0,
          completed: s?.completed ?? 0,
          resultsSince: s?.resultsSince ?? null,
        };
      }),
  };
}

/** Explicit maintenance, 25 accounts per call; no background collection scan. */
export async function prepareAdminAccounts(after?: string) {
  await requireAdmin();
  const page = await listAccessRecords("users", after);
  const key = monthKey();
  if (page.records.length)
    await accessTransaction(async (store) => {
      // One quota read per batch. All reads precede writes, and current account
      // records are read transactionally so preparation cannot overwrite an edit.
      const [usage, rows] = await Promise.all([
        store.get<{
          userAttempts?: Record<string, number>;
          userBonuses?: Record<string, number>;
        }>("usageMonths", key),
        Promise.all(
          page.records.map(async (record) => {
            const id = summaryId(record.uid, key);
            const [account, summary] = await Promise.all([
              store.get<UserAccount>("users", record.uid),
              store.get<UserMonthSummary>("adminUserMonths", id),
            ]);
            return { id, account, summary };
          }),
        ),
      ]);
      for (const { id, account, summary } of rows) {
        if (!account) continue;
        const searchName = normalizeSearchName(account.displayName);
        if (account.searchName !== searchName)
          store.set("users", account.uid, { ...account, searchName });
        if (!summary)
          store.set(
            "adminUserMonths",
            id,
            makeSummary(null, {
              uid: account.uid,
              monthKey: key,
              used: usage?.userAttempts?.[account.uid] ?? 0,
              bonus: usage?.userBonuses?.[account.uid] ?? 0,
              limit: account.monthlyLimit,
              now: new Date().toISOString(),
            }),
          );
      }
    });
  return { count: page.records.length, next: page.next, monthKey: key };
}

export async function getAdminPanel(input: PanelQuery): Promise<PanelData> {
  // Every leaf also guards its reads, so direct reuse remains safe.
  switch (input.tab) {
    case "monitor":
      return { tab: "monitor", data: await getAdminMonitoring(input) };
    case "users":
      return { tab: "users", data: await getUsersPage(input) };
    case "alerts":
      return {
        tab: "alerts",
        data: await getAlertsPage(input.alert, input.after),
      };
    case "invites": {
      await requireAdmin();
      const page = await listAccessRecords("invites", input.after);
      return {
        tab: "invites",
        data: {
          invites: page.records,
          next: page.next,
          evaluatedAt: page.evaluatedAt,
        },
      };
    }
    default:
      throw new AccessError("INVALID_TAB", "Halaman admin tidak valid.", 400);
  }
}
