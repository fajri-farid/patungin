/**
 * Manajemen Sesi Server, Google Login, dan Otorisasi Akun
 *
 * Sesuai .agents/plan/05-access-security-cost.md:
 * - Hanya menerima provider Google dengan email terverifikasi.
 * - Admin ditetapkan server; akun produk harus aktif dan belum kedaluwarsa.
 * - Sesi identitas saja hanya boleh membuka aktivasi; izin produk diperiksa pada setiap request.
 */

import crypto from "node:crypto";
import { cache } from "react";
import { ensureAccount, hasProductAccess, isAdmin } from "../access/accounts";
import { cookies, headers } from "next/headers";
import { getServerConfig, normalizeEmail } from "../config/env";
import { getAdminAuth } from "../firebase/admin";
import { getAuthErrorCode } from "@/lib/login-errors";

export const SESSION_DURATION_MS = 5 * 24 * 60 * 60 * 1000; // 5 hari

export interface AuthenticatedHost {
  uid: string;
  email: string;
  displayName: string;
  isDevSandboxUser?: boolean;
  isAdmin?: boolean;
}

export class AuthGuardError extends Error {
  public readonly statusCode: 401 | 403 | 503;
  public readonly code: string;

  constructor(statusCode: 401 | 403 | 503, code: string, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function getSessionCookieName(): string {
  const config = getServerConfig();
  return config.isProduction ? "__Host-patungin_session" : "patungin_session";
}

/** Use the same host-only attributes when setting and expiring the session. */
export function getSessionCookieOptions() {
  return {
    httpOnly: true,
    secure: getServerConfig().isProduction,
    sameSite: "lax" as const,
    path: "/",
  };
}

export function isEmailAllowed(email: string): boolean {
  const config = getServerConfig();
  if (config.allowedEmails.size === 0) {
    return false;
  }
  return config.allowedEmails.has(normalizeEmail(email));
}

/**
 * Memeriksa header Origin / Referer pada request mutasi (POST) untuk perlindungan CSRF.
 */
export async function verifyRequestOrigin(request?: Request): Promise<void> {
  const config = getServerConfig();
  let originHeader: string | null = null;

  if (request) {
    originHeader = request.headers.get("origin");
  } else {
    const hdrs = await headers();
    originHeader = hdrs.get("origin");
  }

  if (!originHeader) {
    throw new AuthGuardError(
      403,
      "ORIGIN_MISSING",
      "Permintaan ditolak karena header Origin tidak ditemukan."
    );
  }

  try {
    const reqOrigin = new URL(originHeader).origin;
    const allowedOrigin = new URL(config.appOrigin).origin;
    if (reqOrigin !== allowedOrigin) {
      throw new AuthGuardError(
        403,
        "ORIGIN_MISMATCH",
        "Origin permintaan tidak sesuai dengan konfigurasi aplikasi."
      );
    }
  } catch (err) {
    if (err instanceof AuthGuardError) throw err;
    throw new AuthGuardError(
      403,
      "ORIGIN_INVALID",
      "Format header Origin tidak valid."
    );
  }
}

/**
 * Membuat token sesi lokal bertanda tangan HMAC khusus saat mode Dev Sandbox aktif.
 */
export function createDevSandboxSessionToken(payload: {
  uid: string;
  email: string;
  displayName: string;
  exp: number;
}): string {
  const config = getServerConfig();
  if (!config.isDevSandbox) {
    throw new Error("Dev Sandbox tidak aktif.");
  }
  const data = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = crypto
    .createHmac("sha256", config.share.signingSecret)
    .update(`dev_session_v1.${data}`)
    .digest("base64url");
  return `dev.${data}.${sig}`;
}

function verifyDevSandboxSessionToken(token: string): AuthenticatedHost | null {
  const config = getServerConfig();
  if (!config.isDevSandbox || !token.startsWith("dev.")) {
    return null;
  }
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [, data, providedSig] = parts;

  const expectedSig = crypto
    .createHmac("sha256", config.share.signingSecret)
    .update(`dev_session_v1.${data}`)
    .digest("base64url");

  const bufA = Buffer.from(providedSig, "utf8");
  const bufB = Buffer.from(expectedSig, "utf8");
  if (bufA.length !== bufB.length || !crypto.timingSafeEqual(bufA, bufB)) {
    return null;
  }

  try {
    const parsed = JSON.parse(
      Buffer.from(data, "base64url").toString("utf8")
    ) as {
      uid: string;
      email: string;
      displayName: string;
      exp: number;
    };
    if (Date.now() > parsed.exp) return null;
    return {
      uid: parsed.uid,
      email: normalizeEmail(parsed.email),
      displayName: parsed.displayName,
      isDevSandboxUser: true,
    };
  } catch {
    return null;
  }
}

/**
 * Memverifikasi ID Token Firebase dari Google Sign-In dan menukarnya dengan nilai session cookie.
 */
export async function verifyIdTokenAndCreateSessionCookie(idToken: string): Promise<{
  sessionCookieValue: string;
  host: AuthenticatedHost;
}> {
  const config = getServerConfig();

  // Dukungan login sandbox di lokal (hanya saat NODE_ENV=development & Firebase belum diisi)
  if (config.isDevSandbox && idToken.startsWith("DEV_SANDBOX_TOKEN:")) {
    const rawEmail = idToken.replace("DEV_SANDBOX_TOKEN:", "").trim();
    const email = normalizeEmail(rawEmail || "host@patungin.local");
    const host: AuthenticatedHost = {
      uid: `dev-uid-${email.replace(/[^a-z0-9]/g, "-")}`,
      email,
      displayName: email === "host@patungin.local" ? "Host Patungin (Dev)" : email.split("@")[0],
      isDevSandboxUser: true,
    };
    await ensureAccount(host);
    const sessionCookieValue = createDevSandboxSessionToken({
      ...host,
      exp: Date.now() + SESSION_DURATION_MS,
    });
    return { sessionCookieValue, host };
  }

  if (!config.firebase.isConfigured) {
    throw new AuthGuardError(
      401,
      "FIREBASE_NOT_CONFIGURED",
      "Konfigurasi Firebase belum lengkap di server."
    );
  }

  const publicProjectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim();
  if (publicProjectId && publicProjectId !== config.firebase.projectId) {
    throw new AuthGuardError(
      503,
      "FIREBASE_PROJECT_MISMATCH",
      "Konfigurasi project Firebase browser dan server tidak cocok."
    );
  }

  let adminAuth: ReturnType<typeof getAdminAuth>;
  let decoded;
  try {
    adminAuth = getAdminAuth();
    decoded = await adminAuth.verifyIdToken(idToken, true);
  } catch (error) {
    const code = getAuthErrorCode(error);
    const invalidTokenCodes = new Set([
      "auth/argument-error",
      "auth/invalid-argument",
      "auth/invalid-id-token",
      "auth/id-token-expired",
      "auth/id-token-revoked",
      "auth/user-disabled",
      "auth/user-not-found",
    ]);
    if (!invalidTokenCodes.has(code)) {
      // Only a controlled error code is logged, never the SDK error/token/key.
      console.error("[auth] Firebase verification unavailable:", code);
      throw new AuthGuardError(
        503,
        "FIREBASE_SERVICE_UNAVAILABLE",
        "Server belum dapat memverifikasi login dengan Firebase."
      );
    }
    throw new AuthGuardError(
      401,
      "INVALID_ID_TOKEN",
      "Token login tidak valid atau sudah kedaluwarsa. Silakan masuk kembali."
    );
  }

  const signInProvider = decoded.firebase?.sign_in_provider;
  if (signInProvider !== "google.com") {
    throw new AuthGuardError(
      403,
      "PROVIDER_NOT_GOOGLE",
      "Hanya metode masuk Google yang diizinkan."
    );
  }

  if (!decoded.email || decoded.email_verified !== true) {
    throw new AuthGuardError(
      403,
      "EMAIL_NOT_VERIFIED",
      "Email akun Google harus sudah terverifikasi."
    );
  }

  const normalizedEmail = normalizeEmail(decoded.email);

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (
    !Number.isFinite(decoded.auth_time) ||
    nowSeconds - decoded.auth_time > 5 * 60 ||
    decoded.auth_time > nowSeconds + 60
  ) {
    throw new AuthGuardError(
      401,
      "RECENT_LOGIN_REQUIRED",
      "Masuk kembali dengan Google untuk membuat sesi baru."
    );
  }

  await ensureAccount({ uid: decoded.uid, email: normalizedEmail, displayName: decoded.name || normalizedEmail.split("@")[0] });

  let sessionCookieValue: string;
  try {
    sessionCookieValue = await adminAuth.createSessionCookie(idToken, {
      expiresIn: SESSION_DURATION_MS,
    });
  } catch (error) {
    console.error("[auth] Firebase session creation unavailable:", getAuthErrorCode(error));
    throw new AuthGuardError(
      503,
      "FIREBASE_SERVICE_UNAVAILABLE",
      "Server belum dapat membuat sesi login dengan Firebase."
    );
  }

  return {
    sessionCookieValue,
    host: {
      uid: decoded.uid,
      email: normalizedEmail,
      displayName: decoded.name || normalizedEmail.split("@")[0],
    },
  };
}

/**
 * Memverifikasi identitas Google dari cookie, termasuk status revocation.
 * Identitas terverifikasi belum berarti memiliki akses produk atau admin.
 */
// Deduplicate verification within a React server render, never across requests.
export const getSessionIdentity = cache(async function getSessionIdentity(): Promise<AuthenticatedHost | null> {
  const cookieStore = await cookies();
  const cookieName = getSessionCookieName();
  const rawCookie = cookieStore.get(cookieName)?.value;
  if (!rawCookie) return null;

  const config = getServerConfig();

  if (config.isDevSandbox && rawCookie.startsWith("dev.")) {
    const devHost = verifyDevSandboxSessionToken(rawCookie);
    if (!devHost) return null;
    return devHost;
  }

  if (!config.firebase.isConfigured) {
    return null;
  }

  try {
    const decoded = await getAdminAuth().verifySessionCookie(rawCookie, true);
    if (
      decoded.firebase?.sign_in_provider !== "google.com" ||
      !decoded.email ||
      decoded.email_verified !== true
    ) {
      return null;
    }

    const email = normalizeEmail(decoded.email);

    return {
      uid: decoded.uid,
      email,
      displayName: decoded.name || email.split("@")[0],
    };
  } catch (err) {
    if (err instanceof AuthGuardError) throw err;
    return null;
  }
});

/**
 * Guard wajib pada setiap Server Action / Route Handler terlindungi.
 */
export async function requireAuthenticatedHost(): Promise<AuthenticatedHost> {
  const host = await getAuthenticatedHost();
  if (!host) {
    throw new AuthGuardError(
      401,
      "UNAUTHENTICATED",
      "Sesi berakhir atau belum masuk. Silakan login kembali."
    );
  }
  return host;
}


/** Identity-only sessions may visit activation, but never product/admin operations. */
export async function requireSessionIdentity(): Promise<AuthenticatedHost> {
  const identity = await getSessionIdentity();
  if (!identity) throw new AuthGuardError(401, "UNAUTHENTICATED", "Masuk kembali dengan Google.");
  return identity;
}

export async function getAuthenticatedHost(): Promise<AuthenticatedHost | null> {
  const identity = await getSessionIdentity();
  if (!identity) return null;
  if (!await hasProductAccess(identity.uid, identity.email)) throw new AuthGuardError(403, "ACCESS_REQUIRED", "Akses belum aktif atau sudah berakhir. Hubungi admin.");
  return { ...identity, isAdmin: isAdmin(identity) };
}

export async function requireAdmin(): Promise<AuthenticatedHost> {
  const identity = await requireSessionIdentity();
  if (!isAdmin(identity)) throw new AuthGuardError(403, "ADMIN_REQUIRED", "Halaman ini hanya untuk admin.");
  return { ...identity, isAdmin: true };
}
