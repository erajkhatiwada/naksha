/**
 * Named viewports.
 *
 * A viewport in naksha is a bounding box, not a scale factor: each one
 * re-samples its own box at the same dot budget, so the dot count, render cost
 * and look stay constant while the ground resolution changes.
 *
 * **Every view here contains a border**, which is what makes it read as a map.
 * A box drawn entirely inside Nepal has no boundary in it, so every cell is
 * inside and the silhouette is a filled rectangle — measured, the Kathmandu
 * Valley at this dot budget is 100.0% full with zero edge dots. That is why no
 * valley or city view is named here.
 *
 * `bbox` itself stays unrestricted, and a box that tight is still useful for
 * one thing: separating your own points. 250 pickups around Kathmandu occupy 4
 * dots nationally and 221 across the valley. Reach for it when the pins are the
 * subject and the dots are texture — just don't expect a recognisable Nepal
 * behind them.
 */
import type { Bbox } from "./geo.ts";
import { NEPAL_BBOX } from "./geo.ts";

export const VIEWS = {
  /** The whole country. ~11 km/dot: all 77 districts resolve. */
  nepal: NEPAL_BBOX,

  /** The seven provinces. ~4-6 km/dot: 16-31 districts resolve in each. */
  province1: { lo: 86.5, hi: 88.21, la: 26.35, ha: 28.15 },
  madhesh: { lo: 84.8, hi: 87.05, la: 26.35, ha: 27.35 },
  bagmati: { lo: 84.4, hi: 86.4, la: 27.0, ha: 28.4 },
  gandaki: { lo: 82.85, hi: 85.2, la: 27.6, ha: 29.35 },
  lumbini: { lo: 81.6, hi: 84.2, la: 27.35, ha: 29.2 },
  karnali: { lo: 81.0, hi: 83.7, la: 28.3, ha: 30.45 },
  sudurpashchim: { lo: 80.05, hi: 81.8, la: 28.35, ha: 30.48 },
} as const satisfies Record<string, Bbox>;

export type ViewName = keyof typeof VIEWS;
