// Updates the mod's mod.io page from the files in modio/: name, summary,
// description, homepage link, and optionally the logo and tags.
//
//   node scripts/update-modio-page.mjs --dry-run   show what would change; sends nothing
//   node scripts/update-modio-page.mjs             update the text (and tags, if page.json lists them)
//   node scripts/update-modio-page.mjs --logo      also upload the logo
//
// Environment: MODIO_TOKEN, MODIO_GAME_ID, MODIO_MOD_ID, optional MODIO_API_URL,
// as for upload-modio.mjs. A dry run reads the current page, so it needs the
// token too.
//
// modio/page.json:
//   name           page title
//   homepage_url   link shown on the page
//   logo           image uploaded with --logo (at least 512x288, 16:9 is best)
//   tags           optional; when present the page's tags are set to exactly
//                  these. A dry run lists the tags Melvor Idle allows.
// modio/summary.txt is the short summary (up to 250 characters); modio/description.html
// is the page body.

import { existsSync, openAsBlob, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const root = fileURLToPath(new URL("..", import.meta.url));

export const SUMMARY_MAX = 250;
const LOGO_MAX_BYTES = 8 * 1024 * 1024;

export function readPage(dir = join(root, "modio")) {
  const page = JSON.parse(readFileSync(join(dir, "page.json"), "utf8"));
  return {
    ...page,
    summary: readFileSync(join(dir, "summary.txt"), "utf8").trim(),
    description: readFileSync(join(dir, "description.html"), "utf8").trim()
  };
}

// Problems that mod.io would reject, or that would publish a broken page.
export function checkPage(page, base = root) {
  const problems = [];
  if (typeof page.name !== "string" || !page.name.trim()) problems.push("page.json needs a name");
  if (!page.summary) problems.push("summary.txt is empty");
  else if (page.summary.length > SUMMARY_MAX) problems.push(`summary.txt is ${page.summary.length} characters; mod.io allows ${SUMMARY_MAX}`);
  if (!page.description) problems.push("description.html is empty");
  if (page.homepage_url !== undefined && !/^https:\/\/\S+$/.test(page.homepage_url)) problems.push("homepage_url must be an https:// link");
  if (page.tags !== undefined && (!Array.isArray(page.tags) || page.tags.some((t) => typeof t !== "string"))) problems.push("tags must be a list of tag names");
  if (page.logo !== undefined) {
    const file = join(base, page.logo);
    if (!existsSync(file)) problems.push(`logo ${page.logo} doesn't exist`);
    else if (statSync(file).size > LOGO_MAX_BYTES) problems.push(`logo ${page.logo} is over 8mb`);
  }
  return problems;
}

function fail(msg) {
  console.error(`update-modio-page: ${msg}`);
  process.exit(1);
}

async function main() {
  const { values: args } = parseArgs({
    options: {
      "dry-run": { type: "boolean", default: false },
      logo: { type: "boolean", default: false }
    }
  });
  const dryRun = args["dry-run"];

  const page = readPage();
  const problems = checkPage(page);
  if (problems.length) fail(`modio/ has problems:\n  ${problems.join("\n  ")}`);
  if (args.logo && !page.logo) fail('--logo needs a "logo" image in modio/page.json');

  const { MODIO_TOKEN: token, MODIO_GAME_ID: gameId, MODIO_MOD_ID: modId } = process.env;
  if (!token || !gameId || !modId) fail("MODIO_TOKEN, MODIO_GAME_ID and MODIO_MOD_ID must be set");
  const api = (process.env.MODIO_API_URL || `https://g-${gameId}.modapi.io/v1`).replace(/\/$/, "");
  const modUrl = `${api}/games/${gameId}/mods/${modId}`;
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };

  // Returns the reply, or exits on an error unless `optional`, which returns
  // { error } instead.
  async function call(url, init, optional = false) {
    const res = await fetch(url, { ...init, headers });
    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
    if (!res.ok) {
      const detail = body?.error ? `${body.error.message}${body.error.errors ? " " + JSON.stringify(body.error.errors) : ""}` : text;
      if (optional) return { error: `HTTP ${res.status}: ${detail}` };
      fail(`${init?.method ?? "GET"} ${url} -> ${res.status}: ${detail}`);
    }
    return body;
  }

  const mod = await call(modUrl);
  console.log(`Mod ${mod.id}: "${mod.name}" (${mod.profile_url ?? "no URL"}), ${mod.visible === 1 ? "public" : "hidden"}.`);

  // ------------------------------------------- text
  const fields = { name: page.name, summary: page.summary, description: page.description };
  if (page.homepage_url !== undefined) fields.homepage_url = page.homepage_url;
  const current = { name: mod.name, summary: mod.summary, description: mod.description, homepage_url: mod.homepage_url };
  const changed = Object.keys(fields).filter((k) => (current[k] ?? "").trim() !== fields[k].trim());
  for (const k of Object.keys(fields)) {
    const was = String(current[k] ?? "");
    const now = fields[k];
    const show = (s) => (s.length > 70 ? `${s.slice(0, 67).replace(/\s+/g, " ")}...` : s.replace(/\s+/g, " "));
    console.log(
      `  ${changed.includes(k) ? "change" : "same  "}  ${k.padEnd(12)} ${changed.includes(k) ? `${show(was) || "(empty)"}  ->  ${show(now)} (${now.length} chars)` : ""}`
    );
  }
  if (changed.includes("description")) console.log("  (mod.io may tidy the description's HTML, so it can show as changed on every run.)");

  // ------------------------------------------- tags
  let addTags = [];
  let removeTags = [];
  if (page.tags !== undefined || dryRun) {
    // mod.io answers 404 when a game defines no tags.
    const options = await call(`${api}/games/${gameId}/tag_options`, undefined, true);
    if (options.error) {
      if (page.tags !== undefined) fail(`page.json lists tags, but mod.io has no tag list for this game (${options.error}). Remove "tags" from page.json.`);
      console.log(`  tags: this game has no tag list on mod.io (${options.error}); leaving tags alone.`);
      options.data = [];
    }
    const allowed = new Set(options.data.flatMap((o) => o.tags));
    if (dryRun && options.data.length) {
      console.log('Tags Melvor Idle allows (list the ones you want under "tags" in modio/page.json):');
      for (const o of options.data) console.log(`  ${o.name}${o.type === "checkboxes" ? " (any number)" : " (pick one)"}: ${o.tags.join(", ")}`);
    }
    if (page.tags !== undefined) {
      const unknown = page.tags.filter((t) => !allowed.has(t));
      if (unknown.length) fail(`page.json tags aren't allowed for Melvor Idle: ${unknown.join(", ")}`);
      const have = (mod.tags ?? []).map((t) => t.name);
      addTags = page.tags.filter((t) => !have.includes(t));
      removeTags = have.filter((t) => !page.tags.includes(t));
      console.log(`  tags: now [${have.join(", ")}]; add [${addTags.join(", ")}]; remove [${removeTags.join(", ")}]`);
    } else {
      console.log(`  tags: not managed (no "tags" in page.json); now [${(mod.tags ?? []).map((t) => t.name).join(", ")}]`);
    }
  }

  // ------------------------------------------- logo
  const logoFile = page.logo && join(root, page.logo);
  if (args.logo) console.log(`  logo: upload ${page.logo} (${(statSync(logoFile).size / 1024).toFixed(0)}kb), replacing ${mod.logo?.filename ?? "none"}`);
  else console.log(`  logo: unchanged (${mod.logo?.filename ?? "none"}); run with --logo to upload ${page.logo ?? "one"}`);

  if (dryRun) {
    console.log("Dry run: nothing sent.");
    return;
  }

  if (changed.length) {
    const form = new FormData();
    for (const k of changed) form.append(k, fields[k]);
    await call(modUrl, { method: "POST", body: form });
    console.log(`Updated ${changed.join(", ")}.`);
  } else console.log("Text already up to date.");

  if (addTags.length) {
    const form = new FormData();
    for (const t of addTags) form.append("tags[]", t);
    await call(`${modUrl}/tags`, { method: "POST", body: form });
    console.log(`Added tags ${addTags.join(", ")}.`);
  }
  if (removeTags.length) {
    const body = new URLSearchParams(removeTags.map((t) => ["tags[]", t]));
    await call(`${modUrl}/tags`, { method: "DELETE", body });
    console.log(`Removed tags ${removeTags.join(", ")}.`);
  }

  if (args.logo) {
    const form = new FormData();
    form.append("logo", await openAsBlob(logoFile), basename(logoFile));
    await call(`${modUrl}/media`, { method: "POST", body: form });
    console.log(`Uploaded the logo ${page.logo}.`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
