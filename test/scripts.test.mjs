import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sectionFor } from "../scripts/changelog.mjs";

const CHANGELOG = `# Changelog

## [Unreleased]

- Pending thing

## [1.1.0] - 2026-01-02

### Added
- New thing

## [1.0.0] - 2026-01-01

- First
`;

test("sectionFor returns just that version's notes", () => {
  assert.equal(sectionFor(CHANGELOG, "1.1.0"), "### Added\n- New thing");
  assert.equal(sectionFor(CHANGELOG, "1.0.0"), "- First");
  assert.equal(sectionFor(CHANGELOG, "9.9.9"), null);
});

test("CHANGELOG.md has notes for the package version", () => {
  const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const changelog = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8");
  assert.ok(sectionFor(changelog, version), `no CHANGELOG.md section for ${version}`);
});
