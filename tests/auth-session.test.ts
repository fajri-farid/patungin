import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { adminAuth, cookieStore } = vi.hoisted(() => ({
  adminAuth: {
    verifyIdToken: vi.fn(),
    verifySessionCookie: vi.fn(),
    createSessionCookie: vi.fn(),
  },
  cookieStore: { get: vi.fn(), set: vi.fn() },
}));

const { documents, firestore } = await vi.hoisted(async () => {
  const { createFirestoreFake } = await import("./helpers/firestore");
  return createFirestoreFake();
});
vi.mock("../src/server/firebase/admin", () => ({ getAdminAuth: () => adminAuth, getAdminFirestore: () => firestore }));
vi.mock("next/headers", () => ({
  cookies: async () => cookieStore,
  headers: async () => new Headers(),
}));

import {
  getAuthenticatedHost,
  verifyIdTokenAndCreateSessionCookie,
  verifyRequestOrigin,
} from "../src/server/auth/session";
import { getServerConfig } from "../src/server/config/env";
import { POST } from "../src/app/api/auth/session/route";
import { POST as logout } from "../src/app/api/auth/logout/route";

function identity(overrides: Record<string, unknown> = {}) {
  return {
    uid: "owner-uid",
    email: "Owner@Example.com",
    name: "Owner",
    email_verified: true,
    auth_time: Math.floor(Date.now() / 1000),
    firebase: { sign_in_provider: "google.com" },
    ...overrides,
  };
}

function request(body: string, extraHeaders: Record<string, string> = {}) {
  return new Request("http://localhost:3000/api/auth/session", {
    method: "POST",
    headers: { Origin: "http://localhost:3000", "Content-Type": "application/json", ...extraHeaders },
    body,
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  documents.clear();
  vi.stubEnv("FIREBASE_PROJECT_ID", "test-project");
  vi.stubEnv("NEXT_PUBLIC_FIREBASE_PROJECT_ID", "test-project");
  vi.stubEnv("FIREBASE_CLIENT_EMAIL", "admin@test-project.iam.gserviceaccount.com");
  vi.stubEnv("FIREBASE_PRIVATE_KEY", "test-placeholder-never-used-with-real-sdk");
  vi.stubEnv("ALLOWED_EMAILS", "owner@example.com");
  adminAuth.verifyIdToken.mockResolvedValue(identity());
  adminAuth.createSessionCookie.mockResolvedValue("test-session-cookie");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("Real-auth session boundary (Firebase is mocked; no live account is created)", () => {
  it("verifies revocation, provider and allowlist before creating a server session", async () => {
    const result = await verifyIdTokenAndCreateSessionCookie("test-id-token");
    expect(adminAuth.verifyIdToken).toHaveBeenCalledWith("test-id-token", true);
    expect(result.host.email).toBe("owner@example.com");
    expect(result.sessionCookieValue).toBe("test-session-cookie");
  });

  it.each([
    [{ email_verified: false }, "EMAIL_NOT_VERIFIED"],
    [{ firebase: { sign_in_provider: "password" } }, "PROVIDER_NOT_GOOGLE"],
    [{ auth_time: 0 }, "RECENT_LOGIN_REQUIRED"],
    [{ auth_time: Math.floor(Date.now() / 1000) + 3600 }, "RECENT_LOGIN_REQUIRED"],
  ])("rejects %j before session creation", async (overrides, code) => {
    adminAuth.verifyIdToken.mockResolvedValue(identity(overrides));
    await expect(verifyIdTokenAndCreateSessionCookie("test-token")).rejects.toMatchObject({ code });
    expect(adminAuth.createSessionCookie).not.toHaveBeenCalled();
  });

  it("creates an identity-only session for an uninvited account, without product access", async () => {
    vi.stubEnv("ALLOWED_EMAILS", "");
    const response = await POST(request('{"idToken":"test-token"}'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, destination: "/activate" });
    expect(documents.get("users/owner-uid")?.status).toBe("pending");
    cookieStore.get.mockReturnValue({ value: "existing-cookie" });
    adminAuth.verifySessionCookie.mockResolvedValue(identity());
    await expect(getAuthenticatedHost()).rejects.toMatchObject({ code: "ACCESS_REQUIRED" });
  });

  it("rejects a mismatched client/server project before calling Firebase", async () => {
    vi.stubEnv("NEXT_PUBLIC_FIREBASE_PROJECT_ID", "wrong-project");
    await expect(verifyIdTokenAndCreateSessionCookie("test-token")).rejects.toMatchObject({ code: "FIREBASE_PROJECT_MISMATCH" });
    expect(adminAuth.verifyIdToken).not.toHaveBeenCalled();
  });

  it("distinguishes invalid tokens from a server credential/service problem", async () => {
    adminAuth.verifyIdToken.mockRejectedValue({ code: "auth/id-token-expired" });
    await expect(verifyIdTokenAndCreateSessionCookie("expired-token")).rejects.toMatchObject({ statusCode: 401, code: "INVALID_ID_TOKEN" });
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    adminAuth.verifyIdToken.mockRejectedValue({ code: "auth/invalid-credential", message: "SECRET" });
    await expect(verifyIdTokenAndCreateSessionCookie("test-token")).rejects.toMatchObject({ statusCode: 503, code: "FIREBASE_SERVICE_UNAVAILABLE" });
    expect(JSON.stringify(log.mock.calls)).not.toContain("SECRET");
    expect(adminAuth.createSessionCookie).not.toHaveBeenCalled();
  });

  it("rechecks the current allowlist for existing cookies", async () => {
    cookieStore.get.mockReturnValue({ value: "existing-cookie" });
    adminAuth.verifySessionCookie.mockResolvedValue(identity());
    vi.stubEnv("ALLOWED_EMAILS", "another@example.com");
    await expect(getAuthenticatedHost()).rejects.toMatchObject({ code: "ACCESS_REQUIRED" });
    expect(adminAuth.verifySessionCookie).toHaveBeenCalledWith("existing-cookie", true);
  });
});

describe("Origin and session request validation", () => {
  it.each([
    ["production", "__Host-patungin_session", true],
    ["development", "patungin_session", false],
  ])("expires the %s session with matching cookie attributes", async (environment, name, secure) => {
    vi.stubEnv("NODE_ENV", environment);
    const response = await logout(new Request("http://localhost:3000/api/auth/logout", {
      method: "POST", headers: { Origin: "http://localhost:3000" },
    }));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(cookieStore.set).toHaveBeenCalledWith(name, "", {
      httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: 0, expires: new Date(0),
    });
  });

  it("does not clear the session for a request from another origin", async () => {
    const response = await logout(new Request("http://localhost:3000/api/auth/logout", {
      method: "POST", headers: { Origin: "https://other.example" },
    }));
    expect(response.status).toBe(403);
    expect(cookieStore.set).not.toHaveBeenCalled();
  });
  it.each(["http://localhost:3001", "https://example.com", "null", "invalid-origin"])("rejects foreign/invalid origin %s", async (origin) => {
    await expect(verifyRequestOrigin(request("{}", { Origin: origin }))).rejects.toMatchObject({ statusCode: 403 });
  });

  it("requires Origin even during development", async () => {
    const req = new Request("http://localhost:3000/api/auth/session", { method: "POST", body: "{}" });
    await expect(verifyRequestOrigin(req)).rejects.toMatchObject({ code: "ORIGIN_MISSING" });
  });

  it.each(["{", "null", "[]", "{}", '{"idToken":42}', '{"idToken":" "}'])("rejects malformed session body %s without contacting Firebase", async (body) => {
    const response = await POST(request(body));
    expect(response.status).toBe(400);
    expect(adminAuth.verifyIdToken).not.toHaveBeenCalled();
    expect(cookieStore.set).not.toHaveBeenCalled();
  });

  it("rejects oversized bodies even without Content-Length", async () => {
    const response = await POST(request(JSON.stringify({ idToken: "x".repeat(21_000) })));
    expect(response.status).toBe(413);
    expect(adminAuth.verifyIdToken).not.toHaveBeenCalled();
  });

  it("creates an HttpOnly, same-site session without returning identity data", async () => {
    const response = await POST(request('{"idToken":"test-token"}'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, destination: "/app" });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(cookieStore.set).toHaveBeenCalledWith("patungin_session", "test-session-cookie", expect.objectContaining({ httpOnly: true, sameSite: "lax", path: "/" }));
  });
});

describe("Sandbox must not hide partial or production configuration", () => {
  it("does not accept fake login when only part of Firebase is configured", () => {
    vi.stubEnv("FIREBASE_PRIVATE_KEY", "");
    expect(getServerConfig().firebase.isConfigured).toBe(false);
    expect(getServerConfig().isDevSandbox).toBe(false);
  });

  it("never activates sandbox in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("FIREBASE_PROJECT_ID", "");
    vi.stubEnv("NEXT_PUBLIC_FIREBASE_PROJECT_ID", "");
    vi.stubEnv("FIREBASE_CLIENT_EMAIL", "");
    vi.stubEnv("FIREBASE_PRIVATE_KEY", "");
    expect(getServerConfig().isDevSandbox).toBe(false);
  });
});
