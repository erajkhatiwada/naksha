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

/**
 * Rows of dots a grid samples at unless told otherwise.
 *
 * Lives here rather than in grid.ts because `panBbox` has to know the lattice
 * it is landing a pan on, and grid.ts already imports this file.
 */
export const DEFAULT_GRID_HEIGHT = 40;

/**
 * The longitude span that gives `bbox` the same ground width at `lat`.
 *
 * The whole of why a viewport is carried around in ground units rather than in
 * degrees. `aspectWidth` narrows a longitude degree by cos(lat), so a box that
 * keeps its *degree* width as it travels north gets narrower on the ground, its
 * column count falls, and the map changes shape underneath a gesture that only
 * meant to move it. Measured: a 4x box dragged from the Terai to the northern
 * border goes 71 columns to 69, which at the site's 774px map column is the
 * drawn map growing 436px to 449px tall mid-drag.
 */
function spanAtLat(bbox: Bbox, lat: number): number {
  return ((bbox.hi - bbox.lo) * Math.cos(((bbox.la + bbox.ha) / 2) * DEG)) / Math.cos(lat * DEG);
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
 * resolution moves. The box keeps the shape it is *drawn* in — see below — so
 * the map is never stretched.
 *
 * Bounded at both ends: `limit` caps the way out, `minSpan` the way in. A box
 * already narrower than `minSpan` can still zoom out — the floor only refuses
 * to take it further in — so a consumer's own tight bbox is never rejected,
 * just not deepened.
 *
 * **Shape is held in ground units, not in degrees.** Scaling both degree spans
 * by the same ratio is not enough: a `center` away from the box's own middle
 * drags the mid-latitude with it, cos(lat) moves, and `aspectWidth` answers
 * with a different column count — so a zoom-at-cursor rescales the drawn map
 * as well as tightening it. Measured, four steps at a north-west cursor take
 * the national frame from 70 columns to 69. The ground width the box had is
 * restored about the same anchor afterwards, which costs one cosine and makes
 * the claim above true. With no `center` the correction is exactly 1: the
 * mid-latitude never moves, so nothing about the old arithmetic changes.
 */
export function zoomBbox(bbox: Bbox, factor: number, options: ZoomOptions = {}): Bbox {
  const { center, limit, minSpan = MIN_ZOOM_SPAN } = options;
  const width = bbox.hi - bbox.lo;
  let scale = 1 / factor;
  if (scale < 1 && width * scale < minSpan) scale = Math.min(1, minSpan / width);
  const cx = center?.lng ?? (bbox.lo + bbox.hi) / 2;
  const cy = center?.lat ?? (bbox.la + bbox.ha) / 2;
  const la = cy - (cy - bbox.la) * scale;
  const ha = cy + (bbox.ha - cy) * scale;
  const spanLng = spanAtLat(bbox, (la + ha) / 2) * scale;
  // The anchor keeps its fractional position across the box, which is what
  // "held still" means once the width is no longer a plain multiple of the old
  // one. A degenerate box has no such fraction; centre it.
  const fx = width > 0 ? (cx - bbox.lo) / width : 0.5;
  const lo = cx - fx * spanLng;
  // The way out ends *on* the limit rather than on the largest box of the
  // current shape that fits inside it. Those are the same thing only while a
  // viewport still has the frame's proportions, and `panBbox` is entitled to
  // change them — it carries a ground width, so a box that has travelled north
  // is a few percent wider in degrees than the frame is. Without this, zooming
  // all the way out after a drag settles on a full-width box up to 4% short of
  // the frame's height, which clips ~18 km of the southern Terai and leaves a
  // viewport nothing can zoom out of. The ladder has to end on the whole map.
  const bound = limit ?? NEPAL_BBOX;
  if (scale > 1 && (spanLng >= bound.hi - bound.lo || ha - la >= bound.ha - bound.la)) {
    return { lo: bound.lo, hi: bound.hi, la: bound.la, ha: bound.ha };
  }
  return clampBbox({ lo, hi: lo + spanLng, la, ha }, limit);
}

export interface PanOptions {
  /** The box may not leave this. Defaults to the national frame. */
  limit?: Bbox;
  /**
   * Rows of dots the box will be sampled at — the lattice the pan lands on.
   * Defaults to `DEFAULT_GRID_HEIGHT`; pass your own if you build grids at a
   * different height, or the snap is to a lattice you are not drawing.
   */
  rows?: number;
  /**
   * The lattice the grid will be sampled on — pass the same box you pass to
   * `buildGrid`'s `align`, and the pan becomes a plain translation.
   *
   * Without it the dot field is anchored to the viewport, so the only way to
   * move without re-sampling every cell is to land on whole dots, and the only
   * way to keep the drawn shape is to hold the ground width. Both are done
   * below, and both leave marks: the map steps a dot at a time, the lattice
   * re-phases once where the frame clamps a drag, and the width correction
   * fires about twice across a full north-south pan.
   *
   * With `align` none of that is needed. The lattice is fixed to the ground
   * rather than to the box, so the viewport is free to slide continuously
   * between dots, and holding its degree span holds the drawn shape outright —
   * the window is a constant number of cells wide because the cells no longer
   * move — measured, exactly 70 x 40 at every latitude and longitude the demo
   * can reach, at every zoom. The price is that the cell's ground size now
   * varies with latitude instead of the column count: **up to 3.4%** across a
   * full-country pan, against a viewport that already uses a single cos(lat)
   * for its whole height. It is the standard-parallel approximation the map is
   * already built on, moved from per-viewport to per-gesture.
   */
  align?: Bbox;
}

/**
 * Move a viewport to a new centre, keeping the size it is drawn at and landing
 * on whole dots.
 *
 * The other half of `zoomBbox`, and the one a drag gesture wants. Two things
 * are wrong with the obvious `clampBbox` on a box you build yourself, and they
 * are independent — fixing either alone still leaves the map deforming under
 * the pointer.
 *
 * **It has to hold the shape the map is drawn in.** Longitude degrees narrow by
 * cos(lat), so a box that simply keeps its degrees loses ground width as it
 * travels north, `aspectWidth` answers with fewer columns, and the drawn map
 * rescales. Dragging the national frame's quarter-box from the Terai to the
 * northern border walks it through 71, 70 and 69 columns.
 *
 * **And it has to land on whole dots.** The lattice is anchored to the box, so
 * a box that slides by a fraction of a cell re-samples every cell against a
 * different patch of ground: the dots stay put on screen while the country
 * slides underneath them, and the silhouette re-forms instead of moving.
 * Measured at one zoom step in, half a dot of pan changes **387 of 1,990
 * dots** — a fifth of the field, concentrated exactly on the border, which is
 * the edge you are looking at. Moved by whole cells the new grid is the old
 * one shifted, cell for cell, because each cell covers the same ground its
 * neighbour did. A dot map cannot translate by less than a dot; pretending
 * otherwise is what makes the coastline wobble.
 *
 * Clamped like everything else, so a drag towards the border slides the box
 * back inside the frame rather than centring on a point half of whose view
 * would be empty. The frame edge is the one place the lattice does re-phase,
 * once, because the border is not on a dot boundary — and the box then stays
 * there for the rest of the drag rather than shimmering.
 */
export function panBbox(bbox: Bbox, to: LngLat, options: PanOptions = {}): Bbox {
  const limit = options.limit ?? NEPAL_BBOX;
  const rows = options.rows ?? DEFAULT_GRID_HEIGHT;
  const spanLat = bbox.ha - bbox.la;
  const cols = Math.max(1, aspectWidth(bbox, rows));

  // With a lattice fixed to the ground, a pan is just a translation: the
  // window stays the same number of cells across because the cells have not
  // moved, and the viewport may sit between them. See `PanOptions.align`.
  if (options.align) {
    const spanLng = bbox.hi - bbox.lo;
    const glideLo = Math.min(Math.max(to.lng - spanLng / 2, limit.lo), limit.hi - spanLng);
    const glideLa = Math.min(Math.max(to.lat - spanLat / 2, limit.la), limit.ha - spanLat);
    return clampBbox(
      { lo: glideLo, hi: glideLo + spanLng, la: glideLa, ha: glideLa + spanLat },
      limit,
    );
  }

  // Latitude first: the width to carry depends on where the box lands. The
  // snap moves the box's *centre* by whole cells, measured from the box being
  // moved, so a drag accumulates exactly instead of drifting off the lattice
  // one rounding at a time.
  const cellLat = spanLat / rows;
  const cy = (bbox.la + bbox.ha) / 2;
  const centreLat = cy + Math.round((to.lat - cy) / cellLat) * cellLat;
  const la = Math.min(Math.max(centreLat - spanLat / 2, limit.la), limit.ha - spanLat);

  // The degree width is *held* while it still draws the same number of columns
  // at the new latitude, and re-derived only when `aspectWidth`'s rounding
  // would otherwise flip. Carrying the ground width exactly instead moves the
  // cell by 0.05% per row travelled, which re-phases the column lattice a
  // little on every frame of a vertical drag — measured over a 240-frame pan,
  // 6 frames change more than 5 dots. Holding it pins the lattice outright and
  // lets the ground width drift instead, by a measured 0.64 of a column, 0.91%,
  // at every zoom on the ladder — which nothing can see. The same pan then has
  // **1** such frame, where the correction fires. Anchoring the snap on the
  // centre rather than on `lo` splits that correction across both edges, taking
  // its worst frame from 43 dots to 34.
  const held = bbox.hi - bbox.lo;
  const spanLng =
    aspectWidth({ lo: 0, hi: held, la, ha: la + spanLat }, rows) === cols
      ? held
      : (cols * spanLat) / (rows * Math.cos((la + spanLat / 2) * DEG));
  const cellLng = spanLng / cols;
  const cx = (bbox.lo + bbox.hi) / 2;
  const centreLng = cx + Math.round((to.lng - cx) / cellLng) * cellLng;
  const lo = Math.min(Math.max(centreLng - spanLng / 2, limit.lo), limit.hi - spanLng);

  // A ground width grows as it travels south, so a box already close to the
  // frame's own width can overflow it. `clampBbox` is then the same uniform
  // shrink a zoom-out gets — and the identity in every other case.
  return clampBbox({ lo, hi: lo + spanLng, la, ha: la + spanLat }, limit);
}
