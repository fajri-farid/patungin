import type { UserAccount } from "../access/types";

/** Monitoring only. Authorization and quota enforcement never read this projection. */
export interface UserMonthSummary {
  uid: string;
  monthKey: string;
  used: number;
  remaining: number;
  completed: number;
  failed: number;
  lowQuota: boolean;
  frequentFailures: boolean;
  resultsSince: string;
  updatedAt: string;
  deleteAfter: Date;
}

export interface AccountAudit {
  id: string;
  ownerUid: string;
  actorUid: string;
  actorEmail: string;
  createdAt: string;
  monthKey: string;
  before: AccountSettings;
  after: AccountSettings;
  deleteAfter: Date;
}
export interface AccountSettings {
  status: UserAccount["status"];
  accessUntil: string | null;
  monthlyLimit: number;
  bonus: number;
}

export function normalizeSearchName(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

export function summaryId(uid: string, month: string) {
  // Firestore Auth UIDs are allowed to contain punctuation; avoid ambiguous IDs.
  return `${month}_${Buffer.from(uid).toString("base64url")}`;
}

export function makeSummary(
  previous: UserMonthSummary | null | undefined,
  input: {
    uid: string;
    monthKey: string;
    used: number;
    limit: number;
    bonus: number;
    now: string;
  },
  result?: "succeeded" | "failed" | "unknown",
): UserMonthSummary {
  const sameMonth =
    previous?.monthKey === input.monthKey ? previous : undefined;
  const completed =
    (sameMonth?.completed ?? 0) +
    (result === "succeeded" || result === "failed" ? 1 : 0);
  const failed = (sameMonth?.failed ?? 0) + (result === "failed" ? 1 : 0);
  const remaining = Math.max(0, input.limit + input.bonus - input.used);
  const [year, month] = input.monthKey.split("-").map(Number);
  return {
    uid: input.uid,
    monthKey: input.monthKey,
    used: input.used,
    remaining,
    completed,
    failed,
    lowQuota: remaining <= 5,
    frequentFailures: completed >= 5 && failed * 2 >= completed,
    resultsSince: sameMonth?.resultsSince ?? input.now,
    updatedAt: input.now,
    deleteAfter: new Date(Date.UTC(year, month, 1, -8) + 30 * 86400000),
  };
}
