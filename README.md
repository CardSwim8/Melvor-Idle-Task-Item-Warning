# Task Keeper

A [Melvor Idle](https://melvoridle.com) mod that marks the items your Township
tasks still need, so you don't sell or use them by accident.

- **Needed** (amber disc): asked for by an incomplete main task or an active casual task.
- **Ingredient** (violet diamond): goes into making something a task needs, through any recipe, shop purchase or item upgrade.
- **Possible** (sky ring): something the casual task pool could ask for. Can be turned off.

Marked icons carry a small corner badge whose shape and color give the status.
Hover or tap one to see which tasks want it and the crafting chain that leads
there. In the bank, the selected item's sidebar has a **Tasks** tab with the
same detail, how many to keep, and links that open each task in Township.

Settings: show or hide the casual task pool, a colorblind palette, and whether
to mark icons in the bank and in skill menus.

Install it from mod.io through the in-game mod manager.

## Development

Requires Node 22 or newer (`.nvmrc` pins the version CI uses).

```sh
npm ci
npm run check    # lint, format check, tests, build: what CI runs
npm run build    # dist/mod/ and dist/task-keeper-v<version>.zip
npm run watch    # rebuild dist/mod/ on change
npm test
npm run format   # apply Prettier
```

The zip in `dist/` is exactly what is uploaded to mod.io: `manifest.json`,
`setup.mjs` and `styles.css` at its root.

### Layout

| Path                | What it is                                                                                                                                |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `src/main.mjs`      | Entry point: settings, game hooks, the recompute loop, the console API.                                                                   |
| `src/adapter.mjs`   | The only code that reads Melvor's globals. Game updates that break the mod usually land here.                                             |
| `src/model.mjs`     | Pure logic: what to keep and why. Tested without the game.                                                                                |
| `src/ui.mjs`        | Marks icons, renders the tooltip section, badges.                                                                                         |
| `src/styles.css`    | Indicator and tooltip styles.                                                                                                             |
| `src/manifest.json` | Melvor mod manifest.                                                                                                                      |
| `scripts/`          | Build/package, changelog extraction, mod.io upload and page update.                                                                       |
| `test/`             | `node:test` suites: the model against a fake adapter, the adapter against a fake `game`, and the whole setup against a fake game and DOM. |

esbuild bundles `src/` into one `setup.mjs`. The build target (`chrome58` in
`scripts/build.mjs`) matches the 0.2.3 release so older mobile webviews keep
working; raising it is a deliberate choice.

### Retired options

The shop venue, per-skill "Where to show" switches and the border indicator
style were taken out of the settings in 0.3.0 but their code is kept. Flip the
shop's `active` flag in `src/adapter.mjs`, or the flags in `OPTIONS` at the top
of `src/main.mjs`, to bring one back.

## Releasing

1. Add the player-facing notes under `## [x.y.z]` in `CHANGELOG.md`, one line per entry.
2. `npm version x.y.z` bumps `package.json`, commits, and creates tag `vx.y.z`.
3. `git push --follow-tags`.

The **Release** workflow then checks that the tag matches `package.json`, runs
the full check, uploads the zip to mod.io as the current release with the
changelog section as its notes, and creates a GitHub Release with the same zip
and notes. Re-running it for a version already on mod.io skips the upload, so
a failed run can simply be retried.

### mod.io credentials

Uploads use a mod.io OAuth 2 token stored in the repo's `mod.io` GitHub
environment. To set it up, or renew it when it expires (yearly):

1. Create a token with **read + write** scope at [mod.io/me/access](https://mod.io/me/access). If mod.io asks what the token covers, include write access to the mod.
2. Run `scripts/setup-modio.sh` in a terminal, logged in to `gh` as the repo owner. It asks for the token (hidden) and your mod's mod.io URL, checks the token can upload to that mod (without uploading anything), and stores `MODIO_TOKEN`, `MODIO_GAME_ID` and `MODIO_MOD_ID` in the environment.
3. Actions → Release → **Run workflow**. Run by hand, it only checks the credentials and prints the mod's name and current version.

Optionally, add **Required reviewers** to the `mod.io` environment (Settings →
Environments) so every upload waits for your approval.

### The mod.io page

The page's name, summary, description and homepage link come from `modio/`
(`page.json`, `summary.txt`, `description.html`). To publish changes to them:

1. Edit the files and push.
2. Actions → **Update mod.io page** → Run workflow, with **Dry run** ticked
   (the default). It shows what would change, and lists the tags Melvor Idle
   allows, if mod.io has a tag list for it.
3. Run it again with **Dry run** unticked. To replace the logo too, set
   `"logo"` in `modio/page.json` to an image in the repo (at least 512×288,
   16:9 is best) and tick **Also upload the logo**.

To manage tags, add `"tags": ["…"]` to `modio/page.json` using names from
the dry run; the page's tags are then set to exactly that list. Without
`tags`, the page's tags are left alone. A test checks the summary fits
mod.io's 250 characters.

## License

[MIT](LICENSE)
