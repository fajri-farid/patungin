import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CRC32C } from "@google-cloud/storage";
const auth = vi.hoisted(() => ({ getRequestHeaders: vi.fn() }));
vi.mock("../src/server/firebase/credentials.mjs", () => ({
  createServiceAccountJwt: () => auth,
}));
import { downloadPrivateObject } from "../src/server/firebase/storage-download";
const fetchMock = vi.fn();
const bytes = Buffer.from("private image bytes");
const options = {
  bucket: "private-bucket",
  objectName: "payment-qris/owner/image.png",
  generation: "123456789",
  maximumBytes: 2048,
  expectedBytes: bytes.length,
};
function response(body = bytes, correctChecksum = true) {
  const crc = new CRC32C();
  crc.update(correctChecksum ? body : Buffer.from("corrupt"));
  return new Response(new Uint8Array(body), {
    headers: { "x-goog-hash": `md5=unused,crc32c=${crc.toString()}` },
  });
}
beforeEach(() => {
  fetchMock.mockReset();
  auth.getRequestHeaders.mockReset();
  auth.getRequestHeaders.mockResolvedValue(
    new Headers({ Authorization: "Bearer synthetic-test-token" }),
  );
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe("bounded authenticated downloads without SDK stream pipelines", () => {
  it("retries a per-attempt timeout while the overall deadline still permits it", async () => {
    vi.spyOn(AbortSignal, "timeout").mockReturnValueOnce(AbortSignal.abort());
    fetchMock.mockRejectedValueOnce(new DOMException("Timed out", "TimeoutError")).mockImplementationOnce(async () => response());
    expect(await downloadPrivateObject(options)).toEqual(bytes);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("pins the generation, authenticates server-side and bypasses shared caches/redirects", async () => {
    fetchMock.mockImplementation(async () => response());
    expect(await downloadPrivateObject(options)).toEqual(bytes);
    const [url, request] = fetchMock.mock.calls[0];
    expect(url.origin).toBe("https://storage.googleapis.com");
    expect(url.pathname).toContain("payment-qris%2Fowner%2Fimage.png");
    expect(url.searchParams.get("generation")).toBe("123456789");
    expect(url.searchParams.get("alt")).toBe("media");
    expect(request).toMatchObject({
      cache: "no-store",
      redirect: "error",
      headers: {
        Authorization: "Bearer synthetic-test-token",
        "Accept-Encoding": "identity",
      },
    });
    expect(request.signal).toBeInstanceOf(AbortSignal);
  });
  it("reads multiple chunks and verifies their CRC32C", async () => {
    const crc = new CRC32C();
    crc.update(bytes);
    fetchMock.mockImplementation(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(bytes.subarray(0, 4));
              controller.enqueue(bytes.subarray(4));
              controller.close();
            },
          }),
          { headers: { "x-goog-hash": `crc32c=${crc}` } },
        ),
    );
    expect(await downloadPrivateObject(options)).toEqual(bytes);
  });
  it("retries a broken connection with a fresh request, at most once", async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError("connection reset"))
      .mockImplementationOnce(async () => response());
    expect(await downloadPrivateObject(options)).toEqual(bytes);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("never exposes provider URLs, tokens or raw error messages after repeated connection failures", async () => {
    fetchMock.mockRejectedValue(
      new TypeError("SECRET https://provider.example/token"),
    );
    await expect(downloadPrivateObject(options)).rejects.toMatchObject({
      code: "STORAGE_DOWNLOAD_CONNECTION_FAILED",
      message: "Private Storage download failed.",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it.each([401, 403, 404])(
    "does not retry authorization/missing-object HTTP %s",
    async (status) => {
      fetchMock.mockImplementation(
        async () => new Response("private provider details", { status }),
      );
      await expect(downloadPrivateObject(options)).rejects.toMatchObject({
        code: status,
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );
  it("refuses a declared oversized object before reading bytes", async () => {
    fetchMock.mockImplementation(
      async () =>
        new Response("huge", { headers: { "content-length": "9000" } }),
    );
    await expect(downloadPrivateObject(options)).rejects.toMatchObject({
      code: "STORAGE_DOWNLOAD_TOO_LARGE",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("cancels chunked responses that exceed the byte limit", async () => {
    const cancel = vi.fn();
    fetchMock.mockImplementation(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array(3000));
            },
            cancel,
          }),
        ),
    );
    await expect(downloadPrivateObject(options)).rejects.toMatchObject({
      code: "STORAGE_DOWNLOAD_TOO_LARGE",
    });
    expect(cancel).toHaveBeenCalledTimes(1);
  });
  it("rejects checksum and byte-length mismatches after a single bounded retry", async () => {
    fetchMock.mockImplementation(async () => response(bytes, false));
    await expect(downloadPrivateObject(options)).rejects.toMatchObject({
      code: "STORAGE_DOWNLOAD_INTEGRITY",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fetchMock.mockReset().mockImplementation(async () => response());
    await expect(
      downloadPrivateObject({ ...options, expectedBytes: bytes.length + 1 }),
    ).rejects.toMatchObject({ code: "STORAGE_DOWNLOAD_INTEGRITY" });
  });
  it("refuses downloads without an integrity header", async () => {
    fetchMock.mockImplementation(
      async () => new Response(new Uint8Array(bytes)),
    );
    await expect(downloadPrivateObject(options)).rejects.toMatchObject({
      code: "STORAGE_DOWNLOAD_INTEGRITY",
    });
  });
  it("fails invalid generations and missing server authorization without starting a download", async () => {
    await expect(
      downloadPrivateObject({ ...options, generation: "local" }),
    ).rejects.toMatchObject({ code: 400 });
    expect(fetchMock).not.toHaveBeenCalled();
    auth.getRequestHeaders.mockResolvedValue(new Headers());
    await expect(downloadPrivateObject(options)).rejects.toMatchObject({
      code: 401,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
