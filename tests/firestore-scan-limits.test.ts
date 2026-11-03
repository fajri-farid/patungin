import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Firestore } from "@google-cloud/firestore";

const { documents, firestore } = await vi.hoisted(async () => {
  const { createFirestoreFake } = await import("./helpers/firestore");
  return createFirestoreFake();
});

vi.mock("../src/server/firebase/admin", () => ({
  getAdminFirestore: () => firestore,
  getAdminAuth: () => { throw new Error("No real authentication in repository tests"); },
}));

import { completeScanAttempt, createDraftBill, publishBillShareLink, reserveScanAttempt, resolvePublicShareToken } from "../src/server/store/repository";
import { GOLDEN_FIXTURES } from "../src/domain/billing/fixtures";
import { calculateBill } from "../src/domain/billing/calculation";

beforeEach(() => {
  documents.clear();
  vi.stubEnv("FIREBASE_PROJECT_ID", "test-project");
  vi.stubEnv("NEXT_PUBLIC_FIREBASE_PROJECT_ID", "test-project");
  vi.stubEnv("FIREBASE_CLIENT_EMAIL", "admin@test-project.iam.gserviceaccount.com");
  vi.stubEnv("FIREBASE_PRIVATE_KEY", "not-a-real-key");
  vi.stubEnv("GEMINI_API_KEY", "not-a-real-key");
  vi.stubEnv("GEMINI_MODEL", "test-model");
  vi.stubEnv("GEMINI_SCAN_ENABLED", "true");
  vi.stubEnv("SCAN_PER_MINUTE_LIMIT", "20");
  vi.stubEnv("ALLOWED_EMAILS", "owner@example.com");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

async function draft(ownerUid = "owner") {
  return createDraftBill({ ownerUid, ownerVerifiedEmail: "owner@example.com" });
}

function scan(billId: string, key: string, ownerUid = "owner", expectedRevision = 1) {
  return reserveScanAttempt({ billId, ownerUid, expectedRevision, idempotencyKey: key, imageHash: "synthetic-image-hash", model: "test-model", promptVersion: "test-v1" });
}

describe("Firestore scan boundary (contract fake; no live Firestore or Gemini calls)", () => {
  it("publishes and opens a link when optional labels and allocation fields are absent", async () => {
    vi.stubEnv("ALLOWED_EMAILS", "owner@example.com");
    const bill = await draft();
    const input = structuredClone(GOLDEN_FIXTURES[0].input);
    // Cover both unit and shared rows; persisted Firestore data has no undefined fields.
    input.allocations[0] = { itemId: input.items[0].id, mode: "shared", participantIds: input.participants.map(person => person.id) };
    const snapshot = JSON.parse(JSON.stringify({
      id: "fin-1", title: "Makan bersama", merchant: "Warung", receiptDate: "2026-11", currency: "IDR",
      versionNumber: 1, calculationVersion: 1, inputSnapshot: input, calculationResult: calculateBill(input),
      paymentNote: null, finalizedAt: new Date().toISOString(),
    }));
    Object.assign(documents.get(`bills/${bill.id}`)!, { status: "finalized", currentFinalizationId: "fin-1" });
    documents.set(`bills/${bill.id}/finalizations/fin-1`, snapshot);
    await expect(publishBillShareLink({ billId: bill.id, ownerUid: "owner", expectedRevision: bill.revision + 1 })).rejects.toMatchObject({ code: "STALE_REVISION" });
    expect([...documents.keys()].filter((key) => key.startsWith("shares/"))).toHaveLength(0);
    const published = await publishBillShareLink({ billId: bill.id, ownerUid: "owner", expectedRevision: bill.revision });
    expect(published.shareToken).toBeTruthy();
    const repeated = await publishBillShareLink({ billId: bill.id, ownerUid: "owner", expectedRevision: published.bill.revision });
    expect(repeated.shareToken).toBe(published.shareToken);
    expect(repeated.bill.revision).toBe(published.bill.revision);
    // The real SDK validates batch.set locally; no commit or network call is made.
    const validator = new Firestore({ projectId: "test-only-no-network" });
    expect(() => validator.batch().set(validator.doc("shares/test-only"), published.shareRecord)).not.toThrow();
    const projection = await resolvePublicShareToken(published.shareToken);
    expect(projection?.grandTotal).toBe(115500);
    expect(projection?.participants).toHaveLength(2);
    expect(projection?.participants[0]).not.toHaveProperty("label");
    expect(projection?.participants[0].items[0]).not.toHaveProperty("units");
    expect(projection?.receiptDetails?.items).toHaveLength(input.items.length);
    // Old stored projections get their full menu from the immutable finalization.
    const storedShare = documents.get(`shares/${published.shareRecord.shareId}`)!;
    expect(storedShare.publicProjection).toBeUndefined();
    expect((await resolvePublicShareToken(published.shareToken))?.receiptDetails?.items).toHaveLength(input.items.length);
    // A legacy record with a 30-day expiry is still capped at seven days.
    storedShare.createdAt = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    storedShare.expiresAt = new Date(Date.now() + 22 * 24 * 60 * 60 * 1000).toISOString();
    expect(await resolvePublicShareToken(published.shareToken)).toBeNull();
    // Old-format active shares are retired and replaced on the next publish.
    const oldId = "A".repeat(43);
    documents.set(`shares/${oldId}`, { ...structuredClone(storedShare), shareId: oldId, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 7 * 86400000).toISOString() });
    documents.get(`bills/${bill.id}`)!.activeShareId = oldId;
    const replacement = await publishBillShareLink({ billId: bill.id, ownerUid: "owner", expectedRevision: published.bill.revision });
    expect(replacement.shareToken).toHaveLength(42);
    expect(replacement.shareRecord.shareId).not.toBe(oldId);
    expect(documents.get(`shares/${oldId}`)!.revokedAt).toBeTruthy();
    expect(await resolvePublicShareToken(replacement.shareToken)).not.toBeNull();
  });
  it("stores screen metadata and extraction warnings on the bill in the completion transaction", async () => {
    const bill = await draft();
    const { attempt } = await scan(bill.id, "screen-scan");
    await completeScanAttempt({ attemptId: attempt.id, state: "succeeded", applyToBillIfRevisionMatches: true,
      extractedData: { sourceType: "cashier_screen", merchant: null, receiptDate: null,
        items: [{ id: "i", allocationOrder: 0, name: "Item", quantity: 1, lineAmount: 7000, reviewConfirmed: false }],
        adjustments: [], printedGrandTotal: 7000, warnings: ["Periksa pantulan pada layar."] } });
    expect(documents.get(`bills/${bill.id}`)).toMatchObject({ receiptSourceType: "cashier_screen", extractionWarnings: ["Periksa pantulan pada layar."], confirmedInputHash: null });
  });
  it("rejects scan of a stale revision or a finalized bill before consuming quota", async () => {
    const bill = await draft();
    await expect(scan(bill.id, "stale-request", "owner", 2)).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    documents.get(`bills/${bill.id}`)!.status = "finalized";
    await expect(scan(bill.id, "finalized-request")).rejects.toMatchObject({ code: "BILL_FINALIZED" });
    expect([...documents.keys()].filter((key) => key.startsWith("scanAttempts/"))).toHaveLength(0);
  });

  it("allows at most one active scan per user across different bills", async () => {
    const first = await draft();
    const second = await draft();
    await scan(first.id, "first-attempt");
    await expect(scan(second.id, "second-attempt")).rejects.toMatchObject({ code: "USER_CONCURRENCY_LIMIT" });
    expect(documents.get(`bills/${second.id}`)?.scanAttemptCount).toBe(0);
  });

  it("enforces five attempts per bill even when attempts fail and their leases are released", async () => {
    const bill = await draft();
    for (let index = 0; index < 5; index++) {
      const { attempt } = await scan(bill.id, `attempt-${index}`);
      await completeScanAttempt({ attemptId: attempt.id, state: "failed" });
    }
    await expect(scan(bill.id, "attempt-six")).rejects.toMatchObject({ code: "BILL_ATTEMPT_LIMIT_REACHED" });
    expect(documents.get(`bills/${bill.id}`)?.scanAttemptCount).toBe(5);
  });

  it("recovers attempt counts for older bills without a stored counter", async () => {
    const bill = await draft();
    delete documents.get(`bills/${bill.id}`)!.scanAttemptCount;
    for (let index = 0; index < 5; index++) {
      documents.set(`scanAttempts/legacy-${index}`, { billId: bill.id });
    }
    await expect(scan(bill.id, "new-attempt")).rejects.toMatchObject({ code: "BILL_ATTEMPT_LIMIT_REACHED" });
  });

  it("reuses the same idempotency key without charging another application quota slot", async () => {
    const bill = await draft();
    const first = await scan(bill.id, "one-request");
    const duplicate = await scan(bill.id, "one-request");
    expect(duplicate.isDuplicate).toBe(true);
    expect(duplicate.attempt.id).toBe(first.attempt.id);
    expect(documents.get(`bills/${bill.id}`)?.scanAttemptCount).toBe(1);
    const usage = documents.get(`usageMonths/${first.attempt.usageMonthKey}`);
    expect(usage?.deploymentAttempts).toBe(1);
  });

  it("preserves active-user protection across midnight and releases the original date bucket", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-31T15:59:50Z"));
    const first = await draft();
    const second = await draft();
    const { attempt } = await scan(first.id, "before-midnight");
    expect(attempt.usageMonthKey).toBe("2026-10");
    vi.setSystemTime(new Date("2026-10-31T16:00:10Z"));
    await expect(scan(second.id, "after-midnight")).rejects.toMatchObject({ code: "USER_CONCURRENCY_LIMIT" });
    await completeScanAttempt({ attemptId: attempt.id, state: "unknown" });
    const oldUsage = documents.get("usageMonths/2026-10");
    expect(oldUsage?.activeLeases).toEqual({});
    expect(oldUsage?.deploymentAttempts).toBe(1);
    const next = await scan(second.id, "after-completion");
    expect(next.attempt.usageMonthKey).toBe("2026-11");
  });
});
