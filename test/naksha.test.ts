import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import { encodeRle, decodeRle, encodeRleBase64, decodeRleBase64 } from "../src/rle.ts";
import {
  nepalRaster,
  nepalGrid,
  districtAt,
  districtByName,
  districtById,
  DISTRICTS,
  renderNepal,
  clusterPoints,
  collapseRatio,
  arcHeight,
  arcPath,
  buildGrid,
  VIEWS,
  distanceKm,
  OUTSIDE,
  findDistrict,
  pickLabel,
  bothLabels,
  regionBoth,
  hitTest,
  attachInteractions,
  regionAnchor,
  PROVINCES,
  provinceById,
  dotIndex,
  project,
  snapPoint,
  cellAt,
  isInsideGrid,
  renderSvg,
  placeParts,
  describePlace,
  clampBbox,
  zoomBbox,
  panBbox,
  renderInset,
  lightTheme,
  districtBbox,
  bboxSizeKm,
  aspectWidth,
  NEPAL_BBOX,
  MIN_ZOOM_SPAN,
  unproject,
  eventPoint,
  type LabelPlacement,
  type Bbox,
} from "../src/index.ts";

/**
 * Valley- and city-sized boxes, written inline rather than taken from `VIEWS`.
 *
 * `VIEWS` deliberately names only viewports that contain a border, because a
 * box drawn wholly inside Nepal renders as a filled rectangle with no
 * silhouette. These two are exactly that — which is precisely what makes them
 * the right fixtures for testing the dot budget, declustering and off-viewport
 * behaviour, none of which care what the outline looks like.
 */
const VALLEY_BOX = { lo: 85.15, hi: 85.55, la: 27.58, ha: 27.83 };
const CITY_BOX = { lo: 85.26, hi: 85.39, la: 27.66, ha: 27.76 };

describe("rle codec", () => {
  test("round-trips random data", () => {
    for (const seed of [1, 7, 99]) {
      let s = seed;
      const rand = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
      const src = new Uint8Array(5000);
      for (let i = 0; i < src.length; ) {
        const v = Math.floor(rand() * 78);
        const run = 1 + Math.floor(rand() * 300);
        src.fill(v, i, Math.min(src.length, i + run));
        i += run;
      }
      assert.deepEqual(decodeRle(encodeRle(src), src.length), src);
    }
  });

  test("round-trips through base64", () => {
    const src = Uint8Array.from({ length: 1000 }, (_, i) => (i / 37) | 0);
    assert.deepEqual(decodeRleBase64(encodeRleBase64(src), src.length), src);
  });

  test("encodes long runs with multi-byte varints", () => {
    const src = new Uint8Array(100_000).fill(5);
    const encoded = encodeRle(src);
    assert.ok(encoded.length < 10, `expected a tiny encoding, got ${encoded.length} bytes`);
    assert.deepEqual(decodeRle(encoded, src.length), src);
  });

  test("rejects a truncated payload rather than returning silent garbage", () => {
    const src = new Uint8Array(500).fill(3);
    assert.throws(() => decodeRle(encodeRle(src), 999), /corrupt raster/);
  });
});

describe("raster", () => {
  test("decodes to the declared dimensions", () => {
    const r = nepalRaster();
    assert.equal(r.pixels.length, r.width * r.height);
  });

  test("places known airports in the right district", () => {
    const cases: [string, number, number, string][] = [
      ["Kathmandu (TIA)", 85.3591, 27.6966, "Kathmandu"],
      ["Pokhara", 83.982, 28.201, "Kaski"],
      ["Biratnagar", 87.264, 26.4815, "Morang"],
      ["Nepalgunj", 81.667, 28.1036, "Banke"],
      ["Dhangadhi", 80.5819, 28.7533, "Kailali"],
      ["Lukla", 86.7314, 27.6869, "Solukhumbu"],
      ["Bhairahawa", 83.416, 27.5056, "Rupandehi"],
    ];
    for (const [label, lng, lat, expected] of cases) {
      assert.equal(districtAt({ lng, lat })?.name, expected, label);
    }
  });

  test("reports points outside Nepal as outside", () => {
    // Delhi, Lhasa, and a point in the Bay of Bengal.
    for (const p of [
      { lng: 77.209, lat: 28.6139 },
      { lng: 91.117, lat: 29.6544 },
      { lng: 88.0, lat: 21.0 },
    ]) {
      assert.equal(nepalRaster().sample(p), OUTSIDE);
      assert.equal(districtAt(p), undefined);
    }
  });

  test("ships all 77 districts with province links", () => {
    assert.equal(DISTRICTS.length, 77);
    assert.equal(new Set(DISTRICTS.map((d) => d.id)).size, 77);
    for (const d of DISTRICTS) {
      assert.ok(d.province >= 1 && d.province <= 7, `${d.name} province ${d.province}`);
      assert.match(d.pcode ?? "", /^NP\d{4}$/, `${d.name} pcode`);
    }
  });

  test("includes the post-2015 district splits", () => {
    for (const name of ["Nawalparasi East", "Nawalparasi West", "Rukum East", "Rukum West"]) {
      assert.ok(districtByName(name), `missing ${name}`);
    }
  });
});

describe("grid", () => {
  test("never emits a dot outside Nepal", () => {
    for (const dot of nepalGrid().dots) assert.notEqual(dot.region, OUTSIDE);
  });

  test("represents every district at the national view", () => {
    const grid = nepalGrid();
    const missing = DISTRICTS.filter((d) => !grid.regions.has(d.id)).map((d) => d.name);
    assert.deepEqual(missing, [], `districts with no dot: ${missing.join(", ")}`);
  });

  test("without the guarantee pass, small districts vanish", () => {
    // Documents *why* ensureRegions exists: Bhaktapur is smaller than one
    // z1 cell, so it can never win a cell on area alone.
    const bare = buildGrid(nepalRaster(), { ensureRegions: false });
    assert.ok(
      bare.regions.size < DISTRICTS.length,
      "expected at least one district to be lost without ensureRegions",
    );
  });

  test("holds the dot budget roughly constant from country to city core", () => {
    for (const bbox of [VIEWS.nepal, VIEWS.bagmati, VALLEY_BOX, CITY_BOX]) {
      const g = buildGrid(nepalRaster(), { bbox });
      assert.ok(
        g.dots.length > 800 && g.dots.length < 2600,
        `${g.dots.length} dots is outside the intended budget`,
      );
    }
  });

  test("resolves finer ground detail as the viewport tightens", () => {
    const wide = buildGrid(nepalRaster(), { bbox: VIEWS.nepal });
    const tight = buildGrid(nepalRaster(), { bbox: VALLEY_BOX });
    assert.ok(tight.kmPerDot < wide.kmPerDot / 10);
  });
});

describe("clustering", () => {
  const valley = Array.from({ length: 250 }, (_, i) => ({
    lng: 85.28 + (i % 17) * 0.012,
    lat: 27.66 + ((i * 7) % 13) * 0.009,
    label: `stop ${i}`,
  }));

  test("collapses hard at the national view and separates when zoomed", () => {
    const wide = clusterPoints(nepalGrid(), valley);
    const tight = clusterPoints(buildGrid(nepalRaster(), { bbox: VALLEY_BOX }), valley);
    assert.ok(collapseRatio(wide) > 0.8, `expected heavy collapse, got ${collapseRatio(wide)}`);
    assert.ok(
      tight.clusters.length > wide.clusters.length * 5,
      "zooming should decluster substantially",
    );
  });

  test("keeps every point and sits clusters exactly on a dot", () => {
    const { clusters, offscreen } = clusterPoints(nepalGrid(), valley);
    const total = clusters.reduce((n, c) => n + c.points.length, 0);
    assert.equal(total + offscreen.length, valley.length);
    for (const c of clusters) {
      assert.equal(c.x, c.col + 0.5);
      assert.equal(c.y, c.row + 0.5);
    }
  });

  test("reports points outside the viewport instead of dropping them", () => {
    const grid = buildGrid(nepalRaster(), { bbox: VALLEY_BOX });
    const { offscreen } = clusterPoints(grid, [
      { lng: 85.3, lat: 27.7 },
      { lng: 80.6, lat: 28.75 },
    ]);
    assert.equal(offscreen.length, 1);
  });
});

describe("snapping a point to a dot of its own district", () => {
  const grid = nepalGrid();
  const index = dotIndex(grid);
  const dotIn = (col: number, row: number) => index.get(row * grid.cols + col);

  /** Lahan: the case this exists for. Real town, 8 km inside Siraha's border. */
  const LAHAN = { lng: 86.4833, lat: 26.72 };

  test("Lahan pins on Siraha, whose cell is mostly Saptari", () => {
    // The premise first: without the correction the pin would land on a dot
    // painted as another district, contradicting its own "Lahan, Siraha" label
    // and any regionColor around it. If this ever stops being true the
    // regression has moved, not gone.
    const naive = cellAt(grid, LAHAN);
    assert.equal(districtAt(LAHAN)?.name, "Siraha");
    assert.equal(districtById(dotIn(naive.col, naive.row)!.region)?.name, "Saptari");

    const snapped = snapPoint(grid, LAHAN)!;
    assert.equal(districtById(snapped.region)?.name, "Siraha");
  });

  test("the pin, the label and the hit-test key all name the same cell", () => {
    // They agree only because they all go through clusterPoints. A pin that
    // moved while data-cluster did not would be unclickable.
    const [cluster] = clusterPoints(grid, [{ ...LAHAN, label: "Lahan" }]).clusters;
    const snapped = snapPoint(grid, LAHAN)!;
    assert.equal(cluster.col, snapped.col);
    assert.equal(cluster.row, snapped.row);
    assert.equal(cluster.x, snapped.col + 0.5);
    assert.equal(cluster.y, snapped.row + 0.5);
  });

  test("every district headquarters lands on a dot of its own district", () => {
    const wrong: string[] = [];
    for (const d of DISTRICTS) {
      if (!d.hqAt) continue;
      const dot = snapPoint(grid, d.hqAt);
      if (dot?.region !== d.id) wrong.push(`${d.hq} (${d.name} -> ${dot ? districtById(dot.region)?.name : "no dot"})`);
    }
    assert.deepEqual(wrong, []);
  });

  test("never moves a point further than one dot spacing", () => {
    // The bound is the whole argument: one spacing is the map's own resolution,
    // so the correction cannot say anything the dot field was not already
    // saying. Anything further would be inventing a position.
    let worst = 0;
    let moved = 0;
    for (const d of DISTRICTS) {
      if (!d.hqAt) continue;
      const cell = cellAt(grid, d.hqAt);
      const dot = snapPoint(grid, d.hqAt);
      // Only points snapping actually moved: an unmoved point's offset from its
      // dot is just where it sits inside its own cell, which is not a correction.
      if (!dot || (dot.col === cell.col && dot.row === cell.row)) continue;
      moved++;
      const at = project(grid, d.hqAt);
      worst = Math.max(worst, Math.hypot(dot.col + 0.5 - at.x, dot.row + 0.5 - at.y));
    }
    assert.ok(moved > 0, "nothing moved — the measurement below would be vacuous");
    assert.ok(worst <= 1, `worst correction was ${worst.toFixed(2)} dot units`);
    // And the cap does not bind on real data — see SNAP_REACH.
    assert.ok(worst < 0.8, `expected the measured worst case near 0.79, got ${worst.toFixed(2)}`);
  });

  test("rescues a point whose own cell holds no dot at all", () => {
    // Dhangadhi sits in a cell too empty to earn a dot (coverage < 0.5), so it
    // used to pin into the blank frame outside the silhouette.
    const dhangadhi = districtByName("Kailali")!.hqAt!;
    const cell = cellAt(grid, dhangadhi);
    assert.equal(dotIn(cell.col, cell.row), undefined);
    assert.equal(snapPoint(grid, dhangadhi)?.region, districtByName("Kailali")!.id);
  });

  test("leaves a point outside Nepal exactly where it falls", () => {
    // No district to reconcile against, so nothing is corrected. Just inside
    // the frame, over India.
    const outside = { lng: 87.5, lat: 26.4 };
    assert.equal(nepalRaster().sample(outside), OUTSIDE);
    const cell = cellAt(grid, outside);
    const snapped = snapPoint(grid, outside);
    if (snapped) {
      assert.equal(snapped.col, cell.col);
      assert.equal(snapped.row, cell.row);
    }
  });

  test("is undefined outside the viewport rather than aliasing into a row", () => {
    const tight = buildGrid(nepalRaster(), { bbox: VALLEY_BOX });
    assert.equal(snapPoint(tight, { lng: 80.6, lat: 28.75 }), undefined);
    // The bare cell would be a negative column, which `row * cols + col` folds
    // onto a real dot in the previous row.
    const cell = cellAt(tight, { lng: 80.6, lat: 28.75 });
    assert.ok(!isInsideGrid(tight, cell.col, cell.row));
  });

  test("leaves the overwhelming majority of points in their own cell", () => {
    // The correction is for border towns, not a general re-projection: if it
    // were moving most points, the dot field itself would be wrong.
    const hqs = DISTRICTS.filter((d) => d.hqAt);
    const moved = hqs.filter((d) => {
      const cell = cellAt(grid, d.hqAt!);
      const dot = snapPoint(grid, d.hqAt!)!;
      return dot.col !== cell.col || dot.row !== cell.row;
    });
    assert.ok(moved.length < hqs.length * 0.1, `${moved.length}/${hqs.length} moved`);
  });

  test("carries the raster it was sampled from, which is what makes this possible", () => {
    const raster = nepalRaster();
    assert.equal(buildGrid(raster, { bbox: VIEWS.nepal }).raster, raster);
  });
});

describe("arcs", () => {
  test("is non-linear: short hops bow proportionally more than long ones", () => {
    const short = arcHeight(1);
    const long = arcHeight(46);
    assert.ok(short / 1 > long / 46, "short arcs must bow harder relative to length");
  });

  test("clamps to the floor so short hops never render flat", () => {
    assert.equal(arcHeight(0.01), 1.5);
    assert.ok(arcHeight(1000) <= 9);
  });

  test("produces a quadratic segment per leg", () => {
    const grid = nepalGrid();
    const d = arcPath({ x: 0, y: 0 }, { x: 10, y: 0 });
    assert.match(d, /^M .* Q .*/);
    assert.ok(grid.cols > 0);
  });

  test("bows consistently upward regardless of travel direction", () => {
    const ltr = arcPath({ x: 0, y: 20 }, { x: 10, y: 20 });
    const rtl = arcPath({ x: 10, y: 20 }, { x: 0, y: 20 });
    const cy = (d: string) => Number(d.split("Q")[1].trim().split(/\s+/)[1]);
    assert.ok(cy(ltr) < 20 && cy(rtl) < 20, "both directions should bow toward the top");
  });
});

describe("svg", () => {
  const ktm = { lng: 85.3591, lat: 27.6966, label: "Kathmandu" };
  const pkr = { lng: 83.982, lat: 28.201, label: "Pokhara" };

  test("renders a self-contained svg with no external references", () => {
    const svg = renderNepal({ routes: [{ stops: [ktm, pkr] }], points: [ktm, pkr] });
    assert.match(svg, /^<svg /);
    assert.match(svg, /<\/svg>$/);
    assert.doesNotMatch(svg, /https?:\/\/(?!www\.w3\.org)/, "no external URLs");
    assert.doesNotMatch(svg, /<image/, "no raster images");
  });

  test("static output draws routes fully, with no hidden dash state", () => {
    const svg = renderNepal({ routes: [{ stops: [ktm, pkr] }] });
    assert.doesNotMatch(svg, /stroke-dashoffset/);
    assert.doesNotMatch(svg, /naksha-pulse/);
    assert.match(svg, /class="naksha-route"/);
  });

  test("animated output keeps the hidden state inside the keyframes", () => {
    const svg = renderNepal({ routes: [{ stops: [ktm, pkr] }], animate: true });
    // The base rule must not hide the stroke, or non-animating renderers
    // (print, server-side rasterisers) would draw nothing at all.
    assert.doesNotMatch(svg, /\.naksha-reveal\{[^}]*stroke-dashoffset/);
    assert.match(svg, /@keyframes naksha-draw\{from\{[^}]*stroke-dashoffset:1/);
    assert.match(svg, /prefers-reduced-motion/);
  });

  test("a pulse carries its own path, so two maps on a page cannot swap them", () => {
    // An `<mpath href="#id">` resolves document-wide, and two maps number their
    // routes from r0 under the same prefix — so the second map's pulses would
    // follow the first map's geometry, in a viewBox that is not theirs.
    const opts = { routes: [{ stops: [ktm, pkr] }], animate: true };
    const svg = renderNepal(opts);
    assert.doesNotMatch(svg, /<mpath/, "no cross-document id reference");
    const motion = svg.match(/<animateMotion[^>]*path="([^"]+)"/);
    assert.ok(motion, "the pulse carries the arc inline");
    assert.ok(
      svg.includes(`<path id="naksha-r0" class="naksha-route naksha-reveal" pathLength="1" d="${motion[1]}"`),
      "and it is the same arc the route is drawn with",
    );
    // The geometry is per-viewport, so a second map's pulse must differ.
    const zoomed = renderNepal({ ...opts, bbox: VIEWS.madhesh });
    assert.notStrictEqual(zoomed.match(/<animateMotion[^>]*path="([^"]+)"/)![1], motion[1]);
  });

  test("collapses the dot field into a couple of nodes by default", () => {
    const svg = renderNepal({});
    const circles = (svg.match(/<circle/g) ?? []).length;
    assert.ok(circles === 0, `expected no per-dot circles, found ${circles}`);
    assert.ok((svg.match(/<path/g) ?? []).length <= 4);
  });

  test("emits per-dot nodes with region data when asked", () => {
    const svg = renderNepal({ dots: "circles" });
    assert.ok((svg.match(/data-region="/g) ?? []).length > 1000);
  });

  test("escapes untrusted label text", () => {
    const svg = renderNepal({
      points: [{ lng: 85.3591, lat: 27.6966, label: '</text><script>alert(1)</script>' }],
      labels: true,
    });
    assert.doesNotMatch(svg, /<script>/);
    assert.match(svg, /&lt;script&gt;/);
  });

  test("works with no DOM present (SSR safety)", () => {
    assert.equal(typeof (globalThis as Record<string, unknown>).document, "undefined");
    assert.ok(renderNepal({ points: [ktm] }).length > 1000);
  });
});

describe("bilingual labels", () => {
  test("every district carries a distinct Devanagari name", () => {
    assert.equal(DISTRICTS.length, 77);
    for (const d of DISTRICTS) {
      assert.match(d.nameNp, /[ऀ-ॿ]/, `${d.name} has no Devanagari name`);
      assert.match(d.provinceNameNp, /[ऀ-ॿ]/, `${d.name} province`);
    }
    assert.equal(new Set(DISTRICTS.map((d) => d.nameNp)).size, 77, "Devanagari names must be unique");
  });

  test("no name uses a decomposed vowel sign", () => {
    // "काेशी" is क + ा + े, which looks like कोशी but is a different string,
    // so equality and search silently fail. NFC does not repair it.
    const decomposed = /ाे|ाै|ाॅ/;
    for (const d of DISTRICTS) {
      assert.doesNotMatch(d.nameNp, decomposed, `${d.name} name`);
      assert.doesNotMatch(d.provinceNameNp, decomposed, `${d.name} province name`);
      if (d.hqNp) assert.doesNotMatch(d.hqNp, decomposed, `${d.name} hq`);
    }
  });

  test("province 1 is कोशी with a composed vowel", () => {
    const koshi = DISTRICTS.find((d) => d.province === 1)!;
    assert.equal(koshi.provinceNameNp, "कोशी प्रदेश");
    assert.equal([...koshi.provinceNameNp][1].codePointAt(0), 0x094b);
  });

  test("the post-2015 splits are named consistently in both scripts", () => {
    assert.equal(districtByName("Rukum East")?.nameNp, "रुकुम पूर्व");
    assert.equal(districtByName("Rukum West")?.nameNp, "रुकुम पश्चिम");
    assert.equal(districtByName("Nawalparasi East")?.nameNp, "नवलपुर");
    assert.equal(districtByName("Nawalparasi West")?.nameNp, "परासी");
  });

  test("districts resolve from either script", () => {
    assert.equal(findDistrict("Kathmandu")?.id, findDistrict("काठमाडौँ")?.id);
    assert.equal(findDistrict("कास्की")?.name, "Kaski");
    assert.equal(findDistrict("नonsense"), undefined);
  });

  test("province lookups agree across all districts", () => {
    for (const d of DISTRICTS) {
      const peers = DISTRICTS.filter((x) => x.province === d.province);
      assert.equal(new Set(peers.map((p) => p.provinceNameNp)).size, 1, `province ${d.province}`);
    }
  });

  test("pickLabel falls back rather than rendering nothing", () => {
    assert.equal(pickLabel({ label: "Pokhara", labelNp: "पोखरा" }, "np"), "पोखरा");
    assert.equal(pickLabel({ label: "Pokhara", labelNp: "पोखरा" }, "en"), "Pokhara");
    // A consumer with Devanagari for only some stops still gets a label.
    assert.equal(pickLabel({ label: "Lukla" }, "np"), "Lukla");
    assert.equal(pickLabel({ labelNp: "लुक्ला" }, "en"), "लुक्ला");
    assert.equal(pickLabel({}, "np"), undefined);
  });

  test("accessible titles carry both scripts", () => {
    assert.equal(bothLabels({ label: "Pokhara", labelNp: "पोखरा" }), "Pokhara (पोखरा)");
    assert.equal(bothLabels({ label: "Lukla" }), "Lukla");
    assert.equal(regionBoth(districtByName("Kaski")!), "Kaski (कास्की)");
  });

  test("renders Devanagari labels with a Devanagari-capable font stack", () => {
    const point = { lng: 85.3591, lat: 27.6966, label: "Kathmandu", labelNp: "काठमाडौँ" };
    const np = renderNepal({ points: [point], labels: true, lang: "np" });
    assert.match(np, />काठमाडौँ</);
    assert.match(np, /Noto Sans Devanagari/);
    // The English name still reaches assistive tech.
    assert.match(np, /Kathmandu \(काठमाडौँ\)/);

    const en = renderNepal({ points: [point], labels: true, lang: "en" });
    assert.match(en, />Kathmandu</);
    assert.doesNotMatch(en, />काठमाडौँ</);
  });

  test("defaults to English when no language is given", () => {
    const svg = renderNepal({
      points: [{ lng: 85.3591, lat: 27.6966, label: "Kathmandu", labelNp: "काठमाडौँ" }],
      labels: true,
    });
    assert.match(svg, />Kathmandu</);
  });
});

describe("geo", () => {
  test("matches known great-circle distances", () => {
    const d = distanceKm({ lng: 85.324, lat: 27.7172 }, { lng: 83.9856, lat: 28.2096 });
    assert.ok(Math.abs(d - 143) < 5, `Kathmandu-Pokhara came out as ${d.toFixed(1)} km`);
  });

  test("district lookup is consistent in both directions", () => {
    for (const d of DISTRICTS) {
      assert.equal(districtById(d.id)?.name, d.name);
      assert.equal(districtByName(d.name)?.id, d.id);
    }
  });
});

describe("interaction hit-testing", () => {
  test("every dot is found at its own cell centre", () => {
    const grid = nepalGrid();
    for (const dot of grid.dots) {
      assert.equal(hitTest(grid, dot.col + 0.5, dot.row + 0.5), dot);
    }
  });

  test("a dot owns its whole cell, so there are no dead zones between dots", () => {
    const grid = nepalGrid();
    // The visible circle is 0.3 units across in a 1-unit cell. Hovering the
    // 70% of the cell that isn't painted still has to resolve, or the map
    // feels broken everywhere between the dots.
    for (const dot of grid.dots.slice(0, 200)) {
      for (const [dx, dy] of [
        [0.01, 0.01],
        [0.99, 0.01],
        [0.01, 0.99],
        [0.99, 0.99],
      ]) {
        assert.equal(hitTest(grid, dot.col + dx, dot.row + dy), dot);
      }
    }
  });

  test("a point outside the viewport never aliases onto an adjacent row", () => {
    const grid = nepalGrid();
    const index = dotIndex(grid);
    // `row * cols + col` with col = -1 keys the same slot as (cols-1, row-1).
    // Pick a row where that slot actually holds a dot, so an unguarded lookup
    // would confidently return the wrong district.
    let row = -1;
    for (let r = 1; r < grid.rows; r++) {
      if (index.has((r - 1) * grid.cols + grid.cols - 1)) {
        row = r;
        break;
      }
    }
    assert.ok(row > 0, "expected some row to hold a dot in its last column");
    assert.equal(hitTest(grid, -0.5, row + 0.5), undefined);
    assert.equal(hitTest(grid, grid.cols + 0.5, row + 0.5), undefined);
    assert.equal(hitTest(grid, 0.5, -0.5), undefined);
    assert.equal(hitTest(grid, 0.5, grid.rows + 0.5), undefined);
  });

  test("outside Nepal is a miss, not a nearest-district guess", () => {
    const grid = nepalGrid();
    // The bbox corners are well outside the silhouette in every direction.
    for (const [x, y] of [
      [0.5, 0.5],
      [grid.cols - 0.5, 0.5],
      [0.5, grid.rows - 0.5],
      [grid.cols - 0.5, grid.rows - 0.5],
    ]) {
      assert.equal(hitTest(grid, x, y), undefined);
    }
  });

  test("tolerance widens the hit target for touch, and only when asked", () => {
    const grid = nepalGrid();
    const index = dotIndex(grid);
    let empty: { col: number; row: number } | null = null;
    for (const dot of grid.dots) {
      const left = { col: dot.col - 1, row: dot.row };
      if (left.col >= 0 && !index.has(left.row * grid.cols + left.col)) {
        empty = left;
        break;
      }
    }
    assert.ok(empty, "expected an empty cell beside a dot");
    assert.equal(hitTest(grid, empty.col + 0.5, empty.row + 0.5), undefined);
    const near = hitTest(grid, empty.col + 0.5, empty.row + 0.5, 1.5);
    assert.ok(near, "tolerance should reach the dot one cell away");
    const dx = near.col - empty.col;
    const dy = near.row - empty.row;
    assert.ok(Math.hypot(dx, dy) <= 1.5, "the rescued dot must be inside the tolerance");
    // Under the tolerance, the same query is still a miss.
    assert.equal(hitTest(grid, empty.col + 0.5, empty.row + 0.5, 0.4), undefined);
  });

  test("a geographic position round-trips through project() back to its dot", () => {
    const grid = nepalGrid();
    for (const dot of grid.dots) {
      const p = project(grid, { lng: dot.lng, lat: dot.lat });
      assert.equal(hitTest(grid, p.x, p.y), dot);
    }
  });

  test("dots resolve to real districts, so a hover can be attributed", () => {
    const grid = nepalGrid();
    const kaski = districtByName("Kaski")!;
    const dot = grid.dots.find((d) => d.region === kaski.id)!;
    const hit = hitTest(grid, dot.col + 0.5, dot.row + 0.5)!;
    assert.equal(districtById(hit.region)?.name, "Kaski");
  });

  test("the index is memoised per grid, so re-attaching is free", () => {
    const grid = nepalGrid();
    assert.equal(dotIndex(grid), dotIndex(grid));
    assert.notEqual(dotIndex(grid), dotIndex(nepalGrid()));
  });

  test("interaction does not cost the collapsed dot field", () => {
    // The whole point of hit-testing geometrically: `dots: "circles"` is not
    // the price of admission for hover and click.
    const svg = renderNepal();
    const circles = (svg.match(/<circle/g) ?? []).length;
    assert.equal(circles, 0, "the default render should emit no per-dot circles");
  });
});

describe("interaction hooks in the markup", () => {
  const KTM = { lng: 85.3591, lat: 27.6966, label: "Kathmandu" };
  const PKR = { lng: 83.9856, lat: 28.2096, label: "Pokhara" };

  test("pins carry the cell that identifies their cluster", () => {
    const grid = nepalGrid();
    const { clusters } = clusterPoints(grid, [KTM, PKR]);
    const svg = renderNepal({ points: [KTM, PKR] });
    for (const c of clusters) {
      // Cell coordinates, not the formatted x/y — matching a cluster on
      // stringified floats is a rounding bug waiting to happen.
      assert.match(svg, new RegExp(`data-cluster="${c.col},${c.row}"`));
    }
  });

  test("the halo shares its pin's identity, widening the target", () => {
    const svg = renderNepal({ points: [KTM] });
    const halo = svg.match(/<circle class="naksha-pin-halo"[^>]*>/)![0];
    assert.match(halo, /data-cluster="\d+,\d+"/);
  });

  test("routes are addressable whether or not the caller gave them ids", () => {
    const svg = renderNepal({
      routes: [{ stops: [KTM, PKR] }, { stops: [PKR, KTM], id: "back" }],
    });
    assert.match(svg, /data-route-index="0"/);
    assert.match(svg, /data-route-index="1"/);
    assert.match(svg, /data-route="back"/);
  });

  test("adds nothing when there is nothing to interact with", () => {
    const svg = renderNepal();
    assert.doesNotMatch(svg, /data-cluster/);
    assert.doesNotMatch(svg, /data-route-index/);
  });
});

describe("label placement", () => {
  const grid = nepalGrid({ bbox: VIEWS.nepal });
  // Siraha is the reported case: seven dots at the national view, and a label
  // wider than the district, so `above` buries most of what it names.
  const siraha = DISTRICTS.find((d) => d.name === "Siraha")!;
  const mine = grid.dots.filter((d) => d.region === siraha.id);
  // The dot nearest the district's centre of mass, which is where the demo
  // points a district — and the placement that actually buries it.
  const mx = mine.reduce((s, d) => s + d.col, 0) / mine.length;
  const my = mine.reduce((s, d) => s + d.row, 0) / mine.length;
  const dot = mine.reduce((best, d) =>
    (d.col - mx) ** 2 + (d.row - my) ** 2 < (best.col - mx) ** 2 + (best.row - my) ** 2 ? d : best,
  );
  const point = { lng: dot.lng, lat: dot.lat, label: siraha.name };

  const render = (labelPlacement: LabelPlacement) =>
    renderSvg(grid, { points: [point], labels: true, labelPlacement, theme: { background: "#fff" } });

  /** The label's halo box, reconstructed from the emitted text element. */
  function box(svg: string, text = siraha.name) {
    const m = svg.match(/<text x="([-\d.]+)" y="([-\d.]+)" text-anchor="(\w+)"[^>]*font-size="([\d.]+)"/);
    assert.ok(m, "expected a label");
    const [, xs, ys, anchor, size] = m;
    const x = Number(xs);
    const y = Number(ys);
    const s = Number(size);
    const half = (text.length * s * 0.55) / 2;
    const cx = anchor === "middle" ? x : anchor === "start" ? x + half : x - half;
    return { x0: cx - half - 0.25, x1: cx + half + 0.25, y0: y - 0.8 * s - 0.25, y1: y + 0.2 * s + 0.25 };
  }

  /** Gap from a pin to the nearest edge of its label — what the eye judges. */
  const gap = (b: ReturnType<typeof box>, x: number, y: number) =>
    Math.hypot(x - Math.min(Math.max(x, b.x0), b.x1), y - Math.min(Math.max(y, b.y0), b.y1));

  /** Dots of `region` whose painted circle the box would erase. */
  const buried = (b: ReturnType<typeof box>, region: number) =>
    grid.dots.filter((d) => {
      if (d.region !== region) return false;
      const cx = d.col + 0.5;
      const cy = d.row + 0.5;
      const nx = Math.min(Math.max(cx, b.x0), b.x1);
      const ny = Math.min(Math.max(cy, b.y0), b.y1);
      return (cx - nx) ** 2 + (cy - ny) ** 2 <= 0.3 * 0.3;
    }).length;

  test("above is the default, and buries the district it names", () => {
    assert.equal(render("above"), renderSvg(grid, {
      points: [point], labels: true, theme: { background: "#fff" },
    }));
    // Asserted, not lamented: the default covers its own dots, and a consumer
    // who cares reaches for `avoid-region`. If this ever stops being true the
    // default has changed and the docs quoting 12 dots a label need redoing.
    assert.ok(buried(box(render("above")), siraha.id) > 0);
  });

  test("avoid-region leaves every dot of its own district visible", () => {
    assert.equal(buried(box(render("avoid-region")), siraha.id), 0);
  });

  test("clear leaves every dot on the map visible", () => {
    const b = box(render("clear"));
    const any = grid.dots.filter((d) => {
      const cx = d.col + 0.5;
      const cy = d.row + 0.5;
      const nx = Math.min(Math.max(cx, b.x0), b.x1);
      const ny = Math.min(Math.max(cy, b.y0), b.y1);
      return (cx - nx) ** 2 + (cy - ny) ** 2 <= 0.3 * 0.3;
    }).length;
    assert.equal(any, 0);
  });

  test("a label that stays put never gets a leader line", () => {
    // `above` does not move, so there is nothing to join.
    assert.doesNotMatch(render("above"), /naksha-leader/);
  });

  test("labels paint over the pins, in their own group", () => {
    const svg = render("avoid-region");
    assert.ok(
      svg.indexOf('class="naksha-pins"') < svg.indexOf('class="naksha-labels"'),
      "a name hidden behind a pin is worse than one drawn over it",
    );
  });

  test("clear runs straight up or down from the pin wherever it can", () => {
    // The eight route stops of the demo's default view: enough spread to have
    // both easy columns and blocked ones.
    const stops = [
      { lng: 85.3591, lat: 27.6966, label: "Kathmandu" },
      { lng: 83.982, lat: 28.201, label: "Pokhara" },
      { lng: 87.264, lat: 26.4815, label: "Biratnagar" },
      { lng: 81.667, lat: 28.1036, label: "Nepalgunj" },
      { lng: 80.5819, lat: 28.7533, label: "Dhangadhi" },
      { lng: 86.7314, lat: 27.6869, label: "Lukla" },
      { lng: 83.416, lat: 27.5056, label: "Bhairahawa" },
      { lng: 88.0794, lat: 26.5708, label: "Bhadrapur" },
      { lng: 84.4294, lat: 27.6781, label: "Bharatpur" },
    ];
    const svg = renderSvg(grid, { points: stops, labels: true, labelPlacement: "clear" });
    const { clusters } = clusterPoints(grid, stops);
    const texts = [...svg.matchAll(/<text x="([-\d.]+)" y="([-\d.]+)"/g)];
    assert.equal(texts.length, clusters.length);

    // A label placed by the north/south tier keeps its pin's x exactly; the
    // sideways tiers do not. Most stops should manage the straight run.
    let vertical = 0;
    for (const t of texts) {
      const x = Number(t[1]);
      if (clusters.some((c) => Math.abs(c.x - x) < 1e-9)) vertical++;
    }
    assert.ok(vertical >= 6, `expected most labels dead above/below their pin, got ${vertical}/${texts.length}`);
  });

  test("no two labels overlap, and none sits on another pin", () => {
    const stops = [
      // Bhadrapur and Biratnagar are the reported pair: ~110 km apart, both in
      // the crowded south-east corner, and easy to place on top of each other.
      { lng: 88.0794, lat: 26.5708, label: "Bhadrapur" },
      { lng: 87.264, lat: 26.4815, label: "Biratnagar" },
      { lng: 87.2797, lat: 26.8065, label: "Dharan" },
      { lng: 87.928, lat: 26.9094, label: "Ilam" },
      { lng: 86.7314, lat: 27.6869, label: "Lukla" },
    ];
    for (const mode of ["avoid-region", "clear"] as const) {
      const svg = renderSvg(grid, { points: stops, labels: true, labelPlacement: mode });
      const boxes = [...svg.matchAll(
        /<text x="([-\d.]+)" y="([-\d.]+)" text-anchor="(\w+)"[^>]*font-size="([\d.]+)"[^>]*>([^<]+)</g,
      )].map((m) => {
        const s = Number(m[4]);
        const half = (m[5].length * s * 0.55) / 2;
        const x = Number(m[1]);
        const cx = m[3] === "middle" ? x : m[3] === "start" ? x + half : x - half;
        const y = Number(m[2]);
        return { name: m[5], x0: cx - half - 0.25, x1: cx + half + 0.25, y0: y - 0.8 * s - 0.25, y1: y + 0.2 * s + 0.25 };
      });
      assert.equal(boxes.length, stops.length, `${mode}: expected one label per stop`);

      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i];
          const b = boxes[j];
          const hit = a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
          assert.ok(!hit, `${mode}: ${a.name} overlaps ${b.name}`);
        }
      }

      const { clusters } = clusterPoints(grid, stops);
      for (const box of boxes) {
        for (const c of clusters) {
          const nx = Math.min(Math.max(c.x, box.x0), box.x1);
          const ny = Math.min(Math.max(c.y, box.y0), box.y1);
          assert.ok(
            Math.hypot(c.x - nx, c.y - ny) >= 0.42,
            `${mode}: ${box.name} sits on the pin at ${c.x},${c.y}`,
          );
        }
      }
    }
  });

  test("none drops the drawn text but never the accessible name", () => {
    const svg = render("none");
    assert.doesNotMatch(svg, /class="naksha-labels"/);
    assert.match(svg, /class="naksha-pin"/);
    // Hiding a label is a visual choice; a screen reader still gets the stop.
    assert.match(svg, /<title>Siraha<\/title>/);
  });

  test("placement stays in the viewBox, and joins up whenever it travels", () => {
    for (const mode of ["avoid-region", "clear"] as const) {
      for (const d of DISTRICTS) {
        const anchor = grid.dots.find((x) => x.region === d.id);
        if (!anchor) continue;
        const svg = renderSvg(grid, {
          points: [{ lng: anchor.lng, lat: anchor.lat, label: d.name }],
          labels: true,
          labelPlacement: mode,
        });
        const m = svg.match(/<text x="([-\d.]+)" y="([-\d.]+)"/)!;
        const x = Number(m[1]);
        const y = Number(m[2]);
        assert.ok(x >= 0 && x <= grid.cols, `${d.name} ${mode}: x ${x} outside 0..${grid.cols}`);
        assert.ok(y >= 0 && y <= grid.rows, `${d.name} ${mode}: y ${y} outside 0..${grid.rows}`);

        // A label detached from its pin must be joined back to it, or it reads
        // as belonging to whatever it happened to land next to. The gap is
        // measured to the box's nearest edge, not to the text anchor: a long
        // name placed to one side has a distant anchor but still touches its
        // pin, and needs no line.
        const away = gap(box(svg, d.name), anchor.col + 0.5, anchor.row + 0.5);
        if (away > 2) {
          assert.match(svg, /class="naksha-leader"/, `${d.name} ${mode}: gap ${away.toFixed(1)}, no leader`);
        }
      }
    }
  });
});

describe("stacked labels", () => {
  const grid = nepalGrid({ bbox: VIEWS.nepal });
  const siraha = DISTRICTS.find((d) => d.name === "Siraha")!;
  // A dot well inside the frame, so nothing here is accidentally measuring an
  // edge clamp instead of the stacking.
  const dot = grid.dots.find((d) => d.region === siraha.id)!;
  const at = { lng: dot.lng, lat: dot.lat };
  const GAP = 1.1 * 1.2; // labelSize x labelLineHeight, both from lightTheme.
  const THREE = "Lahan\nSiraha\nMadhesh Province";

  const draw = (label: string, options: Parameters<typeof renderSvg>[1] = {}) =>
    renderSvg(grid, { points: [{ ...at, label }], labels: true, ...options });

  /** The label's <text>, taken apart: anchor, lines, and per-line offsets. */
  function text(svg: string) {
    const m = svg.match(
      /<text x="([-\d.]+)" y="([-\d.]+)" text-anchor="(\w+)"[^>]*font-size="([\d.]+)"[^>]*>(.*?)<\/text>/s,
    );
    assert.ok(m, "expected a label");
    const spans = [...m[5].matchAll(/<tspan([^>]*)>([^<]*)<\/tspan>/g)];
    const attr = (s: string, name: string) => {
      const found = s.match(new RegExp(`${name}="([-\\d.]+)"`));
      return found ? Number(found[1]) : undefined;
    };
    return {
      x: Number(m[1]),
      y: Number(m[2]),
      anchor: m[3],
      size: Number(m[4]),
      stacked: spans.length > 0,
      lines: spans.length ? spans.map((s) => s[2]) : [m[5]],
      xs: spans.map((s) => attr(s[1], "x")),
      dys: spans.map((s) => attr(s[1], "dy") ?? 0),
    };
  }

  /** The halo box of a label, including every line below the first. */
  function box(t: ReturnType<typeof text>) {
    const half = Math.max(...t.lines.map((l) => ([...l].length * t.size * 0.55) / 2));
    const cx = t.anchor === "middle" ? t.x : t.anchor === "start" ? t.x + half : t.x - half;
    const drop = (t.lines.length - 1) * GAP;
    return {
      x0: cx - half - 0.25,
      x1: cx + half + 0.25,
      y0: t.y - 0.8 * t.size - 0.25,
      y1: t.y + drop + 0.2 * t.size + 0.25,
    };
  }

  const buried = (b: ReturnType<typeof box>, region: number) =>
    grid.dots.filter((d) => {
      if (d.region !== region) return false;
      const cx = d.col + 0.5;
      const cy = d.row + 0.5;
      const nx = Math.min(Math.max(cx, b.x0), b.x1);
      const ny = Math.min(Math.max(cy, b.y0), b.y1);
      return (cx - nx) ** 2 + (cy - ny) ** 2 <= 0.3 * 0.3;
    }).length;

  test("a one-line label is emitted exactly as it always was", () => {
    // The stacking machinery must not put a <tspan> around every name on every
    // map that never asked for one.
    const svg = draw("Siraha");
    assert.doesNotMatch(svg, /<tspan/);
    assert.match(svg, />Siraha<\/text>/);
  });

  test("a newline draws one line per row, spaced by the theme", () => {
    const t = text(draw(THREE));
    assert.deepEqual(t.lines, ["Lahan", "Siraha", "Madhesh Province"]);
    // The first line sits on the element's own baseline; the rest step down.
    assert.deepEqual(t.dys, [0, GAP, GAP]);
  });

  test("every line restates x, or SVG runs them onto one line", () => {
    // A <tspan> without x continues where the previous one ended — the lines
    // would render as one long row with the right glyphs in the wrong place.
    const t = text(draw(THREE));
    assert.deepEqual(t.xs, [t.x, t.x, t.x]);
  });

  test("the block grows upward, so the bottom line lands where one line would", () => {
    const one = text(draw("Siraha"));
    const three = text(draw(THREE));
    assert.equal(three.anchor, one.anchor);
    assert.equal(three.x, one.x);
    // Adding a district and a province must not shove the name off its pin.
    assert.ok(
      Math.abs(three.y + 2 * GAP - one.y) < 0.01,
      `last baseline moved: ${(three.y + 2 * GAP).toFixed(3)} vs ${one.y}`,
    );
  });

  /** Just the drawn text — the pin's accessible title is a separate question. */
  const drawn = (svg: string) => svg.match(/<g class="naksha-labels">.*?<\/g>/s)?.[0];

  test("blank lines are dropped rather than reserved", () => {
    // A trailing newline is a typo in a template. Honouring it would erase a
    // row of dots for nothing.
    assert.equal(drawn(draw("Siraha\n\n")), drawn(draw("Siraha")));
    assert.equal(drawn(draw("  Siraha  ")), drawn(draw("Siraha")));
  });

  test("the accessible title keeps the caller's string exactly as given", () => {
    // Only the *drawing* is line-aware. The title is the name the caller wrote,
    // reformatted by nobody: whitespace collapses for a screen reader anyway,
    // and rejoining the lines would mean naksha picking a separator.
    assert.match(draw(THREE), /<title>Lahan\nSiraha\nMadhesh Province<\/title>/);
  });

  test("a label of nothing but whitespace draws no text, but keeps its name", () => {
    const svg = draw("\n \n");
    assert.doesNotMatch(svg, /class="naksha-labels"/);
    assert.match(svg, /class="naksha-pin"/);
  });

  test("the searching modes place the whole block, not just the first line", () => {
    // The regression this guards: a placement that measured one line's height
    // clears the field with line 1 and drops lines 2 and 3 straight onto it.
    for (const mode of ["avoid-region", "clear"] as const) {
      const b = box(text(draw(THREE, { labelPlacement: mode })));
      assert.equal(buried(b, siraha.id), 0, `${mode}: stacked label buries its own district`);
    }
  });

  test("stacking is what makes a three-part name affordable at the national view", () => {
    // Not a style preference: flat, the same name is a third of the frame wide
    // and hides more of the field than the district it names contains.
    const flat = box(text(draw("Lahan, Siraha, Madhesh Province")));
    const stacked = box(text(draw(THREE)));
    assert.ok(
      stacked.x1 - stacked.x0 < (flat.x1 - flat.x0) / 1.8,
      `stacked ${(stacked.x1 - stacked.x0).toFixed(1)} vs flat ${(flat.x1 - flat.x0).toFixed(1)}`,
    );
    assert.ok(stacked.y1 - stacked.y0 > flat.y1 - flat.y0, "a stacked label is taller");
  });

  test("the anchor flips on the widest line, not the first", () => {
    // A short first line over a long one still has to clear the frame edge.
    const east = grid.dots.reduce((a, d) => (d.col > a.col ? d : a));
    const svg = renderSvg(grid, {
      points: [{ lng: east.lng, lat: east.lat, label: "Ilam\nKoshi Province, far east" }],
      labels: true,
    });
    assert.equal(text(svg).anchor, "end");
  });

  test("labelLineHeight sets the spacing and touches nothing else", () => {
    const wide = text(draw(THREE, { theme: { labelLineHeight: 2 } }));
    assert.deepEqual(wide.dys, [0, 2.2, 2.2]);
    // Still anchored so the bottom line sits where a one-line label would.
    const one = text(draw("Siraha"));
    assert.ok(Math.abs(wide.y + 2 * 2.2 - one.y) < 0.01);
    // And a map with no stacked labels renders identically whatever it is set to.
    assert.equal(draw("Siraha", { theme: { labelLineHeight: 2 } }), draw("Siraha"));
  });
});

describe("naming a place", () => {
  // Lahan is a town in Siraha — the case that motivated these helpers.
  const lahan = { lng: 86.4833, lat: 26.72, label: "Lahan", labelNp: "लहान" };

  test("joins a place to its district with a comma by default", () => {
    assert.equal(describePlace(lahan), "Lahan, Siraha");
    assert.equal(describePlace(lahan, { lang: "np" }), "लहान, सिराहा");
  });

  test("takes any separator, so the caller owns the formatting", () => {
    assert.equal(describePlace(lahan, { separator: " · " }), "Lahan · Siraha");
    assert.equal(describePlace(lahan, { separator: "\n" }), "Lahan\nSiraha");
  });

  test("never doubles a place up with the district it is named after", () => {
    const siraha = districtByName("Siraha")!;
    assert.equal(describePlace({ lng: 86.2, lat: 26.65, label: siraha.name }), "Siraha");
  });

  test("degrades instead of producing a dangling separator", () => {
    // No name of its own — the district alone.
    assert.equal(describePlace({ lng: 86.4833, lat: 26.72 }), "Siraha");
    // Outside Nepal — its own name alone, with no district to add.
    assert.equal(describePlace({ lng: 77.209, lat: 28.6139, label: "Delhi" }), "Delhi");
    // Nothing to say at all.
    assert.equal(describePlace({ lng: 77.209, lat: 28.6139 }), undefined);
  });

  test("exposes the pieces so a consumer can build its own label", () => {
    const parts = placeParts(lahan);
    assert.equal(parts.name, "Lahan");
    assert.equal(parts.district, "Siraha");
    assert.equal(parts.province, "Madhesh Province");
    assert.equal(parts.hq, "Siraha");
    assert.equal(parts.pcode, "NP0216");
    assert.equal(parts.region?.id, districtByName("Siraha")!.id);
    // Every field is optional, so a point outside Nepal is not a crash.
    assert.deepEqual(placeParts({ lng: 77.209, lat: 28.6139 }), {
      name: undefined, region: undefined, district: undefined,
      province: undefined, hq: undefined, pcode: undefined,
    });
  });
});

describe("label and leader theming", () => {
  const grid = nepalGrid({ bbox: VIEWS.nepal });
  const point = { lng: 86.4833, lat: 26.72, label: "Lahan" };

  test("label colour and leader colour are independent theme props", () => {
    const svg = renderSvg(grid, {
      points: [point],
      labels: true,
      labelPlacement: "clear",
      theme: { label: "#16a34a", leader: "#ea580c", leaderWidth: 0.2, leaderOpacity: 0.9 },
    });
    assert.match(svg, /<text[^>]*fill="#16a34a"/);
    assert.match(svg, /class="naksha-leader"[^>]*stroke="#ea580c"/);
    assert.match(svg, /class="naksha-leader"[^>]*stroke-width="0\.2"/);
    assert.match(svg, /class="naksha-leader"[^>]*opacity="0\.9"/);
  });

  test("an untouched theme still draws the leader in the label colour", () => {
    const svg = renderSvg(grid, { points: [point], labels: true, labelPlacement: "clear" });
    assert.match(svg, /class="naksha-leader"[^>]*stroke="#0f172a"/);
    assert.match(svg, /class="naksha-leader"[^>]*opacity="0\.45"/);
  });
});

describe("region anchors", () => {
  const grid = nepalGrid();

  test("resolves for every district the grid draws", () => {
    const missing = [...grid.regions].filter((id) => !regionAnchor(grid, id));
    assert.deepEqual(missing, [], `regions with no anchor: ${missing.join(", ")}`);
  });

  test("returns a dot that belongs to the region asked for", () => {
    for (const id of grid.regions) assert.equal(regionAnchor(grid, id)!.region, id);
  });

  test("returns a dot the grid actually drew, not a synthesised centroid", () => {
    const dots = new Set(grid.dots);
    for (const id of grid.regions) assert.ok(dots.has(regionAnchor(grid, id)!));
  });

  test("is undefined for a region with no dots", () => {
    assert.equal(regionAnchor(grid, OUTSIDE), undefined);
    assert.equal(regionAnchor(grid, 9999), undefined);
  });

  test("memoises against the grid, and keys per grid rather than globally", () => {
    assert.equal(regionAnchor(grid, 27), regionAnchor(grid, 27));
    const other = buildGrid(nepalRaster(), { bbox: VIEWS.bagmati });
    // A different viewport is a different dot field, so the same district
    // anchors somewhere else. A cache keyed on anything but the grid would
    // hand the second call the first grid's dot.
    assert.notEqual(regionAnchor(other, 27), regionAnchor(grid, 27));
  });

  test("is a district anchor, not a town locator", () => {
    // Guards the documented contract. Kathmandu the city sits ~4 km from its
    // district's centre of mass, but Morang's anchor is ~24 km from
    // Biratnagar: settlements sit on district edges, centres of mass do not.
    // If this ever starts agreeing closely, the doc comment is wrong.
    const biratnagar = { lng: 87.2718, lat: 26.4525 };
    const morang = districtAt(biratnagar)!;
    const anchor = regionAnchor(grid, morang.id)!;
    assert.ok(
      distanceKm(biratnagar, anchor) > grid.kmPerDot,
      "expected the anchor to miss the town by more than one dot spacing",
    );
  });
});

describe("provinces", () => {
  test("are the seven, numbered 1-7 in order", () => {
    assert.deepEqual(
      PROVINCES.map((p) => p.id),
      [1, 2, 3, 4, 5, 6, 7],
    );
  });

  test("partition the 77 districts exactly once each", () => {
    const ids = PROVINCES.flatMap((p) => [...p.districts]);
    assert.equal(ids.length, DISTRICTS.length);
    assert.equal(new Set(ids).size, DISTRICTS.length);
    assert.deepEqual(
      [...ids].sort((a, b) => a - b),
      DISTRICTS.map((d) => d.id).sort((a, b) => a - b),
    );
  });

  test("agree with the province recorded on each district", () => {
    for (const p of PROVINCES) {
      for (const id of p.districts) {
        const d = districtById(id)!;
        assert.equal(d.province, p.id);
        assert.equal(d.provinceName, p.name);
        assert.equal(d.provinceNameNp, p.nameNp);
      }
    }
  });

  test("carry both scripts", () => {
    for (const p of PROVINCES) {
      assert.ok(p.name.length > 0);
      assert.match(p.nameNp, /[ऀ-ॿ]/);
    }
  });

  test("provinceById resolves 1-7 and nothing else", () => {
    for (const p of PROVINCES) assert.equal(provinceById(p.id), p);
    assert.equal(provinceById(0), undefined);
    assert.equal(provinceById(8), undefined);
  });
});

describe("headquarters coordinates", () => {
  const withHq = DISTRICTS.filter((d) => d.hqAt);

  test("cover every district except the three the source predates", () => {
    const without = DISTRICTS.filter((d) => !d.hqAt).map((d) => d.name);
    // The upstream point set is the 75-district one. Nawalparasi East and both
    // Rukums were created by the 2015 split, so no point can be theirs — see
    // AMBIGUOUS_HQ in tools/build-raster.ts.
    assert.deepEqual(without.sort(), ["Nawalparasi East", "Rukum East", "Rukum West"]);
    assert.equal(withHq.length, 74);
  });

  test("each sits inside the district it belongs to", () => {
    for (const d of withHq) assert.equal(districtAt(d.hqAt!)?.id, d.id, `${d.name} HQ is outside it`);
  });

  test("are distinct — no two districts share a headquarters point", () => {
    const keys = withHq.map((d) => `${d.hqAt!.lng},${d.hqAt!.lat}`);
    assert.equal(new Set(keys).size, keys.length);
  });

  test("land inside Nepal's frozen bbox", () => {
    for (const d of withHq) {
      const { lng, lat } = d.hqAt!;
      assert.ok(lng >= 80.05 && lng <= 88.21, `${d.name} lng ${lng}`);
      assert.ok(lat >= 26.34 && lat <= 30.45, `${d.name} lat ${lat}`);
    }
  });

  test("are close to where the towns actually are", () => {
    // Independent spot checks against published positions, not against the
    // generator's own output — this is the test that would catch a bad join.
    const known: [string, number, number][] = [
      ["Kathmandu", 85.324, 27.7172],
      ["Kaski", 83.9856, 28.2096],
      ["Morang", 87.2718, 26.4525],
      ["Jumla", 82.1833, 29.2747],
      ["Parsa", 84.88, 27.0104],
    ];
    for (const [district, lng, lat] of known) {
      const d = districtByName(district)!;
      assert.ok(
        distanceKm({ lng, lat }, d.hqAt!) < 6,
        `${district} HQ is ${distanceKm({ lng, lat }, d.hqAt!).toFixed(1)} km from the known position`,
      );
    }
  });

  test("beat the district anchor at locating a headquarters", () => {
    // The whole reason hqAt exists. regionAnchor is a district's centre of
    // mass; if it were as good as a real coordinate, this data would be dead
    // weight.
    const grid = nepalGrid();
    let exact = 0, anchored = 0;
    for (const d of withHq) {
      const a = regionAnchor(grid, d.id)!;
      if (distanceKm(d.hqAt!, a) <= grid.kmPerDot) anchored++;
      exact++;
    }
    assert.ok(
      anchored / exact < 0.6,
      `anchors matched ${anchored}/${exact} HQs within one dot — hqAt would be redundant`,
    );
  });
});

/**
 * The smallest `<svg>` `attachInteractions` will accept.
 *
 * The transform is the identity, so a client coordinate *is* a viewBox
 * coordinate and a test can aim straight at `col + 0.5, row + 0.5`. Everything
 * else is the minimum the module actually reaches for.
 */
function fakeSvg() {
  const listeners = new Map<string, Set<(e: unknown) => void>>();
  const attrs = new Map<string, string>();
  const identity = { inverse: () => identity };
  return {
    style: { cursor: "" },
    ownerDocument: { createElementNS: () => ({ setAttribute() {}, remove() {} }) },
    getScreenCTM: () => identity,
    createSVGPoint() {
      return {
        x: 0,
        y: 0,
        matrixTransform(this: { x: number; y: number }) {
          return { x: this.x, y: this.y };
        },
      };
    },
    querySelector: () => null,
    getAttribute: (k: string) => attrs.get(k) ?? null,
    setAttribute: (k: string, v: string) => void attrs.set(k, v),
    removeAttribute: (k: string) => void attrs.delete(k),
    addEventListener(type: string, fn: (e: unknown) => void) {
      (listeners.get(type) ?? listeners.set(type, new Set()).get(type)!).add(fn);
    },
    removeEventListener(type: string, fn: (e: unknown) => void) {
      listeners.get(type)?.delete(fn);
    },
    /** Deliver an event to whatever `attachInteractions` registered. */
    fire(type: string, event: Record<string, unknown> = {}) {
      for (const fn of [...(listeners.get(type) ?? [])]) {
        fn({ type, target: null, preventDefault() {}, ...event });
      }
    },
  };
}

describe("dot-level hover events", () => {
  // `resolve` asks `e.target instanceof Element` before it hit-tests, and Node
  // has no Element. The stub only has to exist for that check to answer false.
  const globals = globalThis as Record<string, unknown>;
  const prior = globals.Element;
  const had = "Element" in globals;
  before(() => {
    globals.Element = class Element {};
  });
  after(() => {
    if (had) globals.Element = prior;
    else delete globals.Element;
  });

  /** Two dots side by side in the same district, so a sweep stays inside it. */
  function adjacentPair() {
    const grid = nepalGrid();
    const index = dotIndex(grid);
    for (const dot of grid.dots) {
      const right = index.get(dot.row * grid.cols + dot.col + 1);
      if (right && right.region === dot.region) return { grid, a: dot, b: right };
    }
    throw new Error("no two adjacent dots share a district");
  }

  const at = (svg: ReturnType<typeof fakeSvg>, dot: { col: number; row: number }) =>
    svg.fire("pointermove", { clientX: dot.col + 0.5, clientY: dot.row + 0.5 });

  test("a sweep within one district reports every dot, not just the first", () => {
    const { grid, a, b } = adjacentPair();
    const svg = fakeSvg();
    const dots: string[] = [];
    let regions = 0;

    attachInteractions(svg as never, grid, {
      onDotEnter: (dot) => dots.push(`${dot.col},${dot.row}`),
      onRegionEnter: () => regions++,
    });

    at(svg, a);
    at(svg, b);

    // The bug: `onRegionEnter` keys on the district, so the second dot was
    // silent and anything read off its `dot` — a coordinate above all — stayed
    // stuck on the first.
    assert.deepEqual(dots, [`${a.col},${a.row}`, `${b.col},${b.row}`]);
    // The region contract is unchanged: one district crossed, one enter.
    assert.equal(regions, 1);
  });

  test("the dot reported is the dot pointed at", () => {
    const { grid, a, b } = adjacentPair();
    const svg = fakeSvg();
    const seen: Array<{ lng: number; lat: number }> = [];

    attachInteractions(svg as never, grid, {
      onDotEnter: (dot) => seen.push({ lng: dot.lng, lat: dot.lat }),
    });

    at(svg, a);
    at(svg, b);

    assert.deepEqual(seen, [
      { lng: a.lng, lat: a.lat },
      { lng: b.lng, lat: b.lat },
    ]);
  });

  test("staying on one dot does not re-fire", () => {
    const { grid, a } = adjacentPair();
    const svg = fakeSvg();
    let enters = 0;

    attachInteractions(svg as never, grid, { onDotEnter: () => enters++ });
    at(svg, a);
    at(svg, a);
    at(svg, a);

    assert.equal(enters, 1);
  });

  test("leaves come before enters, so one readout ends on the new dot", () => {
    const { grid, a, b } = adjacentPair();
    const svg = fakeSvg();
    const log: string[] = [];

    attachInteractions(svg as never, grid, {
      onDotEnter: (dot) => log.push(`enter ${dot.col},${dot.row}`),
      onDotLeave: () => log.push("leave"),
    });

    at(svg, a);
    at(svg, b);

    assert.deepEqual(log, [`enter ${a.col},${a.row}`, "leave", `enter ${b.col},${b.row}`]);
  });

  test("leaving the dot field reports the leave once", () => {
    const { grid, a } = adjacentPair();
    const svg = fakeSvg();
    let leaves = 0;

    attachInteractions(svg as never, grid, { onDotLeave: () => leaves++ });
    at(svg, a);
    // Far outside the grid, so `hitTest` misses.
    svg.fire("pointermove", { clientX: -50, clientY: -50 });
    svg.fire("pointermove", { clientX: -50, clientY: -50 });

    assert.equal(leaves, 1);
  });

  test("arrow keys report each dot they step onto", () => {
    const { grid, a, b } = adjacentPair();
    const svg = fakeSvg();
    const dots: string[] = [];
    let regions = 0;

    attachInteractions(svg as never, grid, {
      keyboard: true,
      onDotEnter: (dot) => dots.push(`${dot.col},${dot.row}`),
      onRegionEnter: () => regions++,
    });

    at(svg, a);
    svg.fire("keydown", { key: "ArrowRight" });

    assert.deepEqual(dots, [`${a.col},${a.row}`, `${b.col},${b.row}`]);
    assert.equal(regions, 1);
  });
});

describe("clamping a viewport to the frame", () => {
  const span = (b: { lo: number; hi: number }) => b.hi - b.lo;
  const aspect = (b: { lo: number; hi: number; la: number; ha: number }) =>
    (b.hi - b.lo) / (b.ha - b.la);

  test("a box already inside is returned as it was", () => {
    const box = { lo: 84, hi: 85, la: 27, ha: 28 };
    assert.deepEqual(clampBbox(box), box);
  });

  test("a box hanging off the edge slides back in at the same size", () => {
    const box = { lo: 87.5, hi: 89.5, la: 30, ha: 31 };
    const clamped = clampBbox(box);
    assert.equal(span(clamped), span(box));
    assert.equal(clamped.hi, NEPAL_BBOX.hi);
    assert.equal(clamped.ha, NEPAL_BBOX.ha);
    assert.ok(clamped.lo >= NEPAL_BBOX.lo);
  });

  test("a box larger than the frame shrinks uniformly rather than squashing", () => {
    const box = { lo: 70, hi: 100, la: 20, ha: 35 };
    const clamped = clampBbox(box);
    assert.ok(Math.abs(aspect(clamped) - aspect(box)) < 1e-9);
    assert.ok(span(clamped) <= span(NEPAL_BBOX) + 1e-9);
    assert.ok(clamped.ha - clamped.la <= NEPAL_BBOX.ha - NEPAL_BBOX.la + 1e-9);
  });
});

describe("zooming a viewport", () => {
  const span = (b: { lo: number; hi: number }) => b.hi - b.lo;
  const inFrame = (b: { lo: number; hi: number; la: number; ha: number }) =>
    b.lo >= NEPAL_BBOX.lo - 1e-9 &&
    b.hi <= NEPAL_BBOX.hi + 1e-9 &&
    b.la >= NEPAL_BBOX.la - 1e-9 &&
    b.ha <= NEPAL_BBOX.ha + 1e-9;
  /** Scaling about a point is four multiplications, so results land a few ulps
   *  off a round number. Compared to a tolerance far tighter than a metre. */
  const sameBox = (
    a: { lo: number; hi: number; la: number; ha: number },
    b: { lo: number; hi: number; la: number; ha: number },
    message?: string,
  ) => {
    for (const k of ["lo", "hi", "la", "ha"] as const) {
      assert.ok(Math.abs(a[k] - b[k]) < 1e-9, `${message ?? "box"}: ${k} differs`);
    }
  };

  test("factor 2 halves the span about the centre", () => {
    const box = { lo: 84, hi: 86, la: 27, ha: 28 };
    const zoomed = zoomBbox(box, 2);
    assert.ok(Math.abs(span(zoomed) - 1) < 1e-9);
    assert.ok(Math.abs((zoomed.lo + zoomed.hi) / 2 - 85) < 1e-9);
    assert.ok(Math.abs((zoomed.la + zoomed.ha) / 2 - 27.5) < 1e-9);
  });

  test("a centre is held still, so zoom-at-cursor keeps that point put", () => {
    const box = { lo: 84, hi: 86, la: 27, ha: 28 };
    const center = { lng: 84.5, lat: 27.25 };
    const zoomed = zoomBbox(box, 4, { center });
    // Same fractional position across the box before and after.
    const before = (center.lng - box.lo) / span(box);
    const after = (center.lng - zoomed.lo) / span(zoomed);
    assert.ok(Math.abs(before - after) < 1e-9);
  });

  test("zooming in stops at the raster's own resolution", () => {
    let box = NEPAL_BBOX as { lo: number; hi: number; la: number; ha: number };
    for (let i = 0; i < 20; i++) box = zoomBbox(box, 2);
    assert.ok(Math.abs(span(box) - MIN_ZOOM_SPAN) < 1e-9);
    // Held there rather than creeping: another step changes nothing.
    sameBox(zoomBbox(box, 2), box);
  });

  test("a box already below the floor can still zoom out", () => {
    const tight = { lo: 85.3, hi: 85.4, la: 27.65, ha: 27.7 };
    sameBox(zoomBbox(tight, 2), tight, "refuses to go further in");
    assert.ok(span(zoomBbox(tight, 0.5)) > span(tight), "but still opens up");
  });

  test("zooming out is capped by the frame and never leaves it", () => {
    let box = { lo: 85.3, hi: 85.6, la: 27.6, ha: 27.75 };
    for (let i = 0; i < 20; i++) {
      box = zoomBbox(box, 0.5);
      assert.ok(inFrame(box), `left the frame at step ${i}`);
    }
    assert.ok(Math.abs(span(box) - span(NEPAL_BBOX)) < 1e-9);
  });

  test("a full zoom ladder in and back out returns the frame", () => {
    let box = NEPAL_BBOX as { lo: number; hi: number; la: number; ha: number };
    for (let i = 0; i < 9; i++) box = zoomBbox(box, 2);
    for (let i = 0; i < 9; i++) box = zoomBbox(box, 0.5);
    sameBox(box, NEPAL_BBOX, "round trip");
  });

  test("the box keeps its shape zooming into a corner, where the clamp bites", () => {
    // Shape measured the way the map is actually drawn: `aspectWidth` is what
    // sets the viewBox, and it narrows a longitude degree by cos(lat). A ratio
    // of raw degrees says "unchanged" while the rendered map is rescaling, so
    // this asserts the column count and the ground aspect instead.
    const start = aspectWidth(NEPAL_BBOX, 40);
    const ground = (b: Bbox) => {
      const { width, height } = bboxSizeKm(b);
      return width / height;
    };
    const startGround = ground(NEPAL_BBOX);
    let box = NEPAL_BBOX as Bbox;
    for (let i = 0; i < 12; i++) {
      box = zoomBbox(box, 1.6, { center: { lng: NEPAL_BBOX.hi, lat: NEPAL_BBOX.ha } });
      assert.ok(inFrame(box), `left the frame at step ${i}`);
      assert.equal(aspectWidth(box, 40), start, `column count moved at step ${i}`);
      assert.ok(Math.abs(ground(box) - startGround) < 5e-3, `ground aspect drifted at step ${i}`);
    }
  });

  test("zooming out lands on the frame, so a panned box can always get back", () => {
    // Not the largest box of the current shape that fits inside it: `panBbox`
    // carries a ground width, so a box that has travelled north is a few
    // percent wider in degrees than the frame. Settling on "as big as this
    // shape gets" would clip the southern Terai and never open again.
    const panned = panBbox(zoomBbox(NEPAL_BBOX, 8), { lng: 87.9, lat: 30.3 });
    let box = panned;
    for (let i = 0; i < 12; i++) box = zoomBbox(box, 0.5);
    sameBox(box, NEPAL_BBOX, "zoomed all the way out after a drag");
  });

  test("a custom limit is honoured over the national frame", () => {
    const limit = { lo: 85, hi: 86, la: 27, ha: 28 };
    const box = zoomBbox({ lo: 85.4, hi: 85.6, la: 27.4, ha: 27.6 }, 0.01, { limit });
    sameBox(box, limit);
  });
});

describe("panning a viewport", () => {
  const cols = (b: Bbox) => aspectWidth(b, 40);
  const ground = (b: Bbox) => bboxSizeKm(b);

  test("it centres the box on the point, to the nearest whole dot", () => {
    const from = { lo: 84, hi: 85, la: 27, ha: 28 };
    const box = panBbox(from, { lng: 86, lat: 28.5 });
    // Snapped, not exact: a dot map cannot translate by less than a dot, and
    // the half-dot it declines to move is the resolution it already admits to.
    const cellLng = (box.hi - box.lo) / aspectWidth(from, 40);
    const cellLat = (box.ha - box.la) / 40;
    assert.ok(Math.abs((box.lo + box.hi) / 2 - 86) <= cellLng / 2 + 1e-9);
    assert.ok(Math.abs((box.la + box.ha) / 2 - 28.5) <= cellLat / 2 + 1e-9);
  });

  test("the dot field is the old one shifted, not resampled", () => {
    // The reported bug, in its second form: the lattice is anchored to the box,
    // so a box that slides by a fraction of a cell re-samples every cell
    // against different ground and the silhouette re-forms in place. Measured
    // before the snap, half a dot of pan changed 387 of 1,990 dots.
    const raster = nepalRaster();
    const start = zoomBbox(NEPAL_BBOX, 2);
    const first = buildGrid(raster, { bbox: start });
    const cell = (start.hi - start.lo) / first.cols;
    const centre = { lng: (start.lo + start.hi) / 2, lat: (start.la + start.ha) / 2 };
    const before = new Map(first.dots.map((d) => [`${d.col},${d.row}`, d.region]));

    for (let sixths = 1; sixths <= 12; sixths++) {
      const box = panBbox(start, { lng: centre.lng + (sixths / 6) * cell, lat: centre.lat });
      const grid = buildGrid(raster, { bbox: box });
      const by = Math.round((box.lo - start.lo) / cell);
      let compared = 0;
      for (const d of grid.dots) {
        const col = d.col + by; // back into the starting field's columns
        if (col < 0 || col >= first.cols) continue; // arrived from off-screen
        compared++;
        assert.equal(
          before.get(`${col},${d.row}`),
          d.region,
          `dot ${d.col},${d.row} changed after panning ${sixths / 6} of a dot`,
        );
      }
      assert.ok(compared > 1000, "expected most of the field to be comparable");
    }
  });

  test("the drawn shape does not move, which is the whole point", () => {
    // The reported bug: dragging the overview made the map's own edges change
    // shape. A pan that carries the degree span shrinks on the ground as it
    // goes north, `aspectWidth` answers with fewer columns, and the rendered
    // map rescales mid-drag.
    let box: Bbox = zoomBbox(NEPAL_BBOX, 4);
    const start = cols(box);
    const seen = new Set<number>();
    for (let lat = 26.3; lat <= 30.5; lat += 0.05) {
      for (const lng of [80.1, 84, 88.2]) {
        box = panBbox(box, { lng, lat });
        seen.add(cols(box));
      }
    }
    assert.deepEqual([...seen], [start], `column count moved while panning: ${[...seen]}`);
  });

  test("the same pan the old way does move it — the regression this guards", () => {
    // Kept as a measurement rather than a claim: `clampBbox` on a hand-rolled
    // box is the obvious way to write a pan, and it is what the demo and the
    // README both used to do.
    const box = zoomBbox(NEPAL_BBOX, 4);
    const w = box.hi - box.lo;
    const h = box.ha - box.la;
    const byDegrees = (lat: number) =>
      clampBbox({ lo: 84 - w / 2, hi: 84 + w / 2, la: lat - h / 2, ha: lat + h / 2 });
    const seen = new Set([26.9, 28.4, 29.9].map((lat) => cols(byDegrees(lat))));
    assert.ok(seen.size > 1, "expected the degree-carrying pan to change the column count");
  });

  test("the ground size is held to within a column of dots, and the shape exactly", () => {
    // Not to the last metre: the degree width is kept exactly while it still
    // draws the same number of columns, because a width that moves every frame
    // re-phases the lattice the snap exists to pin. The slack is aspectWidth's
    // own rounding, and the column count — which is what the shape is actually
    // made of — does not move at all. Swept every 0.01 degree of latitude at
    // four zooms, the widest drift measured is 0.64 of a column, 0.91%.
    const box = zoomBbox(NEPAL_BBOX, 4);
    const before = ground(box);
    const column = before.width / cols(box);
    for (let lat = 26.3; lat <= 30.5; lat += 0.05) {
      const moved = panBbox(box, { lng: 84, lat });
      const after = ground(moved);
      assert.ok(
        Math.abs(after.width - before.width) < column,
        `ground width moved ${Math.abs(after.width - before.width).toFixed(3)} km at ${lat}`,
      );
      assert.ok(Math.abs(after.height - before.height) < 0.05, `ground height moved at ${lat}`);
      assert.equal(cols(moved), cols(box), `column count moved at ${lat}`);
    }
  });

  test("a drag past the border slides back in rather than showing empty frame", () => {
    for (const to of [
      { lng: 60, lat: 40 },
      { lng: 99, lat: 10 },
      { lng: 84, lat: 99 },
    ]) {
      const box = panBbox(zoomBbox(NEPAL_BBOX, 4), to);
      assert.ok(box.lo >= NEPAL_BBOX.lo - 1e-9 && box.hi <= NEPAL_BBOX.hi + 1e-9, "lng left the frame");
      assert.ok(box.la >= NEPAL_BBOX.la - 1e-9 && box.ha <= NEPAL_BBOX.ha + 1e-9, "lat left the frame");
    }
  });

  test("a custom limit is honoured, and a box that cannot fit it shrinks", () => {
    const limit = { lo: 85, hi: 86, la: 27, ha: 28 };
    const inside = panBbox({ lo: 85.2, hi: 85.4, la: 27.2, ha: 27.4 }, { lng: 85.9, lat: 27.9 }, { limit });
    assert.ok(inside.hi <= limit.hi + 1e-9 && inside.ha <= limit.ha + 1e-9);
    const big = panBbox(NEPAL_BBOX, { lng: 85.5, lat: 27.5 }, { limit });
    assert.ok(big.hi - big.lo <= limit.hi - limit.lo + 1e-9);
    assert.ok(big.ha - big.la <= limit.ha - limit.la + 1e-9);
  });

  test("panning to where it already is changes nothing", () => {
    const box = zoomBbox(NEPAL_BBOX, 4);
    const again = panBbox(box, { lng: (box.lo + box.hi) / 2, lat: (box.la + box.ha) / 2 });
    for (const k of ["lo", "hi", "la", "ha"] as const) {
      assert.ok(Math.abs(again[k] - box[k]) < 1e-9, `${k} drifted`);
    }
  });
});

describe("a grid aligned to a lattice", () => {
  const raster = nepalRaster();

  test("aligning to the viewport itself is exactly the default", () => {
    const bbox = VIEWS.bagmati;
    const plain = buildGrid(raster, { bbox });
    const aligned = buildGrid(raster, { bbox, align: bbox });
    assert.equal(aligned.cols, plain.cols);
    assert.equal(aligned.rows, plain.rows);
    assert.deepEqual(aligned.viewBox, { x: 0, y: 0, cols: plain.cols, rows: plain.rows });
    assert.equal(aligned.dots.length, plain.dots.length);
    assert.equal(renderSvg(aligned), renderSvg(plain));
  });

  test("a plain grid's window is its whole field", () => {
    const grid = buildGrid(raster, { bbox: VIEWS.nepal });
    assert.deepEqual(grid.viewBox, { x: 0, y: 0, cols: grid.cols, rows: grid.rows });
  });

  test("dots keep their ground position as the viewport slides between them", () => {
    // The whole point. Unaligned, the lattice is anchored to the viewport, so
    // a box that moves by a fraction of a cell re-samples every cell against
    // different ground and the silhouette re-forms in place. Aligned, the
    // dots are pinned to the ground and only the window moves.
    const lattice = zoomBbox(NEPAL_BBOX, 2);
    const base = buildGrid(raster, { bbox: lattice, align: lattice });
    const cell = (lattice.hi - lattice.lo) / base.cols;
    const home = new Map(base.dots.map((d) => [`${d.lng.toFixed(6)},${d.lat.toFixed(6)}`, d.region]));

    for (let tenths = 1; tenths <= 25; tenths++) {
      const to = {
        lng: (lattice.lo + lattice.hi) / 2 + (tenths / 10) * cell,
        lat: (lattice.la + lattice.ha) / 2,
      };
      const grid = buildGrid(raster, { bbox: panBbox(lattice, to, { align: lattice }), align: lattice });
      let seen = 0;
      for (const d of grid.dots) {
        const key = `${d.lng.toFixed(6)},${d.lat.toFixed(6)}`;
        const was = home.get(key);
        if (was === undefined) continue; // scrolled in from beyond the first field
        seen++;
        assert.equal(was, d.region, `the dot at ${key} changed district after ${tenths / 10} of a cell`);
      }
      assert.ok(seen > 1000, `expected the fields to overlap, saw ${seen}`);
    }
  });

  test("the window keeps its size and its shape while the box slides", () => {
    const lattice = zoomBbox(NEPAL_BBOX, 4);
    const start = buildGrid(raster, { bbox: lattice, align: lattice });
    for (let lat = 26.4; lat <= 30.4; lat += 0.1) {
      for (const lng of [80.3, 84, 87.9]) {
        const box = panBbox(lattice, { lng, lat }, { align: lattice });
        const grid = buildGrid(raster, { bbox: box, align: lattice });
        assert.ok(Math.abs(grid.viewBox.cols - start.viewBox.cols) < 1e-9, `cols moved at ${lat}`);
        assert.ok(Math.abs(grid.viewBox.rows - start.viewBox.rows) < 1e-9, `rows moved at ${lat}`);
        // And the field always covers the window it is reporting.
        assert.ok(grid.viewBox.x >= -1e-9 && grid.viewBox.x + grid.viewBox.cols <= grid.cols + 1e-9);
        assert.ok(grid.viewBox.y >= -1e-9 && grid.viewBox.y + grid.viewBox.rows <= grid.rows + 1e-9);
      }
    }
  });

  test("the field is at most one row and one column bigger than the window", () => {
    const lattice = zoomBbox(NEPAL_BBOX, 4);
    for (let lat = 26.4; lat <= 30.4; lat += 0.25) {
      const grid = buildGrid(raster, {
        bbox: panBbox(lattice, { lng: 84.3, lat }, { align: lattice }),
        align: lattice,
      });
      assert.ok(grid.cols <= Math.ceil(grid.viewBox.cols) + 1, `field too wide at ${lat}`);
      assert.ok(grid.rows <= Math.ceil(grid.viewBox.rows) + 1, `field too tall at ${lat}`);
    }
  });

  test("the SVG viewBox carries the sub-cell offset, so a pan can glide", () => {
    const lattice = zoomBbox(NEPAL_BBOX, 2);
    const cols = buildGrid(raster, { bbox: lattice, align: lattice }).cols;
    const cell = (lattice.hi - lattice.lo) / cols;
    const half = {
      lo: lattice.lo + cell / 2,
      hi: lattice.hi + cell / 2,
      la: lattice.la,
      ha: lattice.ha,
    };
    const grid = buildGrid(raster, { bbox: half, align: lattice });
    assert.ok(Math.abs(grid.viewBox.x - 0.5) < 1e-6, `offset was ${grid.viewBox.x}`);
    const svg = renderSvg(grid);
    assert.match(svg, /viewBox="0\.5 0 70 40"/);
  });
});

describe("district bounds", () => {
  test("every district has one, and it holds that district's HQ", () => {
    let withBox = 0;
    let checked = 0;
    for (const d of DISTRICTS) {
      const box = districtBbox(d.id);
      if (!box) continue;
      withBox++;
      if (!d.hqAt) continue;
      checked++;
      assert.ok(
        d.hqAt.lng >= box.lo && d.hqAt.lng <= box.hi && d.hqAt.lat >= box.la && d.hqAt.lat <= box.ha,
        `${d.name} HQ falls outside its own bounds`,
      );
    }
    assert.equal(withBox, DISTRICTS.length);
    assert.ok(checked > 70, "expected most HQs to carry a coordinate");
  });

  test("the box contains the district's own dots and is smaller than the frame", () => {
    const ktm = districtByName("Kathmandu")!;
    const box = districtBbox(ktm.id)!;
    const grid = nepalGrid();
    for (const dot of grid.dots) {
      if (dot.region !== ktm.id) continue;
      // The dot's own coordinate is its cell centre at the national view, which
      // can sit up to half a cell outside a district it only mostly covers.
      const slack = grid.kmPerDot / 111;
      assert.ok(dot.lng >= box.lo - slack && dot.lng <= box.hi + slack);
      assert.ok(dot.lat >= box.la - slack && dot.lat <= box.ha + slack);
    }
    const size = bboxSizeKm(box);
    assert.ok(size.width < 60 && size.height < 60, `Kathmandu box is ${size.width}x${size.height} km`);
  });

  test("an id no district carries has no bounds", () => {
    assert.equal(districtBbox(OUTSIDE), undefined);
    assert.equal(districtBbox(250), undefined);
  });
});

describe("the viewport rectangle on an overview map", () => {
  const overview = () => buildGrid(nepalRaster(), { bbox: NEPAL_BBOX, height: 14 });
  const rectOf = (svg: string) => svg.match(/<rect class="naksha-viewport"[^>]*\/>/)?.[0];
  const attr = (rect: string, name: string) =>
    Number(rect.match(new RegExp(`${name}="([-0-9.]+)"`))![1]);

  test("nothing is drawn unless a viewport is asked for", () => {
    assert.equal(rectOf(renderSvg(overview(), {})), undefined);
  });

  test("it lands where the box projects to", () => {
    const grid = overview();
    const box = { lo: 84.05, hi: 88.21, la: 28.34, ha: 30.45 };
    const rect = rectOf(renderSvg(grid, { viewport: box }))!;
    const nw = project(grid, { lng: box.lo, lat: box.ha });
    const se = project(grid, { lng: box.hi, lat: box.la });
    assert.ok(Math.abs(attr(rect, "x") - nw.x) < 0.01);
    assert.ok(Math.abs(attr(rect, "y") - nw.y) < 0.01);
    assert.ok(Math.abs(attr(rect, "width") - (se.x - nw.x)) < 0.01);
    assert.ok(Math.abs(attr(rect, "height") - (se.y - nw.y)) < 0.01);
  });

  test("the whole frame fills the overview exactly", () => {
    const grid = overview();
    const rect = rectOf(renderSvg(grid, { viewport: NEPAL_BBOX }))!;
    assert.equal(attr(rect, "x"), 0);
    assert.equal(attr(rect, "y"), 0);
    assert.equal(attr(rect, "width"), grid.cols);
    assert.equal(attr(rect, "height"), grid.rows);
  });

  test("a viewport reaching past the overview is clipped to it", () => {
    const grid = buildGrid(nepalRaster(), { bbox: { lo: 84, hi: 86, la: 27, ha: 28 }, height: 14 });
    const rect = rectOf(renderSvg(grid, { viewport: NEPAL_BBOX }))!;
    assert.equal(attr(rect, "x"), 0);
    assert.equal(attr(rect, "width"), grid.cols);
    assert.equal(attr(rect, "height"), grid.rows);
  });

  test("a viewport with no overlap draws nothing at all", () => {
    const west = buildGrid(nepalRaster(), { bbox: { lo: 80.05, hi: 82, la: 26.34, ha: 28 } });
    const east = districtBbox(districtByName("Taplejung")!.id)!;
    assert.equal(rectOf(renderSvg(west, { viewport: east })), undefined);
  });

  test("the tint is themeable, and zero opacity leaves the window hollow", () => {
    const grid = overview();
    const tinted = rectOf(renderSvg(grid, { viewport: VIEWS.bagmati, theme: { viewport: "#ff0000" } }))!;
    assert.match(tinted, /stroke="#ff0000"/);
    assert.match(tinted, /fill="#ff0000"/);
    const hollow = rectOf(
      renderSvg(grid, { viewport: VIEWS.bagmati, theme: { viewportOpacity: 0 } }),
    )!;
    assert.match(hollow, /fill="none"/);
    assert.doesNotMatch(hollow, /fill-opacity/);
  });

  test("it sits above the dots and below the pins", () => {
    const grid = overview();
    const svg = renderSvg(grid, {
      viewport: VIEWS.bagmati,
      points: [{ lng: 85.3, lat: 27.7 }],
    });
    assert.ok(svg.indexOf("naksha-dots") < svg.indexOf("naksha-viewport"));
    assert.ok(svg.indexOf("naksha-viewport") < svg.indexOf("naksha-pins"));
  });
});

describe("the inset", () => {
  const detail = () => buildGrid(nepalRaster(), { bbox: VIEWS.bagmati });
  const groupOf = (svg: string) => {
    const at = svg.indexOf('<g class="naksha-inset"');
    if (at === -1) return undefined;
    // The inset is the last group in the document, so the tail is all of it.
    return svg.slice(at);
  };
  const transform = (g: string) =>
    g.match(/transform="translate\(([-0-9.]+) ([-0-9.]+)\) scale\(([-0-9.]+)\)"/)!
      .slice(1)
      .map(Number);

  test("nothing is drawn unless it is asked for", () => {
    assert.equal(groupOf(renderSvg(detail(), {})), undefined);
    assert.ok(groupOf(renderSvg(detail(), { inset: true })));
  });

  test("it overlays everything, so it is the last layer", () => {
    const svg = renderSvg(detail(), {
      inset: true,
      points: [{ lng: 85.3, lat: 27.7 }],
      routes: [{ stops: [{ lng: 85.3, lat: 27.7 }, { lng: 84.4, lat: 27.9 }] }],
    });
    assert.ok(svg.indexOf("naksha-dots") < svg.indexOf("naksha-inset"));
    assert.ok(svg.indexOf("naksha-routes") < svg.indexOf("naksha-inset"));
    assert.ok(svg.indexOf("naksha-pins") < svg.indexOf("naksha-inset"));
  });

  test("each corner lands in its own corner", () => {
    const grid = detail();
    const at = (corner: "top-left" | "top-right" | "bottom-left" | "bottom-right") =>
      transform(groupOf(renderSvg(grid, { inset: { corner } }))!);

    const [tlx, tly] = at("top-left");
    const [trx, try_] = at("top-right");
    const [blx, bly] = at("bottom-left");
    const [brx, bry] = at("bottom-right");

    assert.equal(tlx, blx, "both left corners share an x");
    assert.equal(trx, brx, "both right corners share an x");
    assert.equal(tly, try_, "both top corners share a y");
    assert.equal(bly, bry, "both bottom corners share a y");
    assert.ok(tlx < trx, "left is left of right");
    assert.ok(tly < bly, "top is above bottom");
    // Inside the frame, on every side.
    assert.ok(tlx > 0 && tly > 0);
    const [, , scale] = at("bottom-right");
    const width = grid.cols * 0.22;
    assert.ok(brx + width <= grid.cols, "right corner stays inside the map");
    assert.ok(scale > 0 && scale < 1, "the inset is a miniature");
  });

  test("size and margin move it the way they say", () => {
    const grid = detail();
    const [x1] = transform(groupOf(renderSvg(grid, { inset: { corner: "top-left", margin: 1 } }))!);
    const [x2] = transform(groupOf(renderSvg(grid, { inset: { corner: "top-left", margin: 4 } }))!);
    assert.ok(Math.abs(x2 - x1 - 3) < 1e-9, "margin is in dot units");

    const small = transform(groupOf(renderSvg(grid, { inset: { size: 0.2 } }))!)[2];
    const big = transform(groupOf(renderSvg(grid, { inset: { size: 0.4 } }))!)[2];
    // Compared loosely because the emitted scale is rounded to three decimals,
    // so the ratio of two printed values is not the ratio of the two exact ones.
    assert.ok(Math.abs(big / small - 2) < 0.01, `twice the size is twice the scale, got ${big / small}`);
  });

  test("the window marks the map's own viewport, and only when there is one", () => {
    // A detail view: the window is drawn and sits inside the inset's own grid.
    const zoomed = groupOf(renderSvg(detail(), { inset: true }))!;
    assert.match(zoomed, /naksha-viewport/);

    // The whole country: nothing to mark, so no window — just the silhouette.
    const whole = buildGrid(nepalRaster(), { bbox: NEPAL_BBOX });
    const full = groupOf(renderSvg(whole, { inset: true }))!;
    assert.doesNotMatch(full, /naksha-viewport/);
    assert.match(full, /naksha-dots/, "the country is still drawn");
  });

  test("the panel is skipped when there is nothing to paint it with", () => {
    const grid = detail();
    assert.match(groupOf(renderSvg(grid, { inset: true }))!, /<rect[^>]*fill="#ffffff"/);
    const bare = groupOf(renderSvg(grid, { inset: { background: "transparent" } }))!;
    assert.doesNotMatch(bare.slice(0, bare.indexOf("naksha-dots")), /<rect/);
    const custom = groupOf(renderSvg(grid, { inset: { background: "#ff00ff" } }))!;
    assert.match(custom, /<rect[^>]*fill="#ff00ff"/);
  });

  test("the inset drops edgeFade, which at 12 rows would wash it out", () => {
    const grid = detail();
    // Every dot opaque: no per-dot opacity attribute survives in the inset.
    const g = groupOf(renderSvg(grid, { inset: true }))!;
    const dots = g.slice(g.indexOf("naksha-dots"));
    assert.doesNotMatch(dots.slice(0, dots.indexOf("naksha-viewport")), /opacity="0\./);
    // And it is an override, not a hard rule.
    const faded = groupOf(renderSvg(grid, { inset: { theme: { edgeFade: 1 } } }))!;
    assert.match(faded, /opacity="0\./);
  });

  test("renderInset is usable on its own, with the same defaults", () => {
    const grid = detail();
    const direct = renderInset(grid, lightTheme, {});
    const viaOptions = groupOf(renderSvg(grid, { inset: true }))!;
    assert.equal(direct, viaOptions.slice(0, direct.length));
  });

  test("a custom bbox limits what the inset covers", () => {
    const grid = buildGrid(nepalRaster(), { bbox: { lo: 85.2, hi: 85.5, la: 27.6, ha: 27.8 } });
    // An inset over one province rather than the country: fewer dots, and the
    // window still resolves because the detail box sits inside it.
    const g = groupOf(renderSvg(grid, { inset: { bbox: VIEWS.bagmati } }))!;
    assert.match(g, /naksha-viewport/);
  });
});

describe("unprojecting back to a coordinate", () => {
  const grid = buildGrid(nepalRaster(), { bbox: VIEWS.bagmati });

  test("it is the exact inverse of project, to floating-point", () => {
    for (const p of [
      { lng: VIEWS.bagmati.lo, lat: VIEWS.bagmati.ha },
      { lng: VIEWS.bagmati.hi, lat: VIEWS.bagmati.la },
      { lng: 85.324, lat: 27.7172 },
      { lng: 85.0, lat: 27.5 },
    ]) {
      const { x, y } = project(grid, p);
      const back = unproject(grid, x, y);
      assert.ok(Math.abs(back.lng - p.lng) < 1e-12, `lng ${back.lng} vs ${p.lng}`);
      assert.ok(Math.abs(back.lat - p.lat) < 1e-12, `lat ${back.lat} vs ${p.lat}`);
    }
  });

  test("the corners of the viewBox are the corners of the box", () => {
    const nw = unproject(grid, 0, 0);
    const se = unproject(grid, grid.cols, grid.rows);
    assert.ok(Math.abs(nw.lng - grid.bbox.lo) < 1e-12);
    assert.ok(Math.abs(nw.lat - grid.bbox.ha) < 1e-12);
    assert.ok(Math.abs(se.lng - grid.bbox.hi) < 1e-12);
    assert.ok(Math.abs(se.lat - grid.bbox.la) < 1e-12);
  });

  test("it is unquantised, so zoom-at-cursor does not snap to a dot centre", () => {
    // Two points inside the same cell must not answer with the same
    // coordinate: rounding to the dot would drift a zoom by half a cell.
    const a = unproject(grid, 10.1, 10.1);
    const b = unproject(grid, 10.9, 10.9);
    assert.notEqual(a.lng, b.lng);
    assert.notEqual(a.lat, b.lat);
    // And it need not land on the field at all — a gesture off the map still
    // has a coordinate, which is what `clampBbox` is then for.
    const off = unproject(grid, -5, -5);
    assert.ok(off.lng < grid.bbox.lo);
    assert.ok(off.lat > grid.bbox.ha);
  });
});

describe("a pointer event in viewBox coordinates", () => {
  /**
   * An `<svg>` whose screen transform is a real scale-and-translate, so a test
   * can tell `eventPoint` apart from "returns clientX untouched".
   *
   * Node has no `DOMPoint`, so this exercises the `createSVGPoint` fallback —
   * which is the branch that matters, since it is the one old WebKit takes.
   */
  function svgAt(scale: number, dx: number, dy: number) {
    const ctm = {
      inverse: () => ({
        apply: (x: number, y: number) => ({ x: (x - dx) / scale, y: (y - dy) / scale }),
      }),
    };
    return {
      getScreenCTM: () => ctm,
      createSVGPoint() {
        return {
          x: 0,
          y: 0,
          matrixTransform(this: { x: number; y: number }, m: { apply: (x: number, y: number) => unknown }) {
            return m.apply(this.x, this.y);
          },
        };
      },
    } as unknown as SVGSVGElement;
  }

  test("the screen transform is applied, not ignored", () => {
    // The map is drawn at 2x and offset 40px right, 12px down the page.
    const at = eventPoint(svgAt(2, 40, 12), { clientX: 140, clientY: 112 } as MouseEvent);
    assert.deepEqual(at, { x: 50, y: 50 });
  });

  test("an element with no transform yet answers null rather than NaN", () => {
    const detached = { getScreenCTM: () => null } as unknown as SVGSVGElement;
    assert.equal(eventPoint(detached, { clientX: 1, clientY: 1 } as MouseEvent), null);
  });

  test("it feeds hitTest and unproject in the same units", () => {
    const grid = buildGrid(nepalRaster(), { bbox: VIEWS.bagmati });
    // Aim at the centre of a dot that exists, through a 3x transform.
    const dot = grid.dots[100];
    const svg = svgAt(3, 7, 9);
    const at = eventPoint(svg, {
      clientX: (dot.col + 0.5) * 3 + 7,
      clientY: (dot.row + 0.5) * 3 + 9,
    } as MouseEvent)!;
    assert.equal(hitTest(grid, at.x, at.y)?.region, dot.region);
    const back = unproject(grid, at.x, at.y);
    assert.ok(Math.abs(back.lng - dot.lng) < 1e-9);
    assert.ok(Math.abs(back.lat - dot.lat) < 1e-9);
  });
});

describe("the inset's colouring", () => {
  const detail = () => buildGrid(nepalRaster(), { bbox: VIEWS.bagmati });
  const groupOf = (svg: string) => {
    const i = svg.indexOf('<g class="naksha-inset"');
    return i === -1 ? null : svg.slice(i);
  };
  const fillsIn = (svg: string) => new Set([...svg.matchAll(/fill="(#[0-9a-f]{6})"/gi)].map((m) => m[1]));
  const red = () => "#ff0000";

  test("it inherits the map's own regionColor, so the miniature matches", () => {
    const g = groupOf(renderSvg(detail(), { regionColor: red, inset: { background: "#ffffff" } }))!;
    assert.ok(fillsIn(g).has("#ff0000"));
  });

  test("an explicit regionColor on the inset wins over the map's", () => {
    const g = groupOf(
      renderSvg(detail(), {
        regionColor: red,
        inset: { background: "#ffffff", regionColor: () => "#00ff00" },
      }),
    )!;
    const fills = fillsIn(g);
    assert.ok(fills.has("#00ff00"));
    assert.ok(!fills.has("#ff0000"));
  });

  test("returning undefined opts back out to a monochrome locator", () => {
    const g = groupOf(
      renderSvg(detail(), {
        regionColor: red,
        inset: { background: "#ffffff", regionColor: () => undefined },
      }),
    )!;
    assert.ok(!fillsIn(g).has("#ff0000"));
    assert.ok(fillsIn(g).has(lightTheme.dot));
  });

  test("renderInset on its own has no parent to inherit from", () => {
    // The default is `renderSvg` handing its own option down; called directly
    // there is nothing to hand down, so the caller passes it or gets the theme.
    assert.ok(!fillsIn(renderInset(detail(), lightTheme, {})).has("#ff0000"));
    assert.ok(fillsIn(renderInset(detail(), lightTheme, { regionColor: red })).has("#ff0000"));
  });
});
