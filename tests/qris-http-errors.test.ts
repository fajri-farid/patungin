import { afterEach, describe, expect, it, vi } from "vitest";
import { qrisError } from "../src/server/payments/qris-http";
import { AppServiceError } from "../src/server/store/repository";

afterEach(() => vi.restoreAllMocks());
describe("QRIS storage diagnostics without secret leakage", () => {
  it.each([
    "STORAGE_DOWNLOAD_CONNECTION_FAILED",
    "STORAGE_DOWNLOAD_TIMEOUT",
    "STORAGE_DOWNLOAD_INTEGRITY",
  ])("classifies safe download failure %s", async (code) => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const response = qrisError({ code }, "read");
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.code).not.toBe("QRIS_ERROR");
    expect(body.error).not.toContain("Bearer");
  });
  it("explains missing bucket overrides on upload without returning provider details", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const response = qrisError(
      {
        code: 404,
        message: "SECRET account@example.com gs://wrong-bucket/private-key",
      },
      "upload",
    );
    const body = await response.json();
    expect(response.status).toBe(503);
    expect(body.code).toBe("QRIS_BUCKET_NOT_FOUND");
    expect(body.error).toContain("FIREBASE_QRIS_STORAGE_BUCKET");
    expect(body.requestId).toBe(response.headers.get("x-request-id"));
    expect(JSON.stringify([body, warn.mock.calls])).not.toMatch(
      /SECRET|account@example|wrong-bucket|private-key/,
    );
  });
  it.each([
    [403, "QRIS_STORAGE_PERMISSION_DENIED"],
    [401, "QRIS_STORAGE_AUTH_FAILED"],
    [400, "QRIS_STORAGE_CONFIG_ERROR"],
    [429, "QRIS_STORAGE_BUSY"],
  ])("classifies provider code %s", async (providerCode, code) => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const response = qrisError({ code: providerCode }, "upload");
    expect((await response.json()).code).toBe(code);
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
  it("distinguishes a missing image from a missing upload bucket", async () => {
    const response = qrisError({ code: 404 }, "read");
    expect(response.status).toBe(404);
    expect((await response.json()).code).toBe("QRIS_IMAGE_NOT_FOUND");
  });
  it("preserves application validation errors and uses QRIS-specific unknown errors", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const invalid = qrisError(
      new AppServiceError(422, "INVALID_QRIS_IMAGE", "Gambar tidak valid."),
      "upload",
    );
    expect(invalid.status).toBe(422);
    expect((await invalid.json()).code).toBe("INVALID_QRIS_IMAGE");
    const unknown = qrisError(
      new Error("sensitive provider message"),
      "upload",
    );
    const body = await unknown.json();
    expect(body.code).toBe("QRIS_ERROR");
    expect(body.error).toContain("disimpan");
    expect(JSON.stringify(body)).not.toContain("sensitive");
  });
});
