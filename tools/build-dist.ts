/**
 * Bundle the published package's non-ESM entry points.
 *
 * `tsc -p tsconfig.build.json` already emits the ESM tree and the `.d.ts`
 * files. This adds the shapes tsc cannot produce:
 *
 *   dist/index.cjs         require("nepal-naksha")
 *   dist/index.esm.js      the `module` / `browser` fields
 *   dist/naksha.min.js     <script src=…> → window.naksha
 *   dist/react/index.cjs   require("nepal-naksha/react")
 *   dist/react/index.esm.js
 *   dist/**\/*.d.cts       types for the `require` condition
 *
 * Everything targets **ES2018**, deliberately. The whole reason these files
 * exist is the toolchains that predate `exports` — webpack 4 and CRA 4 — and
 * webpack 4 parses with an acorn older than optional chaining. Shipping them
 * ES2022 would mean the fields resolve and then fail to parse, which is worse
 * than not shipping them: the error surfaces in the consumer's build, not here.
 */
import { readdir, readFile, writeFile } from "node:fs/promises";

import { build, type Plugin } from "esbuild";

const SRC = new URL("../src/", import.meta.url).pathname;
const OUT = new URL("../dist/", import.meta.url).pathname;

/**
 * Keep `nepal-naksha/react` from carrying its own copy of `src/index.ts`.
 *
 * That one module owns the district table and the lazily-decoded raster. A
 * second copy would decode the raster twice and — worse — hand `onRegionEnter`
 * Region objects that fail `===` against the ones `districtByName` returns, a
 * bug that only appears in CJS consumers and looks like nothing else. Routing
 * it back through the package name keeps exactly one instance.
 *
 * The pure modules (grid, svg, route, cluster, …) are still inlined. They hold
 * no identity-bearing state, so duplicating them costs bytes and nothing else;
 * the raster payload, which is nearly all the weight, lives behind index.ts.
 */
const singleCore: Plugin = {
  name: "single-core",
  setup(pluginBuild) {
    pluginBuild.onResolve({ filter: /^\.\.\/index\.ts$/ }, () => ({
      path: "nepal-naksha",
      external: true,
    }));
  },
};

const common = {
  bundle: true,
  target: "es2018",
  logLevel: "info",
  charset: "utf8", // esbuild escapes Devanagari to \uXXXX otherwise — 6 bytes a glyph.
} as const;

const reactExternal = ["react", "react/jsx-runtime", "react-dom"];

/**
 * Mirror the declaration tree as `.d.cts`.
 *
 * Without this, a `moduleResolution: node16` consumer writing CommonJS gets
 * TS1479 — "the referenced file is an ECMAScript module and cannot be imported
 * with 'require'" — because the only declarations on offer are `.d.ts` under a
 * `"type": "module"` package, whatever the `require` condition resolves to at
 * runtime. The types have to carry the format too.
 *
 * tsc cannot emit these directly: the declaration extension follows the source
 * extension, and there is no flag to force `.d.cts` out of a `.ts` input.
 * Copying is sound here because the declarations only ever use named exports —
 * no `export =`, no default — which is exactly what esbuild's CJS output
 * provides, `__esModule` marker and all.
 *
 * Relative specifiers keep the `.ts` extension in tsc's declaration output
 * (`rewriteRelativeImportExtensions` rewrites the JS, not the `.d.ts`), and
 * TypeScript maps such a specifier onto its declaration sibling. So `./geo.ts`
 * → `./geo.cts` is what points a `.d.cts` at the rest of the CJS-flavoured
 * tree; leaving it as `./geo.ts` would walk straight back into the ESM one.
 */
const RELATIVE_TS = /(\bfrom\s*|\bimport\()(["'])(\.{1,2}\/[^"']+)\.ts\2/g;

async function emitCjsDeclarations() {
  const files = await readdir(OUT, { recursive: true });
  const declarations = files.filter((file) => file.endsWith(".d.ts"));

  await Promise.all(
    declarations.map(async (file) => {
      const source = await readFile(`${OUT}${file}`, "utf8");
      const rewritten = source
        .replace(RELATIVE_TS, "$1$2$3.cts$2")
        // The .d.ts.map beside it describes the .d.ts, and no map is emitted
        // for this copy. A dangling reference is worse than none.
        .replace(/\/\/# sourceMappingURL=.*\n?/g, "");
      await writeFile(`${OUT}${file.slice(0, -".d.ts".length)}.d.cts`, rewritten);
    }),
  );

  console.log(`  ${declarations.length} declaration files mirrored as .d.cts`);
}

await Promise.all([
  build({
    ...common,
    entryPoints: [`${SRC}index.ts`],
    outfile: `${OUT}index.cjs`,
    format: "cjs",
  }),
  build({
    ...common,
    entryPoints: [`${SRC}index.ts`],
    outfile: `${OUT}index.esm.js`,
    format: "esm",
  }),
  build({
    ...common,
    entryPoints: [`${SRC}index.ts`],
    outfile: `${OUT}naksha.min.js`,
    format: "iife",
    globalName: "naksha",
    minify: true,
  }),
  build({
    ...common,
    entryPoints: [`${SRC}react/index.tsx`],
    outfile: `${OUT}react/index.cjs`,
    format: "cjs",
    jsx: "automatic",
    external: reactExternal,
    plugins: [singleCore],
  }),
  build({
    ...common,
    entryPoints: [`${SRC}react/index.tsx`],
    outfile: `${OUT}react/index.esm.js`,
    format: "esm",
    jsx: "automatic",
    external: reactExternal,
    plugins: [singleCore],
  }),
  emitCjsDeclarations(),
]);
