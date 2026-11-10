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
async function runCleanup(request: Request, secret: string, drain: boolean) {
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
      const totals = {
        processed: 0, deleted: 0, failed: 0, hasMore: false,
        oldestDueAt: null as string | null,
        qris: { processed: 0, deleted: 0, failed: 0, hasMore: false },
      };
      // Separate collections can progress concurrently: receipt IO must not
      // consume the entire function budget before QRIS gets a turn.
      for (let batch = 0; batch < (drain ? 10 : 1); batch++) {
        if (batch > 0 && Date.now() >= deadline) break;
        const [receipts, qris] = await Promise.all([
          cleanupReceiptPhotos(25, deadline),
          cleanupQrisImages(25, deadline),
        ]);
        totals.processed += receipts.processed + qris.processed;
        totals.deleted += receipts.deleted + qris.deleted;
        totals.failed += receipts.failed + qris.failed;
        totals.hasMore = receipts.hasMore || qris.hasMore;
        for (const oldestDueAt of [receipts.oldestDueAt, qris.oldestDueAt]) {
          if (oldestDueAt && (!totals.oldestDueAt || oldestDueAt < totals.oldestDueAt)) {
            totals.oldestDueAt = oldestDueAt;
          }
        }
        totals.qris.processed += qris.processed;
        totals.qris.deleted += qris.deleted;
        totals.qris.failed += qris.failed;
        totals.qris.hasMore = qris.hasMore;
        if (!totals.hasMore) break;
      }
      result = totals;
    }
    console.info("image_cleanup", { source: drain ? "vercel-cron" : "external-scheduler", ...result });
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

// Vercel Cron invokes GET and supplies its own CRON_SECRET bearer token.
// Keep the external POST scheduler's credential separate and fail closed when unset.
export async function GET(request: Request) {
  return runCleanup(request, process.env.CRON_SECRET?.trim() ?? "", true);
}

export async function POST(request: Request) {
  return runCleanup(request, getServerConfig().receipts.cleanupSecret, false);
}
