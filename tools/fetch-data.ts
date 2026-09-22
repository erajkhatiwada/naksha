/**
 * Download the upstream GeoJSON into .cache/ (gitignored).
 *
 *   npm run fetch
 *
 * Source: github.com/mesaugat/geoJSON-Nepal (MIT, (c) 2013-present Saugat
 * Acharya). Nothing from johan/world.geo.json is used — it is unlicensed
 * (NOASSERTION) and its Nepal outline is a 23-vertex simplification.
 *
 * Darchula additionally comes from opentechcommunity/map-of-nepal (CC BY 4.0,
 * sourced from MOFAGA), which follows Nepal's 2020 official map; see
 * NEW_TERRITORY in build-raster.ts.
 */
import { mkdirSync, writeFileSync, existsSync, statSync } from "node:fs";
import { resolve } from "node:path";

const CACHE = resolve(import.meta.dirname, "../.cache");

const GEOJSON = "https://raw.githubusercontent.com/mesaugat/geoJSON-Nepal/master";
/** Bilingual names: sagautam5/local-states-nepal (MIT). */
const NAMES = "https://raw.githubusercontent.com/sagautam5/local-states-nepal/master/dataset";
/** Pinned: the repo has no releases, and the artifacts CI job must stay reproducible. */
const MOFAGA =
  "https://raw.githubusercontent.com/opentechcommunity/map-of-nepal/a3f49f886ba5e0da00d85f451c49492bfdd4239c";

const FILES: Record<string, string> = {
  "districts77.json": `${GEOJSON}/nepal-districts-new.geojson`,
  "districts75.json": `${GEOJSON}/nepal-districts.geojson`,
  "hq.json": `${GEOJSON}/nepal-district-headquarters.geojson`,
  "lsn-districts-en.json": `${NAMES}/districts/en.json`,
  "lsn-districts-np.json": `${NAMES}/districts/np.json`,
  "lsn-provinces-en.json": `${NAMES}/provinces/en.json`,
  "lsn-provinces-np.json": `${NAMES}/provinces/np.json`,
  "darchula-2020.json": `${MOFAGA}/maps-of-districts/sudurpashchim_province_7_districts/Darchula.geojson`,
};

mkdirSync(CACHE, { recursive: true });

const size = (bytes: number) =>
  bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${(bytes / 1024).toFixed(0)} KB`;

for (const [local, url] of Object.entries(FILES)) {
  const target = resolve(CACHE, local);
  if (existsSync(target)) {
    console.log(`cached  ${local.padEnd(24)} ${size(statSync(target).size)}`);
    continue;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const body = new Uint8Array(await res.arrayBuffer());
  writeFileSync(target, body);
  console.log(`fetched ${local.padEnd(24)} ${size(body.length)}`);
}
