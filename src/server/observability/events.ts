import crypto from "node:crypto";
import { diagnoseCode, DIAGNOSTICS } from "@/domain/diagnostics";
import { getServerConfig } from "../config/env";
import { getAdminFirestore } from "../firebase/admin";
import { readDevDb, writeDevDb } from "../store/dev-database";

export type EventStage =
  | "validation"
  | "quota"
  | "provider"
  | "persistence"
  | "account"
  | "admin_read"
  | "bill";
export interface OperationalEvent {
  id: string;
  ownerUid: string;
  code: string;
  flag: string;
  level: string;
  stage: EventStage;
  firstAt: string;
  lastAt: string;
  count: number;
  requestId: string;
  billId: string | null;
  attemptId: string | null;
  subjectUid?: string | null;
  providerCalled: boolean | null;
  quotaReserved: boolean | null;
  deleteAfter: Date;
}
export interface EventInput {
  ownerUid: string;
  code: string;
  stage: EventStage;
  requestId?: string;
  billId?: string;
  attemptId?: string;
  subjectUid?: string;
  providerCalled?: boolean | null;
  quotaReserved?: boolean | null;
}
const WINDOW_MS = 5 * 60000;
const CHECKPOINTS = new Set([1, 5, 25, 100]);
// Best-effort coalescing only. Bounded process-local state is never authorization,
// never a quota limiter, and never presented as an exact global request count.
const windows = new Map<
  string,
  { until: number; seen: number; sent: number }
>();
const textId = (value: string | undefined, max = 128) =>
  value && value.length <= max && /^[\w.@:-]+$/.test(value) ? value : null;

export function serverDiagnostic(input: {
  code: string;
  stage: string;
  requestId?: string;
  ownerUid?: string;
  attemptId?: string;
}) {
  const code = Object.hasOwn(DIAGNOSTICS, input.code)
    ? input.code
    : "UNEXPECTED_ERROR";
  console.error(
    JSON.stringify({
      type: "patungin_diagnostic",
      code,
      stage: input.stage,
      requestId: textId(input.requestId),
      ownerUid: textId(input.ownerUid),
      attemptId: textId(input.attemptId),
    }),
  );
}

/** Only call with a server-verified identity; never accepts a client event payload. */
export async function recordOperationalEvent(input: EventInput): Promise<void> {
  if (
    !input.ownerUid ||
    input.ownerUid.length > 128 ||
    input.ownerUid.includes("/")
  )
    return;
  const code = Object.hasOwn(DIAGNOSTICS, input.code)
    ? input.code
    : "UNEXPECTED_ERROR";
  const now = Date.now();
  const bucket = Math.floor(now / WINDOW_MS);
  const id = crypto
    .createHash("sha256")
    .update(JSON.stringify([bucket, input.ownerUid, code, input.stage]))
    .digest("hex");
  let window = windows.get(id);
  if (!window) {
    for (const [key, value] of windows)
      if (value.until <= now) windows.delete(key);
    if (windows.size >= 1024) windows.delete(windows.keys().next().value!);
    window = { until: (bucket + 1) * WINDOW_MS, seen: 0, sent: 0 };
    windows.set(id, window);
  }
  window.seen++;
  if (!CHECKPOINTS.has(window.seen)) return;
  const delta = window.seen - window.sent;
  window.sent = window.seen;
  const diagnostic = diagnoseCode(code);
  const timestamp = new Date(now).toISOString();
  const project = (previous?: OperationalEvent): OperationalEvent => ({
    id,
    ownerUid: input.ownerUid,
    code,
    flag: diagnostic.flag,
    level:
      diagnostic.level === "normal" &&
      code !== "DUPLICATE_REQUEST" &&
      (previous?.count ?? 0) + delta >= 5
        ? "attention"
        : diagnostic.level,
    stage: input.stage,
    firstAt: previous?.firstAt ?? timestamp,
    lastAt: timestamp,
    count: (previous?.count ?? 0) + delta,
    requestId: textId(input.requestId) ?? crypto.randomUUID(),
    billId: textId(input.billId),
    attemptId: textId(input.attemptId),
    subjectUid: textId(input.subjectUid),
    providerCalled: input.providerCalled ?? null,
    quotaReserved: input.quotaReserved ?? null,
    deleteAfter: new Date(now + 30 * 86400000),
  });
  try {
    if (getServerConfig().isDevSandbox) {
      const db = readDevDb();
      db.operationalEvents[id] = project(db.operationalEvents[id]);
      writeDevDb(db);
    } else {
      const db = getAdminFirestore();
      const ref = db.collection("operationalEvents").doc(id);
      await db.runTransaction(
        async (tx) => {
          const previous = await tx.get(ref);
          tx.set(
            ref,
            project(
              previous.exists
                ? (previous.data() as OperationalEvent)
                : undefined,
            ),
          );
        },
        { maxAttempts: 2 },
      );
    }
  } catch {
    // Never turn a rejected request into a successful request, or mask the
    // original error, merely because the diagnostic store is unavailable.
    serverDiagnostic({ ...input, code });
  }
}
