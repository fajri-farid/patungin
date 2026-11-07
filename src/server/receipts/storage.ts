import fs from "node:fs/promises";
import path from "node:path";
import { Storage } from "@google-cloud/storage";
import { getServerConfig } from "../config/env";
import { createServiceAccountJwt } from "../firebase/credentials.mjs";
import type { ReceiptPhotoRecord } from "@/domain/receipts";
import { MAX_RECEIPT_BYTES } from "@/domain/receipts";
import { downloadPrivateObject } from "../firebase/storage-download";

let storage: Storage | undefined;
function bucket() {
  const config = getServerConfig();
  if (!config.firebase.isConfigured || !config.receipts.bucket)
    throw new Error("Storage not configured");
  storage ??= new Storage({
    projectId: config.firebase.projectId,
    authClient: createServiceAccountJwt(config.firebase),
    timeout: 30_000,
  });
  return storage.bucket(config.receipts.bucket);
}
function localPath(photo: Pick<ReceiptPhotoRecord, "id">) {
  if (!/^photo_[a-f0-9]{64}$/.test(photo.id))
    throw new Error("Invalid photo ID");
  return path.join(
    process.env.PATUNGIN_DEV_RECEIPTS_PATH ||
      path.join(process.cwd(), ".patungin-receipts"),
    `${photo.id}.jpg`,
  );
}
function cloudFile(photo: ReceiptPhotoRecord) {
  const expected = `receipts/${photo.ownerUid}/${photo.billId}/${photo.id}.jpg`;
  if (
    photo.objectPath !== expected ||
    [photo.ownerUid, photo.billId, photo.id].some(
      (id) => !/^[a-zA-Z0-9_-]+$/.test(id),
    )
  )
    throw new Error("Invalid object path");
  return bucket().file(photo.objectPath);
}
export async function storePhotoBytes(
  photo: ReceiptPhotoRecord,
  bytes: Buffer,
): Promise<string> {
  if (getServerConfig().isDevSandbox) {
    const file = localPath(photo);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, bytes, { flag: "wx" });
    return "local";
  }
  const file = cloudFile(photo);
  await file.save(bytes, {
    resumable: false,
    validation: "crc32c",
    preconditionOpts: { ifGenerationMatch: 0 },
    metadata: { contentType: "image/jpeg", cacheControl: "private, no-store" },
  });
  const [metadata] = await file.getMetadata();
  return String(metadata.generation);
}
export async function readPhotoBytes(
  photo: ReceiptPhotoRecord,
): Promise<Buffer> {
  if (getServerConfig().isDevSandbox) return fs.readFile(localPath(photo));
  return downloadPrivateObject({ bucket: getServerConfig().receipts.bucket, objectName: cloudFile(photo).name, generation: photo.objectGeneration!, maximumBytes: MAX_RECEIPT_BYTES, expectedBytes: photo.sizeBytes });
}
export async function deletePhotoBytes(
  photo: ReceiptPhotoRecord,
): Promise<void> {
  if (getServerConfig().isDevSandbox) {
    await fs.rm(localPath(photo), { force: true });
    return;
  }
  const file = cloudFile(photo);
  try {
    const generation =
      photo.objectGeneration ||
      String((await file.getMetadata())[0].generation);
    await file.delete({ ifGenerationMatch: generation });
  } catch (error) {
    if ((error as { code?: number }).code !== 404) throw error;
  }
}

/** Bounded maintenance only; never called during a user request. */
export async function listPhotoObjects(cursor?: string) {
  if (getServerConfig().isDevSandbox) return { objects: [], cursor: null };
  const [files, next] = await bucket().getFiles({
    prefix: "receipts/",
    maxResults: 100,
    autoPaginate: false,
    pageToken: cursor,
  });
  return {
    objects: files.map((file) => ({
      path: file.name,
      generation: String(file.metadata.generation),
      createdAt: file.metadata.timeCreated ?? "",
    })),
    cursor: next?.pageToken ?? null,
  };
}
