import { CRC32C } from "@google-cloud/storage";
import { getServerConfig } from "../config/env";
import { createServiceAccountJwt } from "./credentials.mjs";

type DownloadCode =
  | "STORAGE_DOWNLOAD_TIMEOUT"
  | "STORAGE_DOWNLOAD_CONNECTION_FAILED"
  | "STORAGE_DOWNLOAD_INTEGRITY"
  | "STORAGE_DOWNLOAD_TOO_LARGE";
export class StorageDownloadError extends Error {
  constructor(public readonly code: number | DownloadCode) {
    super("Private Storage download failed.");
    this.name = "StorageDownloadError";
  }
}
let auth: ReturnType<typeof createServiceAccountJwt> | undefined;

/** Native fetch avoids the SDK's node-fetch/PassThrough pipeline. No public URL or shared byte cache. */
export async function downloadPrivateObject(options: {
  bucket: string;
  objectName: string;
  generation: string;
  maximumBytes: number;
  expectedBytes?: number;
}): Promise<Buffer> {
  const url = new URL(
    `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(options.bucket)}/o/${encodeURIComponent(options.objectName)}`,
  );
  url.searchParams.set("alt", "media");
  url.searchParams.set("generation", options.generation);
  if (
    !options.bucket ||
    !options.objectName ||
    !/^\d{1,30}$/.test(options.generation) ||
    !Number.isSafeInteger(options.maximumBytes) ||
    options.maximumBytes < 1
  ) {
    throw new StorageDownloadError(400);
  }
  const deadline = Date.now() + 30_000;
  auth ??= createServiceAccountJwt(getServerConfig().firebase);
  let authorization: string | null;
  try {
    authorization = (await auth.getRequestHeaders(url.href)).get(
      "authorization",
    );
  } catch {
    throw new StorageDownloadError(401);
  }
  if (!authorization) throw new StorageDownloadError(401);

  for (let attempt = 0; attempt < 2; attempt++) {
    if (Date.now() >= deadline)
      throw new StorageDownloadError("STORAGE_DOWNLOAD_TIMEOUT");
    const signal = AbortSignal.timeout(
      Math.max(1, Math.min(15_000, deadline - Date.now())),
    );
    try {
      const response = await fetch(url, {
        headers: {
          Authorization: authorization,
          "Accept-Encoding": "identity",
          "Cache-Control": "no-store",
        },
        cache: "no-store",
        redirect: "error",
        signal,
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new StorageDownloadError(response.status);
      }
      if (
        Number(response.headers.get("content-length")) > options.maximumBytes
      ) {
        await response.body?.cancel();
        throw new StorageDownloadError("STORAGE_DOWNLOAD_TOO_LARGE");
      }
      const reader = response.body?.getReader();
      if (!reader) throw new StorageDownloadError("STORAGE_DOWNLOAD_INTEGRITY");
      const chunks: Buffer[] = [];
      const checksum = new CRC32C();
      let size = 0,
        complete = false;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) {
            complete = true;
            break;
          }
          size += value.byteLength;
          if (size > options.maximumBytes)
            throw new StorageDownloadError("STORAGE_DOWNLOAD_TOO_LARGE");
          const chunk = Buffer.from(value);
          chunks.push(chunk);
          checksum.update(chunk);
        }
      } finally {
        if (!complete) await reader.cancel().catch(() => undefined);
        reader.releaseLock();
      }
      const expectedChecksum = response.headers
        .get("x-goog-hash")
        ?.split(",")
        .map((value) => value.trim())
        .find((value) => value.startsWith("crc32c="))
        ?.slice(7);
      if (
        !expectedChecksum ||
        !checksum.validate(expectedChecksum) ||
        (options.expectedBytes && size !== options.expectedBytes)
      ) {
        throw new StorageDownloadError("STORAGE_DOWNLOAD_INTEGRITY");
      }
      return Buffer.concat(chunks, size);
    } catch (error) {
      const failure =
        error instanceof StorageDownloadError
          ? error
          : new StorageDownloadError(
              signal.aborted
                ? "STORAGE_DOWNLOAD_TIMEOUT"
                : "STORAGE_DOWNLOAD_CONNECTION_FAILED",
            );
      const retryable =
        failure.code === "STORAGE_DOWNLOAD_CONNECTION_FAILED" ||
        failure.code === "STORAGE_DOWNLOAD_TIMEOUT" ||
        failure.code === "STORAGE_DOWNLOAD_INTEGRITY" ||
        [429, 500, 502, 503, 504].includes(Number(failure.code));
      if (!retryable || attempt === 1 || Date.now() >= deadline) throw failure;
    }
  }
  throw new StorageDownloadError("STORAGE_DOWNLOAD_CONNECTION_FAILED");
}
