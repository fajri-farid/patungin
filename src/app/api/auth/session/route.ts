import { hasProductAccess } from "@/server/access/accounts";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  AuthGuardError,
  getSessionCookieName,
  getSessionCookieOptions,
  SESSION_DURATION_MS,
  verifyIdTokenAndCreateSessionCookie,
  verifyRequestOrigin,
} from "@/server/auth/session";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 20 * 1024;
const privateHeaders = { "Cache-Control": "no-store" };

function invalidBody(status: number, code: string) {
  return NextResponse.json(
    { error: "Permintaan login tidak valid. Silakan masuk kembali.", code },
    { status, headers: privateHeaders }
  );
}

export async function POST(request: Request) {
  try {
    await verifyRequestOrigin(request);
    if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") {
      return invalidBody(415, "INVALID_CONTENT_TYPE");
    }
    if (Number(request.headers.get("content-length")) > MAX_BODY_BYTES) {
      return invalidBody(413, "REQUEST_TOO_LARGE");
    }

    const reader = request.body?.getReader();
    if (!reader) return invalidBody(400, "MISSING_TOKEN");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BODY_BYTES) {
          await reader.cancel();
          return invalidBody(413, "REQUEST_TOO_LARGE");
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }

    let body: unknown;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      return invalidBody(400, "INVALID_JSON");
    }
    if (typeof body !== "object" || body === null || !("idToken" in body) || typeof body.idToken !== "string") {
      return invalidBody(400, "MISSING_TOKEN");
    }
    const idToken = body.idToken.trim();

    if (!idToken) {
      return NextResponse.json(
        { error: "Token login tidak ditemukan.", code: "MISSING_TOKEN" },
        { status: 400, headers: privateHeaders }
      );
    }

    const { sessionCookieValue, host } =
      await verifyIdTokenAndCreateSessionCookie(idToken);

    const cookieStore = await cookies();
    cookieStore.set(getSessionCookieName(), sessionCookieValue, {
      ...getSessionCookieOptions(),
      maxAge: Math.floor(SESSION_DURATION_MS / 1000),
    });

    return NextResponse.json({ ok: true, destination: await hasProductAccess(host.uid, host.email) ? "/app" : "/activate" }, { headers: privateHeaders });
  } catch (err) {
    if (err instanceof AuthGuardError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.statusCode, headers: privateHeaders }
      );
    }
    return NextResponse.json(
      {
        error: "Terjadi kendala saat memverifikasi sesi login.",
        code: "SESSION_EXCHANGE_FAILED",
      },
      { status: 500, headers: privateHeaders }
    );
  }
}
