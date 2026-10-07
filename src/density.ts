/**
 * Point density: shading dots by how many points land on each.
 *
 * Clustering read as a quantity rather than drawn as pins (spec §8). Points are
 * snapped exactly as `clusterPoints` snaps them, so a point counts toward the
 * dot of the district it is actually in, and zoom declusters a density map the
 * same way it declusters pins: the same points spread over finer dots.
 */
import type { Grid } from "./grid.ts";
import { dotIndex, isInsideGrid } from "./grid.ts";
import type { MapPoint } from "./cluster.ts";
import { clusterPoints } from "./cluster.ts";
import { stepColor } from "./scale.ts";

export interface DensityOptions<T extends MapPoint = MapPoint> {
  /** Points to count. A point's `weight` counts as that many (default 1). */
  points: readonly T[];
  /**
   * Spread each point over the dots around it, as a Gaussian this many dot
   * spacings wide. Default 0: exact counts.
   *
   * Off by default because it changes what a coloured dot claims. Unspread,
   * every shaded dot holds at least one point; spread, a dot can be shaded for
   * points that are all on its neighbours. That reads better as a heatmap and
   * worse as a record, and only the caller knows which they are drawing.
   */
  spread?: number;
  /** Add a legend for the shading, with this title. */
  legend?: string;
}

export interface DensityField {
  /** Value per dot, keyed like `dotIndex` (`row * cols + col`). Dots with none are absent. */
  values: Map<number, number>;
  /** Smallest and largest value present; both 0 when no point landed on a dot. */
  min: number;
  max: number;
}

/**
 * How much of each point lands on every dot.
 *
 * Points that snap to a cell with no dot — out past the border, or offscreen —
 * shade nothing: there is no dot to carry them, and drawing one would invent
 * part of the country.
 */
export function densityField(grid: Grid, options: DensityOptions): DensityField {
  const index = dotIndex(grid);
  const values = new Map<number, number>();
  const spread = options.spread && options.spread > 0 ? options.spread : 0;
  const add = (col: number, row: number, v: number) => {
    if (!isInsideGrid(grid, col, row)) return;
    const key = row * grid.cols + col;
    if (index.has(key)) values.set(key, (values.get(key) ?? 0) + v);
  };

  const { clusters } = clusterPoints(grid, options.points);
  if (!spread) {
    for (const c of clusters) add(c.col, c.row, c.count);
  } else {
    // Normalised over the whole window, so a point in open country deposits
    // exactly its weight and the values stay "points per dot". Near the border
    // the share that falls on empty cells is lost rather than piled back onto
    // the dots that remain.
    //
    // Cut off at two widths, and round rather than square, so an isolated
    // point shades a disc and not a box.
    const reach = Math.ceil(spread * 2);
    const kernel: [number, number, number][] = [];
    let total = 0;
    for (let dr = -reach; dr <= reach; dr++) {
      for (let dc = -reach; dc <= reach; dc++) {
        const d2 = dc * dc + dr * dr;
        if (d2 > (spread * 2) ** 2) continue;
        const w = Math.exp(-d2 / (2 * spread * spread));
        kernel.push([dc, dr, w]);
        total += w;
      }
    }
    for (const c of clusters) {
      for (const [dc, dr, w] of kernel) add(c.col + dc, c.row + dr, (c.count * w) / total);
    }
  }

  let min = Infinity;
  let max = 0;
  for (const [key, v] of values) {
    if (!(v > 0)) {
      values.delete(key);
      continue;
    }
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { values, min: values.size ? min : 0, max };
}

/**
 * The colour for one dot's value: `ramp`, on a log scale from the field's
 * smallest value to its largest.
 *
 * Log because points pile up where people do. A few dots hold most of them, and
 * on a linear ramp everything else would sit at the palest step.
 */
export function densityColor(field: DensityField, ramp: readonly string[], value: number): string {
  const { min, max } = field;
  const t = max === min ? 1 : (Math.log1p(value) - Math.log1p(min)) / (Math.log1p(max) - Math.log1p(min));
  return stepColor(ramp, t);
}
