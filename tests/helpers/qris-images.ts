import sharp from "sharp";

/** A valid ~1.2 MB indexed PNG that expands past 2 MiB when encoded as RGB. */
export async function indexedQrisFixture() {
  const width = 1200;
  const height = 1000;
  const pixels = Buffer.alloc(width * height * 3);
  let seed = 123456789;
  for (let pixel = 0; pixel < width * height; pixel++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const colour = seed >>> 24;
    pixels[pixel * 3] = colour;
    pixels[pixel * 3 + 1] = (colour * 73) % 256;
    pixels[pixel * 3 + 2] = colour ^ 173;
  }
  return sharp(pixels, { raw: { width, height, channels: 3 } })
    .png({ palette: true, colours: 256, dither: 0, compressionLevel: 9 })
    .toBuffer();
}
