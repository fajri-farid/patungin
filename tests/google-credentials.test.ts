import { generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JWT } from "google-auth-library";
import {
  createFirebaseCredential,
  createFirestoreAuth,
  createServiceAccountJwt,
} from "../src/server/firebase/credentials.mjs";

// Generated only inside the test process; no live service-account keys or APIs.
const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
const config = {
  projectId: "test-project",
  clientEmail: "test@test-project.iam.gserviceaccount.com",
  privateKey,
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("Explicit JWT credentials", () => {
  it("constructs JWT/Firestore auth without deprecated JSON/credentials options", async () => {
    const warn = vi.spyOn(console, "warn");
    const jwt = createServiceAccountJwt(config);
    expect(jwt).toBeInstanceOf(JWT);
    expect(jwt.email).toBe(config.clientEmail);
    const firestoreAuth = createFirestoreAuth(config);
    expect(await firestoreAuth.getClient()).toBeInstanceOf(JWT);
    expect(await firestoreAuth.getClient()).not.toBe(jwt);
    expect(warn).not.toHaveBeenCalled();
  });

  it("accepts escaped newlines without changing the private key", () => {
    const jwt = createServiceAccountJwt({ ...config, privateKey: privateKey.replace(/\n/g, "\\n") });
    expect(jwt.key).toBe(privateKey.trim());
  });

  it("fails incomplete configuration without exposing supplied values", () => {
    expect(() => createServiceAccountJwt({ ...config, clientEmail: "" })).toThrow(/belum lengkap/);
    expect(() => createServiceAccountJwt({ ...config, privateKey: "INVALID_SECRET_MUST_NOT_APPEAR" })).toThrow("Private key service account Firebase bukan PEM yang valid.");
  });

  it("adapts the actual token lifetime instead of assuming a fresh hour", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-01T00:00:00Z"));
    const jwt = createServiceAccountJwt(config);
    jwt.credentials = { expiry_date: Date.now() + 3_600_000 };
    vi.spyOn(jwt, "getAccessToken").mockImplementation(async () => ({ token: "synthetic-access-token" }));
    const credential = createFirebaseCredential(jwt);
    expect(await credential.getAccessToken()).toEqual({ access_token: "synthetic-access-token", expires_in: 3600 });
    vi.setSystemTime(new Date("2026-11-01T00:00:05Z"));
    expect((await credential.getAccessToken()).expires_in).toBe(3595);
  });

  it.each(["missing-token", "missing-expiry", "expired"])("rejects %s rather than minting a misleading Firebase credential", async (kind) => {
    const jwt = createServiceAccountJwt(config);
    jwt.credentials = kind === "missing-expiry"
      ? {}
      : { expiry_date: Date.now() + (kind === "expired" ? -60_000 : 60_000) };
    vi.spyOn(jwt, "getAccessToken").mockImplementation(async () => ({ token: kind === "missing-token" ? null : "synthetic-token" }));
    await expect(createFirebaseCredential(jwt).getAccessToken()).rejects.toThrow(/masa berlaku yang valid/);
  });
});
