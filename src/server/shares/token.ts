import crypto from "node:crypto";
import { getServerConfig } from "../config/env";

// 128-bit random ID and a 96-bit HMAC tag: v2.<22 chars>.<16 chars>.
const TOKEN_VERSION = "v2";
const SHARE_ID_BYTES = 16;
const SIGNATURE_BYTES = 12;

export function isCurrentShareId(shareId: string): boolean {
  if (!/^[A-Za-z0-9_-]{22}$/.test(shareId)) return false;
  const bytes = Buffer.from(shareId, "base64url");
  return (
    bytes.length === SHARE_ID_BYTES && bytes.toString("base64url") === shareId
  );
}

export function generateRandomShareId(): string {
  return crypto.randomBytes(SHARE_ID_BYTES).toString("base64url");
}

export function signShareToken(shareId: string): string {
  const config = getServerConfig();
  if (!config.share.isConfigured) {
    throw new Error(
      "SHARE_SIGNING_SECRET belum dikonfigurasi (minimal 32 karakter).",
    );
  }
  if (!isCurrentShareId(shareId)) throw new Error("ID link tidak valid.");
  const payload = `${TOKEN_VERSION}.${shareId}`;
  const signature = crypto
    .createHmac("sha256", config.share.signingSecret)
    .update(payload)
    .digest()
    .subarray(0, SIGNATURE_BYTES)
    .toString("base64url");
  return `${payload}.${signature}`;
}

// Reject old formats and malformed tokens before any database lookup.
export function verifyShareTokenSignature(token: string): string | null {
  if (typeof token !== "string" || token.length !== 42) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [version, shareId, providedSig] = parts;
  if (
    version !== TOKEN_VERSION ||
    !isCurrentShareId(shareId) ||
    !/^[A-Za-z0-9_-]{16}$/.test(providedSig)
  )
    return null;
  const config = getServerConfig();
  if (!config.share.isConfigured) return null;
  const expected = crypto
    .createHmac("sha256", config.share.signingSecret)
    .update(`${version}.${shareId}`)
    .digest()
    .subarray(0, SIGNATURE_BYTES);
  const provided = Buffer.from(providedSig, "base64url");
  if (
    provided.length !== SIGNATURE_BYTES ||
    !crypto.timingSafeEqual(provided, expected)
  )
    return null;
  return shareId;
}
