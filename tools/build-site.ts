/**
 * Build (and optionally serve) the landing page.
 *
 *   npm run site           build to site/dist
 *   npm run site -- --dev  rebuild on change and serve on :8000
 */
import { context, build, type BuildOptions } from "esbuild";
import { cpSync, mkdirSync, rmSync, statSync, watch } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const SITE = resolve(ROOT, "site");
const OUT = resolve(SITE, "dist");
const dev = process.argv.includes("--dev");

const options: BuildOptions = {
  entryPoints: [resolve(SITE, "main.ts")],
  outfile: resolve(OUT, "main.js"),
  bundle: true,
  format: "esm",
  target: ["es2022"],
  // Emit Devanagari literally instead of as \uXXXX escapes, which cost 6 bytes
  // per glyph instead of 3. The page is served as UTF-8.
  charset: "utf8",
  minify: !dev,
  sourcemap: dev,
  logLevel: "info",
};

const STATIC = ["index.html", "styles.css"];

function copyStatic() {
  mkdirSync(OUT, { recursive: true });
  for (const file of STATIC) {
    cpSync(resolve(SITE, file), resolve(OUT, file));
  }
  cpSync(resolve(SITE, "index.html"), resolve(OUT, "404.html"));
}

rmSync(OUT, { recursive: true, force: true });
copyStatic();

if (dev) {
  const ctx = await context(options);
  await ctx.watch();

  // esbuild only watches the module graph, so index.html and styles.css would
  // otherwise be copied once at startup and never again.
  //
  // Watch the directory, not the individual files: fs.watch follows an inode,
  // and most editors save by writing a temp file and renaming over the target.
  // That swaps the inode, so a per-file watch fires once and then goes dead
  // silently — which looks exactly like "my CSS edit did nothing".
  watch(SITE, (_event, filename) => {
    if (!filename || !STATIC.includes(filename)) return;
    try {
      copyStatic();
      console.log(`[watch] copied ${filename}`);
    } catch (err) {
      console.warn(`[watch] failed to copy ${filename}:`, err);
    }
  });

  const { host, port } = await ctx.serve({ servedir: OUT, port: 8000 });
  console.log(`\n  naksha demo -> http://${host === "0.0.0.0" ? "localhost" : host}:${port}\n`);
} else {
  await build(options);
  const kb = (p: string) => (statSync(resolve(OUT, p)).size / 1024).toFixed(1);
  console.log(`\n  main.js    ${kb("main.js")} KB  (library + demo, minified)`);
  console.log(`  index.html ${kb("index.html")} KB`);
  console.log(`  styles.css ${kb("styles.css")} KB\n`);
}
