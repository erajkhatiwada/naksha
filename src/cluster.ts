/**
 * Clustering (spec §8).
 *
 * Not a nice-to-have. At a national view one dot covers ~130 km², so a
 * delivery operator's entire Kathmandu footprint collapses onto a handful of
 * dots. An `addPin` that silently stacks pins is a bug for that consumer, so
 * snapping and clustering are the same operation and always on.
 *
 * Zoom is the declustering mechanism: the same points spread out as the
 * viewport tightens, because the grid re-rasterises per viewport.
 */
import type { LngLat } from "./geo.ts";
import type { Bilingual } from "./i18n.ts";
import type { Grid } from "./grid.ts";
import { cellAt, cellCenter, isInsideGrid, snapPoint } from "./grid.ts";

export interface MapPoint extends LngLat, Bilingual {
  id?: string;
  /** Contribution to the cluster total. Defaults to 1. */
  weight?: number;
  /** Arbitrary payload, passed back to event handlers untouched. */
  data?: unknown;
}

export interface Cluster<T extends MapPoint = MapPoint> {
  col: number;
  row: number;
  /** SVG coordinates of the cluster's dot. */
  x: number;
  y: number;
  /** Snapped geographic position — the cell centre, not the mean of members. */
  lng: number;
  lat: number;
  /** Number of points, or the sum of their weights. */
  count: number;
  points: T[];
}

export interface ClusterResult<T extends MapPoint = MapPoint> {
  clusters: Cluster<T>[];
  /** Points that fell outside the viewport. */
  offscreen: T[];
}

/**
 * Snap points onto the grid and merge everything sharing a cell.
 *
 * Cluster position is the cell centre rather than the members' centroid, so a
 * cluster always sits exactly on a dot. A centroid would float between dots
 * and break the dot-grid look.
 *
 * Snapping is `snapPoint`, not the bare cell: a point lands on a dot of the
 * district it is actually in, even when its own cell is mostly a neighbour's.
 * Two points a few hundred metres apart across a border can therefore end up
 * one dot apart — but that is a one-dot error in *position*, which is the
 * resolution the map already admits to, where the alternative is a pin whose
 * colour and label name different districts.
 */
export function clusterPoints<T extends MapPoint>(grid: Grid, points: readonly T[]): ClusterResult<T> {
  const byCell = new Map<number, Cluster<T>>();
  const offscreen: T[] = [];

  for (const p of points) {
    // A point with no dot in reach still pins where it falls — dropping it
    // would lose a stop rather than place it imprecisely.
    const { col, row } = snapPoint(grid, p) ?? cellAt(grid, p);
    if (!isInsideGrid(grid, col, row)) {
      offscreen.push(p);
      continue;
    }
    const key = row * grid.cols + col;
    let cluster = byCell.get(key);
    if (!cluster) {
      const center = cellCenter(grid, col, row);
      cluster = {
        col,
        row,
        x: col + 0.5,
        y: row + 0.5,
        lng: center.lng,
        lat: center.lat,
        count: 0,
        points: [],
      };
      byCell.set(key, cluster);
    }
    cluster.count += p.weight ?? 1;
    cluster.points.push(p);
  }

  // Busiest last so heavier badges paint over lighter ones.
  const clusters = [...byCell.values()].sort((a, b) => a.count - b.count);
  return { clusters, offscreen };
}

/** How much of the input collapsed, 0..1. Useful for deciding to suggest zoom. */
export function collapseRatio(result: ClusterResult): number {
  const total = result.clusters.reduce((n, c) => n + c.points.length, 0);
  return total === 0 ? 0 : 1 - result.clusters.length / total;
}
