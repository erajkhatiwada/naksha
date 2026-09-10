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
