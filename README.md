# Task Keeper

A [Melvor Idle](https://melvoridle.com) mod that marks the items your Township
tasks still need, so you don't sell or use them by accident.

- **Needed** (amber disc): asked for by an incomplete main task or an active casual task.
- **Ingredient** (violet diamond): goes into making something a task needs, through any recipe, shop purchase or item upgrade.
- **Possible** (sky ring): something the casual task pool could ask for. Can be turned off.

Hover or tap a marked icon to see which tasks want it and the crafting chain
that leads there. Marks appear in the bank, the shop and the skill menus; each
place can be switched off in the mod's settings, along with a colorblind
palette and a corner-badge style.

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

| Path                | What it is                                                                                         |
| ------------------- | -------------------------------------------------------------------------------------------------- |
| `src/main.mjs`      | Entry point: settings, game hooks, the recompute loop, the console API.                            |
| `src/adapter.mjs`   | The only code that reads Melvor's globals. Game updates that break the mod usually land here.      |
| `src/model.mjs`     | Pure logic: what to keep and why. Tested without the game.                                         |
| `src/ui.mjs`        | Marks icons, renders the tooltip section, badges.                                                  |
| `src/styles.css`    | Indicator and tooltip styles.                                                                      |
| `src/manifest.json` | Melvor mod manifest.                                                                               |
| `scripts/`          | Build/package, changelog extraction, mod.io upload.                                                |
| `test/`             | `node:test` suites. The model is tested against a fake adapter, the adapter against a fake `game`. |

esbuild bundles `src/` into one `setup.mjs`. The build target (`chrome58` in
`scripts/build.mjs`) matches the 0.2.3 release so older mobile webviews keep
working; raising it is a deliberate choice.

### Debugging in game

Settings → Task Keeper → Diagnostics → **Show diagnostics report** gives a
copyable report for bug reports. From the browser console:

```js
mod.api.taskKeeper.report(); // same text as the report
mod.api.taskKeeper.inspect("melvorD:Bird_Nest"); // why one item is marked
mod.api.taskKeeper.recompute(); // force a recompute; returns items marked
```

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

1. Create a token with **read + write** scope at [mod.io/me/access](https://mod.io/me/access).
2. Run `scripts/setup-modio.sh` in a terminal, logged in to `gh` as the repo owner. It asks for the token (hidden), checks it, finds the Melvor Idle game id and your mod's id, and stores `MODIO_TOKEN`, `MODIO_GAME_ID` and `MODIO_MOD_ID` in the environment.
3. Actions → Release → **Run workflow**. Run by hand, it only checks the credentials and prints the mod's name and current version.

Optionally, add **Required reviewers** to the `mod.io` environment (Settings →
Environments) so every upload waits for your approval.

## License

[MIT](LICENSE)
