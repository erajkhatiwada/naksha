/**
 * SVG renderer.
 *
 * Emits a self-contained string: no runtime, no framework, no dependencies.
 * The React wrapper and the interactive layer both build on this.
 *
 * The viewBox is `0 0 cols rows`, so one user unit is one dot spacing and
 * every size in the theme is resolution-independent (spec §10).
 */
import type { Grid, Dot } from "./grid.ts";
import { dotIndex, isInsideGrid, project, buildGrid } from "./grid.ts";
import type { Bbox } from "./geo.ts";
import type { Theme } from "./theme.ts";
import { resolveTheme } from "./theme.ts";
import type { Route, ArcOptions } from "./route.ts";
import { routePath, fmt } from "./route.ts";
import type { MapPoint, Cluster } from "./cluster.ts";
import { clusterPoints } from "./cluster.ts";
import type { Lang } from "./i18n.ts";
import { pickLabel, bothLabels } from "./i18n.ts";

/**
 * Where a stop's label goes relative to its pin.
 *
 * A label is drawn with a halo of the background colour so it stays readable
 * over the field — which means it *erases* the dots it covers, and on a dot
 * map the field is the data. Know what each option costs before picking one;
 * the figures are measured over all 77 district labels at the national view.
 *
 * - `above` (default) — flush above the pin. No search, no leader line, and
 *   nothing moves. It also hides a mean of 12 dots per label, and **all 77**
 *   bury dots of the district they name — Bhaktapur is a single dot at that
 *   zoom, so its own label covers all of it. Right when labels are few and
 *   sparse, or when a name landing on the field is acceptable.
 * - `avoid-region` — search around the pin and refuse to cover dots of the
 *   region the point sits in, spilling over a neighbour instead. Zero
 *   own-region dots hidden across all 77, for a median of 3.7 dot-widths of
 *   movement plus a leader line.
 * - `clear` — refuse to cover *any* dot, preferring to run straight up or down
 *   from the pin so the leader reads at a glance. Cleanest — 6 dots hidden in
 *   total — but the frame's empty space is all outside the outline, so labels
 *   travel a median of 8.2 dot-widths and up to 25.8, and depend entirely on
 *   their leader line to stay attached to a pin.
 * - `none` — no on-map text. For consumers whose UI names the place elsewhere.
 *
 * Both searching modes also refuse to overlap another label or pin, so a map
 * with many stops does not stack names on top of each other.
 *
 * All four treat a newline in a label as a line break and place the whole
 * stacked block as one box — see `labels`.
 */
export type LabelPlacement = "above" | "avoid-region" | "clear" | "none";

/**
 * A miniature of the whole country, inset into a corner of the map itself.
 *
 * Named apart from `viewport` on purpose, because the two are the halves of an
 * overview-plus-detail pair and are easy to confuse: `viewport` is for a map
 * that *is* the overview, and draws the window for some other view. `inset` is
 * for the detail map, and puts the whole overview inside it.
 *
 * The alternative to rendering a second map beside this one: everything stays
 * in a single SVG string, so it survives being written to a file, emailed,
 * printed or server-rendered, with no second element to position and no CSS.
 * Reach for the separate-element pattern instead when the overview has to be
 * interactive — dragged, clicked, given its own controls — because that needs a
 * DOM this renderer does not touch.
 */
export interface InsetOptions {
  /** Which corner it sits in. Default `"top-right"`. */
  corner?: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  /** Width as a fraction of the map's own width. Default 0.22. */
  size?: number;
  /** Gap from the map's edges, in dot units. Default 1. */
  margin?: number;
  /** The area it covers. Defaults to the raster's full extent — all of Nepal. */
  bbox?: Bbox;
  /** Rows of dots in the inset's own grid. Default 12, about 105 dots. */
  height?: number;
  /**
   * Panel fill behind it, so the map's own dots don't show through.
   *
   * Defaults to the theme's background. **If that is `"transparent"` — which it
   * is whenever the map is drawn straight onto a page — pass a colour here, or
   * the inset is see-through and unreadable over the field.**
   */
  background?: string;
  /**
   * Theme overrides for the inset alone, merged over the map's own theme.
   *
   * The inset already forces `edgeFade: 0`, which is a difference in kind
   * rather than taste: fading partly-covered cells softens a border at 40 rows,
   * but at 12 rows most of the country *is* edge, so the same rule washes the
   * silhouette out to nothing. Override it here to get it back.
   */
  theme?: Partial<Theme>;
  /**
   * Per-district colour, as `RenderOptions.regionColor`.
   *
   * Defaults to the map's own, so the miniature is recognisably the same map:
   * a grey silhouette floating on a coloured field reads as a second, unrelated
   * thing rather than as a small copy of the one underneath it. Pass
   * `() => undefined` for a monochrome locator, which is the better read when
   * the palette is loud enough to compete with the window rectangle.
   */
  regionColor?: (regionId: number) => string | undefined;
}

export interface RenderOptions {
  theme?: Partial<Theme>;
  /** Ordered stops to draw. */
  routes?: readonly Route[];
  /** Points to snap, cluster and pin. */
  points?: readonly MapPoint[];
  /** Per-region dot colour. Return undefined to fall back to the theme. */
  regionColor?: (regionId: number) => string | undefined;
  arc?: ArcOptions;
  /**
   * `path` (default) collapses the dot field into one node per colour — ~1200
   * circles become 1-2 DOM nodes. `circles` emits one node per dot and tags
   * each with `data-region`, for per-dot CSS or a DOM-based consumer.
   *
   * Interaction is *not* a reason to choose `circles`: `attachInteractions`
   * hit-tests geometrically and works against the collapsed `path` output.
   */
  dots?: "path" | "circles";
  /** Draw the member count on clusters holding more than one point. */
  clusterCounts?: boolean;
  /**
   * Draw stop labels next to pins.
   *
   * A label containing newlines is drawn stacked, one line per row, and placed
   * as a single block — so `"Lahan\nSiraha\nMadhesh Province"` is a third of
   * the width the same name costs on one line, which at the national view is
   * the difference between a readable label and a band across the map. What
   * goes on each line is entirely the caller's (see `placeParts`); the theme's
   * `labelLineHeight` sets how tightly they stack.
   */
  labels?: boolean;
  /** How labels dodge the dot field. Defaults to `above` — see the type. */
  labelPlacement?: LabelPlacement;
  /**
   * Language for drawn labels (default "en"). Falls back to the other
   * language per label when the requested one is missing, and the accessible
   * title always carries both, so switching language never hides a name.
   */
  lang?: Lang;
  /** Reveal routes with a dash animation and send a pulse along them. */
  animate?: boolean;
  /** Accessible name for the whole figure. */
  title?: string;
  /** Optional width/height attributes. Omit for a fluid, container-sized SVG. */
  width?: number | string;
  height?: number | string;
  /**
   * Draw a rectangle showing where another viewport is looking — the overview
   * half of an overview-plus-detail pair.
   *
   * Pass the *detail* map's bbox to a map rendered over a wider one, usually
   * `NEPAL_BBOX` at a small `height`. It is only ever a drawn rectangle: this
   * does not link the two maps, and nothing here reads back from it.
   *
   * Clipped to the frame, so a viewport reaching past the overview's own box
   * shows the part that overlaps rather than painting outside the viewBox.
   *
   * This is the option for a map that *is* an overview — a second, wider map
   * drawn beside this one. To put a miniature *inside* this map's own corner
   * instead, see `inset`.
   */
  viewport?: Bbox;
  /**
   * Inset a miniature of the whole country into a corner of this map, with the
   * current viewport marked on it — an overview and a detail view in one SVG.
   *
   * `true` accepts every default: top-right, 22% of the width, one dot unit in
   * from the edges. The window is drawn only when this map is actually looking
   * at a sub-region; at full extent there is nothing to mark and the inset is
   * just the country.
   */
  inset?: boolean | InsetOptions;
  /** Prefix for generated ids, so multiple maps can share a page. */
  idPrefix?: string;
}

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );

const DEVANAGARI = /[ऀ-ॿ]/;
/** Vowel signs, nukta, virama and other marks that render inside a cluster. */
const COMBINING = /[ऀ-ःऺ-ॏ॑-ॗॢॣ]/;

/**
 * Rough half-width of a label, in dot units, used only to decide whether to
 * flip the text anchor away from a viewBox edge.
 *
 * Counting UTF-16 units would badly overestimate Devanagari, where a syllable
 * like का is two code points but one visual cluster — so combining marks are
 * excluded and a wider per-glyph advance is used instead. Deliberately errs
 * wide: over-estimating flips the anchor a little early, under-estimating
 * clips the label.
 */
function estimateHalfWidth(text: string, size: number): number {
  let advances = 0;
  for (const ch of text) if (!COMBINING.test(ch)) advances++;
  const perGlyph = DEVANAGARI.test(text) ? 0.72 : 0.55;
  return (advances * size * perGlyph) / 2;
}

/**
 * One circular subpath, so a whole dot field can live in a single <path>.
 *
 * Exported for `interact.ts`, which paints its highlight layer the same way —
 * one node for a whole district. Not re-exported from the package root.
 */
export function circleSubpath(cx: number, cy: number, r: number): string {
  return `M${fmt(cx - r)} ${fmt(cy)}a${fmt(r)} ${fmt(r)} 0 1 0 ${fmt(r * 2)} 0a${fmt(r)} ${fmt(r)} 0 1 0 ${fmt(-r * 2)} 0`;
}

/** The halo's stroke reaches half its width past the glyphs on every side. */
const HALO = 0.25;
/** Cap height above the baseline, and descender below, as fractions of size. */
const ASCENT = 0.8;
const DESCENT = 0.2;

export interface LabelBox {
  /** Text anchor point. The box is centred on it horizontally. */
  x: number;
  /** Baseline of the *first* line. Later lines hang below it by `drop`. */
  y: number;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/**
 * A label split into lines, and the geometry every placement decision needs.
 *
 * Composing the string stays the caller's job — `placeParts` hands over the
 * name, district, province and HQ separately precisely so naksha never imposes
 * an ordering — but a three-part name set on one line is 27% of the frame's
 * width at the national view, so the renderer has to be able to stack it.
 * A newline in `label` is the instruction to do that.
 *
 * Blank lines are dropped rather than reserved: a trailing newline is a typo in
 * a template, and honouring it would erase a row of dots for nothing.
 */
export interface LabelMetrics {
  lines: string[];
  /** Half the width of the *widest* line — what has to clear the frame edge. */
  halfWidth: number;
  size: number;
  /** Baseline-to-baseline distance. */
  lineGap: number;
  /** How far the last baseline sits below the first. 0 for a single line. */
  drop: number;
}

/**
 * Split a label into drawn lines.
 *
 * Exported for the React wrapper, which renders its own pins and would
 * otherwise draw a two-line name as one long one. Not re-exported from the
 * package root.
 */
export function labelLines(text: string): string[] {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

export function measureLabel(text: string, theme: Theme): LabelMetrics {
  const lines = labelLines(text);
  const size = theme.labelSize;
  const lineGap = size * theme.labelLineHeight;
  return {
    lines,
    halfWidth: Math.max(0, ...lines.map((line) => estimateHalfWidth(line, size))),
    size,
    lineGap,
    drop: (lines.length - 1) * lineGap,
  };
}

export function labelBox(cx: number, baseline: number, m: LabelMetrics): LabelBox {
  return {
    x: cx,
    y: baseline,
    x0: cx - m.halfWidth - HALO,
    x1: cx + m.halfWidth + HALO,
    y0: baseline - ASCENT * m.size - HALO,
    y1: baseline + m.drop + DESCENT * m.size + HALO,
  };
}

/**
 * Dots the box would erase, split by whether they belong to `region`.
 *
 * Only cells the box touches are visited, so the cost is the label's own area
 * in cells — a couple of dozen lookups — not a scan of the field. The test is
 * circle-against-rectangle rather than whole-cell: a dot is 0.3 units across
 * in a 1-unit cell, so a box clipping a cell's corner usually misses the dot
 * in it, and counting that as a hit would push labels further than they need
 * to go.
 */
export function dotsUnder(
  grid: Grid,
  box: LabelBox,
  radius: number,
  region: number,
): { own: number; other: number } {
  const index = dotIndex(grid);
  let own = 0;
  let other = 0;
  for (let row = Math.floor(box.y0 - radius); row <= Math.floor(box.y1 + radius); row++) {
    for (let col = Math.floor(box.x0 - radius); col <= Math.floor(box.x1 + radius); col++) {
      if (!isInsideGrid(grid, col, row)) continue;
      const dot = index.get(row * grid.cols + col);
      if (!dot) continue;
      const cx = col + 0.5;
      const cy = row + 0.5;
      const nx = Math.min(Math.max(cx, box.x0), box.x1);
      const ny = Math.min(Math.max(cy, box.y0), box.y1);
      if ((cx - nx) ** 2 + (cy - ny) ** 2 > radius * radius) continue;
      if (dot.region === region) own++;
      else other++;
    }
  }
  return { own, other };
}

type Dir = readonly [number, number];

const NORTH_SOUTH: Dir[] = [
  [0, -1],
  [0, 1],
];
const EAST_WEST: Dir[] = [
  [1, 0],
  [-1, 0],
];
const DIAGONALS: Dir[] = [
  [1, -1],
  [-1, -1],
  [1, 1],
  [-1, 1],
];
const ALL_DIRS: Dir[] = [...NORTH_SOUTH, ...EAST_WEST, ...DIAGONALS];

/**
 * Direction tiers, tried in order. A tier that yields a placement good enough
 * to stop on ends the search, so earlier tiers are preferred outright rather
 * than merely weighted — a preference expressed as a penalty gets traded away
 * against distance at some ratio, and the ratio is impossible to reason about.
 *
 * `clear` walks straight up or down first because a label directly over its pin
 * needs no interpreting: the leader is vertical and unmistakable. Only when a
 * column is blocked all the way to the frame edge does it step sideways, then
 * diagonally. `avoid-region` keeps all eight at once — it is trying to stay
 * *near*, and a tier ladder would march it up a long empty column past a
 * perfectly good spot to the left.
 */
const TIERS = {
  "avoid-region": [ALL_DIRS],
  clear: [NORTH_SOUTH, EAST_WEST, DIAGONALS],
} as const;

/**
 * Weights per strategy: what a hidden dot costs against travelling further.
 *
 * `avoid-region` prices its own region 20x a neighbour's, so it will cross a
 * border rather than sit on the district it names, but keeps a stiff distance
 * term so it stays adjacent instead of drifting to the empty corner it could
 * always reach. `clear` prices every dot alike and nearly ignores distance,
 * which is what sends it to the margin.
 *
 * `collision` is priced far above either because two labels sharing space is a
 * worse failure than either covering dots: a reader can see through a label to
 * the field, but cannot tell which pin an overlapping pair belongs to.
 */
const WEIGHTS = {
  "avoid-region": { own: 20, other: 1, distance: 3, collision: 400, steps: 10, stride: 0.8 },
  clear: { own: 1, other: 1, distance: 0.08, collision: 400, steps: 15, stride: 1.1 },
} as const;

/** Boxes already claimed this render — other labels, and every pin. */
export interface Occupied {
  boxes: LabelBox[];
}

function overlaps(a: LabelBox, b: LabelBox): boolean {
  return a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
}

/**
 * How many claimed boxes a candidate would collide with.
 *
 * Counted rather than short-circuited so that when every candidate collides —
 * a dense cluster of stops with nowhere clean to go — the search still prefers
 * the placement that collides with the fewest.
 */
function collisions(box: LabelBox, taken: Occupied): number {
  let n = 0;
  for (const other of taken.boxes) if (overlaps(box, other)) n++;
  return n;
}

/**
 * How far past the pin a label must sit before it earns a leader line.
 *
 * Below this the label still reads as attached and the line is just clutter
 * across the field; above it the eye needs the join.
 */
const LEADER_MIN = 0.9;

/**
 * The best placement for one label, and whether it moved far enough to need a
 * leader line joining it back to its pin.
 *
 * Candidates ring the pin in eight directions at growing distance; anything
 * that would overflow the viewBox is discarded rather than clamped, because a
 * clamped box silently slides back over the field it was trying to leave.
 */
export function placeLabel(
  grid: Grid,
  mode: "avoid-region" | "clear",
  cx: number,
  cy: number,
  pinRadius: number,
  m: LabelMetrics,
  region: number,
  dotRadius: number,
  taken: Occupied,
): LabelBox {
  const w = WEIGHTS[mode];
  const boxW = (m.halfWidth + HALO) * 2;
  const boxH = (ASCENT + DESCENT) * m.size + m.drop + HALO * 2;

  let best: LabelBox | undefined;
  let bestScore = Infinity;
  // Tracked apart from the score so the tier ladder can ask "was this one
  // actually clean?" rather than inferring it from a total that mixes in
  // distance — at `clear`'s weights a four-dot collision scores lower than a
  // clean placement seventy units away, and the ladder would stop on it.
  let bestPenalty = Infinity;

  for (const dirs of TIERS[mode]) {
    for (let step = 0; step < w.steps; step++) {
      for (const [dx, dy] of dirs) {
        const out = step * w.stride;
        const bcx = cx + (dx === 0 ? 0 : dx * (pinRadius + boxW / 2 + out));
        const bcy = cy + (dy === 0 ? 0 : dy * (pinRadius + boxH / 2 + out));
        // The box is positioned by its centre, so the first baseline is found
        // from its bottom edge upward — past the descender and every line the
        // block still has to fit below the first.
        const baseline = bcy + boxH / 2 - HALO - DESCENT * m.size - m.drop;
        const box = labelBox(bcx, baseline, m);
        const frame = grid.viewBox;
        if (box.x0 < frame.x + 0.25 || box.x1 > frame.x + frame.cols - 0.25) continue;
        if (box.y0 < frame.y + 0.25 || box.y1 > frame.y + frame.rows - 0.25) continue;

        const hit = dotsUnder(grid, box, dotRadius, region);
        const distance = Math.hypot(bcx - cx, bcy - cy);
        const penalty =
          hit.own * w.own + hit.other * w.other + collisions(box, taken) * w.collision;
        const score = penalty + distance * w.distance;
        if (score < bestScore) {
          bestScore = score;
          bestPenalty = penalty;
          best = box;
        }
      }
    }
    // This tier found a placement that hides nothing and hits nothing. Later
    // tiers only bend the leader, so stop rather than let a marginally nearer
    // diagonal win.
    if (bestPenalty === 0) break;
  }

  // Every candidate overflowed — a label wider than the viewport, or a pin in
  // a corner. Fall back to the original placement, which the caller clamps.
  return best ?? labelBox(cx, cy - pinRadius - 0.35 - m.drop, m);
}

/**
 * Where an `above` label lands: flush over the pin, no search.
 *
 * Nepal is a NW-SE ribbon, so stops routinely sit near the left and right edges
 * of the viewBox; centre-anchoring them clips the label, so the half-width is
 * estimated and the anchor flipped when it would overflow.
 *
 * A stacked label grows *upward*: the bottom line sits exactly where a one-line
 * label would have, so adding a district or a province never moves the name
 * away from the pin it belongs to.
 *
 * Exported so `tools/verify.ts` can measure what the renderer actually places
 * rather than re-deriving these offsets — a second copy of the `- r - 0.35` and
 * the anchor flip is exactly how a measurement drifts from the thing it claims
 * to measure. Not re-exported from the package root.
 */
export function placeAbove(
  grid: Grid,
  cx: number,
  cy: number,
  pinRadius: number,
  m: LabelMetrics,
): { box: LabelBox; anchor: string } {
  let anchor = "middle";
  let tx = cx;
  const west = grid.viewBox.x + 0.25;
  const east = grid.viewBox.x + grid.viewBox.cols - 0.25;
  if (tx - m.halfWidth < west) {
    anchor = "start";
    tx = Math.max(west, cx - pinRadius);
  } else if (tx + m.halfWidth > east) {
    anchor = "end";
    tx = Math.min(east, cx + pinRadius);
  }
  return { box: labelBox(tx, cy - pinRadius - 0.35 - m.drop, m), anchor };
}

/** A hairline from the pin to the nearest edge of a label that has moved away. */
function leaderPath(cx: number, cy: number, pinRadius: number, box: LabelBox): string {
  const tx = Math.min(Math.max(cx, box.x0), box.x1);
  const ty = Math.min(Math.max(cy, box.y0), box.y1);
  const dx = tx - cx;
  const dy = ty - cy;
  const len = Math.hypot(dx, dy);
  if (len <= pinRadius + LEADER_MIN) return "";
  const from = pinRadius / len;
  return `M${fmt(cx + dx * from)} ${fmt(cy + dy * from)}L${fmt(tx)} ${fmt(ty)}`;
}

function dotOpacity(dot: Dot, theme: Theme): number {
  if (theme.edgeFade <= 0) return theme.dotOpacity;
  const fade = 1 - theme.edgeFade * (1 - Math.min(1, dot.coverage));
  return theme.dotOpacity * fade;
}

/**
 * The dot field as an SVG `<g>` fragment.
 *
 * Exported so framework wrappers can inject the static layer once and keep it
 * memoised, while drawing the interactive layers (routes, pins) as real
 * framework elements with real event handlers.
 */
export function renderDotField(grid: Grid, theme: Theme, options: RenderOptions = {}): string {
  return renderDots(grid, theme, options);
}

function renderDots(grid: Grid, theme: Theme, options: RenderOptions): string {
  const mode = options.dots ?? "path";
  const fillOf = (d: Dot) => options.regionColor?.(d.region) ?? theme.dot;

  if (mode === "circles") {
    const body = grid.dots
      .map((d) => {
        const o = dotOpacity(d, theme);
        return (
          `<circle cx="${fmt(d.col + 0.5)}" cy="${fmt(d.row + 0.5)}" r="${fmt(theme.dotRadius)}"` +
          ` fill="${esc(fillOf(d))}"${o < 1 ? ` opacity="${fmt(o)}"` : ""}` +
          ` data-region="${d.region}"/>`
        );
      })
      .join("");
    return `<g class="naksha-dots">${body}</g>`;
  }

  // Group by fill and a quantised opacity so the field collapses to a handful
  // of <path> nodes instead of one node per dot.
  const groups = new Map<string, { fill: string; opacity: number; d: string[] }>();
  for (const dot of grid.dots) {
    const fill = fillOf(dot);
    const opacity = Math.round(dotOpacity(dot, theme) * 8) / 8;
    const key = `${fill}|${opacity}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { fill, opacity, d: [] }));
    g.d.push(circleSubpath(dot.col + 0.5, dot.row + 0.5, theme.dotRadius));
  }

  const body = [...groups.values()]
    .map(
      (g) =>
        `<path d="${g.d.join("")}" fill="${esc(g.fill)}"` +
        `${g.opacity < 1 ? ` opacity="${fmt(g.opacity)}"` : ""}/>`,
    )
    .join("");
  return `<g class="naksha-dots">${body}</g>`;
}

function renderRoutes(grid: Grid, theme: Theme, options: RenderOptions, prefix: string): string {
  const routes = options.routes ?? [];
  if (!routes.length) return "";

  const parts: string[] = [];
  routes.forEach((route, i) => {
    const d = routePath(grid, route, options.arc);
    if (!d) return;
    const id = `${prefix}r${i}`;
    const stroke = route.color ?? theme.route;
    const width = route.width ?? theme.routeWidth * (route.weight ?? 1);

    parts.push(
      // pathLength="1" normalises the dash maths, so one CSS rule reveals every
      // route correctly whether it is 11 km or 800 km long — no JS measurement.
      `<path id="${id}" class="naksha-route${options.animate ? " naksha-reveal" : ""}"` +
        (options.animate ? ` pathLength="1"` : "") +
        ` d="${d}" fill="none" stroke="${esc(stroke)}" stroke-width="${fmt(width)}"` +
        ` stroke-linecap="round" stroke-linejoin="round" opacity="${fmt(theme.routeOpacity)}"` +
        // Always emitted, unlike data-route: an event handler needs to resolve
        // back to the caller's route array whether or not it gave routes ids.
        ` data-route-index="${i}"` +
        (route.id ? ` data-route="${esc(route.id)}"` : "") +
        (route.label ? `><title>${esc(route.label)}</title></path>` : "/>"),
    );

    if (options.animate) {
      // A separate element on animateMotion, not marker-end: markers don't
      // cooperate with a dash reveal (spec §10).
      //
      // Starts at opacity 0 and is switched on by <set>. animateMotion
      // translates from the origin, so without it the pulse would sit at the
      // top-left corner — which is exactly what a static rasteriser (or any
      // renderer without SMIL) would draw. Invisible is the right fallback.
      //
      // Both begin at the same staggered time, and that is load-bearing: reveal
      // the opacity at 0s while the motion is still waiting its turn and the
      // pulse spends the delay parked at the untranslated origin, drawing a
      // stack of stray dots in the corner until each one's motion starts.
      //
      // The path is written out again here rather than referenced with
      // `<mpath href="#id">`. An id reference resolves against the *document*,
      // not the enclosing <svg>, so two maps on one page — each numbering its
      // routes from r0 under the same `idPrefix` — would send every pulse in
      // the second map along the first map's geometry. Those two maps rarely
      // share a viewBox, so the pulses drift across the frame with no route
      // under them. Repeating a short arc costs a few dozen bytes; not
      // repeating it makes correctness depend on what else is on the page.
      const delay = `${(i * 0.4).toFixed(1)}s`;
      parts.push(
        `<circle class="naksha-pulse" r="${fmt(theme.pinRadius * 0.5)}" fill="${esc(stroke)}"` +
          ` opacity="0">` +
          `<set attributeName="opacity" to="1" begin="${delay}"/>` +
          `<animateMotion dur="3s" repeatCount="indefinite" begin="${delay}"` +
          ` path="${d}"/></circle>`,
      );
    }
  });

  return `<g class="naksha-routes">${parts.join("")}</g>`;
}

function renderPins(
  grid: Grid,
  theme: Theme,
  options: RenderOptions,
  clusters: Cluster[],
): string {
  const parts: string[] = [];
  const labels: string[] = [];
  const placement = options.labelPlacement ?? "above";
  const index = dotIndex(grid);

  // Seeded with every pin, so the first label placed already knows to keep off
  // the others — otherwise whichever cluster happens to be drawn first would
  // be free to sit on a neighbour's pin.
  const taken: Occupied = {
    boxes: clusters.map((c) => {
      const pr = (c.points.length > 1 ? theme.pinRadius * 1.5 : theme.pinRadius) + theme.pinHaloWidth;
      return { x: c.x, y: c.y, x0: c.x - pr, x1: c.x + pr, y0: c.y - pr, y1: c.y + pr };
    }),
  };

  for (const c of clusters) {
    const multiple = c.points.length > 1;
    const r = multiple ? theme.pinRadius * 1.5 : theme.pinRadius;
    const fill = multiple ? theme.cluster : theme.pin;
    // Cell coordinates, not x/y: they identify the cluster exactly, where
    // matching on formatted float positions is a rounding bug waiting to bite.
    const key = ` data-cluster="${c.col},${c.row}"`;

    if (theme.pinHaloWidth > 0) {
      parts.push(
        // Tagged too, so the halo widens the hit target instead of punching a
        // hole in it — it is drawn wider than the pin it sits behind.
        `<circle class="naksha-pin-halo" cx="${fmt(c.x)}" cy="${fmt(c.y)}"` +
          ` r="${fmt(r + theme.pinHaloWidth / 2)}" fill="${esc(theme.pinHalo)}"${key}/>`,
      );
    }
    // The accessible title carries both scripts, so a Devanagari map is still
    // searchable and readable in English and vice versa.
    const label = multiple
      ? `${c.points.length} stops near ${c.lat.toFixed(3)}, ${c.lng.toFixed(3)}`
      : (bothLabels(c.points[0]) ?? "");
    parts.push(
      `<circle class="naksha-pin" cx="${fmt(c.x)}" cy="${fmt(c.y)}" r="${fmt(r)}"` +
        ` fill="${esc(fill)}" data-count="${c.points.length}"${key}` +
        (label ? `><title>${esc(label)}</title></circle>` : "/>"),
    );

    if (multiple && options.clusterCounts !== false) {
      parts.push(
        `<text x="${fmt(c.x)}" y="${fmt(c.y)}" text-anchor="middle" dominant-baseline="central"` +
          ` font-size="${fmt(r * 1.1)}" font-weight="600" fill="${esc(theme.clusterLabel)}"` +
          ` font-family="${esc(theme.fontFamily)}" pointer-events="none">${esc(String(c.points.length))}</text>`,
      );
    } else if (
      !multiple &&
      options.labels &&
      placement !== "none" &&
      pickLabel(c.points[0] ?? {}, options.lang)
    ) {
      const m = measureLabel(pickLabel(c.points[0], options.lang)!, theme);
      // A label of nothing but whitespace: the accessible title still carries
      // it, but there is no block to place.
      if (m.lines.length === 0) continue;
      let anchor = "middle";
      let box: LabelBox;
      let leader = "";

      if (placement === "avoid-region" || placement === "clear") {
        // The pin sits on a dot, so the region to protect is simply whatever
        // that dot belongs to. A pin snapped outside the field has none, and
        // passing 0 (never a real region id) makes every dot count as another
        // district's — which is the right reading for a stop out at sea.
        const region = index.get(c.row * grid.cols + c.col)?.region ?? 0;
        box = placeLabel(grid, placement, c.x, c.y, r, m, region, theme.dotRadius, taken);
        leader = leaderPath(c.x, c.y, r, box);
        // Claimed, so the next label routes around this one.
        taken.boxes.push(box);
      } else {
        const above = placeAbove(grid, c.x, c.y, r, m);
        anchor = above.anchor;
        box = above.box;
      }

      if (leader) {
        labels.push(
          `<path class="naksha-leader" d="${leader}" fill="none"` +
            ` stroke="${esc(theme.leader)}" stroke-width="${fmt(theme.leaderWidth)}"` +
            ` opacity="${fmt(theme.leaderOpacity)}" pointer-events="none"/>`,
        );
      }
      // All the lines live in one <text>, and that is load-bearing rather than
      // tidy: `paint-order` is resolved per element, so a single element paints
      // every halo first and every glyph after. Splitting the lines into
      // separate <text>s would let the second line's halo erase the first
      // line's descenders. Each <tspan> restates `x` because without it a line
      // continues from where the previous one ended.
      const body =
        m.lines.length > 1
          ? m.lines
              .map(
                (line, i) =>
                  `<tspan x="${fmt(box.x)}"` +
                  (i > 0 ? ` dy="${fmt(m.lineGap)}"` : "") +
                  `>${esc(line)}</tspan>`,
              )
              .join("")
          : esc(m.lines[0]);
      labels.push(
        `<text x="${fmt(box.x)}" y="${fmt(box.y)}" text-anchor="${anchor}"` +
          ` font-size="${fmt(m.size)}" fill="${esc(theme.label)}"` +
          ` font-family="${esc(theme.fontFamily)}" pointer-events="none"` +
          ` paint-order="stroke" stroke="${esc(theme.background)}" stroke-width="${fmt(HALO * 2)}"` +
          `>${body}</text>`,
      );
    }
  }

  // Labels last and in their own group: they must paint over the pins, and a
  // consumer hiding or restyling every name at once should not have to reach
  // past the pins to do it.
  return (
    (parts.length ? `<g class="naksha-pins">${parts.join("")}</g>` : "") +
    (labels.length ? `<g class="naksha-labels">${labels.join("")}</g>` : "")
  );
}

/**
 * Where a viewport lands on this grid, in viewBox units, clipped to the frame —
 * or null when the two do not overlap at all.
 *
 * The geometry behind `RenderOptions.viewport`, exported because the React
 * wrapper draws its own elements rather than this module's strings, and because
 * a consumer styling the window themselves needs the same four numbers.
 */
export function viewportRect(
  grid: Grid,
  bbox: Bbox,
): { x: number; y: number; width: number; height: number } | null {
  const nw = project(grid, { lng: bbox.lo, lat: bbox.ha });
  const se = project(grid, { lng: bbox.hi, lat: bbox.la });
  const frame = grid.viewBox;
  const x0 = Math.max(frame.x, Math.min(nw.x, frame.x + frame.cols));
  const x1 = Math.max(frame.x, Math.min(se.x, frame.x + frame.cols));
  const y0 = Math.max(frame.y, Math.min(nw.y, frame.y + frame.rows));
  const y1 = Math.max(frame.y, Math.min(se.y, frame.y + frame.rows));
  // A viewport entirely outside the overview clips to zero width or height.
  // That would still emit a rectangle, which some renderers stroke as a line,
  // so it is reported as no overlap instead.
  if (!(x1 > x0) || !(y1 > y0)) return null;
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/**
 * The window rectangle an overview map draws for a detail view.
 *
 * Between the dots and the routes: it is a frame around the field, so it has
 * to sit over the dots — but a minimap carrying its own pins should still show
 * them on top, not behind the glass.
 */
function renderViewport(grid: Grid, theme: Theme, bbox: Bbox): string {
  const box = viewportRect(grid, bbox);
  if (!box) return "";
  return (
    `<rect class="naksha-viewport" x="${fmt(box.x)}" y="${fmt(box.y)}"` +
    ` width="${fmt(box.width)}" height="${fmt(box.height)}"` +
    (theme.viewportOpacity > 0
      ? ` fill="${esc(theme.viewport)}" fill-opacity="${fmt(theme.viewportOpacity)}"`
      : ` fill="none"`) +
    ` stroke="${esc(theme.viewport)}" stroke-width="${fmt(theme.viewportWidth)}"` +
    ` pointer-events="none"/>`
  );
}

/**
 * The inset layer, as a self-contained `<g>`.
 *
 * Exported because the React wrapper builds its own elements and cannot reuse
 * this module's strings wholesale — it injects this one group, exactly as it
 * does the dot field.
 *
 * Everything inside is expressed in the *inset's* own grid units and the
 * enclosing transform does the shrinking, so the panel, the dots and the window
 * are all described at their natural scale and only one number moves.
 *
 * `renderSvg` passes the map's own `regionColor` down as the default, which it
 * can do because it has both. Called directly there is no parent to inherit
 * from, so pass it here or the miniature comes out monochrome.
 */
export function renderInset(grid: Grid, theme: Theme, options: InsetOptions = {}): string {
  const bbox = options.bbox ?? grid.raster.bbox;
  const inner = buildGrid(grid.raster, { bbox, height: options.height ?? 12 });
  const size = options.size ?? 0.22;
  const margin = options.margin ?? 1;
  const corner = options.corner ?? "top-right";

  const frame = grid.viewBox;
  const width = frame.cols * size;
  const scale = width / inner.cols;
  const height = inner.rows * scale;
  // Padding is in the inner grid's units, so it stays proportional to the dots
  // it surrounds rather than to the map the inset happens to be sitting on.
  const pad = 0.6;
  const x =
    frame.x +
    (corner.endsWith("right") ? frame.cols - margin - width - pad * scale : margin + pad * scale);
  const y =
    frame.y +
    (corner.startsWith("bottom") ? frame.rows - margin - height - pad * scale : margin + pad * scale);

  // See `InsetOptions.theme` for why the fade goes.
  const insetTheme: Theme = { ...theme, edgeFade: 0, ...options.theme };
  const background = options.background ?? insetTheme.background;
  const panel =
    background && background !== "transparent"
      ? `<rect x="${fmt(-pad)}" y="${fmt(-pad)}" width="${fmt(inner.cols + pad * 2)}"` +
        ` height="${fmt(inner.rows + pad * 2)}" fill="${esc(background)}"` +
        ` stroke="${esc(insetTheme.dot)}" stroke-width="0.15" rx="${fmt(pad)}"/>`
      : "";

  // A window around the entire country marks nothing and tints the map it is
  // drawing, so it waits until this map is looking at less than the whole box.
  const zoomed =
    grid.bbox.hi - grid.bbox.lo < bbox.hi - bbox.lo - 1e-9 ||
    grid.bbox.ha - grid.bbox.la < bbox.ha - bbox.la - 1e-9;

  return (
    `<g class="naksha-inset" transform="translate(${fmt(x)} ${fmt(y)}) scale(${fmt(scale)})"` +
    ` pointer-events="none">` +
    panel +
    renderDots(inner, insetTheme, { regionColor: options.regionColor }) +
    (zoomed ? renderViewport(inner, insetTheme, grid.bbox) : "") +
    `</g>`
  );
}

/**
 * The dash properties live *inside* the keyframes, never in the base rule.
 *
 * A route styled `stroke-dashoffset:1` at rest is invisible wherever CSS
 * animation doesn't run — server-side rasterisers, print, PDF export. Keeping
 * the hidden state inside the animation means those renderers draw a complete,
 * static route instead of nothing at all.
 */
const ANIMATION_CSS = `
.naksha-reveal{animation:naksha-draw 1.8s ease-out both}
@keyframes naksha-draw{from{stroke-dasharray:1;stroke-dashoffset:1}to{stroke-dasharray:1;stroke-dashoffset:0}}
@media (prefers-reduced-motion:reduce){
.naksha-reveal{animation:none}
.naksha-pulse{display:none}
}`.trim();

/**
 * Render a grid to a standalone SVG string.
 *
 * Works identically in Node and the browser — nothing here touches the DOM,
 * `Image`, or canvas, so it is safe inside a React server component.
 */
export function renderSvg(grid: Grid, options: RenderOptions = {}): string {
  const theme = resolveTheme(options.theme);
  const prefix = options.idPrefix ?? "naksha-";
  const { clusters } = clusterPoints(grid, options.points ?? []);

  const attrs = [
    `xmlns="http://www.w3.org/2000/svg"`,
    // The window, not the sampled field: an aligned grid runs up to a dot past
    // each edge so the viewport can sit between dots, and those extra dots are
    // meant to be clipped rather than shown.
    `viewBox="${fmt(grid.viewBox.x)} ${fmt(grid.viewBox.y)} ${fmt(grid.viewBox.cols)} ${fmt(grid.viewBox.rows)}"`,
    options.width !== undefined ? `width="${esc(String(options.width))}"` : "",
    options.height !== undefined ? `height="${esc(String(options.height))}"` : "",
    `role="img"`,
    `aria-label="${esc(options.title ?? "Map of Nepal")}"`,
    `class="naksha"`,
  ]
    .filter(Boolean)
    .join(" ");

  const background =
    theme.background && theme.background !== "transparent"
      ? `<rect x="${fmt(grid.viewBox.x)}" y="${fmt(grid.viewBox.y)}"` +
        ` width="${fmt(grid.viewBox.cols)}" height="${fmt(grid.viewBox.rows)}"` +
        ` fill="${esc(theme.background)}"/>`
      : "";

  return (
    `<svg ${attrs}>` +
    (options.title ? `<title>${esc(options.title)}</title>` : "") +
    (options.animate ? `<style>${ANIMATION_CSS}</style>` : "") +
    background +
    renderDots(grid, theme, options) +
    (options.viewport ? renderViewport(grid, theme, options.viewport) : "") +
    renderRoutes(grid, theme, options, prefix) +
    renderPins(grid, theme, options, clusters) +
    // Last, because an inset is an overlay: it has to sit over the field, the
    // routes and the pins it is summarising.
    (options.inset
      ? renderInset(grid, theme, {
          // The map's own colouring is the default, so the miniature is
          // recognisably the same map; an explicit one in `inset` wins.
          regionColor: options.regionColor,
          ...(options.inset === true ? {} : options.inset),
        })
      : "") +
    `</svg>`
  );
}
