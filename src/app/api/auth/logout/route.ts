import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  AuthGuardError,
  getSessionCookieName,
  getSessionCookieOptions,
  verifyRequestOrigin,
} from "@/server/auth/session";

export async function POST(request: Request) {
  try {
    await verifyRequestOrigin(request);
    const cookieStore = await cookies();
    cookieStore.set(getSessionCookieName(), "", {
      ...getSessionCookieOptions(),
      expires: new Date(0),
      maxAge: 0,
    });
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof AuthGuardError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.statusCode }
      );
    }
    return NextResponse.json(
      { error: "Gagal keluar dari sesi.", code: "LOGOUT_FAILED" },
      { status: 500 }
    );
  }
}
