/**
 * Routes and arcs (spec §10).
 *
 * A route is an *ordered list of stops*, rendered as drawn. naksha never asks
 * how you get from one stop to the next — no pathfinding, no road network.
 * A weighted A->B flow is just a two-stop route (spec §9.1).
 */
import type { LngLat } from "./geo.ts";
import type { Bilingual } from "./i18n.ts";
import type { Grid } from "./grid.ts";
import { cellAt, isInsideGrid, project, snapPoint } from "./grid.ts";

export interface Stop extends LngLat, Bilingual {
  id?: string;
}

export interface Route {
  id?: string;
  stops: Stop[];
  /** Overrides the theme's route colour. */
  color?: string;
  /** Overrides the theme's route width, in dot units. */
  width?: number;
  /** Relative weight, for flow-style rendering. Scales width when set. */
  weight?: number;
  label?: string;
}

export interface ArcOptions {
  /** Coefficient in h = clamp(k * sqrt(d), floor, ceil). */
  k?: number;
  /** Minimum bow, in dot units. Keeps short hops from rendering as flat lines. */
  floor?: number;
  /** Maximum bow, in dot units. Stops long routes becoming giant rainbows. */
  ceil?: number;
  /** Which way arcs bow. "up" is consistent regardless of travel direction. */
  bow?: "up" | "left" | "right";
}

const DEFAULTS: Required<ArcOptions> = { k: 1, floor: 1.5, ceil: 9, bow: "up" };

/**
 * Arc height for a chord of length `d` dot units.
 *
 * Non-linear by necessity: district HQ distances span 253x (3.2 km to 819 km).
 * Linear height makes Kathmandu->Bhaktapur an invisible flat line while
 * Kathmandu->Mahendranagar becomes a giant rainbow. sqrt compresses that range
 * into something that reads at both ends.
 */
export function arcHeight(d: number, options: ArcOptions = {}): number {
  const { k, floor, ceil } = { ...DEFAULTS, ...options };
  return Math.min(ceil, Math.max(floor, k * Math.sqrt(d)));
}

export interface Point2 {
  x: number;
  y: number;
}

/**
 * Quadratic bezier between two projected points, bowed perpendicular to the
 * chord. Returned as an SVG path so it can carry a dash reveal and an
 * `<animateMotion>` pulse along the same geometry.
 */
export function arcPath(a: Point2, b: Point2, options: ArcOptions = {}): string {
  const opts = { ...DEFAULTS, ...options };
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.hypot(dx, dy);
  if (d === 0) return `M ${fmt(a.x)} ${fmt(a.y)}`;

  const h = arcHeight(d, opts);
  // Left normal in screen space (y grows downward).
  let nx = dy / d;
  let ny = -dx / d;
  if (opts.bow === "right") {
    nx = -nx;
    ny = -ny;
  } else if (opts.bow === "up" && ny > 0) {
    // Flip so the arc always bows toward the top, whichever way it travels.
    nx = -nx;
    ny = -ny;
  }

  const cx = (a.x + b.x) / 2 + nx * h;
  const cy = (a.y + b.y) / 2 + ny * h;
  return `M ${fmt(a.x)} ${fmt(a.y)} Q ${fmt(cx)} ${fmt(cy)} ${fmt(b.x)} ${fmt(b.y)}`;
}

/**
 * Where a stop is drawn: the same dot its pin lands on.
 *
 * Mirrors `clusterPoints` exactly — `snapPoint`, falling back to the bare cell
 * — so a route always starts and ends inside its own pins. Projecting the raw
 * coordinate instead leaves the arc up to ~0.7 units from the pin's centre,
 * outside the pin for 31 of the 74 district HQs at the national view. A stop
 * outside the viewport has no dot and no pin, so it keeps its raw projection
 * and the arc still runs off the frame toward it.
 */
function stopPoint(grid: Grid, stop: LngLat): Point2 {
  const { col, row } = snapPoint(grid, stop) ?? cellAt(grid, stop);
  return isInsideGrid(grid, col, row) ? { x: col + 0.5, y: row + 0.5 } : project(grid, stop);
}

/** Full path for a multi-stop route: one quadratic segment per leg. */
export function routePath(grid: Grid, route: Route, options: ArcOptions = {}): string {
  const pts = route.stops.map((s) => stopPoint(grid, s));
  if (pts.length < 2) return "";
  return pts
    .slice(0, -1)
    .map((p, i) => arcPath(p, pts[i + 1], options))
    .join(" ");
}

/** Trim trailing zeros so generated SVG stays small and diffable. */
export function fmt(n: number): string {
  return Number(n.toFixed(3)).toString();
}
