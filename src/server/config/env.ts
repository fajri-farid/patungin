/**
 * Konfigurasi Server & Validasi Environment Patungin
 *
 * Prinsip keamanan:
 * - Akses produk: akun aktif atau admin eksplisit; ALLOWED_EMAILS hanya kompatibilitas akun lama.
 * - GEMINI_SCAN_ENABLED dan SHARE_LINKS_ENABLED secara default nonaktif kecuali dikonfigurasi.
 * - Mode pengembangan lokal (Dev Sandbox) HANYA aktif bila NODE_ENV === "development"
 *   dan kredensial Firebase belum diisi. Tidak pernah aktif di production.
 */

import { SHARE_LINK_EXPIRY_DAYS } from "@/domain/billing/types";

export interface ServerConfig {
  nodeEnv: string;
  isProduction: boolean;
  isDevSandbox: boolean;
  appOrigin: string;
  allowedEmails: Set<string>;
  adminEmails: Set<string>;
  adminUids: Set<string>;
  firebase: {
    projectId: string;
    clientEmail: string;
    privateKey: string;
    isConfigured: boolean;
  };
  gemini: {
    scanEnabled: boolean;
    apiKey: string;
    model: string;
    isConfigured: boolean;
  };
  limits: {
    monthlyUserLimit: number;
    perMinuteUserLimit: number;
    maxAttemptsPerBill: number;
    maxActivePerUser: number;
    maxActivePerDeployment: number;
    usageTimezone: string;
  };
  share: {
    linksEnabled: boolean;
    signingSecret: string;
    isConfigured: boolean;
    expiryDays: number;
  };
}

function parsePositiveInt(val: string | undefined, fallback: number): number {
  if (!val) return fallback;
  const parsed = Number.parseInt(val, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function parseAllowedEmails(raw: string | undefined): Set<string> {
  if (!raw) return new Set();
  const emails = raw
    .split(",")
    .map((e) => normalizeEmail(e))
    .filter((e) => e.length > 3 && e.includes("@"));
  return new Set(emails);
}

export function getServerConfig(): ServerConfig {
  const nodeEnv = process.env.NODE_ENV ?? "development";
  const isProduction = nodeEnv === "production";

  const firebaseProjectId =
    process.env.FIREBASE_PROJECT_ID?.trim() ||
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim() ||
    "";
  const firebaseClientEmail = (process.env.FIREBASE_CLIENT_EMAIL ?? "").trim();
  const firebasePrivateKey = (process.env.FIREBASE_PRIVATE_KEY ?? "")
    .replace(/\\n/g, "\n")
    .trim();

  const isFirebaseConfigured = Boolean(
    firebaseProjectId && firebaseClientEmail && firebasePrivateKey
  );

  // Partial configuration must fail closed, never silently switch to fake auth.
  // Tests use an isolated environment with no real credentials.
  const hasAnyFirebaseConfig = Boolean(
    firebaseProjectId ||
      firebaseClientEmail ||
      firebasePrivateKey ||
      process.env.NEXT_PUBLIC_FIREBASE_API_KEY?.trim() ||
      process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN?.trim()
  );
  const isDevSandbox =
    (nodeEnv === "development" || nodeEnv === "test") &&
    !hasAnyFirebaseConfig &&
    process.env.PATUNGIN_DEV_SANDBOX !== "false";

  const allowedEmails = parseAllowedEmails(process.env.ALLOWED_EMAILS);
  if (isDevSandbox && allowedEmails.size === 0) {
    // Tambahkan akun sandbox lokal khusus mode dev agar mudah diuji sebelum isi .env
    allowedEmails.add("host@patungin.local");
  }

  const geminiApiKey = (process.env.GEMINI_API_KEY ?? "").trim();
  const geminiModel = (process.env.GEMINI_MODEL ?? "").trim();
  const geminiScanEnabledEnv =
    process.env.GEMINI_SCAN_ENABLED?.toLowerCase() === "true";
  const isGeminiConfigured = Boolean(geminiApiKey && geminiModel);

  const shareSigningSecret = (process.env.SHARE_SIGNING_SECRET ?? "").trim();
  const shareLinksEnabledEnv =
    process.env.SHARE_LINKS_ENABLED?.toLowerCase() === "true";

  // Di dev sandbox, gunakan ephemeral dev secret jika belum diisi agar alur share link bisa diuji
  const effectiveShareSecret =
    shareSigningSecret.length >= 32
      ? shareSigningSecret
      : isDevSandbox
      ? "dev_only_patungin_signing_secret_32bytes_minimum_key"
      : "";

  const isShareConfigured = effectiveShareSecret.length >= 32;

  return {
    nodeEnv,
    isProduction,
    isDevSandbox,
    appOrigin: (process.env.APP_ORIGIN ?? "http://localhost:3000").trim(),
    allowedEmails,
    adminEmails: parseAllowedEmails(process.env.ADMIN_EMAILS || (isDevSandbox ? "host@patungin.local" : "")),
    adminUids: new Set((process.env.ADMIN_UIDS ?? "").split(",").map(v => v.trim()).filter(Boolean)),
    firebase: {
      projectId: firebaseProjectId,
      clientEmail: firebaseClientEmail,
      privateKey: firebasePrivateKey,
      isConfigured: isFirebaseConfigured,
    },
    gemini: {
      scanEnabled: isDevSandbox
        ? process.env.GEMINI_SCAN_ENABLED?.toLowerCase() !== "false"
        : geminiScanEnabledEnv && isGeminiConfigured,
      apiKey: geminiApiKey,
      model: geminiModel || "gemini-2.5-flash",
      isConfigured: isGeminiConfigured,
    },
    limits: {
      monthlyUserLimit: parsePositiveInt(process.env.SCAN_MONTHLY_LIMIT, 30),
      perMinuteUserLimit: parsePositiveInt(
        process.env.SCAN_PER_MINUTE_LIMIT,
        3
      ),
      maxAttemptsPerBill: 5,
      maxActivePerUser: 1,
      maxActivePerDeployment: 2,
      usageTimezone: "Asia/Makassar",
    },
    share: {
      linksEnabled: isDevSandbox
        ? process.env.SHARE_LINKS_ENABLED?.toLowerCase() !== "false"
        : shareLinksEnabledEnv && isShareConfigured,
      signingSecret: effectiveShareSecret,
      isConfigured: isShareConfigured,
      expiryDays: SHARE_LINK_EXPIRY_DAYS,
    },
  };
}
