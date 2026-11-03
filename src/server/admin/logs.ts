import { FieldPath } from "@google-cloud/firestore";
import { requireAdmin } from "../auth/session";
import { AccessError } from "../access/types";
import { getServerConfig } from "../config/env";
import { getAdminFirestore } from "../firebase/admin";
import { readDevDb } from "../store/dev-database";
import type { AccountAudit } from "./summary";
import type { OperationalEvent } from "../observability/events";
import { diagnoseCode, type DiagnosticLevel } from "@/domain/diagnostics";
import {
  decodeCursor,
  encodeCursor,
  periodBounds,
  type MonitorPeriod,
} from "./pagination";
import { getScanLogs, type ScanLogFilter } from "./monitoring";

export interface LogQuery {
  category: "scans" | "changes" | "events";
  period: MonitorPeriod;
  filter?: string;
  after?: string;
}
export type SafeAudit = Pick<
  AccountAudit,
  | "id"
  | "ownerUid"
  | "actorUid"
  | "actorEmail"
  | "createdAt"
  | "monthKey"
  | "before"
  | "after"
>;
export type SafeEvent = Omit<OperationalEvent, "deleteAfter">;
export type LogsPage =
  | {
      category: "scans";
      scans: Awaited<ReturnType<typeof getScanLogs>>["activity"];
      next: string | null;
      evaluatedAt: number;
    }
  | {
      category: "changes";
      records: SafeAudit[];
      next: string | null;
      evaluatedAt: number;
    }
  | {
      category: "events";
      events: SafeEvent[];
      next: string | null;
      evaluatedAt: number;
    };

export async function getLogsPage(input: LogQuery): Promise<LogsPage> {
  await requireAdmin();
  if (!input || !["scans", "changes", "events"].includes(input.category))
    throw new AccessError("INVALID_FILTER", "Kategori log tidak valid.", 400);
  if (input.category === "scans") {
    const result = await getScanLogs({
      period: input.period,
      filter: (input.filter ?? "all") as ScanLogFilter,
      after: input.after,
    });
    return {
      category: "scans",
      scans: result.activity,
      next: result.next,
      evaluatedAt: result.evaluatedAt,
    };
  }
  const filter = input.filter ?? "all";
  if (
    !(
      input.category === "changes"
        ? ["all"]
        : ["all", "normal", "attention", "error", "security"]
    ).includes(filter)
  )
    throw new AccessError("INVALID_FILTER", "Filter log tidak valid.", 400);
  const now = Date.now();
  const scope = JSON.stringify(["logs", input.category, input.period, filter]);
  const cursor = decodeCursor(input.after, scope, 3);
  const bounds = periodBounds(
    input.period,
    cursor ? Date.parse(cursor[2]) : now,
  );
  if (
    cursor &&
    (cursor[0] < bounds.start ||
      cursor[0] > bounds.end ||
      cursor[1].includes("/"))
  )
    throw new AccessError("INVALID_CURSOR", "Halaman log tidak valid.", 400);
  const collection =
    input.category === "events" ? "operationalEvents" : "accountAudits";
  const dateField = input.category === "events" ? "firstAt" : "createdAt";
  let records: Array<OperationalEvent | AccountAudit>;
  if (getServerConfig().isDevSandbox) {
    const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
    const date = (row: OperationalEvent | AccountAudit) =>
      "firstAt" in row ? row.firstAt : row.createdAt;
    records = Object.values(readDevDb()[collection])
      .filter(
        (row) =>
          date(row) >= bounds.start &&
          date(row) <= bounds.end &&
          (filter === "all" || ("level" in row && row.level === filter)),
      )
      .sort((a, b) => compare(date(b), date(a)) || compare(b.id, a.id))
      .filter(
        (row) =>
          !cursor ||
          date(row) < cursor[0] ||
          (date(row) === cursor[0] && row.id < cursor[1]),
      )
      .slice(0, 26);
  } else {
    let q = getAdminFirestore()
      .collection(collection)
      .where(dateField, ">=", bounds.start)
      .where(dateField, "<=", bounds.end)
      .orderBy(dateField, "desc")
      .orderBy(FieldPath.documentId(), "desc")
      .limit(26);
    if (input.category === "events" && filter !== "all")
      q = q.where("level", "==", filter);
    q =
      input.category === "events"
        ? q.select(
            "ownerUid",
            "code",
            "stage",
            "firstAt",
            "lastAt",
            "count",
            "requestId",
            "billId",
            "attemptId",
            "subjectUid",
            "providerCalled",
            "quotaReserved",
            "level",
          )
        : q.select(
            "ownerUid",
            "actorUid",
            "actorEmail",
            "createdAt",
            "monthKey",
            "before",
            "after",
          );
    records = (
      await (cursor ? q.startAfter(cursor[0], cursor[1]) : q).get()
    ).docs.map(
      (doc) =>
        ({ ...doc.data(), id: doc.id }) as OperationalEvent | AccountAudit,
    );
  }
  const page = records.slice(0, 25);
  const last = page.at(-1);
  const next =
    records.length > 25 && last
      ? encodeCursor(scope, [
          "firstAt" in last ? last.firstAt : last.createdAt,
          last.id,
          bounds.end,
        ])
      : null;
  if (input.category === "changes")
    return {
      category: "changes",
      records: (page as AccountAudit[]).map(
        ({
          id,
          ownerUid,
          actorUid,
          actorEmail,
          createdAt,
          monthKey,
          before,
          after,
        }) => ({
          id,
          ownerUid,
          actorUid,
          actorEmail,
          createdAt,
          monthKey,
          before,
          after,
        }),
      ),
      next,
      evaluatedAt: now,
    };
  return {
    category: "events",
    events: (page as OperationalEvent[]).map((row) => {
      const diagnostic = diagnoseCode(row.code);
      return {
        id: row.id,
        ownerUid: row.ownerUid,
        code: /^[A-Z0-9_]{1,80}$/.test(row.code)
          ? row.code
          : "UNEXPECTED_ERROR",
        flag: diagnostic.flag,
        level: ["normal", "attention", "error", "security"].includes(row.level)
          ? (row.level as DiagnosticLevel)
          : diagnostic.level,
        stage: row.stage,
        firstAt: row.firstAt,
        lastAt: row.lastAt,
        count: Math.max(1, Number.isSafeInteger(row.count) ? row.count : 1),
        requestId: row.requestId,
        billId: row.billId,
        attemptId: row.attemptId,
        subjectUid: row.subjectUid ?? null,
        providerCalled: row.providerCalled ?? null,
        quotaReserved: row.quotaReserved ?? null,
      };
    }),
    next,
    evaluatedAt: now,
  };
}
