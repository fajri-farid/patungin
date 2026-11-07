import {
  requireAuthenticatedHost,
  verifyRequestOrigin,
} from "@/server/auth/session";
import { MAX_RECEIPT_BYTES } from "@/domain/receipts";
import { getBillForOwner, AppServiceError } from "@/server/store/repository";
import {
  getOwnerPhotoInfo,
  uploadReceiptPhoto,
  readOwnerReceiptPhoto,
  removeReceiptPhoto,
} from "@/server/receipts/photos";
import {
  limitedFormData,
  photoError,
  photoResponse,
  PRIVATE_HEADERS,
} from "@/server/receipts/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
type Context = { params: Promise<{ id: string }> };
async function contextIdentity(context: Context) {
  const host = await requireAuthenticatedHost();
  const { id } = await context.params;
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id))
    throw new AppServiceError(
      404,
      "BILL_NOT_FOUND",
      "Tagihan tidak ditemukan.",
    );
  return { host, id };
}
export async function GET(request: Request, context: Context) {
  try {
    const { host, id } = await contextIdentity(context);
    const url = new URL(request.url);
    if (url.searchParams.has("info")) {
      const bill = await getBillForOwner(id, host.uid);
      return Response.json(
        { ok: true, data: { bill, photo: await getOwnerPhotoInfo(bill) } },
        { headers: PRIVATE_HEADERS },
      );
    }
    return photoResponse(
      await readOwnerReceiptPhoto(
        id,
        host.uid,
        url.searchParams.get("photo") ?? undefined,
      ),
    );
  } catch (error) {
    return photoError(error);
  }
}
export async function POST(request: Request, context: Context) {
  try {
    await verifyRequestOrigin(request);
    const { host, id } = await contextIdentity(context);
    const data = await limitedFormData(request, MAX_RECEIPT_BYTES + 64 * 1024);
    const file = data.get("receipt");
    if (!(file instanceof File))
      throw new AppServiceError(400, "MISSING_FILE", "Pilih foto dahulu.");
    const result = await uploadReceiptPhoto({
      billId: id,
      ownerUid: host.uid,
      expectedRevision: Number(data.get("expectedRevision")),
      key: String(data.get("idempotencyKey") ?? ""),
      bytes: Buffer.from(await file.arrayBuffer()),
    });
    return Response.json(
      { ok: true, data: result },
      { headers: PRIVATE_HEADERS },
    );
  } catch (error) {
    return photoError(error);
  }
}
export async function DELETE(request: Request, context: Context) {
  try {
    await verifyRequestOrigin(request);
    const { host, id } = await contextIdentity(context);
    const revision = Number(request.headers.get("x-bill-revision"));
    if (!Number.isSafeInteger(revision) || revision < 1)
      throw new AppServiceError(400, "INVALID_REVISION", "Muat ulang tagihan.");
    const bill = await removeReceiptPhoto(id, host.uid, revision);
    return Response.json(
      { ok: true, data: { bill, photo: { status: "missing" } } },
      { headers: PRIVATE_HEADERS },
    );
  } catch (error) {
    return photoError(error);
  }
}
