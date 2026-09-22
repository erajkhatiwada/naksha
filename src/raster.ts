/**
 * The region raster (spec §5).
 *
 * A single indexed bitmap where each cell holds a region id and 0 means
 * "outside Nepal". One array lookup answers inside/outside AND which district,
 * at any zoom, with no GeoJSON, no point-in-polygon, and no reprojection.
 */
import type { Bbox, LngLat } from "./geo.ts";
import { decodeRleBase64 } from "./rle.ts";

export interface RasterSource {
  width: number;
  height: number;
  bbox: Bbox;
  /** RLE-encoded region ids, base64. */
  data: string;
}

export interface Region {
  id: number;
  /** English name, as published by OCHA. */
  name: string;
  /** Devanagari name, e.g. काठमाडौं. */
  nameNp: string;
  /** OCHA p-code, e.g. NP0769. */
  pcode: string | null;
  /** Province number, 1-7. */
  province: number;
  /** English province name, e.g. "Bagmati Province". */
  provinceName: string;
  /** Devanagari province name, e.g. बाग्मती प्रदेश. */
  provinceNameNp: string;
  /** District headquarters. */
  hq: string | null;
  hqNp: string | null;
  /**
   * Where the headquarters is, when it is known.
   *
   * Null for the three districts the upstream point set predates or cannot
   * resolve — Nawalparasi East, Rukum East and Rukum West, all created by the
   * 2015 split. Use it to pin an HQ exactly; do not substitute `regionAnchor`
   * when it is null, because that returns the district's centre of mass rather
   * than a town (see its own note).
   */
  hqAt: { lng: number; lat: number } | null;
}

/** Region id meaning "outside Nepal". */
export const OUTSIDE = 0;

export class RegionRaster {
  readonly width: number;
  readonly height: number;
  readonly bbox: Bbox;

  #source: string;
  #pixels: Uint8Array | null = null;
  #bounds: Map<number, Bbox> | null = null;

  constructor(source: RasterSource) {
    this.width = source.width;
    this.height = source.height;
    this.bbox = source.bbox;
    this.#source = source.data;
  }

  /**
   * Decoded cells, row-major from the north-west corner.
   *
   * Decoded lazily on first use and memoised, so importing naksha costs
   * nothing until something is actually drawn. Synchronous by design — see
   * the note in rle.ts about why this isn't deflate.
   */
  get pixels(): Uint8Array {
    if (this.#pixels === null) {
      this.#pixels = decodeRleBase64(this.#source, this.width * this.height);
    }
    return this.#pixels;
  }

  /** Force the decode now, e.g. during app startup rather than first paint. */
  preload(): this {
    void this.pixels;
    return this;
  }

  /**
   * Region id at a geographic point, or 0 outside Nepal.
   *
   * Scalar arguments, not a LngLat: the grid sampler calls this ~100k times
   * per viewport, and allocating an object per call dominates the cost.
   */
  sampleAt(lng: number, lat: number): number {
    const { lo, hi, la, ha } = this.bbox;
    const x = ((lng - lo) / (hi - lo)) * this.width;
    const y = ((ha - lat) / (ha - la)) * this.height;
    if (!(x >= 0) || x >= this.width || !(y >= 0) || y >= this.height) return OUTSIDE;
    return this.pixels[(y | 0) * this.width + (x | 0)];
  }

  /** Region id at a geographic point, or 0 outside Nepal. */
  sample(p: LngLat): number {
    return this.sampleAt(p.lng, p.lat);
  }

  /** True when a point falls inside Nepal. */
  contains(p: LngLat): boolean {
    return this.sample(p) !== OUTSIDE;
  }

  /**
   * Geographic bounds of one region, or undefined for an id the raster never
   * uses.
   *
   * The box to zoom a viewport to when a district is picked. It is the
   * region's extent in the *bitmap*, so it is exact to one raster cell
   * (0.447 km) — finer than any grid this library draws, and finer than the
   * dot a click on that district actually landed on.
   *
   * The whole table is built on the first call and memoised: one pass over the
   * bitmap answers for all 77 districts, where asking per district would cost a
   * pass each. Pair it with `padBbox` for breathing room and `fitAspect` to
   * match the container:
   *
   * ```ts
   * const box = fitAspect(padBbox(raster.regionBbox(id)!, 0.08), 16 / 9);
   * ```
   */
  regionBbox(id: number): Bbox | undefined {
    if (this.#bounds === null) {
      const cells = new Map<number, { x0: number; x1: number; y0: number; y1: number }>();
      const px = this.pixels;
      for (let y = 0; y < this.height; y++) {
        const row = y * this.width;
        for (let x = 0; x < this.width; x++) {
          const v = px[row + x];
          if (v === OUTSIDE) continue;
          const b = cells.get(v);
          if (b === undefined) {
            cells.set(v, { x0: x, x1: x, y0: y, y1: y });
            continue;
          }
          // `else if` is safe rather than clever: x0 <= x1 always, so a cell
          // west of the minimum cannot also be east of the maximum.
          if (x < b.x0) b.x0 = x;
          else if (x > b.x1) b.x1 = x;
          // Rows are scanned north to south, so y0 is settled at first sight
          // and y1 only ever grows.
          b.y1 = y;
        }
      }
      const { lo, hi, la, ha } = this.bbox;
      const lngPerCell = (hi - lo) / this.width;
      const latPerCell = (ha - la) / this.height;
      // Outer edges of the extreme cells, not their centres — a box drawn
      // through the centres would exclude half a cell of the district on
      // every side.
      this.#bounds = new Map(
        [...cells].map(([v, b]) => [
          v,
          {
            lo: lo + b.x0 * lngPerCell,
            hi: lo + (b.x1 + 1) * lngPerCell,
            la: ha - (b.y1 + 1) * latPerCell,
            ha: ha - b.y0 * latPerCell,
          },
        ]),
      );
    }
    return this.#bounds.get(id);
  }

  /** Ground resolution of one raster cell, in km, at Nepal's mid-latitude. */
  get cellSizeKm(): number {
    const midLat = ((this.bbox.la + this.bbox.ha) / 2) * (Math.PI / 180);
    const kmPerLng = 111.32 * Math.cos(midLat);
    return ((this.bbox.hi - this.bbox.lo) / this.width) * kmPerLng;
  }
}
