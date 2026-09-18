/** Geographic primitives. Single source of truth for the coordinate frame. */

export interface LngLat {
  lng: number;
  lat: number;
}

export interface Bbox {
  /** min longitude (west) */
  lo: number;
  /** max longitude (east) */
  hi: number;
  /** min latitude (south) */
  la: number;
  /** max latitude (north) */
  ha: number;
}

/**
 * The frame every naksha artifact and viewport is expressed in.
 *
 * Rounded outward from the real 77-district geometry so it contains the source
 * data with a small margin:
 *   districts77  lng 80.058585..88.201668   lat 26.347837..30.447277
 *
 * Deliberately NOT the bbox of world.geo.json's 23-vertex NPL outline
 * (80.088425..88.174804, 26.397898..30.422717) — that polygon's extremes were
 * cut by simplification, so its box sits 3-5 km inside Nepal's real border.
 */
export const NEPAL_BBOX: Bbox = Object.freeze({
  lo: 80.05,
  hi: 88.21,
  la: 26.34,
  ha: 30.45,
});

/** Mean Earth radius, km. */
const R = 6371.0088;
const DEG = Math.PI / 180;

/**
 * Width in cells that preserves true ground aspect for a bbox.
 *
 * Longitude degrees shrink by cos(lat) away from the equator. Skipping this
 * renders Nepal noticeably stretched east-west.
 */
export function aspectWidth(bbox: Bbox, height: number): number {
  const midLat = ((bbox.la + bbox.ha) / 2) * DEG;
  return Math.round((height * ((bbox.hi - bbox.lo) * Math.cos(midLat))) / (bbox.ha - bbox.la));
}

/** Great-circle distance in km. */
export function distanceKm(a: LngLat, b: LngLat): number {
  const dLat = (b.lat - a.lat) * DEG;
  const dLng = (b.lng - a.lng) * DEG;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * DEG) * Math.cos(b.lat * DEG) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Ground width and height of a bbox in km, measured through its centre. */
export function bboxSizeKm(bbox: Bbox): { width: number; height: number } {
  const midLat = (bbox.la + bbox.ha) / 2;
  return {
    width: distanceKm({ lng: bbox.lo, lat: midLat }, { lng: bbox.hi, lat: midLat }),
    height: distanceKm({ lng: bbox.lo, lat: bbox.la }, { lng: bbox.lo, lat: bbox.ha }),
  };
}

export function bboxContains(bbox: Bbox, p: LngLat): boolean {
  return p.lng >= bbox.lo && p.lng <= bbox.hi && p.lat >= bbox.la && p.lat <= bbox.ha;
}

/** Expand (or with a negative value, shrink) a bbox by a fraction of its size. */
export function padBbox(bbox: Bbox, fraction: number): Bbox {
  const dx = (bbox.hi - bbox.lo) * fraction;
  const dy = (bbox.ha - bbox.la) * fraction;
  return { lo: bbox.lo - dx, hi: bbox.hi + dx, la: bbox.la - dy, ha: bbox.ha + dy };
}

/**
 * Grow a bbox to a target aspect ratio (width/height in ground units), so a
 * viewport fills its container without distorting the map.
 */
export function fitAspect(bbox: Bbox, targetAspect: number): Bbox {
  const { width, height } = bboxSizeKm(bbox);
  if (height === 0 || width === 0) return bbox;
  const current = width / height;
  if (Math.abs(current - targetAspect) < 1e-9) return bbox;
  if (current < targetAspect) {
    const grow = ((targetAspect / current - 1) * (bbox.hi - bbox.lo)) / 2;
    return { ...bbox, lo: bbox.lo - grow, hi: bbox.hi + grow };
  }
  const grow = ((current / targetAspect - 1) * (bbox.ha - bbox.la)) / 2;
  return { ...bbox, la: bbox.la - grow, ha: bbox.ha + grow };
}

/**
 * Narrowest longitude span `zoomBbox` will zoom in to, in degrees.
 *
 * Not a taste knob — it is where the raster runs out. The bitmap is 1788x1024
 * over the national frame, 0.447 km/cell, and at the national aspect and the
 * default grid height a 0.32° box samples **0.447 km/dot**: one dot per raster
 * cell, measured. Going narrower upsamples the bitmap, so the dots get blockier
 * instead of the map getting finer.
 *
 * Note this is well past the point where a viewport still looks like Nepal —
 * a box this size is entirely inland, 100% filled, with no border in it (see
 * the note in views.ts). It bounds the arithmetic, not the good taste.
 */
export const MIN_ZOOM_SPAN = 0.32;

/**
 * Slide a box back inside `limit`, shrinking it only if it cannot fit.
 *
 * The shrink is uniform, so a box larger than the frame comes back with its
 * aspect intact rather than squashed against whichever axis overflowed — the
 * map would otherwise stretch as you zoomed out past the border.
 */
export function clampBbox(bbox: Bbox, limit: Bbox = NEPAL_BBOX): Bbox {
  const fit = Math.min(
    1,
    (limit.hi - limit.lo) / (bbox.hi - bbox.lo),
    (limit.ha - limit.la) / (bbox.ha - bbox.la),
  );
  const width = (bbox.hi - bbox.lo) * fit;
  const height = (bbox.ha - bbox.la) * fit;
  // Measured from the centre, so a box that has to shrink pulls in towards its
  // own middle rather than towards its west/south corner.
  const cx = (bbox.lo + bbox.hi) / 2;
  const cy = (bbox.la + bbox.ha) / 2;
  const lo = Math.min(Math.max(cx - width / 2, limit.lo), limit.hi - width);
  const la = Math.min(Math.max(cy - height / 2, limit.la), limit.ha - height);
  return { lo, hi: lo + width, la, ha: la + height };
}

export interface ZoomOptions {
  /**
   * The point held still while the box scales — zoom-at-cursor. Defaults to
   * the box's own centre, which is what a +/- button wants.
   */
  center?: LngLat;
  /** The box may not grow past this. Defaults to the national frame. */
  limit?: Bbox;
  /** Narrowest longitude span to zoom in to. Defaults to `MIN_ZOOM_SPAN`. */
  minSpan?: number;
}

/**
 * Scale a viewport about a point: `factor > 1` zooms in, `< 1` zooms out.
 *
 * Zoom in naksha is a bounding box, never a scale factor (spec §6), so this
 * returns another viewport to hand to `buildGrid` — which re-samples it at the
 * same dot budget, leaving the dot count and render cost flat while the ground
 * resolution moves. Both spans scale by the same ratio, so the box keeps its
 * shape and the map is never stretched.
 *
 * Bounded at both ends: `limit` caps the way out, `minSpan` the way in. A box
 * already narrower than `minSpan` can still zoom out — the floor only refuses
 * to take it further in — so a consumer's own tight bbox is never rejected,
 * just not deepened.
 */
export function zoomBbox(bbox: Bbox, factor: number, options: ZoomOptions = {}): Bbox {
  const { center, limit, minSpan = MIN_ZOOM_SPAN } = options;
  const width = bbox.hi - bbox.lo;
  let scale = 1 / factor;
  if (scale < 1 && width * scale < minSpan) scale = Math.min(1, minSpan / width);
  const cx = center?.lng ?? (bbox.lo + bbox.hi) / 2;
  const cy = center?.lat ?? (bbox.la + bbox.ha) / 2;
  return clampBbox(
    {
      lo: cx - (cx - bbox.lo) * scale,
      hi: cx + (bbox.hi - cx) * scale,
      la: cy - (cy - bbox.la) * scale,
      ha: cy + (bbox.ha - cy) * scale,
    },
    limit,
  );
}
