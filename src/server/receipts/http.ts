import { AuthGuardError } from "../auth/session";
import { AppServiceError } from "../store/repository";

export const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  Vary: "Cookie",
};
export function photoError(error: unknown) {
  const known =
    error instanceof AppServiceError || error instanceof AuthGuardError;
  return Response.json(
    {
      ok: false,
      error: known ? error.message : "Foto belum bisa diakses. Coba lagi.",
      code: known ? error.code : "PHOTO_ERROR",
    },
    { status: known ? error.statusCode : 503, headers: PRIVATE_HEADERS },
  );
}
export function photoResponse(bytes: Buffer) {
  return new Response(new Uint8Array(bytes), {
    headers: {
      ...PRIVATE_HEADERS,
      "Content-Type": "image/jpeg",
      "Content-Length": String(bytes.length),
    },
  });
}

/** Bound the stream before parsing multipart; Content-Length alone is not trusted. */
export async function limitedFormData(request: Request, maximum: number) {
  const reader = request.body?.getReader();
  if (!reader)
    throw new AppServiceError(400, "INVALID_FORM", "Pilih foto dahulu.");
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) {
        await reader.cancel();
        throw new AppServiceError(
          413,
          "IMAGE_TOO_LARGE",
          "Foto terlalu besar. Pilih foto lain.",
        );
      }
      parts.push(value);
    }
    return await new Response(Buffer.concat(parts), {
      headers: { "Content-Type": request.headers.get("content-type") ?? "" },
    }).formData();
  } catch (error) {
    if (error instanceof AppServiceError) throw error;
    throw new AppServiceError(
      400,
      "INVALID_FORM",
      "Foto belum bisa dikirim. Pilih ulang foto dan coba lagi.",
    );
  } finally {
    reader.releaseLock();
  }
}
