/**
 * naksha — a modern, simple Nepal map.
 *
 * This is a presentation-layer map, not a navigation map. It takes an ordered
 * list of stops and renders it beautifully. It does not know how to get from
 * one stop to the next, and deliberately never will (spec §1).
 */

export type { LngLat, Bbox } from "./geo.ts";
export type { ZoomOptions, PanOptions } from "./geo.ts";
export {
  NEPAL_BBOX,
  MIN_ZOOM_SPAN,
  aspectWidth,
  distanceKm,
  bboxSizeKm,
  bboxContains,
  padBbox,
  fitAspect,
  clampBbox,
  zoomBbox,
  panBbox,
} from "./geo.ts";

export type { RasterSource, Region } from "./raster.ts";
export { RegionRaster, OUTSIDE } from "./raster.ts";

export type { Dot, Grid, GridOptions, Sampling } from "./grid.ts";
export {
  buildGrid,
  cellAt,
  cellCenter,
  dotIndex,
  isInsideGrid,
  project,
  unproject,
  dotCenter,
  snapPoint,
  regionAnchor,
  DEFAULT_GRID_HEIGHT,
} from "./grid.ts";

export type { Theme } from "./theme.ts";
export { lightTheme, darkTheme, resolveTheme, DEFAULT_FONT_STACK } from "./theme.ts";

export type { Lang, Bilingual } from "./i18n.ts";
export {
  pickLabel,
  bothLabels,
  regionName,
  regionProvince,
  regionHq,
  regionBoth,
} from "./i18n.ts";

export type { Stop, Route, ArcOptions, Point2 } from "./route.ts";
export { arcHeight, arcPath, routePath } from "./route.ts";

export type { MapPoint, Cluster, ClusterResult } from "./cluster.ts";
export { clusterPoints, collapseRatio } from "./cluster.ts";

export type { RenderOptions, LabelPlacement, InsetOptions } from "./svg.ts";
export { renderSvg, viewportRect, renderInset } from "./svg.ts";

export type { InteractionOptions, HighlightOptions, HitKind } from "./interact.ts";
export { attachInteractions, hitTest, eventPoint } from "./interact.ts";

export { VIEWS, type ViewName } from "./views.ts";

// `placeParts`, `describePlace` and their types are declared further down,
// alongside the other district lookups they build on.

import { RegionRaster, type Region } from "./raster.ts";
import { DISTRICT_RASTER, DISTRICTS } from "./generated/districts.ts";
import { buildGrid, type Grid, type GridOptions } from "./grid.ts";
import { renderSvg, type RenderOptions } from "./svg.ts";
import type { Bbox, LngLat } from "./geo.ts";
import type { Bilingual, Lang } from "./i18n.ts";
import { pickLabel, regionName, regionProvince, regionHq } from "./i18n.ts";

export { DISTRICTS };

let cached: RegionRaster | null = null;

/**
 * Nepal's 77 districts as a region raster.
 *
 * Built once and reused. The underlying payload is decoded lazily on first
 * sample, so importing naksha costs nothing until something is drawn.
 */
export function nepalRaster(): RegionRaster {
  return (cached ??= new RegionRaster(DISTRICT_RASTER));
}

const byId = new Map<number, Region>(DISTRICTS.map((d) => [d.id, d]));
const byName = new Map<string, Region>(DISTRICTS.map((d) => [d.name.toLowerCase(), d]));

export function districtById(id: number): Region | undefined {
  return byId.get(id);
}

const byNameNp = new Map<string, Region>(DISTRICTS.map((d) => [d.nameNp, d]));

/** Look up a district by its English name, case-insensitively. */
export function districtByName(name: string): Region | undefined {
  return byName.get(name.trim().toLowerCase());
}

/**
 * Look up a district by either script.
 *
 * Devanagari input is normalised first, so text typed with a decomposed
 * vowel (क + ा + े rather than क + ो) still matches.
 */
export function findDistrict(name: string): Region | undefined {
  const trimmed = name.trim();
  return (
    byName.get(trimmed.toLowerCase()) ??
    byNameNp.get(trimmed.normalize("NFC").replace(/ाे/g, "ो").replace(/ाै/g, "ौ"))
  );
}

/** Which district contains a point, or undefined if it is outside Nepal. */
export function districtAt(p: LngLat): Region | undefined {
  return byId.get(nepalRaster().sample(p));
}

/**
 * Geographic bounds of a district — the box to zoom to when one is picked.
 *
 * ```ts
 * const dot = hitTest(grid, x, y);
 * const box = fitAspect(padBbox(districtBbox(dot.region)!, 0.08), 16 / 9);
 * ```
 *
 * Undefined only for an id no district carries. All 77 are built and memoised
 * on the first call — see `RegionRaster.regionBbox` for why it is one pass.
 */
export function districtBbox(id: number): Bbox | undefined {
  return nepalRaster().regionBbox(id);
}

/** One of Nepal's seven provinces, with the districts that make it up. */
export interface Province {
  /** 1-7, matching `Region.province`. */
  id: number;
  /** English name, e.g. "Bagmati Province". */
  name: string;
  /** Devanagari name, e.g. बाग्मती प्रदेश. */
  nameNp: string;
  /** Ids of the districts in this province, ascending. */
  districts: readonly number[];
}

/**
 * Nepal's seven provinces, ascending by number.
 *
 * Derived from `DISTRICTS` at import rather than shipped as its own table:
 * every field here already lives on the districts, and a second copy is a
 * second thing to keep in step. Districts remain the unit the raster and the
 * grid speak in — a province is a grouping of them, not a region of its own,
 * so there is no province id on a `Dot`. To colour by province, map a dot's
 * district to `Region.province` (`regionColor` in the demo does exactly this).
 */
export const PROVINCES: readonly Province[] = (() => {
  const groups = new Map<number, { name: string; nameNp: string; districts: number[] }>();
  for (const d of DISTRICTS) {
    const g = groups.get(d.province) ?? {
      name: d.provinceName,
      nameNp: d.provinceNameNp,
      districts: [],
    };
    g.districts.push(d.id);
    groups.set(d.province, g);
  }
  return Object.freeze(
    [...groups]
      .sort(([a], [b]) => a - b)
      .map(([id, g]) =>
        Object.freeze({ id, ...g, districts: Object.freeze([...g.districts].sort((a, b) => a - b)) }),
      ),
  );
})();

const provincesById = new Map<number, Province>(PROVINCES.map((p) => [p.id, p]));

/** A province by its number, 1-7. */
export function provinceById(id: number): Province | undefined {
  return provincesById.get(id);
}

/**
 * The pieces behind a place's display name, already resolved to one language.
 *
 * Exists so a consumer never has to accept naksha's idea of how a name should
 * read. `describePlace` joins these one particular way; anything else — a
 * two-line label, a name with the p-code appended, a province-first ordering,
 * a district shown only when it disambiguates — is a template over this object.
 */
export interface PlaceParts {
  /** The point's own name, if it carries one for this language. */
  name?: string;
  /** The district the point falls in. Undefined outside Nepal. */
  region?: Region;
  /** The district's name. */
  district?: string;
  /** The district's province. */
  province?: string;
  /** The district's headquarters, where one is known. */
  hq?: string;
  /** The district's OCHA p-code, e.g. `NP0407`. */
  pcode?: string;
}

/** Everything naksha knows about where a point is and what it is called. */
export function placeParts(point: LngLat & Bilingual, lang: Lang = "en"): PlaceParts {
  const region = districtAt(point);
  return {
    name: pickLabel(point, lang),
    region,
    district: region ? regionName(region, lang) : undefined,
    province: region ? regionProvince(region, lang) : undefined,
    hq: region ? (regionHq(region, lang) ?? undefined) : undefined,
    pcode: region?.pcode ?? undefined,
  };
}

export interface DescribeOptions {
  lang?: Lang;
  /**
   * Joins the place to its district. `", "` by default — a comma is how an
   * address reads in either script, where a middot reads as decoration.
   */
  separator?: string;
}

/**
 * A place as `"Lahan, Siraha"` — its own name, then the district holding it.
 *
 * Degrades rather than producing something odd: a point with no name of its
 * own is just its district, a point outside Nepal is just its name, and a
 * place named after its own district ("Siraha" in Siraha) is not doubled up.
 * Returns undefined only when there is nothing to say at all.
 */
export function describePlace(
  point: LngLat & Bilingual,
  { lang = "en", separator = ", " }: DescribeOptions = {},
): string | undefined {
  const { name, district } = placeParts(point, lang);
  if (name && district && name !== district) return `${name}${separator}${district}`;
  return name ?? district;
}

/** Build a dot grid over Nepal (or a viewport within it). */
export function nepalGrid(options?: GridOptions): Grid {
  return buildGrid(nepalRaster(), options);
}

/**
 * One-call render: grid + SVG string.
 *
 * ```ts
 * const svg = renderNepal({
 *   routes: [{ stops: [ktm, pokhara, jomsom] }],
 * });
 * ```
 */
export function renderNepal(options: GridOptions & RenderOptions = {}): string {
  const { height, bbox, sampling, coverage, ensureRegions, ...render } = options;
  return renderSvg(
    nepalGrid({ height, bbox, sampling, coverage, ensureRegions }),
    render,
  );
}
