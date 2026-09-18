/**
 * Viewport -> dot grid (spec §6).
 *
 * The core move: never re-resolve a global grid. Rasterise *the current
 * viewport* at a fixed dot budget. Detail then scales for free and the dot
 * count — so the DOM size, the render cost, and the look — stay constant at
 * every zoom level.
 */
import type { Bbox, LngLat } from "./geo.ts";
import { aspectWidth, bboxSizeKm } from "./geo.ts";
import { OUTSIDE, type RegionRaster } from "./raster.ts";

export interface Dot {
  /** Column in grid units. Also the SVG x coordinate: 1 unit = 1 dot spacing. */
  col: number;
  /** Row in grid units, from the top. */
  row: number;
  /** Region id this dot belongs to. Never 0. */
  region: number;
  /** Geographic centre of the cell — used for pin snapping and route anchors. */
  lng: number;
  lat: number;
  /** Fraction of the cell inside Nepal, 0..1. Edge dots can be faded by this. */
  coverage: number;
  /** True if the guarantee pass assigned this dot (see `ensureRegions`). */
  granted?: boolean;
}

export interface Grid {
  cols: number;
  rows: number;
  bbox: Bbox;
  dots: Dot[];
  /** Ground distance between adjacent dots, km. */
  kmPerDot: number;
  /** Region ids with at least one dot. */
  regions: Set<number>;
  /**
   * The raster this grid was sampled from.
   *
   * Kept because a dot's region is a *plurality vote* over its whole cell —
   * ~130 km² at the national view — while the raster answers for an exact
   * point. Near a border the two disagree, and anything pinning a real
   * coordinate needs the finer answer to snap honestly (see `snapPoint`).
   */
  raster: RegionRaster;
}

export type Sampling = "dominant" | "center";

export interface GridOptions {
  /**
   * Rows of dots.
   *
   * 40 is the default: ~1130 dots, which is the density the look is built
   * around. Note that no sane height separates every district HQ — Kathmandu
   * and Lalitpur are 3.2 km apart, so guaranteeing them distinct dots at a
   * national view would need ~250 rows. Collisions at z1 are expected and are
   * what clustering exists to express (spec §8).
   */
  height?: number;
  /** Viewport. Defaults to the raster's full extent (all of Nepal). */
  bbox?: Bbox;
  /**
   * `dominant` (default) gives each dot the region covering most of its cell,
   * which keeps district borders clean. `center` samples the cell centre only:
   * cheaper, but at z1 it discards ~99% of the raster and border dots land on
   * whichever district happens to sit under the midpoint.
   */
  sampling?: Sampling;
  /**
   * Minimum fraction of a cell that must be inside Nepal for a dot to appear.
   * Higher tightens the silhouette; lower fattens it. Ignored when
   * `sampling: "center"`.
   */
  coverage?: number;
  /**
   * Give every region visible in the viewport at least one dot, even when it
   * is too small to win a cell outright (default true).
   *
   * Without this, districts smaller than one cell vanish: at height 40 a cell
   * is ~130 km² and Bhaktapur is ~119 km², so it is never the plurality
   * anywhere and silently disappears from the national view — making it
   * impossible to highlight or click.
   */
  ensureRegions?: boolean;
}

export const DEFAULT_GRID_HEIGHT = 40;

/** Sub-samples per cell edge. Capped so cost stays flat as zoom deepens. */
function subSamples(raster: RegionRaster, cols: number): number {
  return Math.max(1, Math.min(8, Math.floor(raster.width / Math.max(1, cols))));
}

/**
 * Sample a raster into a dot grid over `bbox`.
 *
 * Cost is bounded by the dot budget, not by zoom level, geometry complexity,
 * or region count.
 */
export function buildGrid(raster: RegionRaster, options: GridOptions = {}): Grid {
  const height = options.height ?? DEFAULT_GRID_HEIGHT;
  const bbox = options.bbox ?? raster.bbox;
  const sampling = options.sampling ?? "dominant";
  const coverage = options.coverage ?? 0.5;
  const ensureRegions = options.ensureRegions ?? true;

  const cols = aspectWidth(bbox, height);
  const spanLng = bbox.hi - bbox.lo;
  const spanLat = bbox.ha - bbox.la;
  const k = sampling === "center" ? 1 : subSamples(raster, cols);
  const samplesPerCell = k * k;

  const dots: Dot[] = [];
  const regions = new Set<number>();

  // Best cell for each region, whether or not it wins there. Lets the
  // guarantee pass rescue regions too small to be a plurality anywhere.
  const bestCell = new Map<number, { index: number; score: number }>();
  const tally = new Uint16Array(256);
  const seen: number[] = [];

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < cols; col++) {
      let insideCount = 0;
      for (const v of seen) tally[v] = 0;
      seen.length = 0;

      for (let sy = 0; sy < k; sy++) {
        const lat = bbox.ha - ((row + (sy + 0.5) / k) * spanLat) / height;
        for (let sx = 0; sx < k; sx++) {
          const lng = bbox.lo + ((col + (sx + 0.5) / k) * spanLng) / cols;
          const v = raster.sampleAt(lng, lat);
          if (v === OUTSIDE) continue;
          if (tally[v] === 0) seen.push(v);
          tally[v]++;
          insideCount++;
        }
      }
      if (insideCount === 0) continue;

      let region = 0;
      let bestN = 0;
      for (const v of seen) {
        if (tally[v] > bestN) {
          bestN = tally[v];
          region = v;
        }
        const prev = bestCell.get(v);
        if (!prev || tally[v] > prev.score) bestCell.set(v, { index: dots.length, score: tally[v] });
      }

      const cellCoverage = insideCount / samplesPerCell;
      if (cellCoverage < coverage && sampling !== "center") continue;

      dots.push({
        col,
        row,
        region,
        lng: bbox.lo + ((col + 0.5) * spanLng) / cols,
        lat: bbox.ha - ((row + 0.5) * spanLat) / height,
        coverage: cellCoverage,
      });
      regions.add(region);
    }
  }

  if (ensureRegions) grantMissingRegions(dots, regions, bestCell);

  return {
    cols,
    rows: height,
    bbox,
    dots,
    kmPerDot: bboxSizeKm(bbox).width / cols,
    regions,
    raster,
  };
}

/**
 * Reassign a dot to each visible-but-unrepresented region.
 *
 * Only steals from a region that has dots to spare, so rescuing one small
 * district never erases another. Smallest claims are settled first, since
 * they have the fewest candidate cells.
 */
function grantMissingRegions(
  dots: Dot[],
  regions: Set<number>,
  bestCell: Map<number, { index: number; score: number }>,
): void {
  const counts = new Map<number, number>();
  for (const d of dots) counts.set(d.region, (counts.get(d.region) ?? 0) + 1);

  const missing = [...bestCell.entries()]
    .filter(([id]) => !regions.has(id))
    .sort((a, b) => a[1].score - b[1].score);

  for (const [id, best] of missing) {
    const dot = dots[best.index];
    if (!dot) continue;
    const donor = dot.region;
    if ((counts.get(donor) ?? 0) <= 1) continue; // donor would vanish in turn
    counts.set(donor, counts.get(donor)! - 1);
    counts.set(id, 1);
    dot.region = id;
    dot.granted = true;
    regions.add(id);
  }
}

/**
 * Grid cell a geographic point falls in — the basis of pin snapping and,
 * because many points share a cell, of clustering (spec §8).
 */
export function cellAt(grid: Grid, p: LngLat): { col: number; row: number } {
  const { bbox, cols, rows } = grid;
  return {
    col: Math.floor(((p.lng - bbox.lo) / (bbox.hi - bbox.lo)) * cols),
    row: Math.floor(((bbox.ha - p.lat) / (bbox.ha - bbox.la)) * rows),
  };
}

/** Geographic centre of a grid cell. */
export function cellCenter(grid: Grid, col: number, row: number): LngLat {
  const { bbox, cols, rows } = grid;
  return {
    lng: bbox.lo + ((col + 0.5) * (bbox.hi - bbox.lo)) / cols,
    lat: bbox.ha - ((row + 0.5) * (bbox.ha - bbox.la)) / rows,
  };
}

export function isInsideGrid(grid: Grid, col: number, row: number): boolean {
  return col >= 0 && col < grid.cols && row >= 0 && row < grid.rows;
}

/**
 * How far a point may be nudged to reach a dot of its own district, in dot
 * units.
 *
 * One dot spacing, which is the map's whole resolution: a dot at the national
 * view stands for ~130 km², so no pin on it was ever a claim finer than that.
 * Moving within one spacing therefore says nothing the map was not already
 * saying, while moving further would invent a position. Measured over the 121
 * real coordinates this repo holds — 74 district headquarters and the demo's
 * 47 towns — every point that needs correcting finds its own district within
 * **0.79** units, so the cap never binds on real data. It exists to fail
 * closed on the case that would be a lie, not to tune the common one.
 */
const SNAP_REACH = 1;

/**
 * The dot a point should be drawn on.
 *
 * Normally the dot in the point's own cell. The exception is the one that
 * matters: a dot's region is the district covering *most* of its cell, so a
 * town sitting near a district border routinely lands on a dot painted as its
 * neighbour — Lahan is in Siraha, but its cell is mostly Saptari, and a pin
 * there contradicts its own label and every district colouring around it.
 * Nepali settlements sit on borders far more often than not (highway towns,
 * river crossings, valley mouths), so this is not an exotic edge: 12 of the
 * 121 real coordinates in this repo hit it, Lalitpur and Siraha's own
 * headquarters among them.
 *
 * When the cell's dot disagrees with the raster's answer *at the point*, the
 * nearest dot of the point's real district within `SNAP_REACH` wins. Ties go
 * to scan order — north-west first, strict `<` — for the same reason
 * `hitTest`'s tolerance search does: the four dots orthogonally adjacent to a
 * cell are all exactly one unit away, and with `<=` which district a pin
 * reported would flip under an unrelated edit to the loop.
 *
 * Returns undefined for a point outside the viewport, and for one whose cell
 * holds no dot and has no dot of its district in reach — the caller decides
 * what to do with a pin the field cannot carry.
 */
export function snapPoint(grid: Grid, p: LngLat): Dot | undefined {
  const { col, row } = cellAt(grid, p);
  if (!isInsideGrid(grid, col, row)) return undefined;

  const index = dotIndex(grid);
  const here = index.get(row * grid.cols + col);
  // OUTSIDE means the point is not in any district, so there is nothing to
  // reconcile — a stop out past the border stays exactly where it was put.
  const region = grid.raster.sampleAt(p.lng, p.lat);
  if (region === OUTSIDE || (here && here.region === region)) return here;

  const at = project(grid, p);
  let best: Dot | undefined;
  // Seeded at the cap, so the same comparison enforces the reach and picks the
  // nearest candidate.
  let bestD2 = SNAP_REACH * SNAP_REACH;
  for (let r = row - 1; r <= row + 1; r++) {
    for (let c = col - 1; c <= col + 1; c++) {
      if (!isInsideGrid(grid, c, r)) continue;
      const dot = index.get(r * grid.cols + c);
      if (dot?.region !== region) continue;
      const dx = c + 0.5 - at.x;
      const dy = r + 0.5 - at.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = dot;
      }
    }
  }
  // A 3x3 block is the whole search: from anywhere inside the centre cell, the
  // nearest dot two cells out is already 1.58 units away, past the cap.
  return best ?? here;
}

/**
 * Geographic point -> SVG coordinates, unsnapped.
 *
 * The viewBox is `0 0 cols rows`, so one unit is exactly one dot spacing.
 * Stroke widths, arc heights and pin radii are all expressed in these units
 * and stay visually consistent at every zoom (spec §10).
 */
export function project(grid: Grid, p: LngLat): { x: number; y: number } {
  const { bbox, cols, rows } = grid;
  return {
    x: ((p.lng - bbox.lo) / (bbox.hi - bbox.lo)) * cols,
    y: ((bbox.ha - p.lat) / (bbox.ha - bbox.la)) * rows,
  };
}

/**
 * SVG coordinates -> geographic point, the exact inverse of `project`.
 *
 * Unquantised on purpose: `hitTest` answers *which dot* was hit, which is the
 * right question for a hover readout, and this answers *where* the pointer
 * actually is, which is the right one for a gesture that moves the viewport.
 * Rounding a zoom-at-cursor to the nearest dot centre would drift the map by up
 * to half a cell — 5.7 km at the national view — on every step.
 *
 * ```ts
 * const at = eventPoint(svg, event);
 * if (at) setView(zoomBbox(view, 2, { center: unproject(grid, at.x, at.y) }));
 * ```
 */
export function unproject(grid: Grid, x: number, y: number): LngLat {
  const { bbox, cols, rows } = grid;
  return {
    lng: bbox.lo + (x / cols) * (bbox.hi - bbox.lo),
    lat: bbox.ha - (y / rows) * (bbox.ha - bbox.la),
  };
}

/** SVG coordinates of a dot's centre. */
export function dotCenter(dot: Dot): { x: number; y: number } {
  return { x: dot.col + 0.5, y: dot.row + 0.5 };
}

/**
 * Cell key -> dot.
 *
 * Memoised against the grid itself, so re-attaching (a React effect re-running,
 * a demo switching modes) reuses the index rather than rebuilding it.
 *
 * Lives here rather than next to `hitTest` because the renderer needs it too —
 * label placement asks "is there a dot in this cell?" a few hundred times per
 * label — and `svg.ts` cannot import from `interact.ts`, which imports from it.
 * Sharing the cache means a render followed by an `attachInteractions` on the
 * same grid builds the index once, not twice.
 */
const INDEXES = new WeakMap<Grid, Map<number, Dot>>();

export function dotIndex(grid: Grid): Map<number, Dot> {
  let index = INDEXES.get(grid);
  if (!index) {
    index = new Map();
    for (const dot of grid.dots) index.set(dot.row * grid.cols + dot.col, dot);
    INDEXES.set(grid, index);
  }
  return index;
}

/**
 * One representative dot per region, memoised against the grid.
 *
 * The dot nearest the region's centre of mass in grid space. Centre of mass of
 * the *dots*, not a polygon centroid: a crescent-shaped district's centroid can
 * fall outside the district entirely, or between dots, and the point of this is
 * to land on a dot that is actually drawn. `ensureRegions` guarantees every
 * region has at least one dot, so for any id in `grid.regions` this resolves.
 */
const ANCHORS = new WeakMap<Grid, Map<number, Dot>>();

/**
 * The dot that stands for a region — use it to point *at a district*.
 *
 * **This is not a location for a place inside the region.** Measured against 30
 * real Nepali towns with known coordinates, the anchor lands on the same dot as
 * the town only 10% of the time; the median miss is 15 km and the worst is
 * 40 km. Nepali settlements cluster on district edges — border crossings, the
 * Terai highway, river valleys — while a centre of mass sits inland. Label this
 * dot with the *district's* name. Labelling it with a town's name places that
 * town somewhere it isn't.
 *
 * When you have a coordinate, pass it as a point instead and let `snapPoint`
 * place it: at the default height a dot spans ~11 km, and the dot it picks is
 * guaranteed to belong to the district the coordinate is actually in whenever
 * one is within a single dot spacing.
 */
export function regionAnchor(grid: Grid, regionId: number): Dot | undefined {
  let anchors = ANCHORS.get(grid);
  if (!anchors) {
    const sums = new Map<number, { col: number; row: number; n: number }>();
    for (const dot of grid.dots) {
      const s = sums.get(dot.region) ?? { col: 0, row: 0, n: 0 };
      s.col += dot.col;
      s.row += dot.row;
      s.n++;
      sums.set(dot.region, s);
    }
    const best = new Map<number, { dot: Dot; d2: number }>();
    for (const dot of grid.dots) {
      const s = sums.get(dot.region)!;
      const dc = dot.col - s.col / s.n;
      const dr = dot.row - s.row / s.n;
      const d2 = dc * dc + dr * dr;
      const b = best.get(dot.region);
      if (!b || d2 < b.d2) best.set(dot.region, { dot, d2 });
    }
    anchors = new Map([...best].map(([id, b]) => [id, b.dot]));
    ANCHORS.set(grid, anchors);
  }
  return anchors.get(regionId);
}
