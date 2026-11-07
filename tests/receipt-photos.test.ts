import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
const storage = vi.hoisted(() => ({
  assets: new Map<string, Buffer>(),
  writes: 0,
  deleteFails: false,
  onWrite: null as null | (() => void),
}));
vi.mock("../src/server/receipts/storage", () => ({
  storePhotoBytes: async (photo: { id: string }, bytes: Buffer) => {
    storage.assets.set(photo.id, bytes);
    storage.writes++;
    storage.onWrite?.();
    return "generation-1";
  },
  readPhotoBytes: async (photo: { id: string }) => {
    if (!storage.assets.has(photo.id)) throw new Error("Missing object");
    return storage.assets.get(photo.id)!;
  },
  deletePhotoBytes: async (photo: { id: string }) => {
    if (storage.deleteFails) throw new Error("Storage unavailable");
    storage.assets.delete(photo.id);
  },
  listPhotoObjects: async () => ({ objects: [], cursor: null }),
}));
import { RECEIPT_TTL_MS } from "../src/domain/receipts";
import { readDevDb, writeDevDb } from "../src/server/store/dev-database";
import {
  createDraftBill,
  deleteBillForOwner,
  finalizeBillOnServer,
  getBillForOwner,
  publishBillShareLink,
  reopenBillToDraft,
  resolvePublicShareToken,
  revokeBillShareLink,
  saveBillDraft,
  reserveScanAttempt,
} from "../src/server/store/repository";
import {
  uploadReceiptPhoto,
  readOwnerReceiptPhoto,
  readPublicReceiptPhoto,
  cleanupReceiptPhotos,
  removeReceiptPhoto,
} from "../src/server/receipts/photos";
import { POST as cleanupRoute } from "../src/app/api/internal/receipt-cleanup/route";
import { limitedFormData } from "../src/server/receipts/http";

const owner = "dev-uid-host-patungin-local";
const ownerEmail = "host@patungin.local";
let bytes: Buffer;
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-07T12:00:00Z"));
  vi.stubEnv("RECEIPT_PHOTOS_ENABLED", "true");
  vi.stubEnv("RECEIPT_PHOTO_SHARING_ENABLED", "true");
  vi.stubEnv("ADMIN_EMAILS", "admin@example.com");
  const db = readDevDb();
  db.bills = {};
  db.shares = {};
  db.receiptPhotos = {};
  db.receiptPhotoQuotas = {};
  db.receiptPhotoReads = {};
  writeDevDb(db);
  storage.assets.clear();
  storage.writes = 0;
  storage.deleteFails = false;
  storage.onWrite = null;
  bytes = await sharp({
    create: { width: 20, height: 40, channels: 3, background: "white" },
  })
    .jpeg()
    .withMetadata({ exif: { IFD0: { Artist: "Private metadata" } } })
    .toBuffer();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
async function draft() {
  return createDraftBill({
    ownerUid: owner,
    ownerVerifiedEmail: ownerEmail,
    presetCode: "M-01",
  });
}
async function upload(
  bill: Awaited<ReturnType<typeof draft>>,
  key = "upload-key-0001",
) {
  return uploadReceiptPhoto({
    billId: bill.id,
    ownerUid: owner,
    expectedRevision: bill.revision,
    key,
    bytes,
  });
}
async function shared(includePhoto = true) {
  const saved = await upload(await draft());
  const changed = await saveBillDraft(saved.bill.id, owner, {
    expectedRevision: saved.bill.revision,
    shareReceiptPhoto: includePhoto,
  });
  const finalized = await finalizeBillOnServer({
    billId: changed.id,
    ownerUid: owner,
    expectedRevision: changed.revision,
  });
  return publishBillShareLink({
    billId: changed.id,
    ownerUid: owner,
    expectedRevision: finalized.bill.revision,
  });
}

describe("24-hour private receipt storage", () => {
  it("re-encodes valid bytes, strips EXIF and returns a new bill revision", async () => {
    const bill = await draft();
    const saved = await upload(bill);
    expect(saved.bill.revision).toBe(bill.revision + 1);
    const result = await readOwnerReceiptPhoto(bill.id, owner);
    expect((await sharp(result).metadata()).exif).toBeUndefined();
    expect((await sharp(result).metadata()).format).toBe("jpeg");
    expect(saved.photo.expiresAt).toBe("2026-11-08T12:00:00.000Z");
  });
  it("retries the same upload without another object, revision or expiry extension", async () => {
    const bill = await draft();
    const first = await upload(bill);
    vi.setSystemTime(Date.now() + 600000);
    const duplicate = await upload(bill);
    expect(duplicate).toEqual(first);
    expect(storage.writes).toBe(1);
  });
  it("rejects a reused key with different bytes", async () => {
    const bill = await draft();
    await upload(bill);
    await expect(
      uploadReceiptPhoto({
        billId: bill.id,
        ownerUid: owner,
        expectedRevision: bill.revision,
        key: "upload-key-0001",
        bytes: Buffer.from("different"),
      }),
    ).rejects.toMatchObject({ code: "UPLOAD_KEY_REUSED" });
  });
  it("rejects spoofed image bytes without charging OCR and retains cleanup responsibility", async () => {
    const bill = await draft();
    await expect(
      uploadReceiptPhoto({
        billId: bill.id,
        ownerUid: owner,
        expectedRevision: bill.revision,
        key: "upload-key-invalid",
        bytes: Buffer.from([0xff, 0xd8, 0xff]),
      }),
    ).rejects.toMatchObject({ code: "INVALID_IMAGE" });
    expect((await getBillForOwner(bill.id, owner)).scanAttemptCount).toBe(0);
    expect(Object.values(readDevDb().receiptPhotos)[0].status).toBe(
      "cleanup_pending",
    );
    expect(
      (await getBillForOwner(bill.id, owner)).receiptPhotoUploadId,
    ).toBeNull();
  });
  it("rejects wrong ownership and stale revisions before writing bytes", async () => {
    const bill = await draft();
    await expect(
      uploadReceiptPhoto({
        billId: bill.id,
        ownerUid: "other",
        expectedRevision: bill.revision,
        key: "upload-key-0001",
        bytes,
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
    await saveBillDraft(bill.id, owner, {
      expectedRevision: bill.revision,
      title: "Changed",
    });
    await expect(upload(bill)).rejects.toMatchObject({
      code: "STALE_REVISION",
    });
    expect(storage.writes).toBe(0);
  });
  it("denies at the exact expiry even if cleanup has not deleted bytes", async () => {
    const saved = await upload(await draft());
    vi.setSystemTime(Date.parse(saved.photo.expiresAt!) - 1);
    expect(
      (await readOwnerReceiptPhoto(saved.bill.id, owner)).length,
    ).toBeGreaterThan(0);
    vi.setSystemTime(Date.parse(saved.photo.expiresAt!));
    await expect(
      readOwnerReceiptPhoto(saved.bill.id, owner),
    ).rejects.toMatchObject({ code: "PHOTO_UNAVAILABLE" });
    expect(storage.assets.size).toBe(1);
  });
  it("compensates an upload when another tab edits before attachment", async () => {
    const bill = await draft();
    storage.onWrite = () => {
      const db = readDevDb();
      db.bills[bill.id].revision++;
      writeDevDb(db);
    };
    await expect(upload(bill)).rejects.toMatchObject({
      code: "STALE_REVISION",
    });
    expect(
      (await getBillForOwner(bill.id, owner)).receiptPhotoId,
    ).toBeUndefined();
    expect((await cleanupReceiptPhotos()).deleted).toBe(1);
    expect(storage.assets.size).toBe(0);
  });
  it("does not resurrect a bill deleted while an upload was in flight", async () => {
    const bill = await draft();
    storage.onWrite = () => {
      const db = readDevDb();
      delete db.bills[bill.id];
      writeDevDb(db);
    };
    await expect(upload(bill)).rejects.toMatchObject({
      code: "BILL_NOT_FOUND",
    });
    expect((await cleanupReceiptPhotos()).deleted).toBe(1);
    expect(readDevDb().bills[bill.id]).toBeUndefined();
  });
  it("keeps replaced assets inaccessible and removes them independently", async () => {
    const first = await upload(await draft());
    const second = await upload(first.bill, "upload-key-0002");
    await expect(
      readOwnerReceiptPhoto(first.bill.id, owner, first.photo.id),
    ).rejects.toMatchObject({ code: "PHOTO_UNAVAILABLE" });
    expect((await cleanupReceiptPhotos()).deleted).toBe(1);
    expect(storage.assets.has(second.photo.id!)).toBe(true);
  });
  it("enforces upload limits independently from scan quota", async () => {
    vi.stubEnv("RECEIPT_UPLOAD_HOURLY_LIMIT", "1");
    const first = await upload(await draft());
    await expect(upload(first.bill, "upload-key-0002")).rejects.toMatchObject({
      code: "PHOTO_LIMIT",
    });
    expect(first.bill.scanAttemptCount).toBe(0);
  });
  it("cleans expired bytes while the feature is disabled and tolerates repeated jobs", async () => {
    const saved = await upload(await draft());
    vi.setSystemTime(Date.now() + RECEIPT_TTL_MS);
    vi.stubEnv("RECEIPT_PHOTOS_ENABLED", "false");
    expect((await cleanupReceiptPhotos()).deleted).toBe(1);
    expect((await cleanupReceiptPhotos()).deleted).toBe(0);
    expect(storage.assets.size).toBe(0);
    expect(
      Object.keys(readDevDb().receiptPhotoQuotas[owner].assets),
    ).toHaveLength(0);
    expect(readDevDb().receiptPhotos[saved.photo.id!].status).toBe("deleted");
  });
  it("backs off failed deletes without dropping accounting or exposing expired photos", async () => {
    const saved = await upload(await draft());
    vi.setSystemTime(Date.now() + RECEIPT_TTL_MS);
    storage.deleteFails = true;
    expect((await cleanupReceiptPhotos()).failed).toBe(1);
    expect(readDevDb().receiptPhotos[saved.photo.id!].cleanupAttempts).toBe(1);
    expect(
      Object.keys(readDevDb().receiptPhotoQuotas[owner].assets),
    ).toHaveLength(1);
    storage.deleteFails = false;
    vi.setSystemTime(Date.now() + 60001);
    expect((await cleanupReceiptPhotos()).deleted).toBe(1);
  });
  it("rejects unauthorized cleanup and accepts only the configured bearer secret", async () => {
    vi.stubEnv(
      "RECEIPT_CLEANUP_SECRET",
      "a-test-cleanup-secret-with-32-characters",
    );
    expect(
      (
        await cleanupRoute(
          new Request("http://localhost/api/internal/receipt-cleanup", {
            method: "POST",
          }),
        )
      ).status,
    ).toBe(401);
    const response = await cleanupRoute(
      new Request("http://localhost/api/internal/receipt-cleanup", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.RECEIPT_CLEANUP_SECRET}`,
        },
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
  it("blocks scan and finalization during an uncertain active upload, without charging OCR", async () => {
    const bill = await draft();
    const db = readDevDb();
    db.bills[bill.id].receiptPhotoUploadId = "pending";
    writeDevDb(db);
    await expect(
      finalizeBillOnServer({
        billId: bill.id,
        ownerUid: owner,
        expectedRevision: bill.revision,
      }),
    ).rejects.toMatchObject({ code: "PHOTO_UPLOAD_IN_PROGRESS" });
    vi.stubEnv("GEMINI_SCAN_ENABLED", "true");
    await expect(
      reserveScanAttempt({
        billId: bill.id,
        ownerUid: owner,
        expectedRevision: bill.revision,
        idempotencyKey: "scan-key-pending",
        imageHash: "hash",
        model: "test",
        promptVersion: "test",
      }),
    ).rejects.toMatchObject({ code: "PHOTO_UPLOAD_IN_PROGRESS" });
    expect((await getBillForOwner(bill.id, owner)).scanAttemptCount).toBe(0);
  });
  it("bounds chunked multipart bodies before parsing", async () => {
    const request = new Request("http://localhost/upload", {
      method: "POST",
      body: new Uint8Array(100),
    });
    await expect(limitedFormData(request, 50)).rejects.toMatchObject({
      statusCode: 413,
    });
  });
});

describe("receipt sharing follows the active snapshot and link", () => {
  it("keeps photos private by default", async () => {
    const link = await shared(false);
    expect(
      (await resolvePublicShareToken(link.shareToken))?.receiptPhoto,
    ).toBeUndefined();
    await expect(readPublicReceiptPhoto(link.shareToken)).rejects.toMatchObject(
      { statusCode: 404 },
    );
  });
  it("shares only the opted-in photo and closes it immediately on link revocation", async () => {
    const link = await shared();
    expect(
      (await readPublicReceiptPhoto(link.shareToken)).length,
    ).toBeGreaterThan(0);
    await revokeBillShareLink({ billId: link.bill.id, ownerUid: owner });
    await expect(readPublicReceiptPhoto(link.shareToken)).rejects.toMatchObject(
      { statusCode: 404 },
    );
    expect(
      (await readOwnerReceiptPhoto(link.bill.id, owner)).length,
    ).toBeGreaterThan(0);
  });
  it("expires photo access independently of the seven-day result link", async () => {
    const link = await shared();
    vi.setSystemTime(Date.now() + RECEIPT_TTL_MS);
    const projection = await resolvePublicShareToken(link.shareToken);
    expect(projection?.receiptPhoto?.status).toBe("expired");
    expect(projection?.grandTotal).toBeGreaterThan(0);
    await expect(readPublicReceiptPhoto(link.shareToken)).rejects.toMatchObject(
      { statusCode: 404 },
    );
  });
  it("denies photos after reopening, owner access loss, and the photo sharing switch", async () => {
    const link = await shared();
    vi.stubEnv("RECEIPT_PHOTO_SHARING_ENABLED", "false");
    await expect(readPublicReceiptPhoto(link.shareToken)).rejects.toMatchObject(
      { statusCode: 404 },
    );
    vi.stubEnv("RECEIPT_PHOTO_SHARING_ENABLED", "true");
    vi.stubEnv("ALLOWED_EMAILS", "someone-else@example.com");
    await expect(readPublicReceiptPhoto(link.shareToken)).rejects.toMatchObject(
      { statusCode: 404 },
    );
    vi.stubEnv("ALLOWED_EMAILS", ownerEmail);
    await reopenBillToDraft({
      billId: link.bill.id,
      ownerUid: owner,
      expectedRevision: link.bill.revision,
    });
    await expect(readPublicReceiptPhoto(link.shareToken)).rejects.toMatchObject(
      { statusCode: 404 },
    );
  });
  it("deletes a finalized photo without changing the immutable financial snapshot", async () => {
    const link = await shared();
    const snapshot = structuredClone(link.bill.finalResult);
    const next = await removeReceiptPhoto(
      link.bill.id,
      owner,
      link.bill.revision,
    );
    expect(next.finalResult).toEqual(snapshot);
    await expect(readPublicReceiptPhoto(link.shareToken)).rejects.toMatchObject(
      { statusCode: 404 },
    );
    expect(
      (await resolvePublicShareToken(link.shareToken))?.grandTotal,
    ).toBeGreaterThan(0);
  });
  it("retires the photo when its bill is deleted", async () => {
    const saved = await upload(await draft());
    await deleteBillForOwner({ billId: saved.bill.id, ownerUid: owner });
    await expect(
      readOwnerReceiptPhoto(saved.bill.id, owner),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect((await cleanupReceiptPhotos()).deleted).toBe(1);
  });
  it("rate limits public reads before sending more bytes", async () => {
    vi.stubEnv("RECEIPT_PUBLIC_READS_PER_MINUTE", "1");
    const link = await shared();
    await readPublicReceiptPhoto(link.shareToken);
    await expect(readPublicReceiptPhoto(link.shareToken)).rejects.toMatchObject(
      { statusCode: 429 },
    );
  });
});
