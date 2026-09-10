/**
 * Re-verify the spec's measured claims against the shipped artifacts.
 *
 *   npm run verify
 *
 * The spec's [verified] numbers were measured on the 75-district file inside
 * the world.geo.json bbox. We ship 77 districts in a corrected frame, so these
 * are expected to shift slightly. What must hold is the *shape* of every
 * claim: the H=40 resolution floor, constant-time sampling, and clustering
 * rates that make declustering mandatory.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { RegionRaster } from "../src/raster.ts";
import { DISTRICT_RASTER, DISTRICTS } from "../src/generated/districts.ts";
import { buildGrid, cellAt, dotIndex, project, regionAnchor, snapPoint } from "../src/grid.ts";
import { bboxSizeKm, distanceKm, type LngLat } from "../src/geo.ts";
import {
  measureLabel,
  placeAbove,
  placeLabel,
  dotsUnder,
  type LabelBox,
  type Occupied,
} from "../src/svg.ts";
import { resolveTheme } from "../src/theme.ts";

const CACHE = resolve(import.meta.dirname, "../.cache");
const rule = (s: string) => console.log(`\n\x1b[1m${s}\x1b[0m\n${"-".repeat(s.length)}`);

const hqs: { name: string; lng: number; lat: number }[] = JSON.parse(
  readFileSync(resolve(CACHE, "hq.json"), "utf8"),
).features.map((f: any) => ({
  name: f.properties.HQ_NAME,
  lng: f.geometry.coordinates[0],
  lat: f.geometry.coordinates[1],
}));

// ---------------------------------------------------------------- decode ---
rule("Raster decode (spec §5, §13)");
const raster = new RegionRaster(DISTRICT_RASTER);
let t = performance.now();
raster.preload();
console.log(`payload         ${(DISTRICT_RASTER.data.length / 1024).toFixed(1)} KB base64, synchronous, zero deps`);
console.log(`decode          ${(performance.now() - t).toFixed(1)} ms  (once, lazily, then memoised)`);
console.log(`raster          ${raster.width}x${raster.height}, ${raster.cellSizeKm.toFixed(2)} km/cell`);

const size = bboxSizeKm(raster.bbox);
console.log(`frame           ${size.width.toFixed(0)} km wide x ${size.height.toFixed(0)} km tall, aspect ${(size.width / size.height).toFixed(2)}:1`);
const inside = raster.pixels.reduce((n, v) => n + (v !== 0 ? 1 : 0), 0);
console.log(`fill            ${((inside / raster.pixels.length) * 100).toFixed(1)}% of the frame is Nepal`);

// -------------------------------------------------------------- viewports ---
rule("Viewports: constant dot budget, and which boxes still look like Nepal");
// The last two are deliberately NOT in `VIEWS`. A box drawn wholly inside
// Nepal contains no border, so every cell is inside and the silhouette is a
// filled rectangle — the `fill` and `edge` columns below are the measurement
// that decided which viewports the library names.
const VIEWS = {
  Nepal: raster.bbox,
  Bagmati: { lo: 84.4, hi: 86.4, la: 27.0, ha: 28.4 },
  "Ktm Valley*": { lo: 85.15, hi: 85.55, la: 27.58, ha: 27.83 },
  "Ktm city*": { lo: 85.26, hi: 85.39, la: 27.66, ha: 27.76 },
};
console.log("view          cols x rows   dots   km/dot   districts    fill   edge   build");
for (const [label, bbox] of Object.entries(VIEWS)) {
  t = performance.now();
  const g = buildGrid(raster, { bbox });
  const ms = performance.now() - t;
  const fill = (g.dots.length / (g.cols * g.rows)) * 100;
  const edge = g.dots.filter((d) => d.coverage < 1).length;
  console.log(
    `${label.padEnd(13)} ${`${g.cols} x ${g.rows}`.padEnd(13)} ${String(g.dots.length).padStart(4)}` +
      `   ${g.kmPerDot.toFixed(2).padStart(6)}   ${String(g.regions.size).padStart(9)}` +
      `   ${(fill.toFixed(1) + "%").padStart(6)}   ${String(edge).padStart(4)}   ${ms.toFixed(1)} ms`,
  );
}
console.log("\n* not named in VIEWS: 100% fill and no edge dots means no outline to see.");
const z1 = buildGrid(raster, { bbox: raster.bbox });
const granted = z1.dots.filter((d) => d.granted);
console.log(`\nz1 identifies ${z1.regions.size}/${DISTRICTS.length} districts` +
  (z1.regions.size === DISTRICTS.length ? "  OK" : `  MISSING: ${DISTRICTS.filter(d => !z1.regions.has(d.id)).map(d => d.name).join(", ")}`));
if (granted.length) {
  const byId = new Map(DISTRICTS.map((d) => [d.id, d.name]));
  console.log(`guarantee pass rescued ${granted.length}: ${granted.map((d) => byId.get(d.region)).join(", ")}`);
}
const bare = buildGrid(raster, { bbox: raster.bbox, ensureRegions: false });
console.log(`without the guarantee pass: ${bare.regions.size}/${DISTRICTS.length}` +
  ` (lost ${DISTRICTS.filter((d) => !bare.regions.has(d.id)).map((d) => d.name).join(", ") || "none"})`);

// -------------------------------------------------------- resolution floor ---
rule("Resolution floor: district HQ collisions (spec §7)");
console.log(`${hqs.length} HQs from nepal-district-headquarters.geojson`);
console.log("\nrows   km/dot   lost   merges");
for (const rows of [12, 16, 20, 25, 30, 40, 60, 80]) {
  const g = buildGrid(raster, { height: rows });
  const byCell = new Map<string, string[]>();
  for (const hq of hqs) {
    const c = cellAt(g, hq);
    const key = `${c.col},${c.row}`;
    (byCell.get(key) ?? byCell.set(key, []).get(key)!).push(hq.name);
  }
  const merged = [...byCell.values()].filter((v) => v.length > 1);
  const lost = hqs.length - byCell.size;
  const sample = merged.sort((a, b) => b.length - a.length)[0];
  console.log(
    `${String(rows).padStart(4)}   ${g.kmPerDot.toFixed(1).padStart(6)}   ${String(lost).padStart(4)}` +
      `   ${sample ? sample.join("+") : "—"}`,
  );
}

// ------------------------------------------------------------- clustering ---
rule("Clustering: zoom IS declustering (spec §8)");
// 250 delivery pickup points around the Kathmandu Valley, gaussian-ish around
// the city centre. Deterministic so the numbers are reproducible.
let seed = 42;
const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const gauss = () => (rand() + rand() + rand() + rand() - 2) / 2;
// Mixture: a dense core of city pickups plus a tail spread across the valley,
// which is what a real delivery footprint looks like.
const points: LngLat[] = Array.from({ length: 250 }, () => {
  const core = rand() < 0.7;
  return {
    lng: 85.324 + gauss() * (core ? 0.06 : 0.18),
    lat: 27.7172 + gauss() * (core ? 0.04 : 0.11),
  };
});

console.log("view              km/dot   dots used   collapsed   busiest");
for (const [label, bbox] of Object.entries(VIEWS)) {
  const g = buildGrid(raster, { bbox });
  const cells = new Map<string, number>();
  let visible = 0;
  for (const p of points) {
    const c = cellAt(g, p);
    if (c.col < 0 || c.col >= g.cols || c.row < 0 || c.row >= g.rows) continue;
    visible++;
    const key = `${c.col},${c.row}`;
    cells.set(key, (cells.get(key) ?? 0) + 1);
  }
  const busiest = Math.max(0, ...cells.values());
  const collapsed = visible ? (1 - cells.size / visible) * 100 : 0;
  console.log(
    `${label.padEnd(17)} ${g.kmPerDot.toFixed(2).padStart(6)}   ${String(cells.size).padStart(9)}` +
      `   ${(collapsed.toFixed(0) + "%").padStart(9)}   ${String(busiest).padStart(7)}` +
      (visible < points.length ? `   (${visible}/${points.length} in view)` : ""),
  );
}

// -------------------------------------------------------- label occlusion ---
rule("Labels erase the dots they cover (spec §9)");
// A label's halo is the background colour, so it deletes the dots underneath.
// On a dot map that is data. These numbers drive the `labelPlacement` default,
// so they are measured through the renderer's own placement functions —
// `placeAbove` and `placeLabel` are the same calls `renderPins` makes, and
// `dotsUnder` is the same circle-against-rectangle test. A re-model here would
// quietly disagree with what actually ships.
{
  const g = buildGrid(raster, { bbox: raster.bbox });
  const theme = resolveTheme();
  const index = dotIndex(g);
  // Every district labelled with its own name, at the dot that stands for it —
  // which is what "77 district labels" means. Deliberately not the 74 HQ
  // coordinates: three districts have none, and a claim about districts should
  // cover all of them.
  const labelled = DISTRICTS.map((d) => ({ d, dot: regionAnchor(g, d.id)! })).filter((x) => x.dot);

  console.log(`${labelled.length} districts labelled at their anchor dot, national view\n`);
  console.log("placement       own   others   total   buries its own   median move from pin");

  for (const placement of ["above", "avoid-region", "clear"] as const) {
    // Seeded with every pin, exactly as renderPins does, so labels keep off
    // each other and off the pins rather than each being placed in isolation.
    const clusters = labelled.map(({ d, dot }) => ({
      d,
      col: dot.col,
      row: dot.row,
      x: dot.col + 0.5,
      y: dot.row + 0.5,
    }));
    const pr = theme.pinRadius + theme.pinHaloWidth;
    const taken: Occupied = {
      boxes: clusters.map((c) => ({
        x: c.x, y: c.y, x0: c.x - pr, x1: c.x + pr, y0: c.y - pr, y1: c.y + pr,
      })),
    };

    let ownDots = 0;
    let otherDots = 0;
    let ownBuriers = 0;
    const moves: number[] = [];

    for (const c of clusters) {
      const m = measureLabel(c.d.name, theme);
      if (m.lines.length === 0) continue;
      const region = index.get(c.row * g.cols + c.col)?.region ?? 0;

      let box: LabelBox;
      if (placement === "above") {
        box = placeAbove(g, c.x, c.y, theme.pinRadius, m).box;
      } else {
        box = placeLabel(g, placement, c.x, c.y, theme.pinRadius, m, region, theme.dotRadius, taken);
        taken.boxes.push(box);
      }

      const { own, other } = dotsUnder(g, box, theme.dotRadius, region);
      ownDots += own;
      otherDots += other;
      if (own > 0) ownBuriers++;
      // Distance from the pin to the label's anchor point, in dot-widths.
      moves.push(Math.hypot(box.x - c.x, box.y - c.y));
    }

    moves.sort((a, b) => a - b);
    const median = moves[moves.length >> 1] ?? 0;
    const n = clusters.length;
    console.log(
      `${placement.padEnd(15)} ${(ownDots / n).toFixed(1).padStart(3)}` +
        `   ${(otherDots / n).toFixed(1).padStart(6)}` +
        `   ${((ownDots + otherDots) / n).toFixed(1).padStart(5)}` +
        `   ${`${ownBuriers}/${n}`.padStart(14)}   ${median.toFixed(1).padStart(19)}`,
    );
  }
  console.log("\nAll per-label means. 'own' is dots of the district the label names, which is");
  console.log("the column that matters: a label erasing its own district is erasing its answer.");
}

// ------------------------------------------------------- district snapping ---
rule("Snapping: a pin must land on a dot of its own district");
// A dot's region is the plurality over its whole cell; the raster answers for
// the exact point. Near a border they disagree, and a pin then sits on a dot
// painted as the wrong district while its label names the right one. Measured
// against every coordinate this repo actually ships.
console.log("view              HQs   wrong by cell   wrong after snap   moved   worst move");
for (const [label, bbox] of Object.entries(VIEWS)) {
  const g = buildGrid(raster, { bbox });
  const index = dotIndex(g);
  const inView = DISTRICTS.filter((d) => {
    if (!d.hqAt) return false;
    const c = cellAt(g, d.hqAt);
    return c.col >= 0 && c.col < g.cols && c.row >= 0 && c.row < g.rows;
  });

  let naive = 0;
  let left = 0;
  let moved = 0;
  let worst = 0;
  const named: string[] = [];
  for (const d of inView) {
    const cell = cellAt(g, d.hqAt!);
    if (index.get(cell.row * g.cols + cell.col)?.region !== d.id) {
      naive++;
      if (named.length < 4) named.push(d.hq ?? d.name);
    }
    const dot = snapPoint(g, d.hqAt!);
    if (dot?.region !== d.id) left++;
    if (!dot || (dot.col === cell.col && dot.row === cell.row)) continue;
    moved++;
    // Distance from the point to the dot it was given — the quantity SNAP_REACH
    // actually caps. Unmoved points are excluded: their offset is just where
    // they sit inside their own cell, which snapping never touched.
    const at = project(g, d.hqAt!);
    worst = Math.max(worst, Math.hypot(dot.col + 0.5 - at.x, dot.row + 0.5 - at.y));
  }
  console.log(
    `${label.padEnd(15)} ${String(inView.length).padStart(4)}` +
      `   ${String(naive).padStart(13)}   ${String(left).padStart(16)}   ${String(moved).padStart(5)}` +
      `   ${moved ? `${worst.toFixed(2)}u = ${(worst * g.kmPerDot).toFixed(1)} km` : "—"}` +
      (named.length ? `   [${named.join(", ")}]` : ""),
  );
}
console.log("\nThe cap is one dot spacing — the map's own resolution, so a correction");
console.log("inside it claims nothing the dot field was not already claiming.");

// ---------------------------------------------------------------- arc math ---
rule("Arc height must be non-linear (spec §10)");
const named = (n: string) => hqs.find((h) => h.name.toLowerCase().startsWith(n.toLowerCase()))!;
const ktm = named("Kathmandu") ?? { name: "Kathmandu", lng: 85.324, lat: 27.7172 };
const dists: number[] = [];
for (let i = 0; i < hqs.length; i++)
  for (let j = i + 1; j < hqs.length; j++) dists.push(distanceKm(hqs[i], hqs[j]));
dists.sort((a, b) => a - b);
const pct = (p: number) => dists[Math.floor(dists.length * p)];
console.log(`pairwise HQ distances   min ${dists[0].toFixed(1)} km   p10 ${pct(0.1).toFixed(0)} km   ` +
  `median ${pct(0.5).toFixed(0)} km   max ${dists.at(-1)!.toFixed(0)} km`);
console.log(`spread                  ${(dists.at(-1)! / dists[0]).toFixed(0)}x  -> linear arc height cannot work`);
for (const to of ["Bhaktapur", "Pokhara", "Biratnagar", "Dhangadhi", "Mahendranagar"]) {
  const d = named(to);
  if (d) console.log(`  Kathmandu -> ${to.padEnd(15)} ${distanceKm(ktm, d).toFixed(1).padStart(6)} km`);
}
console.log("");
