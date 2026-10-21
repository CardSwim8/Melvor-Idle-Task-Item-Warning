// Builds the mod into dist/ and packages it as the zip mod.io serves.
//
//   node scripts/build.mjs            bundle + zip
//   node scripts/build.mjs --watch    rebuild dist/mod on change (no zip)

import { build, context } from "esbuild";
import { zipSync } from "fflate";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const src = join(root, "src");
const dist = join(root, "dist");
const out = join(dist, "mod");

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const manifest = JSON.parse(readFileSync(join(src, "manifest.json"), "utf8"));

// Files copied as-is next to the bundle. Every file the manifest names must
// end up in the zip, which validateManifest checks.
const STATIC = ["manifest.json", "styles.css"];

const options = {
  entryPoints: [join(src, "main.mjs")],
  outfile: join(out, manifest.setup),
  bundle: true,
  format: "esm",
  // Melvor runs in Steam's Electron, browsers, and mobile webviews. This
  // target reproduces the 0.2.3 release; raise it deliberately, not by
  // accident.
  target: "chrome58",
  charset: "ascii",
  logLevel: "info"
};

function copyStatic() {
  for (const f of STATIC) cpSync(join(src, f), join(out, f));
}

function validateManifest() {
  const required = [manifest.setup, ...(manifest.load ?? []), manifest.icon].filter(Boolean);
  const missing = required.filter((f) => !existsSync(join(out, f)));
  if (missing.length) throw new Error(`manifest.json names files missing from the build: ${missing.join(", ")}`);
  if (!manifest.namespace) throw new Error("manifest.json has no namespace");
}

// Fixed timestamps so the same source always produces the same zip bytes.
function makeZip() {
  const files = {};
  for (const f of [manifest.setup, ...STATIC]) {
    files[f] = [readFileSync(join(out, f)), { mtime: new Date("2000-01-01T00:00:00Z") }];
  }
  const zip = zipSync(files, { level: 9 });
  const name = `task-keeper-v${pkg.version}.zip`;
  writeFileSync(join(dist, name), zip);
  const md5 = createHash("md5").update(zip).digest("hex");
  console.log(`\n  dist/${name}  ${(zip.length / 1024).toFixed(1)}kb  md5 ${md5}`);
}

if (process.argv.includes("--watch")) {
  mkdirSync(out, { recursive: true });
  copyStatic();
  const ctx = await context({
    ...options,
    plugins: [{ name: "static", setup: (b) => b.onEnd(copyStatic) }]
  });
  await ctx.watch();
} else {
  rmSync(dist, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  await build(options);
  copyStatic();
  validateManifest();
  makeZip();
}
