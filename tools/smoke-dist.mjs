/**
 * Smoke-test the *built* package on the oldest Node we claim to support.
 *
 * The repo's own sources need Node 22+ (native type stripping), but the
 * published dist is plain JavaScript and must run on the engines floor.
 * This asserts that boundary rather than trusting it.
 *
 * All three consumer shapes are exercised, because each is resolved by a
 * different mechanism and any one of them can rot on its own:
 *
 *   import  → exports.import → dist/index.js       (tsc, ES2022)
 *   require → exports.require → dist/index.cjs     (esbuild, ES2018)
 *   <script>→ dist/naksha.min.js                   (esbuild, IIFE)
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import vm from "node:vm";

import { renderNepal, districtAt, nepalGrid, DISTRICTS } from "../dist/index.js";

const require = createRequire(import.meta.url);

assert.equal(DISTRICTS.length, 77);
assert.equal(districtAt({ lng: 85.3591, lat: 27.6966 })?.name, "Kathmandu");
assert.equal(districtAt({ lng: 77.209, lat: 28.6139 }), undefined);

const grid = nepalGrid();
assert.ok(grid.dots.length > 1000, `only ${grid.dots.length} dots`);

const svg = renderNepal({
  routes: [{ stops: [{ lng: 85.3591, lat: 27.6966 }, { lng: 83.982, lat: 28.201 }] }],
});
assert.ok(svg.startsWith("<svg "), "expected an svg string");
assert.ok(svg.endsWith("</svg>"));

// --- require() ------------------------------------------------------------
// Resolved through `exports.require`, and separately through `main` for the
// resolvers that predate `exports`. Both must land on the same file.
const cjs = require("naksha");
assert.equal(cjs.DISTRICTS.length, 77);
assert.equal(cjs.districtAt({ lng: 85.3591, lat: 27.6966 })?.name, "Kathmandu");
assert.ok(cjs.renderNepal().startsWith("<svg "));
assert.equal(
  cjs,
  require("../dist/index.cjs"),
  "`naksha` and ./dist/index.cjs must be one module instance, not two",
);

// The CJS and ESM builds are separate module graphs — that is inherent to dual
// publishing — but they must at least agree on what they export.
assert.deepEqual(
  Object.keys(cjs).sort(),
  Object.keys(await import("../dist/index.js")).sort(),
  "the CJS bundle and the ESM tree export different names",
);

// --- <script src=…> -------------------------------------------------------
// Run the IIFE the way a browser would: no module wrapper, no `require`, just
// a global object it is expected to define itself.
const sandbox = vm.createContext({ atob, btoa, TextDecoder, TextEncoder });
vm.runInContext(readFileSync(new URL("../dist/naksha.min.js", import.meta.url), "utf8"), sandbox, {
  filename: "naksha.min.js",
});
const iife = vm.runInContext("naksha", sandbox);
assert.equal(typeof iife, "object", "dist/naksha.min.js defined no `naksha` global");
assert.equal(iife.DISTRICTS.length, 77);
assert.equal(iife.districtAt({ lng: 85.3591, lat: 27.6966 })?.name, "Kathmandu");
assert.ok(iife.renderNepal().startsWith("<svg "));

console.log(
  `dist ok on ${process.version}: ${DISTRICTS.length} districts, ` +
    `${grid.dots.length} dots, ${(svg.length / 1024).toFixed(1)} KB svg — ` +
    `esm + cjs + iife (${Object.keys(iife).length} globals)`,
);
