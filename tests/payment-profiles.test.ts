import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
const photoBytes = vi.hoisted(() => new Map<string, Buffer>());
vi.mock("../src/server/receipts/storage", () => ({
  storePhotoBytes: async (photo: { id: string }, bytes: Buffer) => {
    photoBytes.set(photo.id, bytes);
    return "generation-1";
  },
  readPhotoBytes: async (photo: { id: string }) => photoBytes.get(photo.id)!,
  deletePhotoBytes: async (photo: { id: string }) => {
    photoBytes.delete(photo.id);
  },
  listPhotoObjects: async () => ({ objects: [], cursor: null }),
}));
const { documents, firestore } = await vi.hoisted(async () => {
  const { createFirestoreFake } = await import("./helpers/firestore");
  return createFirestoreFake();
});
const auth = vi.hoisted(() => ({
  uid: "alice",
  email: "alice@example.com",
  loggedIn: true,
}));
vi.mock("../src/server/firebase/admin", () => ({
  getAdminFirestore: () => firestore,
  getAdminAuth: () => ({
    verifySessionCookie: async () => {
      if (!auth.loggedIn) throw new Error("No session");
      return {
        uid: auth.uid,
        email: auth.email,
        email_verified: true,
        firebase: { sign_in_provider: "google.com" },
      };
    },
  }),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: "session-test" }) }),
  headers: async () => new Headers({ origin: "http://localhost:3000" }),
}));
import {
  validatePaymentProfile,
  type PaymentProfileInput,
} from "../src/domain/payment-profile";
import {
  getPaymentProfile,
  savePaymentProfile,
  selectPaymentMethods,
} from "../src/server/payments/profiles";
import {
  getPaymentProfileAction,
  savePaymentProfileAction,
  selectPaymentMethodsAction,
} from "../src/app/actions/payment-settings";
import {
  createDraftBill,
  saveBillDraft,
  finalizeBillOnServer,
  publishBillShareLink,
  resolvePublicShareToken,
  deleteBillForOwner,
} from "../src/server/store/repository";
import { uploadReceiptPhoto } from "../src/server/receipts/photos";
import {
  GET as photoGet,
  POST as photoPost,
  DELETE as photoDelete,
} from "../src/app/api/bills/[id]/receipt-photo/route";

function input(): PaymentProfileInput {
  return {
    methods: [
      {
        id: "pay_temporary01",
        label: "Pribadi",
        method: "bank",
        bankOrWalletName: "BCA",
        accountNumber: "0012345678",
        accountHolderName: "Alice",
      },
    ],
    defaultMethodId: "pay_temporary01",
  };
}
beforeEach(() => {
  documents.clear();
  auth.uid = "alice";
  auth.email = "alice@example.com";
  auth.loggedIn = true;
  photoBytes.clear();
  vi.stubEnv("FIREBASE_PROJECT_ID", "test-project");
  vi.stubEnv(
    "FIREBASE_CLIENT_EMAIL",
    "test@test-project.iam.gserviceaccount.com",
  );
  vi.stubEnv("FIREBASE_PRIVATE_KEY", "test-only");
  vi.stubEnv("ALLOWED_EMAILS", "alice@example.com,bob@example.com");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-07T12:00:00Z"));
});

describe("photo Firestore transaction and HTTP contract", () => {
  async function photoDraft() {
    vi.stubEnv("RECEIPT_PHOTOS_ENABLED", "true");
    vi.stubEnv("FIREBASE_STORAGE_BUCKET", "test-private-bucket");
    const bill = await createDraftBill({
      ownerUid: "alice",
      ownerVerifiedEmail: "alice@example.com",
      presetCode: "M-01",
    });
    const bytes = await sharp({
      create: { width: 20, height: 40, channels: 3, background: "white" },
    })
      .jpeg()
      .toBuffer();
    return { bill, bytes };
  }
  it("commits real-shaped Firestore records without undefined fields and retires them with deleted bills", async () => {
    const { bill, bytes } = await photoDraft();
    const saved = await uploadReceiptPhoto({
      billId: bill.id,
      ownerUid: "alice",
      expectedRevision: bill.revision,
      key: "upload-key-cloud",
      bytes,
    });
    expect(saved.bill.receiptPhotoUploadId).toBeNull();
    expect(documents.get(`receiptPhotos/${saved.photo.id}`)?.status).toBe(
      "ready",
    );
    await deleteBillForOwner({ billId: bill.id, ownerUid: "alice" });
    expect(documents.has(`bills/${bill.id}`)).toBe(false);
    expect(documents.get(`receiptPhotos/${saved.photo.id}`)?.status).toBe(
      "cleanup_pending",
    );
  });
  it("blocks parallel reservations on the same bill and clears leases after validation failure", async () => {
    const { bill, bytes } = await photoDraft();
    const params = {
      billId: bill.id,
      ownerUid: "alice",
      expectedRevision: bill.revision,
      bytes,
    };
    const results = await Promise.allSettled([
      uploadReceiptPhoto({ ...params, key: "cloud-upload-first" }),
      uploadReceiptPhoto({ ...params, key: "cloud-upload-second" }),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.find((result) => result.status === "rejected"),
    ).toMatchObject({ reason: { code: "UPLOAD_IN_PROGRESS" } });
    const next = await photoDraft();
    await expect(
      uploadReceiptPhoto({
        billId: next.bill.id,
        ownerUid: "alice",
        expectedRevision: next.bill.revision,
        key: "cloud-bad-bytes",
        bytes: Buffer.from("bad"),
      }),
    ).rejects.toMatchObject({ code: "INVALID_IMAGE" });
    expect(
      documents.get(`bills/${next.bill.id}`)?.receiptPhotoUploadId,
    ).toBeNull();
  });
  it("protects owner bytes, cache headers, missing sessions and cross-origin mutations", async () => {
    const { bill, bytes } = await photoDraft();
    await uploadReceiptPhoto({
      billId: bill.id,
      ownerUid: "alice",
      expectedRevision: bill.revision,
      key: "cloud-http-upload",
      bytes,
    });
    const url = `http://localhost:3000/api/bills/${bill.id}/receipt-photo`;
    const context = { params: Promise.resolve({ id: bill.id }) };
    const response = await photoGet(new Request(url), context);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    auth.uid = "bob";
    auth.email = "bob@example.com";
    expect((await photoGet(new Request(url), context)).status).toBe(403);
    auth.loggedIn = false;
    expect((await photoGet(new Request(url), context)).status).toBe(401);
    auth.loggedIn = true;
    for (const method of [photoPost, photoDelete]) {
      const denied = await method(
        new Request(url, {
          method: method === photoPost ? "POST" : "DELETE",
          headers: { origin: "https://attacker.example" },
        }),
        context,
      );
      expect(denied.status).toBe(403);
    }
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("private payment profiles with transactional revisions", () => {
  it("treats missing profiles as empty without importing history", async () => {
    expect(await getPaymentProfile("alice")).toMatchObject({
      revision: 0,
      methods: [],
      defaultMethodId: null,
    });
    expect(documents.has("paymentProfiles/alice")).toBe(false);
  });
  it("persists server-created IDs, keeps leading zeros and permits selecting only saved IDs", async () => {
    const saved = await savePaymentProfile("alice", 0, input());
    expect(saved.methods[0].id).not.toBe("pay_temporary01");
    expect(saved.defaultMethodId).toBe(saved.methods[0].id);
    const selected = await selectPaymentMethods("alice", [saved.methods[0].id]);
    expect(selected[0].accountNumber).toBe("0012345678");
    expect(selected[0]).not.toHaveProperty("id");
    expect(selected[0]).not.toHaveProperty("label");
    expect(documents.has("users/alice")).toBe(false);
  });
  it("accepts phone numbers with plus and leading zeros as strings", async () => {
    const next = input();
    next.methods[0].method = "ewallet";
    next.methods[0].accountNumber = "+6208123000";
    expect(
      (await savePaymentProfile("alice", 0, next)).methods[0].accountNumber,
    ).toBe("+6208123000");
  });
  it("serializes concurrent saves and rejects the loser rather than overwriting", async () => {
    const results = await Promise.allSettled([
      savePaymentProfile("alice", 0, input()),
      savePaymentProfile("alice", 0, input()),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.find((result) => result.status === "rejected"),
    ).toMatchObject({ reason: { code: "STALE_REVISION" } });
  });
  it("clears the default on explicit removal and never changes saved bill snapshots", async () => {
    const saved = await savePaymentProfile("alice", 0, input());
    const bill = await createDraftBill({
      ownerUid: "alice",
      ownerVerifiedEmail: "alice@example.com",
      presetCode: "M-01",
    });
    const patched = await saveBillDraft(bill.id, "alice", {
      expectedRevision: bill.revision,
      paymentMethods: await selectPaymentMethods("alice", [
        saved.methods[0].id,
      ]),
    });
    const final = await finalizeBillOnServer({
      billId: bill.id,
      ownerUid: "alice",
      expectedRevision: patched.revision,
    });
    const link = await publishBillShareLink({
      billId: bill.id,
      ownerUid: "alice",
      expectedRevision: final.bill.revision,
    });
    vi.setSystemTime(Date.now() + 1000);
    await savePaymentProfile("alice", saved.revision, {
      methods: [],
      defaultMethodId: null,
    });
    expect(
      (await resolvePublicShareToken(link.shareToken))?.paymentMethods?.[0]
        .accountNumber,
    ).toBe("0012345678");
    expect(final.snapshot.paymentMethods?.[0].accountNumber).toBe("0012345678");
    expect((await getPaymentProfile("alice")).defaultMethodId).toBeNull();
  });
  it("rejects invalid method, default, duplicate IDs, extra fields and oversize lists", () => {
    const qris = input();
    qris.methods[0].method = "qris" as "bank";
    expect(() => validatePaymentProfile(qris)).toThrow();
    expect(() =>
      validatePaymentProfile({ ...input(), defaultMethodId: "pay_unknown123" }),
    ).toThrow();
    const duplicate = input();
    duplicate.methods.push({ ...duplicate.methods[0] });
    expect(() => validatePaymentProfile(duplicate)).toThrow();
    expect(() =>
      validatePaymentProfile({
        ...input(),
        ownerUid: "victim",
      } as PaymentProfileInput),
    ).toThrow();
    const huge = input();
    huge.methods = Array.from({ length: 11 }, (_, i) => ({
      ...huge.methods[0],
      id: `pay_temporary${i}`,
    }));
    expect(() => validatePaymentProfile(huge)).toThrow();
  });
  it("cannot select deleted, duplicated, or foreign profile IDs", async () => {
    const saved = await savePaymentProfile("alice", 0, input());
    const id = saved.methods[0].id;
    await expect(selectPaymentMethods("bob", [id])).rejects.toMatchObject({
      code: "PAYMENT_REMOVED",
    });
    await expect(selectPaymentMethods("alice", [id, id])).rejects.toMatchObject(
      { code: "INVALID_SELECTION" },
    );
    vi.setSystemTime(Date.now() + 1000);
    await savePaymentProfile("alice", 1, {
      methods: [],
      defaultMethodId: null,
    });
    await expect(selectPaymentMethods("alice", [id])).rejects.toMatchObject({
      code: "PAYMENT_REMOVED",
    });
  });
  it("server actions derive profile ownership only from the authenticated session", async () => {
    const saved = await savePaymentProfileAction(0, input());
    expect(saved.ok).toBe(true);
    const id = saved.data!.methods[0].id;
    auth.uid = "bob";
    auth.email = "bob@example.com";
    expect((await getPaymentProfileAction()).data?.methods).toEqual([]);
    expect((await selectPaymentMethodsAction([id])).ok).toBe(false);
  });
  it("rejects actions for missing sessions and inactive access", async () => {
    auth.loggedIn = false;
    expect((await getPaymentProfileAction()).ok).toBe(false);
    auth.loggedIn = true;
    vi.stubEnv("ALLOWED_EMAILS", "other@example.com");
    expect((await savePaymentProfileAction(0, input())).ok).toBe(false);
  });
});
