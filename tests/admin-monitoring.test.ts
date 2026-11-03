import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScanAttemptRecord, UsageBucketRecord } from "@/server/store/repository";
const { requireAdmin } = vi.hoisted(() => ({ requireAdmin: vi.fn() }));
vi.mock("@/server/auth/session", () => ({ requireAdmin }));
vi.mock("@/server/firebase/admin", () => ({ getAdminFirestore: () => { throw new Error("Database must not be read before authorization"); } }));
import { projectMonitoring, getAdminMonitoring } from "@/server/admin/monitoring";
import { accountState, scanState } from "@/app/admin/admin-utils";

const now = Date.parse("2026-11-02T08:00:00Z");
function attempt(index = 0): ScanAttemptRecord {
  return { id: `scan-${index}`, ownerUid: "owner", billId: "bill", billRevisionAtStart: 1, imageHash: "private-hash", model: "test-model", promptVersion: "test", state: "succeeded", reservedAt: new Date(now - 10000).toISOString(), dispatchedAt: new Date(now - 9000).toISOString(), completedAt: new Date(now - 1000).toISOString(), errorCode: null, errorMessage: "private raw error", extractedData: { merchant: "private merchant", receiptDate: null, items: [], adjustments: [], printedGrandTotal: 10000, warnings: [] } };
}
const owners = new Map([["owner", { displayName: "Test Owner", email: "owner@example.test" }]]);

beforeEach(() => { requireAdmin.mockReset(); });
describe("admin monitoring", () => {
  it("rejects non-admins before reading any data", async () => {
    requireAdmin.mockRejectedValue(new Error("ADMIN_REQUIRED"));
    await expect(getAdminMonitoring()).rejects.toThrow("ADMIN_REQUIRED");
  });
  it("aggregates all monthly usage, not just users on the current admin page", () => {
    const usage = { userAttempts: { owner: 6, another: 4, unused: 0 }, activeLeases: { expired: now - 1, running: now + 1000 } } as unknown as UsageBucketRecord;
    const result = projectMonitoring(usage, [], owners, now, "2026-11", true);
    expect(result).toMatchObject({ monthlyAttempts: 10, accountsWithUsage: 2, activeScans: 1, monthKey: "2026-11" });
  });
  it("bounds activity and excludes OCR payloads, image hashes, and raw errors", () => {
    const result = projectMonitoring(undefined, Array.from({ length: 26 }, (_, index) => attempt(index)), owners, now, "2026-11", false);
    expect(result.activity).toHaveLength(25);
    expect(result.hasMoreActivity).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/private-hash|private raw error|private merchant|extractedData|promptVersion/);
    expect(result.activity[0]).toMatchObject({ displayName: "Test Owner", email: "owner@example.test" });
  });
  it("handles deleted owners and rejects raw text in the error-code field", () => {
    const scan = { ...attempt(), errorCode: "Token secret unexpected failure" };
    const result = projectMonitoring(undefined, [scan], new Map(), now, "2026-11", false);
    expect(result.activity[0]).toMatchObject({ displayName: "Akun tidak tersedia", email: null, errorCode: null });
  });
  it("does not relabel old successful scans as failed, and flags unfinished scans honestly", () => {
    const old = { ...attempt(), reservedAt: new Date(now - 120000).toISOString() };
    expect(scanState(old, now).key).toBe("succeeded");
    expect(scanState({ ...old, state: "dispatched" }, now).key).toBe("unknown");
    expect(scanState({ ...old, reservedAt: new Date(now - 1000).toISOString(), state: "dispatched" }, now).key).toBe("running");
  });
  it("distinguishes pending, disabled and expired access", () => {
    const user = { isAdmin: false, status: "disabled", accessUntil: new Date(now - 1000).toISOString() } as Parameters<typeof accountState>[0];
    expect(accountState(user, now).key).toBe("disabled");
    expect(accountState({ ...user, status: "pending" }, now).key).toBe("pending");
    expect(accountState({ ...user, status: "active" }, now).key).toBe("expired");
    expect(accountState({ ...user, isAdmin: true }, now).key).toBe("admin");
  });
});
