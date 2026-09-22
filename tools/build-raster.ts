/**
 * Build the district raster + lookup table (spec §15, ported from Python).
 *
 *   npm run data
 *
 * Reads .cache/districts77.json (see tools/fetch-data.ts) and writes:
 *   data/nepal-districts-<w>x<h>.png   debug image, not shipped to consumers
 *   data/districts.json                human-readable region table
 *   src/generated/districts.ts         the module the library actually ships
 */
import { mkdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { encodeIndexedPng, debugPalette } from "./lib/png.ts";
import { fillPolygons, type Polygon } from "./lib/rasterize.ts";
import { NEPAL_BBOX, aspectWidth } from "../src/geo.ts";
import { encodeRleBase64, decodeRleBase64 } from "../src/rle.ts";
import { joinBilingual } from "./lib/labels.ts";

const ROOT = resolve(import.meta.dirname, "..");
const CACHE = resolve(ROOT, ".cache");

/** 1024 rows => ~0.46 km/cell, finer than the 0.69 km/dot of a z3 viewport. */
const HEIGHT = 1024;

interface Feature {
  properties: Record<string, string | null>;
  geometry: { type: "Polygon" | "MultiPolygon"; coordinates: unknown };
}

const polygonsOf = (g: Feature["geometry"]): Polygon[] =>
  g.type === "MultiPolygon" ? (g.coordinates as Polygon[]) : [g.coordinates as Polygon];

function main() {
  const features: Feature[] = JSON.parse(
    readFileSync(resolve(CACHE, "districts77.json"), "utf8"),
  ).features;
  console.log(`source:    districts77.json  ${features.length} features`);

  /**
   * Darchula as drawn on Nepal's 2020 official map, which added the
   * Limpiyadhura–Kalapani–Lipulekh area (~335 km²) in Byas. The OCHA-derived
   * districts77 predates it, so its Darchula stops short.
   *
   * Only the territory is taken from this source, not Darchula wholesale: it
   * is painted into cells districts77 leaves outside Nepal, so every internal
   * boundary — including Darchula's with Bajhang and Baitadi — stays exactly
   * as the 77-district source draws it. The file is Darchula's nine palikas,
   * which rasterize to the same cells as their union.
   */
  const NEW_TERRITORY: Feature[] = JSON.parse(
    readFileSync(resolve(CACHE, "darchula-2020.json"), "utf8"),
  ).features;

  let lo = Infinity, hi = -Infinity, la = Infinity, ha = -Infinity;
  for (const f of [...features, ...NEW_TERRITORY]) {
    for (const rings of polygonsOf(f.geometry)) {
      for (const ring of rings) {
        for (const [x, y] of ring) {
          if (x < lo) lo = x;
          if (x > hi) hi = x;
          if (y < la) la = y;
          if (y > ha) ha = y;
        }
      }
    }
  }

  // The frame must CONTAIN the data. Otherwise geometry is clamped onto the
  // edge column and Nepal grows a false straight border.
  if (lo < NEPAL_BBOX.lo || hi > NEPAL_BBOX.hi || la < NEPAL_BBOX.la || ha > NEPAL_BBOX.ha) {
    throw new Error(
      `frozen bbox does not contain the source data — geometry would be clipped.\n` +
        `  data:   lng ${lo}..${hi}  lat ${la}..${ha}\n` +
        `  frozen: lng ${NEPAL_BBOX.lo}..${NEPAL_BBOX.hi}  lat ${NEPAL_BBOX.la}..${NEPAL_BBOX.ha}`,
    );
  }
  const margin = Math.min(
    lo - NEPAL_BBOX.lo, NEPAL_BBOX.hi - hi, la - NEPAL_BBOX.la, NEPAL_BBOX.ha - ha,
  );
  console.log(`frame:     margin ${margin.toFixed(4)} deg around the data`);

  // Sorted names give stable ids across rebuilds.
  const names = [...new Set(features.map((f) => f.properties.DIST_EN as string))].sort();
  const idOf = new Map(names.map((n, i) => [n, i + 1] as const));
  if (names.length > 255) throw new Error(`${names.length} regions exceeds the 8-bit cell`);

  const width = aspectWidth(NEPAL_BBOX, HEIGHT);
  const pixels = new Uint8Array(width * HEIGHT);

  const t0 = performance.now();
  for (const f of features) {
    fillPolygons(
      pixels, width, HEIGHT, NEPAL_BBOX,
      polygonsOf(f.geometry), idOf.get(f.properties.DIST_EN as string)!,
    );
  }

  const territory = new Uint8Array(pixels.length);
  fillPolygons(territory, width, HEIGHT, NEPAL_BBOX, NEW_TERRITORY.flatMap((f) => polygonsOf(f.geometry)), 1);
  const darchula = idOf.get("Darchula")!;
  let added = 0;
  for (let i = 0; i < pixels.length; i++) {
    if (territory[i] && !pixels[i]) {
      pixels[i] = darchula;
      added++;
    }
  }
  const rasterMs = performance.now() - t0;

  const counts = new Uint32Array(256);
  for (let i = 0; i < pixels.length; i++) counts[pixels[i]]++;
  const inside = pixels.length - counts[0];
  const empty = names.filter((n) => counts[idOf.get(n)!] === 0);
  if (empty.length) throw new Error(`regions with zero cells: ${empty.join(", ")}`);

  const ocha = names.map((name) => {
    const f = features.find((x) => x.properties.DIST_EN === name)!;
    return {
      name,
      pcode: f.properties.DIST_PCODE ?? null,
      province: Number(f.properties.ADM1_EN),
    };
  });

  // Bilingual names. Throws rather than guessing if the join is incomplete.
  const read = (f: string) => JSON.parse(readFileSync(resolve(CACHE, f), "utf8"));
  const { districts: bilingual, provinces, notes } = joinBilingual(
    ocha,
    read("lsn-districts-en.json"),
    read("lsn-districts-np.json"),
    read("lsn-provinces-en.json"),
    read("lsn-provinces-np.json"),
  );
  console.log(`names:     ${bilingual.size} districts matched to Devanagari, ${provinces.size} provinces`);
  for (const note of notes.filter((n) => !n.startsWith("aliased"))) console.log(`           ${note}`);
  console.log(`           ${notes.filter((n) => n.startsWith("aliased")).length} romanisation aliases applied`);

  // --- HQ coordinates ----------------------------------------------------
  //
  // .cache/hq.json is the *75*-district headquarters set, so it predates the
  // 2015 split of Rukum and Nawalparasi and carries 75 points for 77
  // districts. Each point is placed by sampling the raster built above rather
  // than by matching HQ_NAME: the file uses older, colloquial town names
  // (Tribhuwannagar for Ghorahi, Jumla for Chandannath, Mahendranagar for
  // Bheemdatta) while naksha ships the post-2017 municipality names. The
  // geometry agrees even where the strings do not — the Dang point is 1.4 km
  // from Ghorahi and 20.5 km from Tulsipur, so it is unambiguously the HQ.
  //
  // One point is dropped rather than trusted; see AMBIGUOUS_HQ.
  const hqFeatures: { name: string; lng: number; lat: number }[] = JSON.parse(
    readFileSync(resolve(CACHE, "hq.json"), "utf8"),
  ).features.map((f: any) => ({
    name: f.properties.HQ_NAME,
    lng: f.geometry.coordinates[0],
    lat: f.geometry.coordinates[1],
  }));

  /**
   * HQ points that cannot be assigned to one of the 77 districts.
   *
   * Rukum was split into East and West in 2015 and the file has a single
   * pre-split point. The raster puts it in Rukum East, but it sits 1.9 km from
   * the Rukum West boundary and its name — Khalanga — is West's HQ (Musikot
   * Khalanga), not East's (Rukumkot). Either half could claim it, so neither
   * does: both ship without a coordinate instead of one of them shipping the
   * other's town. Nawalparasi split the same year but its point is 14.8 km
   * inside Nawalparasi West, so that one is not in doubt.
   */
  const AMBIGUOUS_HQ = new Set(["Jumlikhalanga"]);

  const hqAt = new Map<number, { lng: number; lat: number }>();
  const hqNotes: string[] = [];
  for (const f of hqFeatures) {
    if (AMBIGUOUS_HQ.has(f.name)) continue;
    const px = Math.floor(((f.lng - NEPAL_BBOX.lo) / (NEPAL_BBOX.hi - NEPAL_BBOX.lo)) * width);
    const py = Math.floor(((NEPAL_BBOX.ha - f.lat) / (NEPAL_BBOX.ha - NEPAL_BBOX.la)) * HEIGHT);
    const id = pixels[py * width + px];
    if (!id) {
      hqNotes.push(`${f.name} falls outside the raster and was skipped`);
      continue;
    }
    if (hqAt.has(id)) {
      // Two points in one district would mean the join is wrong, not that the
      // district has two headquarters. Fail rather than silently pick one.
      throw new Error(`two HQ points resolved to district ${id}: ${f.name}`);
    }
    // Six decimals is ~0.1 m — the source's own precision, rounded to keep the
    // generated module from carrying float noise.
    hqAt.set(id, { lng: +f.lng.toFixed(6), lat: +f.lat.toFixed(6) });
  }
  for (const note of hqNotes) console.log(`           ${note}`);
  console.log(
    `hq:        ${hqAt.size}/${ocha.length} districts have an exact HQ coordinate` +
      ` (${hqFeatures.length} points in, ${AMBIGUOUS_HQ.size} ambiguous)`,
  );

  const regions = ocha.map((r) => {
    const b = bilingual.get(r.name)!;
    const p = provinces.get(r.province)!;
    return {
      id: idOf.get(r.name)!,
      name: r.name,
      nameNp: b.nameNp,
      pcode: r.pcode,
      province: r.province,
      provinceName: p.name,
      provinceNameNp: p.nameNp,
      hq: b.hq,
      hqNp: b.hqNp,
      hqAt: hqAt.get(idOf.get(r.name)!) ?? null,
    };
  });

  // --- artifacts ---------------------------------------------------------
  mkdirSync(resolve(ROOT, "data"), { recursive: true });
  mkdirSync(resolve(ROOT, "src/generated"), { recursive: true });

  const pngPath = resolve(ROOT, "data", `nepal-districts-${width}x${HEIGHT}.png`);
  writeFileSync(pngPath, encodeIndexedPng({
    width, height: HEIGHT, pixels, palette: debugPalette(), filter: "auto",
  }));

  writeFileSync(
    resolve(ROOT, "data/districts.json"),
    JSON.stringify({
      version: 1,
      source: "mesaugat/geoJSON-Nepal nepal-districts-new.geojson (MIT); Darchula 2020 territory from opentechcommunity/map-of-nepal (CC BY 4.0)",
      generated: new Date().toISOString().slice(0, 10),
      bbox: NEPAL_BBOX,
      raster: { width, height: HEIGHT },
      regions: regions.map((r) => ({ ...r, cells: counts[r.id] })),
    }, null, 2) + "\n",
  );

  const b64 = encodeRleBase64(pixels);

  // Round-trip before shipping: a corrupt payload would fail at the consumer's
  // first render, which is the worst place to find out.
  const roundTrip = decodeRleBase64(b64, pixels.length);
  for (let i = 0; i < pixels.length; i++) {
    if (roundTrip[i] !== pixels[i]) throw new Error(`RLE round-trip mismatch at ${i}`);
  }

  const module = `// GENERATED by tools/build-raster.ts — do not edit.
// Source: mesaugat/geoJSON-Nepal nepal-districts-new.geojson (MIT);
// Darchula 2020 territory from opentechcommunity/map-of-nepal (CC BY 4.0)
import type { RasterSource, Region } from "../raster.ts";

export const DISTRICT_RASTER: RasterSource = {
  width: ${width},
  height: ${HEIGHT},
  bbox: { lo: ${NEPAL_BBOX.lo}, hi: ${NEPAL_BBOX.hi}, la: ${NEPAL_BBOX.la}, ha: ${NEPAL_BBOX.ha} },
  data: "${b64}",
};

export const DISTRICTS: readonly Region[] = ${JSON.stringify(regions)};
`;
  writeFileSync(resolve(ROOT, "src/generated/districts.ts"), module);

  const kb = (n: number) => (n / 1024).toFixed(1);
  console.log(`\nraster:    ${width}x${HEIGHT}  (${(width * HEIGHT / 1e6).toFixed(2)}M cells, ${rasterMs.toFixed(0)} ms)`);
  console.log(`fill:      ${((inside / pixels.length) * 100).toFixed(1)}% inside Nepal`);
  console.log(`darchula:  ${added} cells added from the 2020 map`);
  console.log(`regions:   ${names.length} districts, all non-empty`);
  console.log(`png:       ${kb(statSync(pngPath).size)} KB  (debug only)`);
  console.log(`shipped:   ${kb(b64.length)} KB base64 RLE  ->  src/generated/districts.ts`);
}

main();
