import fs from "node:fs/promises";
import path from "node:path";
import { Storage } from "@google-cloud/storage";
import { QRIS_IMAGE_ID, type QrisImageRecord } from "@/domain/qris";
import { getServerConfig } from "../config/env";
import { createServiceAccountJwt } from "../firebase/credentials.mjs";
import { downloadPrivateObject } from "../firebase/storage-download";
import { MAX_QRIS_BYTES } from "@/domain/qris";
let client: Storage | undefined;
function bucket() {
  const config = getServerConfig();
  if (!config.firebase.isConfigured || !config.qris.bucket)
    throw new Error("QRIS storage not configured");
  client ??= new Storage({
    projectId: config.firebase.projectId,
    authClient: createServiceAccountJwt(config.firebase),
    timeout: 30_000,
  });
  return client.bucket(config.qris.bucket);
}
function objectPath(asset: QrisImageRecord) {
  if (
    !QRIS_IMAGE_ID.test(asset.id) ||
    !/^[a-zA-Z0-9_-]{1,128}$/.test(asset.ownerUid)
  )
    throw new Error("Invalid QRIS asset");
  return `payment-qris/${asset.ownerUid}/${asset.id}.png`;
}
function localPath(asset: QrisImageRecord) {
  objectPath(asset);
  return path.join(
    process.env.PATUNGIN_DEV_QRIS_PATH ||
      path.join(process.cwd(), ".patungin-qris"),
    `${asset.id}.png`,
  );
}
export async function storeQrisBytes(asset: QrisImageRecord, bytes: Buffer) {
  if (getServerConfig().isDevSandbox) {
    const file = localPath(asset);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, bytes, { flag: "wx" });
    return "local";
  }
  const file = bucket().file(objectPath(asset));
  await file.save(bytes, {
    resumable: false,
    validation: "crc32c",
    preconditionOpts: { ifGenerationMatch: 0 },
    metadata: { contentType: "image/png", cacheControl: "private, no-store" },
  });
  return String((await file.getMetadata())[0].generation);
}
export async function readQrisBytes(asset: QrisImageRecord) {
  if (getServerConfig().isDevSandbox) return fs.readFile(localPath(asset));
  return downloadPrivateObject({ bucket: getServerConfig().qris.bucket, objectName: objectPath(asset), generation: asset.generation!, maximumBytes: MAX_QRIS_BYTES, expectedBytes: asset.sizeBytes });
}
export async function deleteQrisBytes(asset: QrisImageRecord) {
  if (getServerConfig().isDevSandbox) {
    await fs.rm(localPath(asset), { force: true });
    return;
  }
  const file = bucket().file(objectPath(asset));
  try {
    const generation =
      asset.generation || String((await file.getMetadata())[0].generation);
    await file.delete({ ifGenerationMatch: generation });
  } catch (error) {
    if ((error as { code?: number }).code !== 404) throw error;
  }
}
export async function listQrisObjects(cursor?: string) {
  if (getServerConfig().isDevSandbox) return { objects: [], cursor: null };
  const [files, next] = await bucket().getFiles({
    prefix: "payment-qris/",
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
