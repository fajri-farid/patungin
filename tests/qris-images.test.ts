import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
const { documents, firestore } = await vi.hoisted(async () => {
  const { createFirestoreFake } = await import("./helpers/firestore");
  return createFirestoreFake();
});
const assets = vi.hoisted(() => ({
  files: new Map<string, Buffer>(),
  failDelete: false,
}));
const auth = vi.hoisted(() => ({
  uid: "alice",
  email: "alice@example.com",
  loggedIn: true,
}));
vi.mock("../src/server/payments/qris-storage", () => ({
  storeQrisBytes: async (asset: { id: string }, bytes: Buffer) => {
    assets.files.set(asset.id, bytes);
    return "generation-1";
  },
  readQrisBytes: async (asset: { id: string }) => {
    if (!assets.files.has(asset.id)) throw new Error("Not found");
    return assets.files.get(asset.id)!;
  },
  deleteQrisBytes: async (asset: { id: string }) => {
    if (assets.failDelete) throw new Error("Storage unavailable");
    assets.files.delete(asset.id);
  },
  listQrisObjects: async () => ({ objects: [], cursor: null }),
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
  cookies: async () => ({ get: () => ({ value: "session" }) }),
  headers: async () => new Headers({ origin: "http://localhost:3000" }),
}));
import {
  uploadQrisImage,
  cleanupQrisImages,
  readOwnerQrisImage,
  readPublicQrisImage,
} from "../src/server/payments/qris-images";
import {
  savePaymentProfile,
  selectPaymentMethods,
} from "../src/server/payments/profiles";
import {
  createDraftBill,
  saveBillDraft,
  finalizeBillOnServer,
  publishBillShareLink,
  deleteBillForOwner,
  reopenBillToDraft,
  revokeBillShareLink,
} from "../src/server/store/repository";
import { GET as ownerGet } from "../src/app/api/payments/qris/[id]/route";
import { POST as uploadPost } from "../src/app/api/payments/qris/route";
import type { PaymentProfileInput } from "../src/domain/payment-profile";
import type { QrisImageRecord } from "../src/domain/qris";
const DAY = 86400000;
let bytes: Buffer;
function profile(imageId: string): PaymentProfileInput {
  return {
    methods: [
      {
        id: "pay_temporary01",
        label: "QRIS pribadi",
        method: "qris",
        qrisImageId: imageId,
      },
    ],
    defaultMethodId: null,
  };
}
function record(id: string) {
  return documents.get(`qrisImages/${id}`) as unknown as QrisImageRecord;
}
async function share(imageId: string) {
  const bill = await createDraftBill({
    ownerUid: "alice",
    ownerVerifiedEmail: "alice@example.com",
    presetCode: "M-01",
  });
  const saved = await saveBillDraft(bill.id, "alice", {
    expectedRevision: bill.revision,
    paymentMethods: [{ method: "qris", qrisImageId: imageId }],
  });
  const final = await finalizeBillOnServer({
    billId: bill.id,
    ownerUid: "alice",
    expectedRevision: saved.revision,
  });
  return publishBillShareLink({
    billId: bill.id,
    ownerUid: "alice",
    expectedRevision: final.bill.revision,
  });
}
beforeEach(async () => {
  documents.clear();
  assets.files.clear();
  assets.failDelete = false;
  auth.uid = "alice";
  auth.email = "alice@example.com";
  auth.loggedIn = true;
  vi.stubEnv("FIREBASE_PROJECT_ID", "test-project");
  vi.stubEnv(
    "FIREBASE_CLIENT_EMAIL",
    "test@test-project.iam.gserviceaccount.com",
  );
  vi.stubEnv("FIREBASE_PRIVATE_KEY", "test-only");
  vi.stubEnv("FIREBASE_STORAGE_BUCKET", "test-bucket");
  vi.stubEnv("QRIS_IMAGES_ENABLED", "true");
  vi.stubEnv("RECEIPT_PHOTOS_ENABLED", "false");
  vi.stubEnv("ALLOWED_EMAILS", "alice@example.com,bob@example.com");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-07T12:00:00Z"));
  bytes = await sharp({
    create: { width: 40, height: 40, channels: 3, background: "white" },
  })
    .withMetadata({ exif: { IFD0: { Artist: "private" } } })
    .png()
    .toBuffer();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
describe("uploaded QRIS images", () => {
  it("enforces the stored asset cap across hours, including older reservations and failed deletions", async () => {
    vi.stubEnv("QRIS_MAX_STORED_PER_USER", "2");
    const one = await uploadQrisImage("alice", bytes);
    vi.setSystemTime(Date.now() + 3600000);
    const two = await uploadQrisImage("alice", bytes);
    documents.set(`qrisImages/${two.id}`, { ...record(two.id), status: "cleanup_pending" });
    vi.setSystemTime(Date.now() + 3600000);
    await expect(uploadQrisImage("alice", bytes)).rejects.toMatchObject({ code: "QRIS_STORAGE_LIMIT" });
    expect(documents.get("qrisUploadQuotas/alice")).toMatchObject({ attempts: 1 });
    assets.failDelete = true;
    await cleanupQrisImages();
    await expect(uploadQrisImage("alice", bytes)).rejects.toMatchObject({ code: "QRIS_STORAGE_LIMIT" });
    assets.failDelete = false;
    vi.setSystemTime(Date.now() + DAY);
    await cleanupQrisImages();
    expect(record(one.id).status).toBe("deleted");
    await expect(uploadQrisImage("alice", bytes)).resolves.toHaveProperty("id");
  });
  it("allows only one of two concurrent uploads into the last available slot", async () => {
    vi.stubEnv("QRIS_MAX_STORED_PER_USER", "1");
    const results = await Promise.allSettled([uploadQrisImage("alice", bytes), uploadQrisImage("alice", bytes)]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.find(result => result.status === "rejected")).toMatchObject({ reason: { code: "QRIS_STORAGE_LIMIT" } });
  });
  it("validates and re-encodes PNG without EXIF independently of receipt photo switches", async () => {
    const image = await uploadQrisImage("alice", bytes);
    expect(image.id).toMatch(/^qris_[a-f0-9]{32}$/);
    const output = await readOwnerQrisImage("alice", image.id);
    const metadata = await sharp(output).metadata();
    expect(metadata.exif).toBeUndefined();
    expect(metadata.format).toBe("png");
    expect(record(image.id)).toMatchObject({
      referenceCount: 0,
      status: "ready",
    });
  });
  it("requires a saved QRIS image and rejects foreign images atomically", async () => {
    const image = await uploadQrisImage("alice", bytes);
    await expect(
      savePaymentProfile("bob", 0, profile(image.id)),
    ).rejects.toMatchObject({ code: "QRIS_UNAVAILABLE" });
    expect(documents.has("paymentProfiles/bob")).toBe(false);
    expect(record(image.id).referenceCount).toBe(0);
    const invalid = profile(image.id);
    delete invalid.methods[0].qrisImageId;
    await expect(savePaymentProfile("alice", 0, invalid)).rejects.toMatchObject(
      { code: "INVALID_PAYMENT_PROFILE" },
    );
  });
  it("retains active profile images beyond one day and cleans them after their last reference is removed", async () => {
    const image = await uploadQrisImage("alice", bytes);
    const saved = await savePaymentProfile("alice", 0, profile(image.id));
    expect(record(image.id).referenceCount).toBe(1);
    vi.setSystemTime(Date.now() + 2 * DAY);
    expect((await cleanupQrisImages()).deleted).toBe(0);
    expect(
      (await readOwnerQrisImage("alice", image.id)).length,
    ).toBeGreaterThan(0);
    await savePaymentProfile("alice", saved.revision, {
      methods: [],
      defaultMethodId: null,
    });
    expect(record(image.id).referenceCount).toBe(0);
    vi.setSystemTime(Date.now() + DAY);
    expect((await cleanupQrisImages()).deleted).toBe(1);
    expect(assets.files.has(image.id)).toBe(false);
  });
  it("cleans abandoned uploads while preserving linked images", async () => {
    const abandoned = await uploadQrisImage("alice", bytes);
    const active = await uploadQrisImage("alice", bytes);
    await savePaymentProfile("alice", 0, profile(active.id));
    vi.setSystemTime(Date.now() + DAY);
    expect((await cleanupQrisImages()).deleted).toBe(1);
    expect(record(abandoned.id).status).toBe("deleted");
    expect(assets.files.has(active.id)).toBe(true);
  });
  it("does not double-count repeated profile saves or unchanged draft saves", async () => {
    const image = await uploadQrisImage("alice", bytes);
    const saved = await savePaymentProfile("alice", 0, profile(image.id));
    vi.setSystemTime(Date.now() + 1000);
    await savePaymentProfile("alice", saved.revision, {
      methods: saved.methods,
      defaultMethodId: saved.methods[0].id,
    });
    const bill = await createDraftBill({
      ownerUid: "alice",
      ownerVerifiedEmail: "alice@example.com",
      presetCode: "M-01",
    });
    const methods = await selectPaymentMethods("alice", [saved.methods[0].id]);
    const next = await saveBillDraft(bill.id, "alice", {
      expectedRevision: bill.revision,
      paymentMethods: methods,
    });
    await saveBillDraft(bill.id, "alice", {
      expectedRevision: next.revision,
      title: "Changed title",
    });
    expect(record(image.id).referenceCount).toBe(2);
  });
  it("keeps the old QRIS snapshot after profile replacement/deletion and releases bill references on deletion", async () => {
    const old = await uploadQrisImage("alice", bytes);
    const saved = await savePaymentProfile("alice", 0, profile(old.id));
    const link = await share(old.id);
    const newer = await uploadQrisImage("alice", bytes);
    vi.setSystemTime(Date.now() + 1000);
    const updated = await savePaymentProfile("alice", saved.revision, {
      methods: [{ ...saved.methods[0], qrisImageId: newer.id }],
      defaultMethodId: null,
    });
    expect(record(old.id).referenceCount).toBe(1);
    expect(record(newer.id).referenceCount).toBe(1);
    vi.setSystemTime(Date.now() + 1000);
    await savePaymentProfile("alice", updated.revision, {
      methods: [],
      defaultMethodId: null,
    });
    vi.setSystemTime(Date.now() + 2 * DAY);
    await cleanupQrisImages();
    expect(
      (await readPublicQrisImage(link.shareToken, old.id)).length,
    ).toBeGreaterThan(0);
    expect(record(newer.id).status).toBe("deleted");
    await deleteBillForOwner({ billId: link.bill.id, ownerUid: "alice" });
    expect(record(old.id).referenceCount).toBe(0);
    await expect(
      readPublicQrisImage(link.shareToken, old.id),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
  it("retains a previous final snapshot while editing and releases it only when replaced by a new finalization", async () => {
    const old = await uploadQrisImage("alice", bytes);
    const newer = await uploadQrisImage("alice", bytes);
    const link = await share(old.id);
    const draft = await reopenBillToDraft({
      billId: link.bill.id,
      ownerUid: "alice",
      expectedRevision: link.bill.revision,
    });
    const changed = await saveBillDraft(draft.id, "alice", {
      expectedRevision: draft.revision,
      paymentMethods: [{ method: "qris", qrisImageId: newer.id }],
    });
    expect(record(old.id).referenceCount).toBe(1);
    expect(record(newer.id).referenceCount).toBe(1);
    await finalizeBillOnServer({
      billId: draft.id,
      ownerUid: "alice",
      expectedRevision: changed.revision,
    });
    expect(record(old.id).referenceCount).toBe(0);
    expect(record(newer.id).referenceCount).toBe(1);
  });
  it("only serves images selected in the active public snapshot and respects revocation", async () => {
    const image = await uploadQrisImage("alice", bytes);
    const other = await uploadQrisImage("alice", bytes);
    const link = await share(image.id);
    await expect(
      readPublicQrisImage(link.shareToken, other.id),
    ).rejects.toMatchObject({ statusCode: 404 });
    await expect(readOwnerQrisImage("bob", image.id)).rejects.toMatchObject({
      statusCode: 404,
    });
    await revokeBillShareLink({ billId: link.bill.id, ownerUid: "alice" });
    await expect(
      readPublicQrisImage(link.shareToken, image.id),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
  it("keeps payment records intact after cleanup failure and denies attachment once cleanup starts", async () => {
    const image = await uploadQrisImage("alice", bytes);
    vi.setSystemTime(Date.now() + DAY);
    assets.failDelete = true;
    expect((await cleanupQrisImages()).failed).toBe(1);
    expect(record(image.id).status).toBe("cleanup_pending");
    await expect(
      savePaymentProfile("alice", 0, profile(image.id)),
    ).rejects.toMatchObject({ code: "QRIS_UNAVAILABLE" });
    assets.failDelete = false;
    vi.setSystemTime(Date.now() + 60001);
    expect((await cleanupQrisImages()).deleted).toBe(1);
  });
  it("rejects corrupt, oversized and unsupported bytes and limits repeated upload attempts", async () => {
    await expect(
      uploadQrisImage("alice", Buffer.alloc(2 * 1024 * 1024 + 1)),
    ).rejects.toMatchObject({ code: "INVALID_QRIS" });
    for (let i = 0; i < 10; i++)
      await expect(
        uploadQrisImage("alice", Buffer.from("not an image")),
      ).rejects.toMatchObject({ code: "INVALID_QRIS_IMAGE" });
    await expect(uploadQrisImage("alice", bytes)).rejects.toMatchObject({
      code: "QRIS_UPLOAD_LIMIT",
    });
  });
  it("uses private no-store PNG responses, supports download and rejects missing sessions and CSRF", async () => {
    const image = await uploadQrisImage("alice", bytes);
    const context = { params: Promise.resolve({ id: image.id }) };
    const url = `http://localhost:3000/api/payments/qris/${image.id}?download=1`;
    const response = await ownerGet(new Request(url), context);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("content-disposition")).toContain("attachment");
    auth.loggedIn = false;
    expect((await ownerGet(new Request(url), context)).status).toBe(401);
    auth.loggedIn = true;
    expect(
      (
        await uploadPost(
          new Request("http://localhost:3000/api/payments/qris", {
            method: "POST",
            headers: { origin: "https://attacker.example" },
          }),
        )
      ).status,
    ).toBe(403);
  });
});
