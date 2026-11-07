import crypto from "node:crypto";
import { getServerConfig } from "@/server/config/env";
import {
  cleanupReceiptPhotos,
  reconcileReceiptObjects,
} from "@/server/receipts/photos";
import { PRIVATE_HEADERS } from "@/server/receipts/http";
import {
  cleanupQrisImages,
  reconcileQrisObjects,
} from "@/server/payments/qris-images";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function POST(request: Request) {
  const secret = getServerConfig().receipts.cleanupSecret;
  const expected = Buffer.from(`Bearer ${secret}`);
  const provided = Buffer.from(request.headers.get("authorization") ?? "");
  if (
    secret.length < 32 ||
    provided.length !== expected.length ||
    !crypto.timingSafeEqual(expected, provided)
  ) {
    return Response.json(
      { ok: false },
      { status: 401, headers: PRIVATE_HEADERS },
    );
  }
  try {
    const url = new URL(request.url);
    const cursor = url.searchParams.get("cursor") ?? undefined;
    if (cursor && cursor.length > 2048)
      return Response.json(
        { ok: false },
        { status: 400, headers: PRIVATE_HEADERS },
      );
    let result;
    if (url.searchParams.has("reconcile")) {
      result =
        url.searchParams.get("reconcile") === "qris"
          ? await reconcileQrisObjects(cursor)
          : await reconcileReceiptObjects(cursor);
    } else {
      const deadline = Date.now() + 25000;
      const receipts = await cleanupReceiptPhotos(25, deadline);
      const qris = await cleanupQrisImages(25, deadline);
      result = {
        ...receipts,
        qris,
        processed: receipts.processed + qris.processed,
        deleted: receipts.deleted + qris.deleted,
        failed: receipts.failed + qris.failed,
        hasMore: receipts.hasMore || qris.hasMore,
      };
    }
    return Response.json(
      { ok: true, data: result },
      { headers: PRIVATE_HEADERS },
    );
  } catch {
    return Response.json(
      { ok: false, error: "Cleanup belum berhasil; ulangi terjadwal." },
      { status: 503, headers: PRIVATE_HEADERS },
    );
  }
}
