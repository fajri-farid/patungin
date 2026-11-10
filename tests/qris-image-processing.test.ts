import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { MAX_QRIS_BYTES } from "../src/domain/qris";
import { normalizeQrisImage } from "../src/server/payments/qris-image-processing";

function noisyPixels(width: number, height: number) {
  const pixels = Buffer.alloc(width * height * 3);
  let seed = 987654321;
  for (let i = 0; i < pixels.length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    pixels[i] = seed >>> 24;
  }
  return pixels;
}

describe("QRIS image normalization", () => {
  it.each(["jpeg", "webp"] as const)("accepts a %s below 2 MiB even when its initial PNG expands past the storage limit", async (format) => {
    const input = await sharp(noisyPixels(1200, 1000), { raw: { width: 1200, height: 1000, channels: 3 } })
      .toFormat(format, { quality: 75 })
      .toBuffer();
    expect(input.length).toBeLessThan(MAX_QRIS_BYTES);
    expect((await sharp(input).png().toBuffer()).length).toBeGreaterThan(MAX_QRIS_BYTES);
    const output = await normalizeQrisImage(input);
    const metadata = await sharp(output).metadata();
    expect(output.length).toBeLessThanOrEqual(MAX_QRIS_BYTES);
    expect(metadata.format).toBe("png");
    expect(metadata.width).toBeGreaterThan(700);
    expect(metadata.width).toBeLessThan(1200);
    expect(metadata.width! / metadata.height!).toBeCloseTo(1.2, 2);
  });

  it("accepts the 16 megapixel boundary and bounds stored dimensions", async () => {
    const input = await sharp({ create: { width: 4000, height: 4000, channels: 3, background: "white" } }).png().toBuffer();
    const output = await normalizeQrisImage(input);
    expect(await sharp(output).metadata()).toMatchObject({ width: 2400, height: 2400, format: "png" });
  });

  it("reports excessive resolution separately even for a small compressed PNG", async () => {
    const input = await sharp({ create: { width: 4001, height: 4000, channels: 3, background: "white" } }).png().toBuffer();
    expect(input.length).toBeLessThan(MAX_QRIS_BYTES);
    await expect(normalizeQrisImage(input)).rejects.toMatchObject({ statusCode: 422, code: "QRIS_RESOLUTION_TOO_LARGE" });
  });

  it("flattens transparency onto white without enlarging the image", async () => {
    const input = await sharp({ create: { width: 32, height: 32, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
    const output = await normalizeQrisImage(input);
    expect(await sharp(output).metadata()).toMatchObject({ width: 32, height: 32, hasAlpha: false });
    const { data } = await sharp(output).raw().toBuffer({ resolveWithObject: true });
    expect(data.every(value => value === 255)).toBe(true);
  });

  it("applies EXIF orientation and strips private metadata", async () => {
    const input = await sharp({ create: { width: 80, height: 40, channels: 3, background: "white" } })
      .withMetadata({ orientation: 6, exif: { IFD0: { Artist: "private-test-artist" } } })
      .jpeg()
      .toBuffer();
    const output = await normalizeQrisImage(input);
    const metadata = await sharp(output).metadata();
    expect(metadata).toMatchObject({ width: 40, height: 80 });
    expect(metadata.exif).toBeUndefined();
    expect(metadata.orientation).toBeUndefined();
  });

  it("rejects animated WebP rather than silently storing one frame", async () => {
    const pixels = Buffer.alloc(40 * 80 * 3);
    pixels.fill(255, 40 * 40 * 3);
    const input = await sharp(pixels, { raw: { width: 40, height: 80, pageHeight: 40, channels: 3 } })
      .webp({ loop: 0, delay: [100, 100] })
      .toBuffer();
    expect((await sharp(input).metadata()).pages).toBe(2);
    await expect(normalizeQrisImage(input)).rejects.toMatchObject({ code: "QRIS_ANIMATED_IMAGE" });
  });

  it("rejects unsupported contents even if the caller calls the file a PNG", async () => {
    await expect(normalizeQrisImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20"/></svg>')))
      .rejects.toMatchObject({ code: "QRIS_UNSUPPORTED_FORMAT" });
  });

  it("distinguishes corrupt or truncated pixels from excessive upload bytes", async () => {
    const input = await sharp(noisyPixels(100, 100), { raw: { width: 100, height: 100, channels: 3 } }).png().toBuffer();
    await expect(normalizeQrisImage(input.subarray(0, Math.floor(input.length / 2)))).rejects.toMatchObject({ code: "INVALID_QRIS_IMAGE" });
    await expect(normalizeQrisImage(Buffer.from("not an image"))).rejects.toMatchObject({ code: "INVALID_QRIS_IMAGE" });
    await expect(normalizeQrisImage(Buffer.alloc(MAX_QRIS_BYTES + 1))).rejects.toMatchObject({ code: "INVALID_QRIS" });
  });
});
