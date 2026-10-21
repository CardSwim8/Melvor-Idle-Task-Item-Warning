// Uploads a release zip to mod.io as a new modfile and makes it current.
//
//   node scripts/upload-modio.mjs --file dist/task-keeper-v1.2.3.zip --version 1.2.3 \
//     [--changelog-file notes.md] [--dry-run]
//   node scripts/upload-modio.mjs --check     verify credentials and ids, upload nothing
//
// Environment:
//   MODIO_TOKEN     OAuth 2 access token with write scope (mod.io/me/access)
//   MODIO_GAME_ID   numeric game id
//   MODIO_MOD_ID    numeric mod id
//   MODIO_API_URL   optional; defaults to https://g-<game id>.modapi.io/v1 (mod.io
//                   refuses writes on the deprecated api.mod.io host)
//
// Re-running for a version that is already on mod.io does nothing, so a
// failed workflow can be retried safely.

import { createHash } from "node:crypto";
import { openAsBlob, readFileSync } from "node:fs";
import { basename } from "node:path";
import { parseArgs } from "node:util";

const { values: args } = parseArgs({
  options: {
    file: { type: "string" },
    version: { type: "string" },
    "changelog-file": { type: "string" },
    "dry-run": { type: "boolean", default: false },
    check: { type: "boolean", default: false }
  }
});

function fail(msg) {
  console.error(`upload-modio: ${msg}`);
  process.exit(1);
}

const dryRun = args["dry-run"];
const { MODIO_TOKEN: token, MODIO_GAME_ID: gameId, MODIO_MOD_ID: modId } = process.env;
if (!gameId || !modId) fail("MODIO_GAME_ID and MODIO_MOD_ID must be set");
const api = (process.env.MODIO_API_URL || `https://g-${gameId}.modapi.io/v1`).replace(/\/$/, "");
if (!token && !dryRun) fail("MODIO_TOKEN must be set");

const modUrl = `${api}/games/${gameId}/mods/${modId}`;
const filesUrl = `${modUrl}/files`;
const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };

async function call(url, init) {
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
    fail(`${init?.method ?? "GET"} ${url} -> ${res.status}: ${detail}`);
  }
  return body;
}

// Personal access tokens may be limited to particular resources (no /me), so
// check upload permission directly: a request with no file is rejected as
// invalid (422) if the token may upload, or forbidden (403) if not.
if (args.check) {
  const mod = await call(modUrl);
  console.log(`Mod ${mod.id} is "${mod.name}"; current release ${mod.modfile?.version ?? "(none)"}.`);
  const probe = new FormData();
  probe.append("version", "0.0.0-permission-check");
  const res = await fetch(filesUrl, { method: "POST", body: probe, headers });
  if (res.status !== 422) fail(`token cannot upload to this mod (HTTP ${res.status}): ${await res.text()}`);
  console.log("The token can upload to this mod.");
  process.exit(0);
}

if (!args.file) fail("--file is required");
if (!args.version) fail("--version is required");

const bytes = readFileSync(args.file);
const md5 = createHash("md5").update(bytes).digest("hex");
const changelog = args["changelog-file"] ? readFileSync(args["changelog-file"], "utf8").trim() : "";

console.log(`mod.io upload
  endpoint  ${filesUrl}
  file      ${basename(args.file)} (${(bytes.length / 1024).toFixed(1)}kb, md5 ${md5})
  version   ${args.version}
  changelog ${changelog ? `${changelog.length} chars` : "(none)"}`);

if (dryRun) {
  console.log("Dry run: nothing uploaded.");
  process.exit(0);
}

const existing = await call(`${filesUrl}?version=${encodeURIComponent(args.version)}`);
if (existing.data?.length) {
  console.log(`Version ${args.version} is already on mod.io (modfile ${existing.data[0].id}); skipping.`);
  process.exit(0);
}

const form = new FormData();
form.append("filedata", await openAsBlob(args.file), basename(args.file));
form.append("version", args.version);
form.append("filehash", md5);
form.append("active", "true");
if (changelog) form.append("changelog", changelog);

const modfile = await call(filesUrl, { method: "POST", body: form });
console.log(`Uploaded modfile ${modfile.id} (${modfile.version}); it is now the mod's current release.`);
