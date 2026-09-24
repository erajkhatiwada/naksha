/**
 * Render `nepal-naksha/react` against whichever React is installed.
 *
 * The peer range is `>=16.14` — 16.14 being the oldest React that ships
 * `react/jsx-runtime`, which the automatic JSX transform requires. The wrapper
 * only ever calls useEffect/useMemo/useRef, so nothing newer is needed, but
 * "nothing newer is needed" is a claim about four major versions of react-dom
 * and is worth actually running. CI drives this file once per major.
 *
 * Assertions check structure, not exact bytes: react-dom is free to change how
 * it serialises SVG props like `paintOrder` and `dominantBaseline` between
 * majors. As measured, it has not — 16.14, 17.0, 18.3 and 19.2 all emit the
 * same 21838 characters for the props below — but the map is expected to
 * change and react-dom is not expected to promise anything, so pinning a
 * length here would only produce a test that fails for the wrong reason.
 *
 * The strict half of the test is the console.error trap. React reports unknown
 * props and invalid nesting as warnings rather than throwing, so on an old
 * react-dom a broken attribute renders "successfully" and only says so on
 * stderr. A silent render is the real signal.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const version = require("react/package.json").version;
const domVersion = require("react-dom/package.json").version;

const props = {
  title: "Nepal",
  height: 24,
  labels: true,
  keyboard: true,
  highlight: true,
  routes: [
    {
      id: "ktm-pkr",
      label: "Kathmandu → Pokhara",
      stops: [
        { lng: 85.3591, lat: 27.6966 },
        { lng: 83.982, lat: 28.201 },
      ],
    },
  ],
  points: [
    // `label`, not `name` — a MapPoint's name lives in the Bilingual fields,
    // and an earlier `name` here meant this file rendered no labels at all.
    { lng: 85.3591, lat: 27.6966, label: "Kathmandu" },
    // Stacked, so the wrapper's own <tspan> path is covered in both formats.
    { lng: 81.667, lat: 28.1036, label: "Nepalgunj\nBanke" },
  ],
  onRegionEnter() {},
  onRegionClick() {},
};

/** Render with console.error trapped, so React's warnings become failures. */
function render(React, renderToStaticMarkup, Naksha, label) {
  const warnings = [];
  const original = console.error;
  console.error = (...args) => warnings.push(String(args[0]));
  let html;
  try {
    html = renderToStaticMarkup(React.createElement(Naksha, props));
  } finally {
    console.error = original;
  }

  assert.equal(warnings.length, 0, `${label}: React warned — ${warnings.join(" | ")}`);
  assert.ok(html.startsWith("<svg "), `${label}: expected an <svg> root, got ${html.slice(0, 40)}`);
  assert.ok(html.endsWith("</svg>"), `${label}: truncated svg`);
  assert.match(html, /viewBox="0 0 \d+ 24"/, `${label}: viewBox is not in dot units`);
  // The static render is the whole map: role="img" plus a title, no focus
  // affordance. `keyboard: true` swaps that to role="group" and adds tabindex,
  // but it does so from `attachInteractions` — a DOM effect — so it is
  // deliberately absent here. A server render is the presentational map.
  assert.match(html, /role="img"/, `${label}: static render lost its role`);
  assert.match(html, /<title>Nepal<\/title>/, `${label}: accessible name did not render`);
  assert.match(html, /class="naksha-dots"/, `${label}: the injected dot field is missing`);
  assert.match(html, /class="naksha-routes"/, `${label}: routes did not render`);
  assert.match(html, /class="naksha-pins"/, `${label}: pins did not render`);
  assert.match(html, />Kathmandu</, `${label}: a one-line label did not render`);
  // Each line restates x, or SVG runs them together into one row.
  assert.match(
    html,
    /<tspan x="[-\d.]+">Nepalgunj<\/tspan><tspan x="[-\d.]+" dy="[\d.]+">Banke<\/tspan>/,
    `${label}: a stacked label did not render as separate lines`,
  );
  assert.ok(html.length > 4000, `${label}: suspiciously small render (${html.length} chars)`);
  return html;
}

/** The wrapper should match `renderSvg` for `align` and edge labels. */
function parity(React, renderToStaticMarkup, Naksha, core, label) {
  const lattice = core.zoomBbox(core.NEPAL_BBOX, 2);
  const bbox = core.panBbox(lattice, { lng: 83.4137, lat: 28.6211 }, { align: lattice });
  const viewBox = (svg) => svg.match(/viewBox="([^"]+)"/)[1];
  const aligned = renderToStaticMarkup(React.createElement(Naksha, { bbox, align: lattice }));
  assert.equal(viewBox(aligned), viewBox(core.renderNepal({ bbox, align: lattice })), `${label}: align ignored`);

  const points = [{ lng: 80.1, lat: 29.9, label: "Mahakali" }];
  const labelTag = (svg) => svg.match(/<text[^>]*>(?=Mahakali)/)[0];
  const wrapped = renderToStaticMarkup(React.createElement(Naksha, { points, labels: true }));
  assert.equal(labelTag(wrapped), labelTag(core.renderNepal({ points, labels: true })), `${label}: label differs`);
}

// --- require("nepal-naksha/react") ---------------------------------------------
const cjs = render(
  require("react"),
  require("react-dom/server").renderToStaticMarkup,
  require("../dist/react/index.cjs").Naksha,
  "cjs",
);
parity(
  require("react"),
  require("react-dom/server").renderToStaticMarkup,
  require("../dist/react/index.cjs").Naksha,
  require("nepal-naksha"),
  "cjs",
);

// The CJS wrapper is bundled, but `src/index.ts` is left external on purpose
// so the district table and the decoded raster stay single instances — a second
// copy would hand `onRegionEnter` Regions that fail `===` against the ones
// `districtByName` returns. If build-dist.ts's plugin ever stops matching, the
// table lands in here and this is what notices.
const reactCjs = readFileSync(new URL("../dist/react/index.cjs", import.meta.url), "utf8");
assert.match(reactCjs, /require\("nepal-naksha"\)/, "the react bundle does not reach for the core");
assert.ok(
  !reactCjs.includes("Bhaktapur"),
  "the react bundle inlined the district table; the core is meant to stay external",
);
assert.equal(require("nepal-naksha").DISTRICTS.length, 77, "the core the react bundle requires is broken");

// --- import "nepal-naksha/react" ------------------------------------------------
// React 16 and 17 have no `exports` map, so Node's ESM resolver cannot find
// `react/jsx-runtime` — it does no extension probing for legacy packages. Every
// bundler that targets those versions (webpack 4, CRA 4) resolves it fine, so
// this is a gap in Node's view of old React, not in naksha. Detected rather
// than assumed from the version number, so the day React backports an exports
// map this starts covering it.
let esm = null;
try {
  const React = (await import("react")).default;
  const server = await import("react-dom/server");
  const { Naksha } = await import("../dist/react/index.js");
  esm = render(
    React,
    server.renderToStaticMarkup ?? server.default.renderToStaticMarkup,
    Naksha,
    "esm",
  );
} catch (error) {
  // Only a React subpath failing to resolve is excused. "Cannot find package
  // 'react'" (not installed) and anything thrown by naksha's own modules still
  // fail the run.
  const legacy =
    error.code === "ERR_MODULE_NOT_FOUND" &&
    /node_modules\/react(-dom)?\//.test(error.url ?? error.message);
  if (!legacy) throw error;
  console.log(
    `  esm: skipped — react@${version} has no \`exports\` map, so Node cannot ` +
      `resolve its subpaths. Bundlers targeting this React can.`,
  );
}

// Two module graphs, one map. They are built by different compilers — tsc for
// the ESM tree, esbuild for the CJS bundle — so this is worth stating.
if (esm) assert.equal(esm, cjs, "the cjs and esm builds render different markup");

console.log(
  `react ok on ${process.version}: react@${version} / react-dom@${domVersion} — ` +
    `cjs ${cjs.length} chars${esm ? `, esm ${esm.length} chars` : ""}`,
);
