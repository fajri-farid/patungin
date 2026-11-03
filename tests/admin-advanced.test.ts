import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { documents, firestore, queries, ownerBatches } = await vi.hoisted(async () => {
  const { createAdminFirestoreFake } = await import("./helpers/admin-firestore");
  return createAdminFirestoreFake();
});
const { requireAdmin } = vi.hoisted(() => ({ requireAdmin: vi.fn() }));
vi.mock("@/server/auth/session", () => ({ requireAdmin }));
vi.mock("@/server/firebase/admin", () => ({ getAdminFirestore: () => firestore }));
import { getUsersPage, getAdminPanel, getUserProfile, getAccountAudits, getAlertsPage, prepareAdminAccounts } from "@/server/admin/data";
import { getAdminMonitoring, getUserActivity } from "@/server/admin/monitoring";
import { makeSummary, summaryId } from "@/server/admin/summary";
import { periodBounds } from "@/server/admin/pagination";
import { updateAccount } from "@/server/access/accounts";
import type { UserAccount } from "@/server/access/types";

const admin = { uid: "admin", email: "admin@example.test", displayName: "Admin" };
const now = Date.parse("2026-11-03T03:00:00Z");
function account(index: number): UserAccount {
  const uid = "person-" + String(index).padStart(3, "0");
  return { uid, email: uid + "@example.test", displayName: "Person " + index, searchName: "person " + index,
    status: "active", accessUntil: null, monthlyLimit: 30, activatedAt: "2026-10-01T00:00:00.000Z",
    source: "direct", createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-11-03T03:00:00.000Z" };
}
function seedUsers(n = 60) { for (let i = 0; i < n; i++) { const user = account(i); documents.set("users/" + user.uid, user as unknown as Record<string, unknown>); } }
function seedScans(n = 60, owner = "person-000") {
  for (let i = 0; i < n; i++) {
    const id = "scan-" + String(i).padStart(3, "0");
    documents.set("scanAttempts/" + id, { id, ownerUid: owner, billId: "bill", state: "succeeded",
      reservedAt: "2026-11-03T02:00:00.000Z", dispatchedAt: "2026-11-03T02:00:00.000Z",
      completedAt: "2026-11-03T02:00:01.000Z", model: "test", errorCode: null,
      extractedData: { merchant: "PRIVATE_RECEIPT" }, imageHash: "PRIVATE_HASH", errorMessage: "PRIVATE_ERROR" });
  }
}
beforeEach(() => {
  documents.clear(); queries.length = 0; ownerBatches.length = 0;
  vi.useFakeTimers(); vi.setSystemTime(now);
  vi.stubEnv("FIREBASE_PROJECT_ID", "test-project");
  vi.stubEnv("FIREBASE_CLIENT_EMAIL", "test@example.test");
  vi.stubEnv("FIREBASE_PRIVATE_KEY", "test-only");
  vi.stubEnv("ADMIN_UIDS", "admin");
  requireAdmin.mockReset(); requireAdmin.mockResolvedValue(admin);
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("bounded admin queries", () => {
  it("guards every read and preparation before touching Firestore", async () => {
    requireAdmin.mockRejectedValue(new Error("NO_ADMIN"));
    for (const call of [() => getUsersPage(), () => getAdminMonitoring(), () => getUserActivity("person-000"),
      () => getUserProfile("person-000"), () => getAccountAudits("person-000"), () => getAlertsPage(), () => prepareAdminAccounts()]) {
      await expect(call()).rejects.toThrow("NO_ADMIN");
    }
    expect(queries).toEqual([]); expect(documents.size).toBe(0);
  });
  it("only loads the selected panel and caps its query at 26", async () => {
    seedUsers();
    await getAdminPanel({ tab: "users" });
    expect(queries.map((q) => q.collection)).toEqual(["users"]);
    expect(queries[0].maximum).toBe(26);
    queries.length = 0;
    await getAdminPanel({ tab: "invites" });
    expect(queries.map((q) => q.collection)).toEqual(["invites"]);
  });
  it("finds an account beyond the first page using normalized email, name, or exact UID", async () => {
    seedUsers();
    expect((await getUsersPage()).users.some((u) => u.uid === "person-059")).toBe(false);
    expect((await getUsersPage({ field: "email", query: "PERSON-059@" })).users[0].uid).toBe("person-059");
    expect((await getUsersPage({ field: "name", query: "Person 59" })).users[0].uid).toBe("person-059");
    expect((await getUsersPage({ field: "uid", query: "person-059" })).users[0].uid).toBe("person-059");
  });
  it("paginates duplicate names deterministically and rejects a cursor from another search", async () => {
    seedUsers();
    for (const [key, value] of documents) documents.set(key, { ...value, searchName: "same name" });
    const first = await getUsersPage({ field: "name", query: "same" });
    const second = await getUsersPage({ field: "name", query: "same", after: first.next! });
    const third = await getUsersPage({ field: "name", query: "same", after: second.next! });
    expect(new Set([...first.users, ...second.users, ...third.users].map((u) => u.uid)).size).toBe(60);
    expect(third.next).toBeNull();
    await expect(getUsersPage({ field: "email", query: "same", after: first.next! })).rejects.toMatchObject({ code: "INVALID_CURSOR" });
    expect(queries.every((q) => q.maximum === 26)).toBe(true);
  });
  it("freezes scan pagination and handles identical timestamps without duplicates", async () => {
    seedUsers(1); seedScans();
    const first = await getAdminMonitoring({ period: "today" });
    documents.set("scanAttempts/scan-new", { ...documents.get("scanAttempts/scan-000"), reservedAt: new Date(now + 1000).toISOString() });
    vi.setSystemTime(now + 2000);
    const second = await getAdminMonitoring({ period: "today", after: first.next! });
    const third = await getAdminMonitoring({ period: "today", after: second.next! });
    expect(new Set([...first.activity, ...second.activity, ...third.activity].map((s) => s.id)).size).toBe(60);
    expect(third.next).toBeNull();
    expect(ownerBatches.every((n) => n <= 25)).toBe(true);
    expect(JSON.stringify(first)).not.toMatch(/PRIVATE|extractedData|imageHash|errorMessage/);
    await expect(getAdminMonitoring({ period: "week", after: first.next! })).rejects.toMatchObject({ code: "INVALID_CURSOR" });
  });
  it("keeps activity scoped to the selected owner and WITA period", async () => {
    seedUsers(2); seedScans(2); seedScans(1, "person-001");
    const page = await getUserActivity("person-000", { period: "today" });
    expect(page.activity).toHaveLength(1);
    expect(page.activity[0].ownerUid).toBe("person-000");
    const q = queries.at(-1)!;
    expect(q.filters).toContainEqual({ field: "ownerUid", op: "==", value: "person-000" });
    expect(q.filters).toContainEqual({ field: "reservedAt", op: ">=", value: "2026-11-02T16:00:00.000Z" });
  });
  it("calculates calendar boundaries at WITA midnight, including month and year rollover", () => {
    const instant = Date.parse("2026-12-31T16:00:00Z");
    expect(periodBounds("today", instant).start).toBe("2026-12-31T16:00:00.000Z");
    expect(periodBounds("month", instant).start).toBe("2026-12-31T16:00:00.000Z");
    expect(periodBounds("week", instant).start).toBe("2026-12-25T16:00:00.000Z");
  });
});

describe("audit and materialized operational summaries", () => {
  it.each(["low", "expiry", "failures"] as const)("returns an empty page rather than an error when %s has no matching accounts", async (kind) => {
    const result = await getAlertsPage(kind);
    expect(result.items).toEqual([]);
    expect(result.next).toBeNull();
    expect(queries[0].maximum).toBe(26);
  });
  it("paginates all expiring accounts with identical expiry times without duplicates", async () => {
    seedUsers(60);
    for (const [key, row] of documents) documents.set(key, { ...row, accessUntil: "2026-11-07T03:00:00.000Z" });
    documents.set("users/person-000", { ...documents.get("users/person-000"), status: "disabled" });
    documents.set("users/person-001", { ...documents.get("users/person-001"), accessUntil: "2026-11-03T02:59:59.000Z" });
    documents.set("users/person-002", { ...documents.get("users/person-002"), accessUntil: "2026-11-11T03:00:00.000Z" });
    const first = await getAlertsPage("expiry");
    const second = await getAlertsPage("expiry", first.next!);
    const third = await getAlertsPage("expiry", second.next!);
    expect(new Set([...first.items, ...second.items, ...third.items].map(item => item.user.uid)).size).toBe(57);
    expect(third.next).toBeNull();
    expect(queries.every(q => q.maximum === 26)).toBe(true);
  });
  it("reads high-failure alerts across pages without scanning attempts or unrelated months", async () => {
    seedUsers(30);
    for (let i = 0; i < 30; i++) {
      const uid = account(i).uid;
      documents.set("adminUserMonths/" + summaryId(uid, "2026-11"), { ...makeSummary(null, { uid, monthKey: "2026-11", used: 8, limit: 30, bonus: 0, now: new Date(now).toISOString() }), completed: 8, failed: 6, frequentFailures: true });
    }
    documents.set("adminUserMonths/other-month", { uid: "person-000", monthKey: "2026-10", frequentFailures: true });
    const first = await getAlertsPage("failures");
    const second = await getAlertsPage("failures", first.next!);
    expect(first.items).toHaveLength(25);
    expect(second.items).toHaveLength(5);
    expect(new Set([...first.items, ...second.items].map(item => item.user.uid)).size).toBe(30);
    expect(first.items[0]).toMatchObject({ completed: 8, failed: 6 });
    expect(queries.every(q => q.collection === "adminUserMonths" && q.maximum === 26)).toBe(true);
    expect(ownerBatches.every(n => n <= 25)).toBe(true);
  });
  it("writes before/after and summary atomically, and rejects stale edits in the same millisecond", async () => {
    seedUsers(1);
    await updateAccount(admin, { uid: "person-000", status: "active", accessUntil: null, monthlyLimit: 40, bonus: 5, expectedUpdatedAt: account(0).updatedAt });
    const changed = documents.get("users/person-000")!;
    expect(changed.updatedAt).not.toBe(account(0).updatedAt);
    await expect(updateAccount(admin, { uid: "person-000", status: "disabled", accessUntil: null, monthlyLimit: 1, bonus: 5, expectedUpdatedAt: account(0).updatedAt })).rejects.toMatchObject({ code: "ACCOUNT_CHANGED" });
    const audits = await getAccountAudits("person-000");
    expect(audits.records).toHaveLength(1);
    expect(audits.records[0]).toMatchObject({ actorUid: "admin", before: { monthlyLimit: 30, bonus: 0 }, after: { monthlyLimit: 40, bonus: 5 } });
    expect(audits.records[0]).not.toHaveProperty("deleteAfter");
    expect(documents.get("adminUserMonths/" + summaryId("person-000", "2026-11"))).toMatchObject({ remaining: 45 });
  });
  it("does not add audit entries for no-op saves", async () => {
    seedUsers(1);
    await updateAccount(admin, { uid: "person-000", status: "active", accessUntil: null, monthlyLimit: 30, bonus: 0 });
    expect([...documents.keys()].filter((k) => k.startsWith("accountAudits/"))).toHaveLength(0);
  });
  it("prepares old accounts in bounded, repeatable pages without changing access or resetting counters", async () => {
    seedUsers(30);
    for (const [key, row] of documents) { const copy = { ...row }; delete copy.searchName; documents.set(key, copy); }
    const id = summaryId("person-000", "2026-11");
    documents.set("adminUserMonths/" + id, { ...makeSummary(null, { uid: "person-000", monthKey: "2026-11", used: 28, limit: 30, bonus: 0, now: new Date(now).toISOString() }), completed: 9, failed: 7 });
    const first = await prepareAdminAccounts();
    expect(first.count).toBe(25); expect(first.next).not.toBeNull();
    expect(documents.get("users/person-024")?.searchName).toBe("person 24");
    expect(documents.get("users/person-025")?.searchName).toBeUndefined();
    expect(documents.get("adminUserMonths/" + id)).toMatchObject({ completed: 9, failed: 7, used: 28 });
    expect((await prepareAdminAccounts(first.next!)).count).toBe(5);
    expect(documents.get("users/person-029")?.status).toBe("active");
  });
  it("queries global low-quota summaries without loading scan history, excluding inactive/admin accounts", async () => {
    seedUsers(3);
    documents.set("users/person-001", { ...documents.get("users/person-001"), status: "disabled" });
    vi.stubEnv("ADMIN_UIDS", "admin,person-002");
    for (let i = 0; i < 3; i++) {
      const uid = account(i).uid;
      documents.set("adminUserMonths/" + summaryId(uid, "2026-11"), makeSummary(null, { uid, monthKey: "2026-11", used: 29, limit: 30, bonus: 0, now: new Date(now).toISOString() }) as unknown as Record<string, unknown>);
    }
    const page = await getAlertsPage("low");
    expect(page.items.map((item) => item.user.uid)).toEqual(["person-000"]);
    expect(queries.map((q) => q.collection)).toEqual(["adminUserMonths"]);
    expect(queries[0]).toMatchObject({ maximum: 26 });
  });
  it("keeps thresholds, unknown results, and monthly rollover explicit", () => {
    const input = { uid: "person-000", monthKey: "2026-11", used: 28, limit: 30, bonus: 0, now: new Date(now).toISOString() };
    let summary = makeSummary(null, input);
    for (let i = 0; i < 3; i++) summary = makeSummary(summary, input, "failed");
    summary = makeSummary(summary, input, "succeeded");
    expect(summary.frequentFailures).toBe(false);
    summary = makeSummary(summary, input, "succeeded");
    expect(summary).toMatchObject({ lowQuota: true, frequentFailures: true, completed: 5, failed: 3 });
    expect(makeSummary(summary, input, "unknown")).toMatchObject({ completed: 5, failed: 3 });
    expect(makeSummary(summary, { ...input, monthKey: "2026-12", used: 0 })).toMatchObject({ completed: 0, failed: 0, lowQuota: false, frequentFailures: false });
  });
});
