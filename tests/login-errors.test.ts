import { describe, expect, it } from "vitest";
import { getAuthErrorCode, getGoogleLoginIssue, getSessionLoginIssue } from "../src/lib/login-errors";

describe("Actionable Google login errors", () => {
  it.each([
    ["auth/configuration-not-found", /Google sedang tidak tersedia/, /hubungi pengelola/],
    ["auth/operation-not-allowed", /Google sedang tidak tersedia/, /hubungi pengelola/],
    ["auth/unauthorized-domain", /Alamat web/, /Buka alamat Patungin/],
    ["auth/invalid-api-key", /Google sedang tidak tersedia/, /hubungi pengelola/],
    ["auth/popup-blocked", /memblokir/, /Izinkan popup/],
    ["auth/network-request-failed", /terhubung/, /koneksi/],
  ])("explains %s without incorrectly blaming the allowlist", (code, message, guidance) => {
    const issue = getGoogleLoginIssue({ code, message: "RAW_SECRET_MUST_NOT_APPEAR" });
    expect(issue?.message).toMatch(message);
    expect(issue?.guidance).toMatch(guidance);
    expect(JSON.stringify(issue)).not.toContain("RAW_SECRET");
    expect(`${issue?.message} ${issue?.guidance}`).not.toMatch(/\.env|check:setup|Firebase Console|API key|APP_ORIGIN/);
    expect(issue?.guidance).not.toContain("Pilih akun Google yang sudah diizinkan");
  });

  it.each(["auth/popup-closed-by-user", "auth/cancelled-popup-request"])("keeps %s quiet and retryable", (code) => {
    expect(getGoogleLoginIssue({ code })).toBeNull();
  });

  it("only suggests a different allowed account for an actual access denial", () => {
    expect(getSessionLoginIssue("EMAIL_NOT_ALLOWED").guidance).toMatch(/Pilih akun Google/);
    expect(getSessionLoginIssue("ORIGIN_MISMATCH").guidance).toContain("Buka alamat Patungin");
    expect(getSessionLoginIssue("FIREBASE_SERVICE_UNAVAILABLE").guidance).toContain("hubungi pengelola");
  });

  it("does not expose raw exception text or arbitrary error codes", () => {
    expect(getAuthErrorCode({ code: "https://example.com/?secret=value" })).toBe("UNKNOWN_ERROR");
    expect(getAuthErrorCode(null)).toBe("UNKNOWN_ERROR");
    expect(getAuthErrorCode(new Error("PRIVATE_KEY"))).toBe("UNKNOWN_ERROR");
    expect(JSON.stringify(getGoogleLoginIssue(new Error("PRIVATE_KEY")))).not.toContain("PRIVATE_KEY");
  });
});
