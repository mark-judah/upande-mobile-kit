# Everything a person runs or does with the kit

One list, so it can be cut down. Status as of kit v0.17.2 plus the unreleased `app.json` release config (`90bf60e`).
"Who" is the person doing it: **dev** = someone building an app, **kit** = the person maintaining this repo, **CI** = the release workflow does it already.

## 1. The CLI (`npx upande-mobile-kit <command>`): 7 commands

| Command | Who | What it does | Needed by hand? |
|---|---|---|---|
| `init` | dev, once per app | Wizard: writes `app/mobile-kit/settings.tsx`, `devices.tsx`, `src/mobile-kit.ts`, `.github/workflows/release.yml`; edits `app.json`, `package.json`, the root layout; installs native modules; registers the backend on a local bench. Flags: `--yes`, `--no-install`, `--site`, `--dev-site`, `--bench`, `--bench-site`, `--settings-route`, `--no-backup`, `--no-adapters`, `--force` | once |
| `init --update-workflow` | dev, on every kit upgrade | Rewrites only `release.yml` to the installed kit's version | **every upgrade** |
| `fix` | dev | Installs or repairs the native modules the kit needs (`--dry-run`, `--align`, `--yes`) | after adding the kit, and after some upgrades |
| `verify` | dev | Self-test of routes, provider, wiring, native modules, sites | optional |
| `doctor` | dev | The short `verify` | optional |
| `version` | CI | Plans/applies the version bump and decides APK or OTA (`--apply --json --notes --bump --set --apk --keep-version`) | **no, CI only** (dev uses it only to preview) |
| `publish-ota` | CI | Builds the JS bundle into `./ota` (`--out`) | **no, CI only** |
| `release` | kit | Tags a release of the kit itself (`patch/minor/major/x.y.z`, `--push`, `--dry-run`, `--list`, `--skip-checks`, `--allow-branch`) | every kit release |

Also added into every app by `init`: `package.json` scripts `version:*`, `ota:build`, `kit:doctor`.

## 2. Everything a dev does, in order

### First time, per app
1. Install and register the backend on the Frappe site: `bench get-app`, `install-app upande_mobile`, `bench build --app upande_mobile`, `migrate`, `restart`.
2. `npm install github:mark-judah/upande-mobile-kit#vX.Y.Z`.
3. `npx upande-mobile-kit init` and answer the questions.
4. On the production server: `bench --site <site> execute upande_mobile.api.register_app --kwargs '{...}'`.
5. Wrap the app in `<MobileKitProvider>` if `init` did not recognise the layout.
6. `git add -A && git commit && git push`.
7. GitHub setup: enable Pages on the `gh-pages` branch; optionally add the four signing secrets (`ANDROID_KEYSTORE_BASE64`, `_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`, `ANDROID_KEY_SHA256`).
8. Make the first release an APK: run the workflow by hand with `build_apk` ticked (or `[apk]` in a commit).
9. `npx upande-mobile-kit fix` if a native module is missing.

### Every change you ship
- Push to the release branch. CI decides OTA or APK, bumps the version, publishes.
- To force something: put `[apk]`, `[native]`, `[major]` or `[ota]` in a commit message, or run the workflow by hand with `build_apk` / `bump` / `set_version`.
- To see what a push would do: `npx upande-mobile-kit version`.
- NEW: list folders under `expo.extra.mobileKit.release` (`apk`, `ota`) in `app.json` so files are classified.

### Upgrading the kit in an app (what I did by hand for 0.17.0, 0.17.1, 0.17.2)
1. Edit `package.json`: `"@upande/mobile-kit": "github:mark-judah/upande-mobile-kit#vX.Y.Z"`.
2. Edit `.github/workflows/release.yml`: change `@vA.B.C` on the `uses:` line (or run `init --update-workflow`).
3. `npm install "github:mark-judah/upande-mobile-kit#vX.Y.Z"` (a plain `npm install` does not refresh a git dependency).
4. `npx upande-mobile-kit fix` and `doctor`.
5. If the kit added or removed a native module: add `[apk]` or `[native]` to the commit so an APK is built (now automatic).
6. Commit and push.

### When something native changes
New package, plugin, permission, patch: needs a new APK on a new runtime. Previously a marker; now detected from the native surface and the `release` lists.

### When a release fails
Read the run, fix, re-run the workflow. Retry a failed APK build from the workflow page.

## 3. What the kit maintainer does
1. Change the code, run `npm test` (jest, web jest, CLI tests) and `npm run check:pack`.
2. `npx upande-mobile-kit release patch|minor --push` (typecheck, tests, pack check, commit, tag, push).
3. Wait for the kit's own workflow (if any) and for the npm/GitHub release to exist.
4. Upgrade every app (section 2, "Upgrading the kit").

## 4. Where the manual work is (what to remove)

| Manual action today | Proposed end state |
|---|---|
| `version`, `publish-ota` | Not commands. The shared workflow calls the files directly. Removed from the help and the README. |
| Upgrading the kit (6 steps, 3 files) | One automatic step: a scheduled/dispatch job in the shared workflow opens a pull request that changes the dependency, the workflow pin and the lockfile, runs `fix` logic, and sets `[apk]` itself when the native surface changed. You merge it. |
| `init --update-workflow` | Gone with the above. The caller workflow becomes a few lines that never need editing. |
| `fix`, `doctor`, `verify` | (later) Done by the Expo config plugin that is already in `app.json`: it fails `expo prebuild` and the CI APK build with the one-line fix. No separate commands. |
| `release` (kit) | A workflow in the kit repo: push to `main` tags, tests and publishes. No command. |
| `init` | Stays as the one command you run once per app, or becomes `npm create`-style. Settings live in `app.json` (`expo.extra.mobileKit`). |
| Markers `[apk]`/`[native]` | Overrides only; the kit decides by itself. |

## 5. Done so far (kit v0.18.0, unreleased)

- `--help` shows only `init`; `fix`, `verify`, `doctor`, `version`, `publish-ota` and `release` still exist for the workflows and for repair.
- Upgrading is a pull request: `init` writes `.github/workflows/upgrade-kit.yml` (weekly, or by hand); the reusable `upgrade.yml` opens `chore: update @upande/mobile-kit to vX.Y.Z` with the dependency, the lockfile and the native modules; `init --update-workflow` also pins/adds that file. With the optional `KIT_UPGRADE_TOKEN` secret the PR moves the workflow pins too.
- APK or OTA is decided from the native surface and the `release` lists in `app.json`, which `init` and the first release pre-fill with a comment.
- Not done: replacing the kit's own `release` command with a workflow; removing `fix`/`verify`/`doctor` outright (the config plugin already fails the build on a missing native module).
