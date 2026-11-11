import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const workers = vi.hoisted(() => ({ receipts: vi.fn(), qris: vi.fn(), reconcileReceipts: vi.fn(), reconcileQris: vi.fn() }));
vi.mock("../src/server/receipts/photos", () => ({ cleanupReceiptPhotos: workers.receipts, reconcileReceiptObjects: workers.reconcileReceipts }));
vi.mock("../src/server/payments/qris-images", () => ({ cleanupQrisImages: workers.qris, reconcileQrisObjects: workers.reconcileQris }));
import { GET, POST } from "../src/app/api/internal/receipt-cleanup/route";

const cronSecret = "test-only-cron-secret-at-least-32-characters";
const externalSecret = "test-only-external-secret-at-least-32-characters";
const empty = { processed: 0, deleted: 0, failed: 0, hasMore: false };
function request(method: "GET" | "POST", secret?: string, query = "") {
  return new Request(`https://app.example/api/internal/receipt-cleanup${query}`, {
    method,
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
  });
}

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", cronSecret);
  vi.stubEnv("RECEIPT_CLEANUP_SECRET", externalSecret);
  workers.receipts.mockReset().mockResolvedValue({ ...empty, oldestDueAt: null });
  workers.qris.mockReset().mockResolvedValue(empty);
  workers.reconcileQris.mockReset().mockResolvedValue({ processed: 0, removed: 0, cursor: null });
  workers.reconcileReceipts.mockReset();
  vi.spyOn(console, "info").mockImplementation(() => undefined);
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("scheduled image cleanup", () => {
  it("rejects missing or wrong credentials without touching storage", async () => {
    for (const secret of [undefined, "wrong", externalSecret]) {
      expect((await GET(request("GET", secret))).status).toBe(401);
    }
    expect((await POST(request("POST", cronSecret))).status).toBe(401);
    expect(workers.receipts).not.toHaveBeenCalled();
    expect(workers.qris).not.toHaveBeenCalled();
  });
  it.each(["", "short"])("fails closed when the cron secret is insufficient: %s", async (secret) => {
    vi.stubEnv("CRON_SECRET", secret);
    expect((await GET(request("GET", secret))).status).toBe(401);
    expect(workers.qris).not.toHaveBeenCalled();
  });
  it("drains multiple batches with the configured cron credential", async () => {
    workers.receipts.mockResolvedValueOnce({ processed: 25, deleted: 25, failed: 0, hasMore: true, oldestDueAt: "2026-11-01T00:00:00.000Z" });
    workers.qris.mockResolvedValueOnce({ processed: 25, deleted: 24, failed: 1, hasMore: true, oldestDueAt: "2026-10-31T00:00:00.000Z" }).mockResolvedValueOnce({ processed: 2, deleted: 2, failed: 0, hasMore: false });
    const response = await GET(request("GET", cronSecret));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, data: { processed: 52, deleted: 51, failed: 1, hasMore: false, oldestDueAt: "2026-10-31T00:00:00.000Z", qris: { processed: 27, deleted: 26, failed: 1, hasMore: false } } });
    expect(workers.receipts).toHaveBeenCalledTimes(2);
    expect(workers.qris).toHaveBeenCalledTimes(2);
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
  it("keeps external POST cleanup to one batch and reports remaining work", async () => {
    workers.qris.mockResolvedValue({ processed: 25, deleted: 25, failed: 0, hasMore: true });
    const response = await POST(request("POST", externalSecret));
    expect(response.status).toBe(200);
    expect((await response.json()).data.hasMore).toBe(true);
    expect(workers.qris).toHaveBeenCalledTimes(1);
  });
  it("bounds cron work when the backlog is larger than one invocation can handle", async () => {
    workers.qris.mockResolvedValue({ processed: 25, deleted: 25, failed: 0, hasMore: true });
    const response = await GET(request("GET", cronSecret));
    expect((await response.json()).data).toMatchObject({ processed: 250, deleted: 250, hasMore: true });
    expect(workers.qris).toHaveBeenCalledTimes(10);
  });
  it("starts QRIS work while receipt cleanup is still waiting", async () => {
    let release!: () => void;
    workers.receipts.mockImplementation(() => new Promise(resolve => { release = () => resolve({ ...empty, oldestDueAt: null }); }));
    const response = GET(request("GET", cronSecret));
    expect(workers.qris).toHaveBeenCalledTimes(1);
    release();
    expect((await response).status).toBe(200);
  });
  it("rejects invalid reconciliation cursors and preserves the paginated reconciliation contract", async () => {
    expect((await GET(request("GET", cronSecret, `?reconcile=qris&cursor=${"a".repeat(2049)}`))).status).toBe(400);
    expect(workers.reconcileQris).not.toHaveBeenCalled();
    expect((await POST(request("POST", externalSecret, "?reconcile=qris&cursor=next-page"))).status).toBe(200);
    expect(workers.reconcileQris).toHaveBeenCalledWith("next-page");
  });
  it("does not expose provider details when cleanup fails", async () => {
    workers.receipts.mockRejectedValue(new Error("SECRET credential gs://private-bucket"));
    const response = await GET(request("GET", cronSecret));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toMatch(/SECRET|credential|private-bucket/);
    expect(workers.qris).toHaveBeenCalledTimes(1);
  });
});
