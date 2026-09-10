/**
 * Typecheck a throwaway consumer against the built `dist`, once per module
 * resolution mode.
 *
 * The package ships two declaration trees — `.d.ts` for `import`, `.d.cts` for
 * `require` — reachable through four different mechanisms: the root `types`
 * field, the `react/` directory stub, and the `types` condition nested inside
 * each of `import` and `require`. Every one of them is invisible to `tsc
 * --noEmit` on this repo, and three of the four are invisible to each other.
 * The failure they produce is not a crash but a package that resolves to `any`
 * or does not resolve at all, in someone else's editor.
 *
 * So each mode compiles two files: one that must typecheck, and one holding a
 * deliberate type error that must be *caught*. Without the second, a mode that
 * silently degraded every export to `any` would pass this file happily.
 *
 * `skipLibCheck` is off on purpose — errors inside the shipped declarations are
 * the whole point.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("..", import.meta.url));
const tsc = join(repo, "node_modules/typescript/bin/tsc");

const GOOD_JSX = `
import { renderNepal, districtByName, VIEWS, type Region } from "nepal-naksha";
import { Naksha } from "nepal-naksha/react";

const svg: string = renderNepal({ bbox: VIEWS.bagmati });
const region: Region | undefined = districtByName("Kathmandu");
export const el = <Naksha height={20} title={region?.name ?? svg} />;
`;

// .mts and .cts have no JSX-bearing counterpart, so the component is checked as
// a value instead. Resolution is what is under test, not the JSX transform.
const GOOD_PLAIN = `
import { renderNepal, districtByName, VIEWS, type Region } from "nepal-naksha";
import { Naksha } from "nepal-naksha/react";

export const svg: string = renderNepal({ bbox: VIEWS.bagmati });
export const region: Region | undefined = districtByName("Kathmandu");
export const component: typeof Naksha = Naksha;
`;

const BAD = `
import { renderNepal } from "nepal-naksha";
export const wrong: number = renderNepal();
`;

const modes = [
  {
    // webpack 4, CRA 4, and every TS project still on the classic resolver.
    // Reaches dist through the root `types` field and the react/ stub.
    name: "node10",
    ext: "tsx",
    good: GOOD_JSX,
    options: { module: "commonjs", moduleResolution: "node", jsx: "react-jsx" },
  },
  {
    name: "node16-esm",
    ext: "mts",
    good: GOOD_PLAIN,
    options: { module: "node16", moduleResolution: "node16" },
  },
  {
    // The mode `.d.cts` exists for. Resolves the `require` condition, and
    // without a CJS-flavoured declaration beside it reports TS1479 rather than
    // the ESM declarations it can see.
    name: "node16-cjs",
    ext: "cts",
    good: GOOD_PLAIN,
    options: { module: "node16", moduleResolution: "node16" },
  },
  {
    name: "bundler",
    ext: "tsx",
    good: GOOD_JSX,
    options: { module: "preserve", moduleResolution: "bundler", jsx: "react-jsx" },
  },
];

/** Run tsc on one config. Returns null on success, its output on failure. */
function typecheck(dir, config) {
  try {
    execFileSync(process.execPath, [tsc, "-p", join(dir, config)], {
      cwd: dir,
      encoding: "utf8",
      stdio: "pipe",
    });
    return null;
  } catch (error) {
    return `${error.stdout ?? ""}${error.stderr ?? ""}`.trim();
  }
}

const dir = mkdtempSync(join(tmpdir(), "naksha-types-"));
try {
  // A package.json with no `type` makes the directory CommonJS, so .mts and
  // .cts carry the format themselves rather than inheriting it.
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "consumer", private: true }));
  mkdirSync(join(dir, "node_modules/@types"), { recursive: true });
  symlinkSync(repo, join(dir, "node_modules/nepal-naksha"), "dir");
  for (const dep of ["@types/react", "csstype"]) {
    symlinkSync(join(repo, "node_modules", dep), join(dir, "node_modules", dep), "dir");
  }

  for (const mode of modes) {
    const options = {
      target: "es2022",
      strict: true,
      noEmit: true,
      skipLibCheck: false,
      ...mode.options,
    };
    writeFileSync(join(dir, `good-${mode.name}.${mode.ext}`), mode.good);
    writeFileSync(join(dir, `bad-${mode.name}.${mode.ext}`), BAD);
    writeFileSync(
      join(dir, `good-${mode.name}.json`),
      JSON.stringify({ compilerOptions: options, files: [`good-${mode.name}.${mode.ext}`] }),
    );
    writeFileSync(
      join(dir, `bad-${mode.name}.json`),
      JSON.stringify({ compilerOptions: options, files: [`bad-${mode.name}.${mode.ext}`] }),
    );

    const failure = typecheck(dir, `good-${mode.name}.json`);
    assert.equal(failure, null, `${mode.name}: the package does not typecheck —\n${failure}`);

    const caught = typecheck(dir, `bad-${mode.name}.json`);
    assert.ok(
      caught?.includes("TS2322"),
      `${mode.name}: a string is assignable to number here, so the package ` +
        `resolved to \`any\` rather than to its declarations — ${caught ?? "no error at all"}`,
    );

    console.log(`  ${mode.name.padEnd(11)} ok — types resolve and are enforced`);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(`types ok: ${modes.length} resolution modes, esm + cjs declarations`);
