import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { documents, firestore } = await vi.hoisted(async () => {
  const { createFirestoreFake } = await import("./helpers/firestore");
  return createFirestoreFake();
});
const authState = vi.hoisted(() => ({
  uid: "admin-uid",
  email: "admin@example.com",
}));
vi.mock("../src/server/firebase/admin", () => ({
  getAdminFirestore: () => firestore,
  getAdminAuth: () => ({
    verifySessionCookie: async () => ({
      ...authState,
      email_verified: true,
      firebase: { sign_in_provider: "google.com" },
    }),
  }),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: "test-cookie" }) }),
  headers: async () => new Headers({ origin: "http://localhost:3000" }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

import {
  claimInvite,
  createInvite,
  ensureAccount,
  getAccount,
  hasProductAccess,
  monthKey,
  setInviteActive,
  updateAccount,
} from "../src/server/access/accounts";
import {
  createInviteAction,
  updateAccountAction,
} from "../src/app/actions/access";
import {
  completeScanAttempt,
  createDraftBill,
  deleteBillForOwner,
  finalizeBillOnServer,
  getScanQuotaStatus,
  publishBillShareLink,
  reserveScanAttempt,
  resolvePublicShareToken,
  saveBillDraft,
} from "../src/server/store/repository";
import { requireAuthenticatedHost } from "../src/server/auth/session";
import { summaryId } from "../src/server/admin/summary";

const admin = {
  uid: "admin-uid",
  email: "admin@example.com",
  displayName: "Admin",
};
const alice = {
  uid: "alice",
  email: "alice@example.com",
  displayName: "Alice",
};
const bob = { uid: "bob", email: "bob@example.com", displayName: "Bob" };
const inviteInput = {
  label: "Teman",
  code: "MAKANBARENG",
  maxClaims: 1,
  expiresAt: null,
  accessDays: null,
};

beforeEach(() => {
  documents.clear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-01T04:00:00Z"));
  vi.stubEnv("FIREBASE_PROJECT_ID", "test-project");
  vi.stubEnv("NEXT_PUBLIC_FIREBASE_PROJECT_ID", "test-project");
  vi.stubEnv("FIREBASE_CLIENT_EMAIL", "test@example.com");
  vi.stubEnv("FIREBASE_PRIVATE_KEY", "test-only");
  vi.stubEnv("GEMINI_API_KEY", "test-only");
  vi.stubEnv("GEMINI_MODEL", "test-only");
  vi.stubEnv("GEMINI_SCAN_ENABLED", "true");
  vi.stubEnv("ADMIN_UIDS", admin.uid);
  vi.stubEnv("ADMIN_EMAILS", "");
  vi.stubEnv("ALLOWED_EMAILS", "");
  vi.stubEnv(
    "INVITE_SIGNING_SECRET",
    "test-only-invite-verifier-secret-not-used-in-production",
  );
  authState.uid = admin.uid;
  authState.email = admin.email;
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

async function activate(identity = alice) {
  await createInvite({ ...inviteInput, email: identity.email });
  return ensureAccount(identity);
}
async function scan(billId: string, key: string, ownerUid = alice.uid) {
  return reserveScanAttempt({
    ownerUid,
    billId,
    expectedRevision: 1,
    idempotencyKey: key,
    imageHash: "test-hash",
    model: "test",
    promptVersion: "test",
  });
}

describe("Invitation and admin access", () => {
  it("counts a scan and its outcome once across reservation and completion retries", async () => {
    await activate();
    const bill = await createDraftBill({ ownerUid: alice.uid, ownerVerifiedEmail: alice.email });
    const first = await scan(bill.id, "monitoring-idempotent");
    const retry = await scan(bill.id, "monitoring-idempotent");
    expect(retry.isDuplicate).toBe(true);
    const input = { attemptId: first.attempt.id, state: "failed" as const, errorCode: "GEMINI_TIMEOUT" };
    await completeScanAttempt(input);
    await completeScanAttempt(input);
    await completeScanAttempt({ attemptId: first.attempt.id, state: "succeeded" });
    expect(documents.get(`adminUserMonths/${summaryId(alice.uid, "2026-11")}`)).toMatchObject({ used: 1, completed: 1, failed: 1, remaining: 29 });
    expect(documents.get(`scanAttempts/${first.attempt.id}`)?.state).toBe("failed");
  });
  it("limits simultaneous claims atomically, normalizes case, and never stores the code", async () => {
    await Promise.all([ensureAccount(alice), ensureAccount(bob)]);
    await createInvite(inviteInput);
    const results = await Promise.allSettled([
      claimInvite(alice, " makanbareng "),
      claimInvite(bob, "MAKANBARENG"),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const invites = [...documents.entries()].filter(([path]) =>
      path.startsWith("invites/"),
    );
    expect(invites[0][1].claimCount).toBe(1);
    expect(JSON.stringify(invites)).not.toContain("MAKANBARENG");
    await claimInvite(alice, "MAKANBARENG");
    expect(documents.get(invites[0][0])?.claimCount).toBe(1);
  });

  it("rejects expired/revoked invitations and duplicate codes without resetting claims", async () => {
    await ensureAccount(alice);
    await createInvite({ ...inviteInput, expiresAt: "2026-11-01T05:00:00Z" });
    await expect(createInvite(inviteInput)).rejects.toMatchObject({
      code: "INVITE_EXISTS",
    });
    vi.setSystemTime(new Date("2026-11-01T05:00:00Z"));
    await expect(claimInvite(alice, "MAKANBARENG")).rejects.toMatchObject({
      code: "INVITE_INVALID",
    });
    const invite = [...documents.values()].find((doc) => doc.kind === "code")!;
    await setInviteActive(String(invite.id), false);
    await expect(claimInvite(alice, "MAKANBARENG")).rejects.toMatchObject({
      code: "INVITE_INVALID",
    });
  });

  it("counts malformed guesses, persists failed attempts, and allows retry after cooldown", async () => {
    await ensureAccount(alice);
    for (let i = 0; i < 5; i++)
      await expect(claimInvite(alice, "bad")).rejects.toMatchObject({
        code: "INVITE_INVALID",
      });
    await createInvite(inviteInput);
    await expect(claimInvite(alice, "MAKANBARENG")).rejects.toMatchObject({
      code: "CLAIM_RATE_LIMIT",
    });
    vi.advanceTimersByTime(15 * 60000);
    await claimInvite(alice, "MAKANBARENG");
    expect(await hasProductAccess(alice.uid, alice.email)).toBe(true);
  });

  it("activates only the exact verified Google email of a direct invitation", async () => {
    await createInvite({
      ...inviteInput,
      email: "ALICE@example.com",
      accessDays: 7,
    });
    const denied = await ensureAccount(bob);
    expect(denied.status).toBe("pending");
    const allowed = await ensureAccount(alice);
    expect(allowed.status).toBe("active");
    expect(allowed.accessUntil).toBe("2026-11-08T04:00:00.000Z");
    vi.setSystemTime(new Date(allowed.accessUntil!));
    expect(await hasProductAccess(alice.uid, alice.email)).toBe(false);
  });

  it("requires admin on server actions, even with an authenticated Google session", async () => {
    await ensureAccount(bob);
    authState.uid = bob.uid;
    authState.email = bob.email;
    expect(await createInviteAction(inviteInput)).toMatchObject({
      ok: false,
      code: "ADMIN_REQUIRED",
    });
    expect(
      await updateAccountAction({
        uid: bob.uid,
        status: "active",
        accessUntil: null,
        monthlyLimit: 999,
        bonus: 999,
      }),
    ).toMatchObject({ ok: false, code: "ADMIN_REQUIRED" });
    expect((await getAccount(bob.uid))?.status).toBe("pending");
  });

  it("keeps admin able to use regular product features with the same quota", async () => {
    await ensureAccount(admin);
    expect(await requireAuthenticatedHost()).toMatchObject({
      uid: admin.uid,
      isAdmin: true,
    });
    const bill = await createDraftBill({
      ownerUid: admin.uid,
      ownerVerifiedEmail: admin.email,
    });
    await scan(bill.id, "admin-scan", admin.uid);
    expect(await getScanQuotaStatus(admin.uid)).toMatchObject({
      monthlyLimit: 30,
      usedThisMonth: 1,
      remaining: 29,
    });
    await expect(
      updateAccount(admin, {
        uid: admin.uid,
        status: "disabled",
        accessUntil: null,
        monthlyLimit: 30,
        bonus: 0,
      }),
    ).rejects.toMatchObject({ code: "ADMIN_PROTECTED" });
  });

  it("blocks an existing session on the next protected request and allows reactivation", async () => {
    await activate();
    authState.uid = alice.uid;
    authState.email = alice.email;
    await expect(requireAuthenticatedHost()).resolves.toMatchObject({
      uid: alice.uid,
    });
    await updateAccount(admin, {
      uid: alice.uid,
      status: "disabled",
      accessUntil: null,
      monthlyLimit: 30,
      bonus: 0,
    });
    await expect(requireAuthenticatedHost()).rejects.toMatchObject({
      code: "ACCESS_REQUIRED",
    });
    await expect(claimInvite(alice, "MAKANBARENG")).rejects.toMatchObject({
      code: "ACCESS_DISABLED",
    });
    await updateAccount(admin, {
      uid: alice.uid,
      status: "active",
      accessUntil: null,
      monthlyLimit: 30,
      bonus: 0,
    });
    await expect(requireAuthenticatedHost()).resolves.toMatchObject({
      uid: alice.uid,
    });
  });
});

describe("Monthly quota and final results", () => {
  it("enforces 30/account, permits another account, and applies bonus without resetting usage", async () => {
    await activate();
    await activate(bob);
    const bill = await createDraftBill({
      ownerUid: alice.uid,
      ownerVerifiedEmail: alice.email,
    });
    documents.set("usageMonths/2026-11", {
      dateKey: "2026-11",
      deploymentAttempts: 30,
      userAttempts: { alice: 30 },
      userMinuteWindows: {},
      activeLeases: {},
      userBonuses: {},
    });
    await expect(scan(bill.id, "over-quota")).rejects.toMatchObject({
      code: "MONTHLY_QUOTA_REACHED",
    });
    await updateAccount(admin, {
      uid: alice.uid,
      status: "active",
      accessUntil: null,
      monthlyLimit: 30,
      bonus: 10,
    });
    await scan(bill.id, "bonus-scan");
    expect(await getScanQuotaStatus(alice.uid)).toMatchObject({
      usedThisMonth: 31,
      bonus: 10,
      remaining: 9,
    });
    const otherBill = await createDraftBill({
      ownerUid: bob.uid,
      ownerVerifiedEmail: bob.email,
    });
    await scan(otherBill.id, "bob-scan", bob.uid);
    expect(await getScanQuotaStatus(bob.uid)).toMatchObject({
      usedThisMonth: 1,
      remaining: 29,
    });
  });

  it("resets at exactly 00:00 WITA on the first, retains custom limit and drops monthly bonus", async () => {
    await activate();
    await updateAccount(admin, {
      uid: alice.uid,
      status: "active",
      accessUntil: null,
      monthlyLimit: 50,
      bonus: 10,
    });
    vi.setSystemTime(new Date("2026-11-30T15:59:59.999Z"));
    expect(monthKey()).toBe("2026-11");
    expect(await getScanQuotaStatus(alice.uid)).toMatchObject({
      monthlyLimit: 50,
      bonus: 10,
    });
    vi.advanceTimersByTime(1);
    expect(monthKey()).toBe("2026-12");
    expect(await getScanQuotaStatus(alice.uid)).toMatchObject({
      monthlyLimit: 50,
      bonus: 0,
      usedThisMonth: 0,
      remaining: 50,
    });
    await expect(
      updateAccount(admin, {
        uid: alice.uid,
        status: "active",
        accessUntil: null,
        monthlyLimit: 50,
        bonus: 10,
        usageMonth: "2026-11",
      }),
    ).rejects.toMatchObject({ code: "MONTH_CHANGED" });
    expect(await getScanQuotaStatus(alice.uid)).toMatchObject({ bonus: 0 });
  });

  it("charges one slot for concurrent duplicate requests and rejects changed image hashes", async () => {
    await activate();
    const bill = await createDraftBill({
      ownerUid: alice.uid,
      ownerVerifiedEmail: alice.email,
    });
    const scans = await Promise.all([
      scan(bill.id, "same-request"),
      scan(bill.id, "same-request"),
    ]);
    expect(scans.map((scan) => scan.isDuplicate).sort()).toEqual([false, true]);
    await expect(
      reserveScanAttempt({
        ownerUid: alice.uid,
        billId: bill.id,
        expectedRevision: 1,
        idempotencyKey: "same-request",
        imageHash: "changed",
        model: "test",
        promptVersion: "test",
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    expect(await getScanQuotaStatus(alice.uid)).toMatchObject({
      usedThisMonth: 1,
    });
  });

  it("does not apply a late OCR result after disabling the owner", async () => {
    await activate();
    const bill = await createDraftBill({
      ownerUid: alice.uid,
      ownerVerifiedEmail: alice.email,
    });
    const { attempt } = await scan(bill.id, "late-scan");
    await updateAccount(admin, {
      uid: alice.uid,
      status: "disabled",
      accessUntil: null,
      monthlyLimit: 30,
      bonus: 0,
    });
    const completed = await completeScanAttempt({
      attemptId: attempt.id,
      state: "succeeded",
      extractedData: {
        merchant: "Late",
        receiptDate: null,
        items: [],
        adjustments: [],
        printedGrandTotal: 1000,
        warnings: [],
      },
    });
    expect(completed.appliedToBill).toBe(false);
    expect(completed.attempt.applicationOutcome).toBe("access_inactive");
    expect(documents.get(`bills/${bill.id}`)?.merchant).toBe("");
  });

  it("deletes a bill during a scan without resurrecting it or refunding quota", async () => {
    await activate();
    const bill = await createDraftBill({
      ownerUid: alice.uid,
      ownerVerifiedEmail: alice.email,
    });
    const { attempt } = await scan(bill.id, "deleted-during-scan");
    await deleteBillForOwner({ billId: bill.id, ownerUid: alice.uid });
    expect(documents.has(`bills/${bill.id}`)).toBe(false);
    expect(documents.has(`scanAttempts/${attempt.id}`)).toBe(true);
    const completed = await completeScanAttempt({
      attemptId: attempt.id,
      state: "succeeded",
      extractedData: {
        merchant: "Late",
        receiptDate: null,
        items: [],
        adjustments: [],
        printedGrandTotal: 1000,
        warnings: [],
      },
    });
    expect(completed.appliedToBill).toBe(false);
    expect(documents.has(`bills/${bill.id}`)).toBe(false);
    expect(documents.has(`scanAttempts/${attempt.id}`)).toBe(false);
    expect(completed.attempt.applicationOutcome).toBe("bill_deleted");
    expect(await getScanQuotaStatus(alice.uid)).toMatchObject({
      usedThisMonth: 1,
    });
    expect(documents.get("usageMonths/2026-11")?.activeLeases).toEqual({});
  });

  it("stores one inline final result, avoids public payload duplication, and denies disabled-owner links", async () => {
    await activate();
    const bill = await createDraftBill({
      ownerUid: alice.uid,
      ownerVerifiedEmail: alice.email,
      presetCode: "M-01",
    });
    const saved = await saveBillDraft(bill.id, alice.uid, {
      expectedRevision: 1,
      markReviewConfirmed: true,
    });
    const result = await finalizeBillOnServer({
      billId: bill.id,
      ownerUid: alice.uid,
      expectedRevision: saved.revision,
    });
    expect(documents.get(`bills/${bill.id}`)?.finalResult).toMatchObject({
      id: result.snapshot.id,
    });
    expect(
      [...documents.keys()].filter((path) => path.includes("/finalizations/")),
    ).toEqual([]);
    const share = await publishBillShareLink({
      billId: bill.id,
      ownerUid: alice.uid,
      expectedRevision: result.bill.revision,
    });
    expect(share.shareRecord.publicProjection).toBeUndefined();
    const publicData = await resolvePublicShareToken(share.shareToken);
    expect(publicData?.grandTotal).toBe(115500);
    expect(JSON.stringify(publicData)).not.toContain(alice.email);
    await updateAccount(admin, {
      uid: alice.uid,
      status: "disabled",
      accessUntil: null,
      monthlyLimit: 30,
      bonus: 0,
    });
    expect(await resolvePublicShareToken(share.shareToken)).toBeNull();
  });
});

it("keeps a pending account pending when only quota and bonus are edited", async () => {
  const account = await ensureAccount(alice);
  expect(account.status).toBe("pending");
  await updateAccount(admin, { uid: alice.uid, status: "pending", accessUntil: null, monthlyLimit: 40, bonus: 10 });
  expect(await getAccount(alice.uid)).toMatchObject({ status: "pending", activatedAt: null, monthlyLimit: 40 });
});

it("rejects stale admin edits without overwriting quota or access", async () => {
  const account = await activate(alice);
  await updateAccount(admin, { uid: alice.uid, status: "active", accessUntil: null, monthlyLimit: 30, bonus: 10 });
  await expect(updateAccount(admin, { uid: alice.uid, status: "disabled", accessUntil: null, monthlyLimit: 1, bonus: 5, expectedUpdatedAt: account.updatedAt, expectedBonus: 0 })).rejects.toMatchObject({ code: "ACCOUNT_CHANGED" });
  expect(await getAccount(alice.uid)).toMatchObject({ status: "active", monthlyLimit: 30 });
  expect((await getScanQuotaStatus(alice.uid)).bonus).toBe(10);
});
