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

test("the mod.io page content in modio/ passes the checks mod.io needs", async () => {
  const { readPage, checkPage } = await import("../scripts/update-modio-page.mjs");
  const page = readPage();
  assert.deepEqual(checkPage(page), []);
  assert.match(page.description, /Melvor-Idle-Task-Item-Warning\/issues/);
});

test("checkPage catches pages mod.io would reject", async () => {
  const { checkPage, SUMMARY_MAX } = await import("../scripts/update-modio-page.mjs");
  const good = { name: "X", summary: "s", description: "<p>d</p>" };
  assert.deepEqual(checkPage(good), []);
  assert.match(checkPage({ ...good, summary: "x".repeat(SUMMARY_MAX + 1) })[0], /251 characters; mod.io allows 250/);
  assert.match(checkPage({ ...good, name: "" })[0], /needs a name/);
  assert.match(checkPage({ ...good, homepage_url: "github.com/x" })[0], /https/);
  assert.match(checkPage({ ...good, logo: "nope.png" })[0], /doesn't exist/);
  assert.match(checkPage({ ...good, tags: "Utility" })[0], /list of tag names/);
});
