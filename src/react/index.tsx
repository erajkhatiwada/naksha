/**
 * React wrapper.
 *
 * Deliberately thin: all the work happens in the framework-agnostic core, and
 * React is an optional peer dependency. The static dot field is injected once
 * and memoised — ~1200 dots collapse to a couple of nodes — while routes and
 * pins are real React elements so they carry real event handlers.
 *
 * Region and dot events come from `attachInteractions`, which hit-tests
 * geometrically. That is why the dot field stays collapsed even when
 * `onRegionClick` or `onDotEnter` is set: an earlier version switched to
 * `dots: "circles"` so there was something to click, and paid ~1130 DOM nodes
 * for it.
 */
import { useEffect, useMemo, useRef, type CSSProperties, type ReactNode } from "react";

import type { GridOptions, Grid, Dot } from "../grid.ts";
import { buildGrid } from "../grid.ts";
import type { RenderOptions } from "../svg.ts";
import { renderDotField, labelLines, viewportRect, renderInset } from "../svg.ts";
import type { InsetOptions } from "../svg.ts";
import type { Bbox } from "../geo.ts";
import type { HighlightOptions } from "../interact.ts";
import { attachInteractions } from "../interact.ts";
import { resolveTheme, type Theme } from "../theme.ts";
import { routePath, fmt, type Route } from "../route.ts";
import { clusterPoints, type Cluster, type MapPoint } from "../cluster.ts";
import { nepalRaster, districtById } from "../index.ts";
import type { Region } from "../raster.ts";
import type { RegionRaster } from "../raster.ts";
import type { Lang } from "../i18n.ts";
import { pickLabel, bothLabels } from "../i18n.ts";

export interface NakshaProps extends GridOptions {
  /** Defaults to Nepal's 77 districts. */
  raster?: RegionRaster;
  theme?: Partial<Theme>;
  /**
   * Draw a rectangle showing where another viewport is looking — see
   * `RenderOptions.viewport`. Pass the detail map's `bbox` to an overview map
   * rendered over a wider one.
   */
  viewport?: Bbox;
  /**
   * Inset a miniature of the whole country into a corner of this map — see
   * `RenderOptions.inset`. `true` accepts every default.
   */
  inset?: boolean | InsetOptions;
  routes?: readonly Route[];
  points?: readonly MapPoint[];
  regionColor?: (regionId: number) => string | undefined;
  arc?: RenderOptions["arc"];
  /** Draw stop labels above their pins. Newlines in a label stack it. */
  labels?: boolean;
  /** Language for drawn labels (default "en"). Titles always carry both. */
  lang?: Lang;
  clusterCounts?: boolean;
  animate?: boolean;
  /** Accessible name. Always provide something meaningful. */
  title?: string;
  className?: string;
  style?: CSSProperties;

  /**
   * Fires once when the pointer moves into a district, not once per dot — a
   * readout bound to this updates when the answer changes, not 40 times as you
   * sweep across Dolpa.
   *
   * Which also means its `dot` is whichever one the border was crossed on. For
   * the dot actually under the pointer, use `onDotEnter`.
   */
  onRegionEnter?: (region: Region | undefined, id: number, dot: Dot) => void;
  onRegionLeave?: () => void;
  onRegionClick?: (region: Region | undefined, id: number, dot: Dot) => void;
  /**
   * Fires every time the dot under the pointer changes, including within one
   * district — the granularity to bind a coordinate readout to, and the one that
   * matches `highlight={{ mode: "dot" }}`.
   *
   * The district is `districtById(dot.region)`, left to the caller so this stays
   * about the dot.
   */
  onDotEnter?: (dot: Dot) => void;
  /** The pointer left the dot it was on — including onto a pin, which wins. */
  onDotLeave?: () => void;
  onPointEnter?: (cluster: Cluster) => void;
  onPointLeave?: () => void;
  onPointClick?: (cluster: Cluster) => void;
  onRouteEnter?: (route: Route, index: number) => void;
  onRouteLeave?: () => void;
  onRouteClick?: (route: Route, index: number) => void;

  /** Paint the hovered district. `true` accepts every default. */
  highlight?: boolean | HighlightOptions;
  /** Widen region hit-testing by this many dot units. Useful for touch. */
  hitTolerance?: number;
  /**
   * Make the map focusable and traversable with the arrow keys, Enter and
   * Escape. Pair it with an `aria-live` readout fed from `onRegionEnter`.
   */
  keyboard?: boolean;

  /** Extra SVG content drawn above the map — legends, annotations. */
  children?: ReactNode;
}

export function Naksha({
  raster,
  theme: themeInput,
  routes = [],
  points = [],
  regionColor,
  arc,
  labels,
  lang = "en",
  clusterCounts = true,
  animate,
  title = "Map of Nepal",
  className,
  style,
  onRegionEnter,
  onRegionLeave,
  onRegionClick,
  onDotEnter,
  onDotLeave,
  onPointEnter,
  onPointLeave,
  onPointClick,
  onRouteEnter,
  onRouteLeave,
  onRouteClick,
  highlight,
  hitTolerance = 0,
  keyboard = false,
  children,
  height,
  bbox,
  sampling,
  coverage,
  ensureRegions,
  viewport,
  inset,
}: NakshaProps) {
  const theme = useMemo(() => resolveTheme(themeInput), [themeInput]);
  const activeRaster = raster ?? nepalRaster();

  const grid: Grid = useMemo(
    () => buildGrid(activeRaster, { height, bbox, sampling, coverage, ensureRegions }),
    [activeRaster, height, bbox, sampling, coverage, ensureRegions],
  );

  // The expensive, static layer. Rebuilt only when the grid or its colours
  // change — not when a route is hovered or a pin is selected.
  const dotField = useMemo(
    () => renderDotField(grid, theme, { regionColor }),
    [grid, theme, regionColor],
  );

  const clusters = useMemo(() => clusterPoints(grid, points).clusters, [grid, points]);

  // A whole second grid, so it is memoised like the dot field rather than
  // rebuilt whenever a pin is hovered. Serialised because the common call
  // passes an object literal, which is a new identity on every render.
  const insetKey = JSON.stringify(inset ?? null);
  const insetLayer = useMemo(
    () => (inset ? renderInset(grid, theme, inset === true ? {} : inset) : ""),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [grid, theme, insetKey],
  );

  const svgRef = useRef<SVGSVGElement>(null);

  // Handlers are read through a ref so an inline arrow function — which is what
  // every caller writes — doesn't tear down and re-attach the listeners on
  // every render. Only *whether* a handler exists is a dependency.
  const latest = useRef({
    onRegionEnter,
    onRegionLeave,
    onRegionClick,
    onDotEnter,
    onDotLeave,
  });
  latest.current = { onRegionEnter, onRegionLeave, onRegionClick, onDotEnter, onDotLeave };

  const wantsEnter = !!onRegionEnter;
  const wantsLeave = !!onRegionLeave;
  const wantsClick = !!onRegionClick;
  const wantsDotEnter = !!onDotEnter;
  const wantsDotLeave = !!onDotLeave;
  const highlightKey = JSON.stringify(highlight ?? null);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    if (!wantsEnter && !wantsLeave && !wantsClick && !wantsDotEnter && !wantsDotLeave && !highlight)
      return;

    return attachInteractions(svg, grid, {
      highlight,
      keyboard,
      tolerance: hitTolerance,
      // Pins and routes are React elements here, with React handlers. They are
      // still recognised by their data attributes, which is what stops a region
      // event firing for the dot underneath a pin.
      onRegionEnter: wantsEnter
        ? (dot) => latest.current.onRegionEnter?.(districtById(dot.region), dot.region, dot)
        : undefined,
      onRegionLeave: wantsLeave ? () => latest.current.onRegionLeave?.() : undefined,
      onRegionClick: wantsClick
        ? (dot) => latest.current.onRegionClick?.(districtById(dot.region), dot.region, dot)
        : undefined,
      onDotEnter: wantsDotEnter ? (dot) => latest.current.onDotEnter?.(dot) : undefined,
      onDotLeave: wantsDotLeave ? () => latest.current.onDotLeave?.() : undefined,
    });
    // highlightKey stands in for `highlight`, which is usually a fresh object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    grid,
    wantsEnter,
    wantsLeave,
    wantsClick,
    wantsDotEnter,
    wantsDotLeave,
    highlightKey,
    keyboard,
    hitTolerance,
  ]);

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${grid.cols} ${grid.rows}`}
      role="img"
      aria-label={title}
      className={className ? `naksha ${className}` : "naksha"}
      style={style}
    >
      <title>{title}</title>
      {animate && <style>{REVEAL_CSS}</style>}

      {theme.background !== "transparent" && (
        <rect width={grid.cols} height={grid.rows} fill={theme.background} />
      )}

      <g dangerouslySetInnerHTML={{ __html: dotField }} />

      {/* Over the dots and under the routes, exactly where `renderSvg` puts it,
          so the two renderers stack the same layers in the same order. */}
      {viewport &&
        (() => {
          const box = viewportRect(grid, viewport);
          if (!box) return null;
          return (
            <rect
              className="naksha-viewport"
              x={box.x}
              y={box.y}
              width={box.width}
              height={box.height}
              fill={theme.viewportOpacity > 0 ? theme.viewport : "none"}
              fillOpacity={theme.viewportOpacity > 0 ? theme.viewportOpacity : undefined}
              stroke={theme.viewport}
              strokeWidth={theme.viewportWidth}
              pointerEvents="none"
            />
          );
        })()}

      <g className="naksha-routes">
        {routes.map((route, i) => {
          const d = routePath(grid, route, arc);
          if (!d) return null;
          const stroke = route.color ?? theme.route;
          return (
            <path
              key={route.id ?? i}
              d={d}
              fill="none"
              stroke={stroke}
              strokeWidth={route.width ?? theme.routeWidth * (route.weight ?? 1)}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={theme.routeOpacity}
              className={animate ? "naksha-route naksha-reveal" : "naksha-route"}
              pathLength={animate ? 1 : undefined}
              data-route-index={i}
              onClick={onRouteClick ? () => onRouteClick(route, i) : undefined}
              onMouseEnter={onRouteEnter ? () => onRouteEnter(route, i) : undefined}
              onMouseLeave={onRouteLeave ? () => onRouteLeave() : undefined}
              style={onRouteClick ? { cursor: "pointer" } : undefined}
            >
              {route.label && <title>{route.label}</title>}
            </path>
          );
        })}
      </g>

      <g className="naksha-pins">
        {clusters.map((c) => {
          const multiple = c.points.length > 1;
          const r = multiple ? theme.pinRadius * 1.5 : theme.pinRadius;
          // Stacked labels grow upward, exactly as `renderSvg` places them, so
          // the bottom line stays where a one-line label would have sat.
          const lines = multiple ? [] : labelLines(pickLabel(c.points[0] ?? {}, lang) ?? "");
          const lineGap = theme.labelSize * theme.labelLineHeight;
          return (
            <g
              key={`${c.col},${c.row}`}
              data-cluster={`${c.col},${c.row}`}
              onClick={onPointClick ? () => onPointClick(c) : undefined}
              onMouseEnter={onPointEnter ? () => onPointEnter(c) : undefined}
              onMouseLeave={onPointLeave ? () => onPointLeave() : undefined}
              style={onPointClick ? { cursor: "pointer" } : undefined}
            >
              {theme.pinHaloWidth > 0 && (
                <circle
                  className="naksha-pin-halo"
                  cx={c.x}
                  cy={c.y}
                  r={r + theme.pinHaloWidth / 2}
                  fill={theme.pinHalo}
                />
              )}
              <circle className="naksha-pin" cx={c.x} cy={c.y} r={r} fill={multiple ? theme.cluster : theme.pin}>
                {/* Both scripts reach assistive tech regardless of `lang`. */}
                <title>
                  {multiple
                    ? `${c.points.length} stops`
                    : (bothLabels(c.points[0] ?? {}) ?? "")}
                </title>
              </circle>
              {multiple && clusterCounts && (
                <text
                  x={c.x}
                  y={c.y}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={fmt(r * 1.1)}
                  fontWeight={600}
                  fill={theme.clusterLabel}
                  fontFamily={theme.fontFamily}
                  pointerEvents="none"
                >
                  {c.points.length}
                </text>
              )}
              {labels && lines.length > 0 && (
                <text
                  x={c.x}
                  y={c.y - r - 0.35 - (lines.length - 1) * lineGap}
                  textAnchor="middle"
                  fontSize={theme.labelSize}
                  fill={theme.label}
                  fontFamily={theme.fontFamily}
                  pointerEvents="none"
                  paintOrder="stroke"
                  stroke={theme.background}
                  strokeWidth={0.25}
                >
                  {/* One <text>, so every halo paints before every glyph and no
                      line erases the descenders of the one above it. */}
                  {lines.length > 1
                    ? lines.map((line, i) => (
                        <tspan key={i} x={c.x} dy={i > 0 ? lineGap : undefined}>
                          {line}
                        </tspan>
                      ))
                    : lines[0]}
                </text>
              )}
            </g>
          );
        })}
      </g>

      {children}

      {/* Last, as in `renderSvg`: an inset overlays the field, the routes and
          the pins it summarises. */}
      {insetLayer && <g dangerouslySetInnerHTML={{ __html: insetLayer }} />}
    </svg>
  );
}

const REVEAL_CSS = `
.naksha-reveal{animation:naksha-draw 1.8s ease-out both}
@keyframes naksha-draw{from{stroke-dasharray:1;stroke-dashoffset:1}to{stroke-dasharray:1;stroke-dashoffset:0}}
@media (prefers-reduced-motion:reduce){.naksha-reveal{animation:none}}
`.trim();

export type { Region, Cluster, MapPoint, Route, Theme, Lang, Dot, HighlightOptions };
