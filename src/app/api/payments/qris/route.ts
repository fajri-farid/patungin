import {
  requireAuthenticatedHost,
  verifyRequestOrigin,
} from "@/server/auth/session";
import { MAX_QRIS_BYTES } from "@/domain/qris";
import { limitedFormData, PRIVATE_HEADERS } from "@/server/receipts/http";
import { AppServiceError } from "@/server/store/repository";
import { uploadQrisImage } from "@/server/payments/qris-images";
import { qrisError } from "@/server/payments/qris-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function POST(request: Request) {
  try {
    await verifyRequestOrigin(request);
    const host = await requireAuthenticatedHost();
    const form = await limitedFormData(request, MAX_QRIS_BYTES + 64 * 1024);
    const file = form.get("image");
    if (!(file instanceof File))
      throw new AppServiceError(
        400,
        "MISSING_QRIS",
        "Pilih gambar QRIS dahulu.",
      );
    return Response.json(
      {
        ok: true,
        data: await uploadQrisImage(
          host.uid,
          Buffer.from(await file.arrayBuffer()),
        ),
      },
      { headers: PRIVATE_HEADERS },
    );
  } catch (error) {
    return qrisError(error, "upload");
  }
}
