/**
 * Polygon -> indexed raster, via even-odd scanline fill.
 *
 * Every pixel holds a region id; 0 means "outside Nepal". Sampling this at
 * runtime answers inside/outside AND region membership in a single array
 * lookup, which is the whole architectural bet (spec §5).
 */

export type Ring = number[][];
export type Polygon = Ring[];

export interface Bbox {
  lo: number; // min lng
  hi: number; // max lng
  la: number; // min lat
  ha: number; // max lat
}

interface Edge {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  yMin: number;
  yMax: number;
}

/**
 * Fill `polygons` into `pixels` with value `id`.
 *
 * All rings of a polygon are rasterized together under the even-odd rule, so
 * interior rings punch holes rather than being painted solid. Filling each ring
 * independently (as a naive port does) silently fills holes back in.
 */
export function fillPolygons(
  pixels: Uint8Array,
  width: number,
  height: number,
  bbox: Bbox,
  polygons: Polygon[],
  id: number,
): void {
  const { lo, hi, la, ha } = bbox;
  const spanLng = hi - lo;
  const spanLat = ha - la;

  for (const rings of polygons) {
    const edges: Edge[] = [];
    let yMinAll = Infinity;
    let yMaxAll = -Infinity;

    for (const ring of rings) {
      if (ring.length < 3) continue;
      // Project the whole ring into pixel space once.
      const px: number[] = new Array(ring.length);
      const py: number[] = new Array(ring.length);
      for (let i = 0; i < ring.length; i++) {
        px[i] = ((ring[i][0] - lo) / spanLng) * width;
        py[i] = ((ha - ring[i][1]) / spanLat) * height;
      }
      for (let i = 0; i < ring.length; i++) {
        const j = (i + 1) % ring.length;
        if (py[i] === py[j]) continue; // horizontal edges contribute no crossings
        const edge: Edge = {
          x0: px[i],
          y0: py[i],
          x1: px[j],
          y1: py[j],
          yMin: Math.min(py[i], py[j]),
          yMax: Math.max(py[i], py[j]),
        };
        edges.push(edge);
        if (edge.yMin < yMinAll) yMinAll = edge.yMin;
        if (edge.yMax > yMaxAll) yMaxAll = edge.yMax;
      }
    }
    if (!edges.length) continue;

    const rowStart = Math.max(0, Math.floor(yMinAll - 0.5));
    const rowEnd = Math.min(height - 1, Math.ceil(yMaxAll + 0.5));
    const crossings: number[] = [];

    for (let row = rowStart; row <= rowEnd; row++) {
      const y = row + 0.5;
      crossings.length = 0;

      for (const e of edges) {
        // Half-open test: counts each vertex exactly once, so shared vertices
        // between adjacent edges don't double-count into a dropped span.
        if (y >= e.yMin && y < e.yMax) {
          crossings.push(e.x0 + ((y - e.y0) * (e.x1 - e.x0)) / (e.y1 - e.y0));
        }
      }
      if (crossings.length < 2) continue;
      crossings.sort((a, b) => a - b);

      const base = row * width;
      for (let k = 0; k + 1 < crossings.length; k += 2) {
        // Pixel centers sit at x+0.5, so a pixel is inside when its center
        // falls within the span.
        const from = Math.max(0, Math.ceil(crossings[k] - 0.5));
        const to = Math.min(width - 1, Math.floor(crossings[k + 1] - 0.5));
        for (let x = from; x <= to; x++) pixels[base + x] = id;
      }
    }
  }
}

/**
 * Width that preserves true ground aspect at Nepal's latitude.
 *
 * Longitude degrees shrink by cos(lat) as you move off the equator; without
 * this the map renders noticeably stretched east-west.
 */
export function aspectWidth(bbox: Bbox, height: number): number {
  const { lo, hi, la, ha } = bbox;
  const midLat = ((la + ha) / 2) * (Math.PI / 180);
  const ratio = ((hi - lo) * Math.cos(midLat)) / (ha - la);
  return Math.round(height * ratio);
}
