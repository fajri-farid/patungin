import crypto from "node:crypto";
import {
  MAX_QRIS_BYTES,
  QRIS_IMAGE_ID,
  type QrisImageRecord,
} from "@/domain/qris";
import type { BillDocument } from "@/domain/billing/types";
import { getServerConfig } from "../config/env";
import { getAdminFirestore } from "../firebase/admin";
import { AppServiceError, resolvePublicShareToken } from "../store/repository";
import { productTransaction, readProductDocument } from "../store/transaction";
import { readDevDb } from "../store/dev-database";
import { verifyShareTokenSignature } from "../shares/token";
import { reservePublicRead } from "../receipts/photos";
import { qrisIds } from "./qris-references";
import { normalizeQrisImage } from "./qris-image-processing";
import {
  deleteQrisBytes,
  listQrisObjects,
  readQrisBytes,
  storeQrisBytes,
} from "./qris-storage";
const DAY = 86400000;
function assertEnabled() {
  if (!getServerConfig().qris.enabled)
    throw new AppServiceError(
      503,
      "QRIS_DISABLED",
      "Unggah QRIS belum tersedia. Konfigurasikan bucket Storage aplikasi.",
    );
}
export async function uploadQrisImage(ownerUid: string, bytes: Buffer) {
  assertEnabled();
  if (
    !/^[a-zA-Z0-9_-]{1,128}$/.test(ownerUid) ||
    !bytes.length ||
    bytes.length > MAX_QRIS_BYTES
  )
    throw new AppServiceError(
      422,
      "INVALID_QRIS",
      "Pilih gambar QRIS JPG, PNG, atau WebP maksimal 2 MiB.",
    );
  const now = Date.now();
  const record: QrisImageRecord = {
    id: `qris_${crypto.randomBytes(16).toString("hex")}`,
    ownerUid,
    status: "uploading",
    generation: null,
    referenceCount: 0,
    createdAt: new Date(now).toISOString(),
    nextCleanupAt: new Date(now + 900000).toISOString(),
    cleanupAttempts: 0,
    sizeBytes: 0,
  };
  await productTransaction(async (tx) => {
    const quota = await tx.get<{ hour: number; attempts: number }>(
      "qrisUploadQuotas",
      ownerUid,
    );
    const hour = Math.floor(now / 3600000);
    const attempts = quota?.hour === hour ? quota.attempts : 0;
    if (attempts >= 10)
      throw new AppServiceError(
        429,
        "QRIS_UPLOAD_LIMIT",
        "Maksimal 10 unggahan QRIS per jam. Coba nanti.",
      );
    // Includes pre-existing records and pending deletions. The quota document
    // serializes concurrent uploads across serverless instances.
    const maximum = getServerConfig().qris.maxStored;
    const active = await tx.activeQrisImages(ownerUid, maximum);
    if (
      active.length >= maximum ||
      active.filter((asset) => asset.status === "uploading").length >= 3
    )
      throw new AppServiceError(
        429,
        "QRIS_STORAGE_LIMIT",
        "Batas simpan QRIS tercapai atau unggahan masih diproses. Tunggu pembersihan sebelum mengunggah lagi.",
      );
    tx.set("qrisUploadQuotas", ownerUid, { hour, attempts: attempts + 1 });
    tx.set("qrisImages", record.id, record);
  });
  let generation: string | null = null;
  try {
    const output = await normalizeQrisImage(bytes);
    generation = await storeQrisBytes(record, output);
    await productTransaction(async (tx) => {
      const current = await tx.get<QrisImageRecord>("qrisImages", record.id);
      if (current?.status !== "uploading")
        throw new AppServiceError(
          409,
          "QRIS_UPLOAD_EXPIRED",
          "Unggahan berakhir. Pilih ulang gambar QRIS.",
        );
      tx.set("qrisImages", record.id, {
        ...current,
        generation,
        sizeBytes: output.length,
        status: "ready",
        nextCleanupAt: new Date(Date.now() + DAY).toISOString(),
      });
    });
    return { id: record.id };
  } catch (error) {
    await productTransaction(async (tx) => {
      const current = await tx.get<QrisImageRecord>("qrisImages", record.id);
      if (current?.status === "uploading")
        tx.set("qrisImages", record.id, {
          ...current,
          generation,
          status: "cleanup_pending",
          nextCleanupAt: new Date().toISOString(),
        });
    }).catch(() => undefined);
    throw error;
  }
}
export async function readOwnerQrisImage(ownerUid: string, id: string) {
  assertEnabled();
  const asset = QRIS_IMAGE_ID.test(id)
    ? await readProductDocument<QrisImageRecord>("qrisImages", id)
    : null;
  if (!asset || asset.ownerUid !== ownerUid || asset.status !== "ready")
    throw new AppServiceError(
      404,
      "QRIS_UNAVAILABLE",
      "Gambar QRIS tidak tersedia.",
    );
  return readQrisBytes(asset);
}
export async function readPublicQrisImage(token: string, id: string) {
  assertEnabled();
  const config = getServerConfig();
  if (
    !config.share.linksEnabled ||
    !config.share.isConfigured ||
    !QRIS_IMAGE_ID.test(id)
  )
    throw new AppServiceError(
      404,
      "QRIS_UNAVAILABLE",
      "Gambar QRIS tidak tersedia.",
    );
  const shareId = verifyShareTokenSignature(token);
  if (!shareId)
    throw new AppServiceError(404, "QRIS_UNAVAILABLE", "Link tidak tersedia.");
  await reservePublicRead(shareId);
  const projection = await resolvePublicShareToken(token);
  if (!projection || !qrisIds(projection.paymentMethods).includes(id))
    throw new AppServiceError(
      404,
      "QRIS_UNAVAILABLE",
      "QRIS tidak disertakan dalam tagihan ini.",
    );
  const [bill, asset] = await Promise.all([
    readProductDocument<BillDocument>("bills", projection.billId),
    readProductDocument<QrisImageRecord>("qrisImages", id),
  ]);
  if (
    !bill ||
    !asset ||
    bill.ownerUid !== asset.ownerUid ||
    asset.status !== "ready"
  )
    throw new AppServiceError(
      404,
      "QRIS_UNAVAILABLE",
      "Gambar QRIS tidak tersedia.",
    );
  return readQrisBytes(asset);
}
export async function cleanupQrisImages(
  maximum = 25,
  deadline = Date.now() + 25000,
) {
  const now = new Date().toISOString();
  const candidates = getServerConfig().isDevSandbox
    ? Object.values(readDevDb().qrisImages)
        .filter((asset) => asset.nextCleanupAt <= now)
        .sort((a, b) => a.nextCleanupAt.localeCompare(b.nextCleanupAt))
        .slice(0, maximum)
    : (
        await getAdminFirestore()
          .collection("qrisImages")
          .where("nextCleanupAt", "<=", now)
          .orderBy("nextCleanupAt")
          .limit(maximum)
          .get()
      ).docs.map((doc) => doc.data() as QrisImageRecord);
  let processed = 0,
    deleted = 0,
    failed = 0;
  for (const candidate of candidates) {
    if (Date.now() >= deadline) break;
    processed++;
    const asset = await productTransaction(async (tx) => {
      const current = await tx.get<QrisImageRecord>("qrisImages", candidate.id);
      if (
        !current ||
        current.status === "deleted" ||
        current.nextCleanupAt > now
      )
        return null;
      if (current.referenceCount > 0) {
        tx.set("qrisImages", current.id, {
          ...current,
          nextCleanupAt: new Date(Date.now() + DAY).toISOString(),
        });
        return null;
      }
      const next = { ...current, status: "cleanup_pending" as const };
      tx.set("qrisImages", current.id, next);
      return next;
    });
    if (!asset) continue;
    try {
      await deleteQrisBytes(asset);
      await productTransaction(async (tx) => {
        const current = await tx.get<QrisImageRecord>("qrisImages", asset.id);
        if (current?.status === "cleanup_pending")
          tx.set("qrisImages", asset.id, {
            ...current,
            status: "deleted",
            nextCleanupAt: "9999-12-31T23:59:59.999Z",
            deleteAfter: new Date(Date.now() + 7 * DAY),
          });
      });
      deleted++;
    } catch {
      failed++;
      await productTransaction(async (tx) => {
        const current = await tx.get<QrisImageRecord>("qrisImages", asset.id);
        if (current && current.status !== "deleted")
          tx.set("qrisImages", asset.id, {
            ...current,
            cleanupAttempts: current.cleanupAttempts + 1,
            nextCleanupAt: new Date(
              Date.now() +
                Math.min(
                  3600000,
                  60000 * 2 ** Math.min(6, current.cleanupAttempts),
                ),
            ).toISOString(),
          });
      });
    }
  }
  return {
    processed,
    deleted,
    failed,
    oldestDueAt: candidates[0]?.nextCleanupAt ?? null,
    hasMore: candidates.length === maximum || processed < candidates.length,
  };
}
export async function reconcileQrisObjects(cursor?: string) {
  const page = await listQrisObjects(cursor);
  let removed = 0;
  for (const object of page.objects) {
    const match =
      /^payment-qris\/([a-zA-Z0-9_-]+)\/(qris_[a-f0-9]{32})\.png$/.exec(
        object.path,
      );
    if (
      !match ||
      !Number.isFinite(Date.parse(object.createdAt)) ||
      Date.now() - Date.parse(object.createdAt) < 25 * 3600000
    )
      continue;
    const current = await readProductDocument<QrisImageRecord>(
      "qrisImages",
      match[2],
    );
    if (current && current.status !== "deleted") continue;
    await deleteQrisBytes({
      id: match[2],
      ownerUid: match[1],
      generation: object.generation,
    } as QrisImageRecord);
    removed++;
  }
  return { processed: page.objects.length, removed, cursor: page.cursor };
}
