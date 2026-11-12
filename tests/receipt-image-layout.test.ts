import { describe, expect, it, vi } from "vitest";
import { encodeReceiptCanvas, receiptImageDimensions } from "../src/lib/receipt-image-layout";

describe("receipt image readability and upload bounds", () => {
  it("keeps a long receipt substantially wider than the old 2400px longest-side resize", () => {
    const result = receiptImageDimensions(1000, 10000);
    expect(result.width).toBeGreaterThan(600);
    expect(result.width * result.height).toBeLessThanOrEqual(4_000_000);
    expect(result.height).toBeLessThanOrEqual(7200);
    expect(result.width / result.height).toBeCloseTo(0.1, 3);
  });
  it.each([[1000, 10000], [10000, 1000], [12000, 12000], [600, 400]])("bounds %s x %s without upscaling", (w, h) => {
    const result = receiptImageDimensions(w, h);
    expect(result.width).toBeLessThanOrEqual(w);
    expect(result.height).toBeLessThanOrEqual(h);
    expect(result.width * result.height).toBeLessThanOrEqual(4_000_000);
    expect(Math.max(result.width, result.height)).toBeLessThanOrEqual(7200);
  });
  it("does not change small originals", () => expect(receiptImageDimensions(600, 400)).toEqual({ width: 600, height: 400 }));
  it.each([[0, 10], [NaN, 100], [100, Infinity]])("rejects invalid image dimensions %s, %s", (w, h) => {
    expect(() => receiptImageDimensions(w, h)).toThrow();
  });
  it("lowers JPEG quality only when the encoded upload is too big", async () => {
    const toBlob = vi.fn<(callback: BlobCallback, mime?: string, quality?: number) => void>((callback) => callback(new Blob([new Uint8Array(toBlob.mock.calls.length === 1 ? 3_000_000 : 1_000_000)])));
    const result = await encodeReceiptCanvas({ toBlob } as unknown as HTMLCanvasElement);
    expect(result.size).toBe(1_000_000);
    expect(toBlob.mock.calls).toHaveLength(2);
    expect(toBlob.mock.calls[0][2]).toBe(0.86);
    expect(toBlob.mock.calls[1][2]).toBe(0.78);
  });
  it("rejects an unencodable or persistently oversized image instead of uploading it", async () => {
    await expect(encodeReceiptCanvas({ toBlob: callback => callback(null) } as HTMLCanvasElement)).rejects.toThrow("Gagal memproses");
    const toBlob = vi.fn((callback: BlobCallback) => callback(new Blob([new Uint8Array(3_000_000)])));
    await expect(encodeReceiptCanvas({ toBlob } as unknown as HTMLCanvasElement)).rejects.toThrow("masih terlalu besar");
    expect(toBlob).toHaveBeenCalledTimes(3);
  });
});
