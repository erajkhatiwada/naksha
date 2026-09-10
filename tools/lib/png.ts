/**
 * Minimal indexed-PNG encoder. Build-time only.
 *
 * Uses node:zlib and nothing else, so regenerating the map artifacts needs no
 * Python, no `sharp`, no native modules — just Node.
 */
import { deflateSync } from "node:zlib";

const SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(data.length + 12);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(out.length - 4, crc32(out.subarray(4, out.length - 4)));
  return out;
}

/** PNG filter types we consider. Indexed images gain little from the others. */
type Filter = 0 | 1;

function applyFilter(row: Uint8Array, filter: Filter): Uint8Array {
  if (filter === 0) return row;
  // Sub: store the delta from the previous byte. Turns runs of one district
  // into runs of zeros, which deflate collapses aggressively.
  const out = new Uint8Array(row.length);
  out[0] = row[0];
  for (let i = 1; i < row.length; i++) out[i] = (row[i] - row[i - 1]) & 0xff;
  return out;
}

export interface IndexedPngOptions {
  width: number;
  height: number;
  /** One palette index per pixel, row-major, length width*height. */
  pixels: Uint8Array;
  /** RGB triples, up to 256 entries. Padded with black if short. */
  palette: Uint8Array;
  filter?: Filter | "auto";
}

export function encodeIndexedPng(opts: IndexedPngOptions): Uint8Array {
  const { width, height, pixels } = opts;
  if (pixels.length !== width * height) {
    throw new Error(`pixels length ${pixels.length} != ${width}*${height}`);
  }

  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, width);
  ihdrView.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 3; // color type 3 = indexed
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  const plte = new Uint8Array(768);
  plte.set(opts.palette.subarray(0, 768));

  const candidates: Filter[] = opts.filter === "auto" || opts.filter === undefined
    ? [0, 1]
    : [opts.filter];

  let best: Uint8Array | null = null;
  for (const filter of candidates) {
    const raw = new Uint8Array(height * (width + 1));
    for (let y = 0; y < height; y++) {
      const row = pixels.subarray(y * width, (y + 1) * width);
      raw[y * (width + 1)] = filter;
      raw.set(applyFilter(row, filter), y * (width + 1) + 1);
    }
    const idat = deflateSync(raw, { level: 9 });
    if (!best || idat.length < best.length) best = idat;
  }

  const parts = [
    SIGNATURE,
    chunk("IHDR", ihdr),
    chunk("PLTE", plte),
    chunk("IDAT", best!),
    chunk("IEND", new Uint8Array(0)),
  ];

  const total = parts.reduce((n, p) => n + p.length, 0);
  const png = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    png.set(p, offset);
    offset += p.length;
  }
  return png;
}

/**
 * A visually distinct palette. The raster is data, not an image — but being able
 * to open the PNG and see 77 separate districts makes build bugs obvious.
 */
export function debugPalette(): Uint8Array {
  const pal = new Uint8Array(768);
  for (let i = 0; i < 256; i++) {
    pal[i * 3] = (i * 37) % 256;
    pal[i * 3 + 1] = (i * 91) % 256;
    pal[i * 3 + 2] = (i * 151) % 256;
  }
  // Index 0 is "outside Nepal". Force it to black so the silhouette reads.
  pal[0] = pal[1] = pal[2] = 0;
  return pal;
}
