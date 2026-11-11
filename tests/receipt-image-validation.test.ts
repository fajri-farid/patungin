import crypto from "node:crypto";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { MAX_SERVER_IMAGE_BYTES, MAX_SERVER_IMAGE_PIXELS, validateAndInspectImageBytes } from "../src/server/scans/gemini";

const image = (width = 32, height = 32) => sharp({ create: { width, height, channels: 3, background: "white" } });

describe("scan image validation before AI quota", () => {
  it.each(["jpeg", "png", "webp"] as const)("decodes a real %s and hashes the original bytes", async format => {
    const bytes = await image().toFormat(format).toBuffer();
    expect(await validateAndInspectImageBytes(bytes)).toEqual({
      mimeType: `image/${format}`, imageHash: crypto.createHash("sha256").update(bytes).digest("hex"),
    });
  });

  it("retains a narrow long receipt without resizing its original bytes", async () => {
    const bytes = await image(1000, 10000).png().toBuffer();
    const original = Buffer.from(bytes);
    expect((await validateAndInspectImageBytes(bytes)).mimeType).toBe("image/png");
    expect(bytes.equals(original)).toBe(true);
    expect(await sharp(bytes).metadata()).toMatchObject({ width: 1000, height: 10000 });
  });

  it("accepts the maximum pixel count and rejects a small compressed file above it", async () => {
    expect(MAX_SERVER_IMAGE_PIXELS).toBe(4000 * 4000);
    await expect(validateAndInspectImageBytes(await image(4000, 4000).png().toBuffer())).resolves.toMatchObject({ mimeType: "image/png" });
    const bytes = await image(4001, 4000).png().toBuffer();
    expect(bytes.length).toBeLessThan(MAX_SERVER_IMAGE_BYTES);
    await expect(validateAndInspectImageBytes(bytes)).rejects.toMatchObject({ code: "IMAGE_RESOLUTION_TOO_LARGE", statusCode: 422 });
  });

  it.each([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]),
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from("RIFF0000WEBP", "ascii"),
  ])("rejects a signature without decodable pixels (%j)", async bytes => {
    await expect(validateAndInspectImageBytes(bytes)).rejects.toMatchObject({ code: "INVALID_IMAGE" });
  });

  it("rejects the four-byte PNG prefix that previously passed validation", async () => {
    await expect(validateAndInspectImageBytes(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0])))
      .rejects.toMatchObject({ code: "UNSUPPORTED_IMAGE_FORMAT" });
  });

  it("decodes pixel data rather than trusting valid metadata on a truncated PNG", async () => {
    const bytes = await image(200, 200).png({ compressionLevel: 0 }).toBuffer();
    const truncated = bytes.subarray(0, Math.floor(bytes.length / 2));
    expect(await sharp(truncated).metadata()).toMatchObject({ width: 200, height: 200 });
    await expect(validateAndInspectImageBytes(truncated)).rejects.toMatchObject({ code: "INVALID_IMAGE" });
  });

  it("rejects animated WebP instead of silently reading its first frame", async () => {
    const pixels = Buffer.alloc(32 * 64 * 3);
    pixels.fill(255, 32 * 32 * 3);
    const bytes = await sharp(pixels, { raw: { width: 32, height: 64, pageHeight: 32, channels: 3 } })
      .webp({ loop: 0, delay: [100, 100] }).toBuffer();
    await expect(validateAndInspectImageBytes(bytes)).rejects.toMatchObject({ code: "ANIMATED_IMAGE_NOT_SUPPORTED" });
  });

  it("rejects empty or oversized buffers and unsupported formats", async () => {
    await expect(validateAndInspectImageBytes(Buffer.alloc(0))).rejects.toMatchObject({ code: "EMPTY_IMAGE" });
    await expect(validateAndInspectImageBytes(Buffer.alloc(MAX_SERVER_IMAGE_BYTES + 1))).rejects.toMatchObject({ code: "IMAGE_TOO_LARGE" });
    await expect(validateAndInspectImageBytes(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"/>')))
      .rejects.toMatchObject({ code: "UNSUPPORTED_IMAGE_FORMAT" });
  });
});
