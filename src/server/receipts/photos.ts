import crypto from "node:crypto";
import sharp from "sharp";
import {
  MAX_RECEIPT_BYTES,
  RECEIPT_TTL_MS,
  receiptPhotoInfo,
  type ReceiptPhotoRecord,
} from "@/domain/receipts";
import type {
  BillDocument,
  PublicShareProjection,
} from "@/domain/billing/types";
import { getServerConfig } from "../config/env";
import { getAdminFirestore } from "../firebase/admin";
import {
  AppServiceError,
  getBillForOwner,
  resolvePublicShareToken,
} from "../store/repository";
import { productTransaction, readProductDocument } from "../store/transaction";
import { readDevDb } from "../store/dev-database";
import { verifyShareTokenSignature } from "../shares/token";
import {
  deletePhotoBytes,
  listPhotoObjects,
  readPhotoBytes,
  storePhotoBytes,
} from "./storage";

export interface PhotoQuota {
  hour: number;
  attempts: number;
  assets: Record<string, { createdAt: number; uploading: boolean }>;
}
const STALE_UPLOAD_MS = 15 * 60 * 1000;
const NEVER = "9999-12-31T23:59:59.999Z";
function assertEnabled() {
  if (!getServerConfig().receipts.enabled)
    throw new AppServiceError(
      503,
      "PHOTOS_DISABLED",
      "Penyimpanan foto sementara belum tersedia.",
    );
}
function assertDraft(
  bill: BillDocument | null,
  ownerUid: string,
  revision: number,
): asserts bill is BillDocument {
  if (!bill || bill.ownerUid !== ownerUid)
    throw new AppServiceError(
      404,
      "BILL_NOT_FOUND",
      "Tagihan tidak ditemukan.",
    );
  if (bill.status !== "draft" || bill.revision !== revision)
    throw new AppServiceError(
      409,
      "STALE_REVISION",
      "Tagihan berubah. Muat ulang sebelum menyimpan foto.",
    );
}

export async function getOwnerPhotoInfo(bill: BillDocument) {
  if (!getServerConfig().receipts.enabled)
    return { status: "disabled" as const };
  try {
    const photo = bill.receiptPhotoId
      ? await readProductDocument<ReceiptPhotoRecord>(
          "receiptPhotos",
          bill.receiptPhotoId,
        )
      : null;
    return receiptPhotoInfo(
      photo && photo.billId === bill.id && photo.ownerUid === bill.ownerUid
        ? photo
        : null,
    );
  } catch {
    return { status: "unavailable" as const };
  }
}

export async function uploadReceiptPhoto(params: {
  billId: string;
  ownerUid: string;
  expectedRevision: number;
  key: string;
  bytes: Buffer;
}) {
  assertEnabled();
  const { billId, ownerUid, expectedRevision, key, bytes } = params;
  if (
    !/^[a-zA-Z0-9_-]{1,128}$/.test(billId) ||
    !/^[a-zA-Z0-9_-]{1,128}$/.test(ownerUid) ||
    typeof key !== "string" ||
    key.length < 8 ||
    key.length > 128 ||
    !Number.isSafeInteger(expectedRevision)
  ) {
    throw new AppServiceError(
      422,
      "INVALID_UPLOAD",
      "Permintaan simpan foto tidak valid.",
    );
  }
  if (!bytes.length || bytes.length > MAX_RECEIPT_BYTES)
    throw new AppServiceError(
      422,
      "IMAGE_TOO_LARGE",
      "Foto maksimal 2 MiB setelah optimasi.",
    );
  const imageHash = crypto.createHash("sha256").update(bytes).digest("hex");
  const id = `photo_${crypto
    .createHash("sha256")
    .update(JSON.stringify([ownerUid, billId, key]))
    .digest("hex")}`;
  const now = Date.now();
  const config = getServerConfig();
  const reserved = await productTransaction(async (tx) => {
    const bill = await tx.get<BillDocument>("bills", billId);
    const existing = await tx.get<ReceiptPhotoRecord>("receiptPhotos", id);
    const quota = (await tx.get<PhotoQuota>(
      "receiptPhotoQuotas",
      ownerUid,
    )) ?? { hour: Math.floor(now / 3600000), attempts: 0, assets: {} };
    if (!bill || bill.ownerUid !== ownerUid)
      throw new AppServiceError(
        404,
        "BILL_NOT_FOUND",
        "Tagihan tidak ditemukan.",
      );
    if (existing) {
      if (existing.imageHash !== imageHash)
        throw new AppServiceError(
          409,
          "UPLOAD_KEY_REUSED",
          "Pilih ulang foto untuk permintaan berbeda.",
        );
      if (
        bill.receiptPhotoId === id &&
        receiptPhotoInfo(existing).status === "available"
      )
        return { photo: existing, bill, duplicate: true };
      if (
        existing.status === "cleanup_pending" ||
        existing.status === "deleted"
      )
        throw new AppServiceError(
          409,
          "UPLOAD_RETRY_REQUIRED",
          "Percobaan sebelumnya gagal. Mulai percobaan simpan baru.",
        );
      throw new AppServiceError(
        409,
        "UPLOAD_IN_PROGRESS",
        "Upload ini sudah diproses. Muat ulang sebelum mencoba lagi.",
      );
    }
    assertDraft(bill, ownerUid, expectedRevision);
    if (bill.receiptPhotoUploadId)
      throw new AppServiceError(
        409,
        "UPLOAD_IN_PROGRESS",
        "Foto masih diproses di tab lain. Tunggu lalu coba lagi.",
      );
    if (quota.hour !== Math.floor(now / 3600000)) {
      quota.hour = Math.floor(now / 3600000);
      quota.attempts = 0;
    }
    if (
      quota.attempts >= config.receipts.hourlyUploadLimit ||
      Object.keys(quota.assets).length >= config.receipts.maxStored ||
      Object.values(quota.assets).filter((asset) => asset.uploading).length >= 3
    ) {
      throw new AppServiceError(
        429,
        "PHOTO_LIMIT",
        "Batas simpan foto sementara tercapai. Tunggu lalu coba lagi.",
      );
    }
    const photo: ReceiptPhotoRecord = {
      id,
      billId,
      ownerUid,
      imageHash,
      objectPath: `receipts/${ownerUid}/${billId}/${id}.jpg`,
      objectGeneration: null,
      status: "uploading",
      contentType: "image/jpeg",
      sizeBytes: 0,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + RECEIPT_TTL_MS).toISOString(),
      nextCleanupAt: new Date(now + STALE_UPLOAD_MS).toISOString(),
      cleanupAttempts: 0,
      deletedAt: null,
    };
    quota.attempts += 1;
    quota.assets[id] = { createdAt: now, uploading: true };
    tx.set("receiptPhotoQuotas", ownerUid, quota);
    tx.set("receiptPhotos", id, photo);
    tx.set("bills", billId, { ...bill, receiptPhotoUploadId: id });
    return { photo, bill, duplicate: false };
  });
  if (reserved.duplicate)
    return { bill: reserved.bill, photo: receiptPhotoInfo(reserved.photo) };
  let generation: string | null = null;
  try {
    let output: Buffer;
    try {
      const image = sharp(bytes, {
        limitInputPixels: 16_000_000,
        failOn: "warning",
        animated: false,
      });
      const metadata = await image.metadata();
      if (
        !["jpeg", "png", "webp"].includes(metadata.format ?? "") ||
        (metadata.pages ?? 1) > 1
      )
        throw new Error("Unsupported image");
      output = await image
        .rotate()
        .resize({
          width: 2400,
          height: 2400,
          fit: "inside",
          withoutEnlargement: true,
        })
        .flatten({ background: "#ffffff" })
        .jpeg({ quality: 86 })
        .toBuffer();
      if (output.length > MAX_RECEIPT_BYTES) throw new Error("Image too large");
    } catch {
      throw new AppServiceError(
        422,
        "INVALID_IMAGE",
        "Foto belum bisa dibaca. Gunakan JPG, PNG, atau WebP yang valid.",
      );
    }
    generation = await storePhotoBytes(reserved.photo, output);
    const bill = await productTransaction(async (tx) => {
      const current = await tx.get<BillDocument>("bills", billId);
      const photo = await tx.get<ReceiptPhotoRecord>("receiptPhotos", id);
      const quota = await tx.get<PhotoQuota>("receiptPhotoQuotas", ownerUid);
      const previous = current?.receiptPhotoId
        ? await tx.get<ReceiptPhotoRecord>(
            "receiptPhotos",
            current.receiptPhotoId,
          )
        : null;
      assertDraft(current, ownerUid, expectedRevision);
      if (
        photo?.status !== "uploading" ||
        current.receiptPhotoUploadId !== id ||
        Date.now() >= Date.parse(photo.expiresAt)
      )
        throw new AppServiceError(
          409,
          "UPLOAD_EXPIRED",
          "Upload sudah berakhir. Pilih ulang foto.",
        );
      const next = {
        ...current,
        receiptPhotoId: id,
        receiptPhotoUploadId: null,
        revision: current.revision + 1,
        updatedAt: new Date().toISOString(),
      };
      tx.set("receiptPhotos", id, {
        ...photo,
        status: "ready",
        objectGeneration: generation,
        sizeBytes: output.length,
        nextCleanupAt: photo.expiresAt,
      });
      if (previous)
        tx.set("receiptPhotos", previous.id, {
          ...previous,
          status: "cleanup_pending",
          nextCleanupAt: new Date().toISOString(),
        });
      if (quota?.assets[id]) {
        quota.assets[id].uploading = false;
        tx.set("receiptPhotoQuotas", ownerUid, quota);
      }
      tx.set("bills", billId, next);
      return next;
    });
    return {
      bill,
      photo: {
        status: "available" as const,
        id,
        expiresAt: reserved.photo.expiresAt,
      },
    };
  } catch (error) {
    // A failed/uncertain commit must never retire an asset that was already attached.
    await productTransaction(async (tx) => {
      const current = await tx.get<ReceiptPhotoRecord>("receiptPhotos", id);
      const bill = await tx.get<BillDocument>("bills", billId);
      const quota = await tx.get<PhotoQuota>("receiptPhotoQuotas", ownerUid);
      if (current?.status === "uploading")
        tx.set("receiptPhotos", id, {
          ...current,
          objectGeneration: generation,
          status: "cleanup_pending",
          nextCleanupAt: new Date().toISOString(),
        });
      if (bill?.receiptPhotoUploadId === id)
        tx.set("bills", billId, { ...bill, receiptPhotoUploadId: null });
      if (quota?.assets[id]?.uploading) {
        quota.assets[id].uploading = false;
        tx.set("receiptPhotoQuotas", ownerUid, quota);
      }
    }).catch(() => undefined); // Existing reservation remains discoverable even if Firestore is unavailable.
    throw error;
  }
}

export async function removeReceiptPhoto(
  billId: string,
  ownerUid: string,
  expectedRevision: number,
) {
  return productTransaction(async (tx) => {
    const bill = await tx.get<BillDocument>("bills", billId);
    if (!bill || bill.ownerUid !== ownerUid)
      throw new AppServiceError(
        404,
        "BILL_NOT_FOUND",
        "Tagihan tidak ditemukan.",
      );
    if (bill.revision !== expectedRevision)
      throw new AppServiceError(
        409,
        "STALE_REVISION",
        "Tagihan berubah. Muat ulang dahulu.",
      );
    if (bill.receiptPhotoUploadId)
      throw new AppServiceError(
        409,
        "UPLOAD_IN_PROGRESS",
        "Tunggu penyimpanan foto selesai dahulu.",
      );
    const photo = bill.receiptPhotoId
      ? await tx.get<ReceiptPhotoRecord>("receiptPhotos", bill.receiptPhotoId)
      : null;
    const next = {
      ...bill,
      receiptPhotoId: null,
      shareReceiptPhoto: false,
      revision: bill.revision + 1,
      updatedAt: new Date().toISOString(),
    };
    if (photo)
      tx.set("receiptPhotos", photo.id, {
        ...photo,
        status: "cleanup_pending",
        nextCleanupAt: new Date().toISOString(),
      });
    tx.set("bills", billId, next);
    return next;
  });
}

async function readAvailable(
  photo: ReceiptPhotoRecord | null,
  bill: Pick<BillDocument, "id" | "ownerUid">,
) {
  if (
    !photo ||
    photo.billId !== bill.id ||
    photo.ownerUid !== bill.ownerUid ||
    receiptPhotoInfo(photo).status !== "available"
  ) {
    throw new AppServiceError(
      404,
      "PHOTO_UNAVAILABLE",
      "Foto struk sudah kedaluwarsa atau tidak tersedia.",
    );
  }
  const bytes = await readPhotoBytes(photo);
  // Recheck expiry after storage IO, before returning any bytes.
  if (receiptPhotoInfo(photo).status !== "available")
    throw new AppServiceError(
      404,
      "PHOTO_UNAVAILABLE",
      "Foto sudah kedaluwarsa.",
    );
  return bytes;
}
export async function readOwnerReceiptPhoto(
  billId: string,
  ownerUid: string,
  expectedPhotoId?: string,
) {
  assertEnabled();
  const bill = await getBillForOwner(billId, ownerUid);
  if (expectedPhotoId && bill.receiptPhotoId !== expectedPhotoId)
    throw new AppServiceError(404, "PHOTO_UNAVAILABLE", "Foto sudah berubah.");
  const photo = bill.receiptPhotoId
    ? await readProductDocument<ReceiptPhotoRecord>(
        "receiptPhotos",
        bill.receiptPhotoId,
      )
    : null;
  return readAvailable(photo, bill);
}
export async function addPublicPhotoInfo(
  projection: PublicShareProjection,
  bill: BillDocument,
  photoId?: string | null,
) {
  if (
    !getServerConfig().receipts.enabled ||
    !getServerConfig().receipts.sharingEnabled ||
    !photoId ||
    bill.receiptPhotoId !== photoId
  )
    return;
  try {
    const photo = await readProductDocument<ReceiptPhotoRecord>(
      "receiptPhotos",
      photoId,
    );
    if (photo?.ownerUid === bill.ownerUid && photo.billId === bill.id)
      projection.receiptPhoto = receiptPhotoInfo(photo);
  } catch {
    projection.receiptPhoto = { status: "unavailable" };
  }
}
export async function readPublicReceiptPhoto(token: string) {
  assertEnabled();
  const config = getServerConfig();
  if (
    !config.receipts.sharingEnabled ||
    !config.share.linksEnabled ||
    !config.share.isConfigured
  )
    throw new AppServiceError(404, "PHOTO_UNAVAILABLE", "Foto tidak tersedia.");
  const shareId = verifyShareTokenSignature(token);
  if (!shareId)
    throw new AppServiceError(404, "PHOTO_UNAVAILABLE", "Foto tidak tersedia.");
  await reservePublicRead(shareId);
  const projection = await resolvePublicShareToken(token);
  if (
    projection?.receiptPhoto?.status !== "available" ||
    !projection.receiptPhoto.id
  )
    throw new AppServiceError(404, "PHOTO_UNAVAILABLE", "Foto tidak tersedia.");
  const photo = await readProductDocument<ReceiptPhotoRecord>(
    "receiptPhotos",
    projection.receiptPhoto.id,
  );
  // Resolve identity from the photo only after the share resolver has bound its ID to the active bill/snapshot.
  if (!photo)
    throw new AppServiceError(404, "PHOTO_UNAVAILABLE", "Foto tidak tersedia.");
  return readAvailable(photo, {
    id: projection.billId,
    ownerUid: photo.ownerUid,
  });
}
export async function reservePublicRead(shareId: string) {
  const config = getServerConfig();
  const minute = Math.floor(Date.now() / 60000);
  const id = crypto
    .createHash("sha256")
    .update(`${shareId}:${minute}`)
    .digest("hex");
  const deploymentId = `deployment_${minute}`;
  await productTransaction(async (tx) => {
    const perShare = await tx.get<{ count: number }>("receiptPhotoReads", id);
    const deployment = await tx.get<{ count: number }>(
      "receiptPhotoReads",
      deploymentId,
    );
    if (
      (perShare?.count ?? 0) >= config.receipts.publicReadsPerMinute ||
      (deployment?.count ?? 0) >= config.receipts.deploymentReadsPerMinute
    ) {
      throw new AppServiceError(
        429,
        "PHOTO_READ_LIMIT",
        "Foto terlalu sering dibuka. Coba sebentar lagi.",
      );
    }
    const deleteAfter = new Date(Date.now() + RECEIPT_TTL_MS);
    tx.set("receiptPhotoReads", id, {
      count: (perShare?.count ?? 0) + 1,
      deleteAfter,
    });
    tx.set("receiptPhotoReads", deploymentId, {
      count: (deployment?.count ?? 0) + 1,
      deleteAfter,
    });
  });
}

export async function cleanupReceiptPhotos(maximum = 50, deadline = Date.now() + 25_000) {
  // Deliberately independent of feature switches: disabled uploads must not leave old bytes behind.
  const now = new Date().toISOString();
  const candidates = getServerConfig().isDevSandbox
    ? Object.values(readDevDb().receiptPhotos)
        .filter((photo) => photo.nextCleanupAt <= now)
        .sort((a, b) => a.nextCleanupAt.localeCompare(b.nextCleanupAt))
        .slice(0, maximum)
    : (
        await getAdminFirestore()
          .collection("receiptPhotos")
          .where("nextCleanupAt", "<=", now)
          .orderBy("nextCleanupAt")
          .limit(maximum)
          .get()
      ).docs.map((doc) => doc.data() as ReceiptPhotoRecord);
  let deleted = 0,
    failed = 0,
    processed = 0;
  // Leave time for the final storage request and metadata commit within a 60s route.
  for (const candidate of candidates) {
    if (Date.now() >= deadline) break;
    processed++;
    const photo = await productTransaction(async (tx) => {
      const current = await tx.get<ReceiptPhotoRecord>(
        "receiptPhotos",
        candidate.id,
      );
      const bill = current
        ? await tx.get<BillDocument>("bills", current.billId)
        : null;
      if (
        !current ||
        current.nextCleanupAt > now ||
        current.status === "deleted"
      )
        return null;
      const pending = { ...current, status: "cleanup_pending" as const };
      tx.set("receiptPhotos", current.id, pending);
      if (bill?.receiptPhotoUploadId === current.id)
        tx.set("bills", bill.id, { ...bill, receiptPhotoUploadId: null });
      return pending;
    });
    if (!photo) continue;
    try {
      await deletePhotoBytes(photo);
      await productTransaction(async (tx) => {
        const current = await tx.get<ReceiptPhotoRecord>(
          "receiptPhotos",
          photo.id,
        );
        const quota = await tx.get<PhotoQuota>(
          "receiptPhotoQuotas",
          photo.ownerUid,
        );
        if (!current || current.status === "deleted") return;
        tx.set("receiptPhotos", photo.id, {
          ...current,
          status: "deleted",
          deletedAt: new Date().toISOString(),
          nextCleanupAt: NEVER,
          deleteAfter: new Date(Date.now() + 7 * RECEIPT_TTL_MS),
        });
        if (quota) {
          delete quota.assets[photo.id];
          tx.set("receiptPhotoQuotas", photo.ownerUid, quota);
        }
      });
      deleted++;
    } catch {
      failed++;
      await productTransaction(async (tx) => {
        const current = await tx.get<ReceiptPhotoRecord>(
          "receiptPhotos",
          photo.id,
        );
        if (current && current.status !== "deleted")
          tx.set("receiptPhotos", photo.id, {
            ...current,
            cleanupAttempts: current.cleanupAttempts + 1,
            nextCleanupAt: new Date(
              Date.now() +
                Math.min(
                  3600000,
                  60000 * 2 ** Math.min(current.cleanupAttempts, 6),
                ),
            ).toISOString(),
          });
      });
    }
  }
  const result = {
    processed,
    deleted,
    failed,
    oldestDueAt: candidates[0]?.nextCleanupAt ?? null,
    hasMore: candidates.length === maximum || processed < candidates.length,
  };
  console.info("receipt_cleanup", result);
  return result;
}

export async function reconcileReceiptObjects(cursor?: string) {
  const page = await listPhotoObjects(cursor);
  let removed = 0;
  for (const object of page.objects) {
    const match =
      /^receipts\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_-]+)\/(photo_[a-f0-9]{64})\.jpg$/.exec(
        object.path,
      );
    if (
      !match ||
      !Number.isFinite(Date.parse(object.createdAt)) ||
      Date.now() - Date.parse(object.createdAt) < RECEIPT_TTL_MS + 3600000
    )
      continue;
    const record = await readProductDocument<ReceiptPhotoRecord>(
      "receiptPhotos",
      match[3],
    );
    if (record && record.status !== "deleted") continue; // Normal cleanup retains accounting responsibility.
    await deletePhotoBytes({
      id: match[3],
      billId: match[2],
      ownerUid: match[1],
      objectPath: object.path,
      objectGeneration: object.generation,
    } as ReceiptPhotoRecord);
    removed++;
  }
  return { processed: page.objects.length, removed, cursor: page.cursor };
}
