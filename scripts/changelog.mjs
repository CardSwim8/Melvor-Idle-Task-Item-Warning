// Prints the CHANGELOG.md section for a version (default: package.json's).
// Exits non-zero if there is none, so a release can't ship without notes.
//
//   node scripts/changelog.mjs [version]

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));

export function sectionFor(changelog, version) {
  const lines = changelog.split(/\r?\n/);
  const heading = /^## \[?v?([^\]\s]+)\]?/;
  const start = lines.findIndex((l) => heading.exec(l)?.[1] === version);
  if (start < 0) return null;
  let end = lines.findIndex((l, i) => i > start && heading.test(l));
  if (end < 0) end = lines.length;
  const body = lines
    .slice(start + 1, end)
    .join("\n")
    .trim();
  return body || null;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const version = process.argv[2] ?? JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
  const body = sectionFor(readFileSync(join(root, "CHANGELOG.md"), "utf8"), version);
  if (!body) {
    console.error(`CHANGELOG.md has no notes for ${version}. Add a "## [${version}]" section.`);
    process.exit(1);
  }
  console.log(body);
}
