import { readPublicQrisImage } from "@/server/payments/qris-images";
import { qrisError, qrisResponse } from "@/server/payments/qris-http";
export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  context: { params: Promise<{ token: string; id: string }> },
) {
  try {
    const { token, id } = await context.params;
    return qrisResponse(
      await readPublicQrisImage(token, id),
      new URL(request.url).searchParams.has("download"),
    );
  } catch (error) {
    return qrisError(error);
  }
}
