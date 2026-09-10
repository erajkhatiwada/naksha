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

  /** Ground resolution of one raster cell, in km, at Nepal's mid-latitude. */
  get cellSizeKm(): number {
    const midLat = ((this.bbox.la + this.bbox.ha) / 2) * (Math.PI / 180);
    const kmPerLng = 111.32 * Math.cos(midLat);
    return ((this.bbox.hi - this.bbox.lo) / this.width) * kmPerLng;
  }
}
