import { readPublicReceiptPhoto } from "@/server/receipts/photos";
import { photoError, photoResponse } from "@/server/receipts/http";
export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";
export async function GET(
  _request: Request,
  context: { params: Promise<{ token: string }> },
) {
  try {
    return photoResponse(
      await readPublicReceiptPhoto((await context.params).token),
    );
  } catch (error) {
    return photoError(error);
  }
}
