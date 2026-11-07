import { requireAuthenticatedHost } from "@/server/auth/session";
import { readOwnerQrisImage } from "@/server/payments/qris-images";
import { qrisError, qrisResponse } from "@/server/payments/qris-http";
export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const host = await requireAuthenticatedHost();
    return qrisResponse(
      await readOwnerQrisImage(host.uid, (await context.params).id),
      new URL(request.url).searchParams.has("download"),
    );
  } catch (error) {
    return qrisError(error);
  }
}
