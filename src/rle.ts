/**
 * Run-length codec for the region raster.
 *
 * Format: a sequence of runs, each `[value: u8][length: varint LEB128]`,
 * read row-major across the whole raster.
 *
 * Why not deflate (which is ~35% smaller)? Inflating needs either node:zlib or
 * DecompressionStream. The first doesn't exist in browsers, the second is
 * async — and an async raster forces every consumer into a loading state, or
 * into a client-only boundary under SSR. A synchronous decode keeps the server
 * and browser paths identical and keeps `naksha` usable inside a React server
 * component. The extra ~14 KB buys that.
 */

/** Decode base64 to bytes without Buffer or any dependency. */
function base64ToBytes(b64: string): Uint8Array {
  // atob exists in browsers, Node >=16, Deno, Bun, and Workers.
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  // Chunked to avoid blowing the argument limit on large rasters.
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

export function encodeRle(pixels: Uint8Array): Uint8Array {
  const out: number[] = [];
  let i = 0;
  while (i < pixels.length) {
    const value = pixels[i];
    let n = 1;
    while (i + n < pixels.length && pixels[i + n] === value) n++;
    out.push(value);
    let len = n;
    while (len >= 0x80) {
      out.push((len & 0x7f) | 0x80);
      len >>>= 7;
    }
    out.push(len);
    i += n;
  }
  return Uint8Array.from(out);
}

export function decodeRle(rle: Uint8Array, expectedLength: number): Uint8Array {
  const out = new Uint8Array(expectedLength);
  let p = 0;
  let at = 0;
  while (p < rle.length) {
    const value = rle[p++];
    let len = 0;
    let shift = 0;
    for (;;) {
      const b = rle[p++];
      len |= (b & 0x7f) << shift;
      if ((b & 0x80) === 0) break;
      shift += 7;
    }
    if (at + len > expectedLength) {
      throw new Error(`naksha: corrupt raster (run overflows at ${at}+${len})`);
    }
    // Runs of 0 are the common case and the array is already zeroed.
    if (value !== 0) out.fill(value, at, at + len);
    at += len;
  }
  if (at !== expectedLength) {
    throw new Error(`naksha: corrupt raster (decoded ${at}, expected ${expectedLength})`);
  }
  return out;
}

export function encodeRleBase64(pixels: Uint8Array): string {
  return bytesToBase64(encodeRle(pixels));
}

export function decodeRleBase64(b64: string, expectedLength: number): Uint8Array {
  return decodeRle(base64ToBytes(b64), expectedLength);
}
