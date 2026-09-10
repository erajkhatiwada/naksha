/**
 * Pointer and keyboard interaction.
 *
 * The dot field collapses to one `<path>` per colour, so there is no per-dot
 * element to hang a listener on. Giving that up is expensive — `dots:
 * "circles"` costs ~1130 nodes instead of ~2 — so region hits are resolved
 * *geometrically* instead: the viewBox is `0 0 cols rows`, so the cell under
 * the pointer is exactly `floor(x), floor(y)` and one Map lookup answers which
 * dot, and therefore which district, is there. Hit-testing is O(1) and the DOM
 * stays as small as it was without interaction.
 *
 * Pins and routes *are* real elements, so those resolve by delegation off the
 * event target and take priority over whatever dot sits beneath them.
 *
 * Nothing here runs at import time or touches a global `document` — the module
 * is safe to import from a server bundle; only `attachInteractions` needs a DOM,
 * and it takes the element it works on.
 */
import type { Dot, Grid } from "./grid.ts";
import { dotIndex, isInsideGrid } from "./grid.ts";
import type { Cluster, MapPoint } from "./cluster.ts";
import { clusterPoints } from "./cluster.ts";
import type { Route } from "./route.ts";
import { fmt } from "./route.ts";
import { circleSubpath } from "./svg.ts";

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * The dot at a point in **viewBox coordinates**, or undefined for a miss.
 *
 * Pure and DOM-free: `attachInteractions` converts screen coordinates and calls
 * this, but so can any consumer that already has viewBox coordinates.
 *
 * A cell is one unit across and a dot owns its whole cell, so there are no dead
 * zones between dots — unlike `:hover` on a 0.3-unit circle. `tolerance`, in
 * dot units, widens the search to neighbouring cells for touch input; at 0
 * (the default) a point outside Nepal reports no hit at all.
 */
export function hitTest(grid: Grid, x: number, y: number, tolerance = 0): Dot | undefined {
  const col = Math.floor(x);
  const row = Math.floor(y);
  const index = dotIndex(grid);

  // The bounds check is load-bearing, not defensive: `row * cols + col` with a
  // negative or overflowing col aliases onto a real cell in the adjacent row.
  if (isInsideGrid(grid, col, row)) {
    const exact = index.get(row * grid.cols + col);
    if (exact) return exact;
  }
  if (!(tolerance > 0)) return undefined;

  // Ties are common — the four cells orthogonally adjacent to an empty one are
  // all exactly one unit away — so the comparison is strict and the scan order
  // (north-west first) settles them. Otherwise which district a border touch
  // reports would depend on loop order, and change under an unrelated edit.
  const reach = Math.ceil(tolerance);
  let best: Dot | undefined;
  let bestD2 = Infinity;
  for (let r = row - reach; r <= row + reach; r++) {
    for (let c = col - reach; c <= col + reach; c++) {
      if (!isInsideGrid(grid, c, r)) continue;
      const dot = index.get(r * grid.cols + c);
      if (!dot) continue;
      const dx = c + 0.5 - x;
      const dy = r + 0.5 - y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = dot;
      }
    }
  }
  return bestD2 <= tolerance * tolerance ? best : undefined;
}

export type HitKind = "region" | "point" | "route";

export interface HighlightOptions {
  /**
   * `region` (default) lights every dot of the hovered district — the useful
   * answer to "what am I pointing at". `dot` lights only the one dot.
   */
  mode?: "region" | "dot";
  /** Default `currentColor`, so CSS on the `<svg>` can drive it. */
  color?: string;
  /** Dot radius in dot units. Slightly above the theme's 0.3 so it reads as a lift. */
  radius?: number;
  opacity?: number;
}

export interface InteractionOptions<T extends MapPoint = MapPoint> {
  /** The same points passed to the renderer, so pin hits resolve to clusters. */
  points?: readonly T[];
  /** The same routes passed to the renderer, so route hits resolve. */
  routes?: readonly Route[];
  /** Widen region hit-testing by this many dot units. Useful for touch. */
  tolerance?: number;
  /** Paint the hovered district. `true` accepts every default. */
  highlight?: boolean | HighlightOptions;
  /**
   * Make the map focusable and traversable with the arrow keys, Enter and
   * Escape. Pair it with an `aria-live` readout fed from `onRegionEnter` —
   * this cannot announce for you, because only the consumer knows what the
   * region means in their app.
   */
  keyboard?: boolean;
  /** Cursor while over something clickable. `false` leaves the cursor alone. */
  cursor?: string | false;

  onRegionEnter?: (dot: Dot, event: Event) => void;
  onRegionLeave?: (event: Event) => void;
  onRegionClick?: (dot: Dot, event: Event) => void;
  /**
   * The dot under the pointer changed.
   *
   * Unlike `onRegionEnter`, this fires *within* a district too, so `dot` is
   * always the one being pointed at. That is the difference that matters if you
   * read anything per-dot off it — `dot.lng` / `dot.lat` especially, since
   * `onRegionEnter` hands you whichever dot you crossed the border on and then
   * stays quiet for the rest of the district.
   *
   * It is the callback that matches `highlight: { mode: "dot" }`: both change on
   * every dot.
   */
  onDotEnter?: (dot: Dot, event: Event) => void;
  /** The pointer left the dot it was on, for any reason — including onto a pin. */
  onDotLeave?: (event: Event) => void;
  onPointEnter?: (cluster: Cluster<T>, event: Event) => void;
  onPointLeave?: (event: Event) => void;
  onPointClick?: (cluster: Cluster<T>, event: Event) => void;
  onRouteEnter?: (route: Route, index: number, event: Event) => void;
  onRouteLeave?: (event: Event) => void;
  onRouteClick?: (route: Route, index: number, event: Event) => void;
}

interface Hit<T extends MapPoint> {
  kind: HitKind;
  /** Identity for enter/leave bookkeeping. Regions key on the district, not the
   *  dot, so sweeping across one district fires `onRegionEnter` exactly once —
   *  which also means its `dot` is the one the border was crossed on. Use
   *  `onDotEnter` for the dot actually under the pointer. */
  key: string;
  dot?: Dot;
  cluster?: Cluster<T>;
  route?: Route;
  index?: number;
}

const ARROWS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

/**
 * Wire hover, click and (optionally) keyboard interaction onto a rendered map.
 *
 * Works with the default `dots: "path"` output — interaction does not cost you
 * the collapsed dot field.
 *
 * ```ts
 * const detach = attachInteractions(svg, grid, {
 *   points,
 *   highlight: true,
 *   onRegionEnter: (dot) => show(districtById(dot.region)),
 *   onPointClick: (cluster) => open(cluster.points),
 * });
 * ```
 *
 * @returns a function that removes every listener and the highlight overlay.
 */
export function attachInteractions<T extends MapPoint = MapPoint>(
  svg: SVGSVGElement,
  grid: Grid,
  options: InteractionOptions<T> = {},
): () => void {
  const { points, routes, tolerance = 0, keyboard = false, cursor = "pointer" } = options;

  const clusters = new Map<string, Cluster<T>>();
  if (points?.length) {
    for (const c of clusterPoints(grid, points).clusters) clusters.set(`${c.col},${c.row}`, c);
  }

  // ------------------------------------------------------------ highlight ---

  const hl: HighlightOptions | null =
    options.highlight === true ? {} : options.highlight === undefined || options.highlight === false
      ? null
      : options.highlight;
  const hlRadius = hl?.radius ?? 0.34;
  const overlay = hl ? createOverlay(svg, hl) : null;
  const regionPaths = new Map<number, string>();

  function regionPath(region: number): string {
    let d = regionPaths.get(region);
    if (d === undefined) {
      const parts: string[] = [];
      for (const dot of grid.dots) {
        if (dot.region === region) parts.push(circleSubpath(dot.col + 0.5, dot.row + 0.5, hlRadius));
      }
      regionPaths.set(region, (d = parts.join("")));
    }
    return d;
  }

  function paint(dot: Dot | null): void {
    if (!overlay) return;
    if (!dot) {
      overlay.setAttribute("d", "");
      return;
    }
    overlay.setAttribute(
      "d",
      hl!.mode === "dot"
        ? circleSubpath(dot.col + 0.5, dot.row + 0.5, hlRadius)
        : regionPath(dot.region),
    );
  }

  // -------------------------------------------------------------- hit test ---

  /**
   * `getScreenCTM` already accounts for the viewBox, `preserveAspectRatio`,
   * CSS transforms and page scroll. Reimplementing that arithmetic works right
   * up until a consumer scales the map or sets its own aspect handling.
   */
  function toViewBox(e: MouseEvent): { x: number; y: number } | null {
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    if (typeof DOMPoint === "function") {
      const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
      return { x: p.x, y: p.y };
    }
    const p = svg.createSVGPoint();
    p.x = e.clientX;
    p.y = e.clientY;
    const t = p.matrixTransform(ctm.inverse());
    return { x: t.x, y: t.y };
  }

  /**
   * Pin, then route, then the dot underneath.
   *
   * A pin or route element wins even when its data can't be resolved — the
   * caller may be drawing those itself (the React wrapper does) and a region
   * event fired from under a pin would be wrong either way.
   */
  function resolve(e: MouseEvent): Hit<T> | null {
    const el = e.target instanceof Element ? e.target : null;

    const pin = el?.closest?.("[data-cluster]");
    if (pin) {
      const key = pin.getAttribute("data-cluster") ?? "";
      return { kind: "point", key: `point:${key}`, cluster: clusters.get(key) };
    }

    const route = el?.closest?.("[data-route-index]");
    if (route) {
      const index = Number(route.getAttribute("data-route-index"));
      return { kind: "route", key: `route:${index}`, index, route: routes?.[index] };
    }

    const at = toViewBox(e);
    if (!at) return null;
    const dot = hitTest(grid, at.x, at.y, tolerance);
    return dot ? { kind: "region", key: `region:${dot.region}`, dot } : null;
  }

  // ---------------------------------------------------------------- state ---

  let current: Hit<T> | null = null;
  /** The dot under the pointer, tracked separately from `current` because it
   *  changes more often — `current` keys regions on the district. */
  let currentDot: string | null = null;
  /** Where arrow-key traversal continues from, independent of hover keying. */
  let caret: { col: number; row: number } | null = null;
  const priorCursor = svg.style.cursor;

  function clickable(hit: Hit<T> | null): boolean {
    if (!hit) return false;
    if (hit.kind === "region") return !!options.onRegionClick;
    if (hit.kind === "point") return !!options.onPointClick && !!hit.cluster;
    return !!options.onRouteClick && !!hit.route;
  }

  function update(hit: Hit<T> | null, event: Event): void {
    // Painted first: in `dot` mode the overlay moves on every dot, and must not
    // wait on the region bookkeeping, which is coarser.
    paint(hit?.kind === "region" ? hit.dot! : null);

    // Two independent identities, because they change at different rates: the
    // dot moves cell by cell, the hit only when the district (or pin, or route)
    // under the pointer changes. Gating both on the coarser one would freeze
    // `onDotEnter` for the rest of a district — and with it anything a consumer
    // reads off that dot, such as its coordinate.
    const dot = hit?.kind === "region" ? `${hit.dot!.col},${hit.dot!.row}` : null;
    const dotMoved = dot !== currentDot;
    const hitMoved = (hit?.key ?? null) !== (current?.key ?? null);
    if (!dotMoved && !hitMoved) return;

    const prev = current;
    const prevDot = currentDot;
    current = hit;
    currentDot = dot;

    // Every leave before every enter, so a consumer that writes both sets of
    // callbacks into one slot ends on what the pointer is over, not what it left.
    if (hitMoved) {
      if (prev?.kind === "region") options.onRegionLeave?.(event);
      else if (prev?.kind === "point") options.onPointLeave?.(event);
      else if (prev?.kind === "route") options.onRouteLeave?.(event);
    }
    if (dotMoved && prevDot !== null) options.onDotLeave?.(event);

    if (dotMoved && hit?.kind === "region") options.onDotEnter?.(hit.dot!, event);
    if (hitMoved) {
      if (hit?.kind === "region") options.onRegionEnter?.(hit.dot!, event);
      else if (hit?.kind === "point" && hit.cluster) options.onPointEnter?.(hit.cluster, event);
      else if (hit?.kind === "route" && hit.route) options.onRouteEnter?.(hit.route, hit.index!, event);
    }

    if (cursor !== false) svg.style.cursor = clickable(hit) ? cursor : priorCursor;
  }

  // -------------------------------------------------------------- pointer ---

  const onMove = (e: PointerEvent) => update(resolve(e), e);
  // Touch has no hover: a tap should still light up what it landed on.
  const onDown = (e: PointerEvent) => update(resolve(e), e);
  const onOut = (e: Event) => {
    caret = null;
    update(null, e);
  };

  const onClick = (e: MouseEvent) => {
    // Resolved fresh rather than reusing `current`: a tap can arrive with no
    // preceding move at all.
    const hit = resolve(e);
    if (!hit) return;
    if (hit.kind === "region") options.onRegionClick?.(hit.dot!, e);
    else if (hit.kind === "point" && hit.cluster) options.onPointClick?.(hit.cluster, e);
    else if (hit.kind === "route" && hit.route) options.onRouteClick?.(hit.route, hit.index!, e);
  };

  svg.addEventListener("pointermove", onMove);
  svg.addEventListener("pointerdown", onDown);
  svg.addEventListener("pointerleave", onOut);
  svg.addEventListener("pointercancel", onOut);
  svg.addEventListener("click", onClick);

  // ------------------------------------------------------------- keyboard ---

  /** The next dot along `[dc, dr]`, skipping cells that hold no dot. */
  function step(from: { col: number; row: number } | null, [dc, dr]: [number, number]): Dot | undefined {
    if (!from) return grid.dots[0];
    const index = dotIndex(grid);
    let { col, row } = from;
    for (let i = 0; i < Math.max(grid.cols, grid.rows); i++) {
      col += dc;
      row += dr;
      if (!isInsideGrid(grid, col, row)) return undefined;
      const dot = index.get(row * grid.cols + col);
      if (dot) return dot;
    }
    return undefined;
  }

  const onKeyDown = (e: KeyboardEvent) => {
    const dir = ARROWS[e.key];
    if (dir) {
      e.preventDefault(); // otherwise the page scrolls under the map
      const next = step(caret ?? (current?.dot ? { col: current.dot.col, row: current.dot.row } : null), dir);
      if (!next) return;
      caret = { col: next.col, row: next.row };
      update({ kind: "region", key: `region:${next.region}`, dot: next }, e);
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      if (current?.kind === "region" && current.dot) {
        e.preventDefault();
        options.onRegionClick?.(current.dot, e);
      }
      return;
    }
    if (e.key === "Escape") onOut(e);
  };

  const priorTabIndex = svg.getAttribute("tabindex");
  const priorRole = svg.getAttribute("role");
  if (keyboard) {
    svg.setAttribute("tabindex", "0");
    // role="img" declares the subtree presentational, which is honest for a
    // static map and wrong for one you can walk through.
    if (priorRole === "img") svg.setAttribute("role", "group");
    svg.addEventListener("keydown", onKeyDown);
    svg.addEventListener("blur", onOut);
  }

  // ---------------------------------------------------------------- detach ---

  return () => {
    svg.removeEventListener("pointermove", onMove);
    svg.removeEventListener("pointerdown", onDown);
    svg.removeEventListener("pointerleave", onOut);
    svg.removeEventListener("pointercancel", onOut);
    svg.removeEventListener("click", onClick);
    if (keyboard) {
      svg.removeEventListener("keydown", onKeyDown);
      svg.removeEventListener("blur", onOut);
      if (priorTabIndex === null) svg.removeAttribute("tabindex");
      else svg.setAttribute("tabindex", priorTabIndex);
      if (priorRole === null) svg.removeAttribute("role");
      else svg.setAttribute("role", priorRole);
    }
    overlay?.remove();
    if (cursor !== false) svg.style.cursor = priorCursor;
    current = null;
    currentDot = null;
  };
}

/**
 * The highlight layer: one `<path>`, inserted directly above the dot field so
 * routes and pins still paint over it.
 *
 * Placed as a direct child of the `<svg>`, not merely next to `.naksha-dots`.
 * The dot field can be *wrapped* — the React component injects it through
 * `dangerouslySetInnerHTML` on a `<g>` of its own — and a node added inside
 * that wrapper is a node React did not put there, so the next re-render
 * removes it and the highlight silently stops painting. Climbing to the
 * `<svg>`'s own child keeps the layer order and puts the overlay somewhere no
 * framework is reconciling.
 */
function createOverlay(svg: SVGSVGElement, options: HighlightOptions): SVGPathElement {
  const el = svg.ownerDocument.createElementNS(SVG_NS, "path");
  el.setAttribute("class", "naksha-highlight");
  el.setAttribute("fill", options.color ?? "currentColor");
  if (options.opacity !== undefined) el.setAttribute("opacity", fmt(options.opacity));
  el.setAttribute("pointer-events", "none");

  let anchor: Element | null = svg.querySelector(".naksha-dots");
  while (anchor && anchor.parentNode !== svg) anchor = anchor.parentElement;
  if (anchor) svg.insertBefore(el, anchor.nextSibling);
  else svg.appendChild(el);
  return el;
}
