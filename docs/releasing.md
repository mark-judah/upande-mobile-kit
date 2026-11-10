# Shipping updates in detail

The short version is in the [README](../README.md#day-to-day). This page explains how a release decides between an OTA and an APK, and how to steer it.

**Every push to your release branch is a release.** You never choose OTA or APK by hand: the release works it out, says why in the run summary, and the version bumps itself. The rest of this section explains how, so you can steer it when you need to.

## What happens on a push

Pushing to your release branch starts the workflow, except for changes that only touch `*.md` files or `docs/`. It:

1. plans the version and decides OTA or APK (below). The decision and its reason go into the run summary and the GitHub Release;
2. exports the JavaScript bundle and publishes it to the `gh-pages` branch under `ota/`, for every release;
3. if the release is an APK, runs `expo prebuild` and Gradle to build a signed (or debug-signed) APK;
4. commits `chore(release): <version> [skip ci]`, tags `v<version>`, and creates the GitHub Release.

An APK release takes about 14 minutes. The workflow times out after 45 minutes and runs queue behind each other. Do not start your own commit message with `chore(release):`; the workflow ignores those to avoid loops.

## How it decides: OTA or APK

Versions are `x.y.z` and the **runtime** is `x.y`. An OTA bundle reaches only phones with the same runtime, so a normal push moves `z` (`1.2.7` to `1.2.8`) and ships JavaScript only. A release builds an APK on a **new runtime** (the minor goes up, `1.2.7` to `1.3.0`) when native code changed, because native code can only come with a new APK. Two checks decide, and both compare with the **last APK**, not the last release, so a native change that once slipped out as an OTA is caught by the next release.

**1. The native surface.** Every dependency that carries native code (an `android/` or `ios/` folder, an Expo module or a config plugin) is recorded with its installed version, plus the kit's own native modules and plugins, the `patches/` folder and the native fields of `app.json` (name, scheme, icon, splash, plugins, `android`, `ios`). The record is saved in `app.json` (`expo.extra.mobileKit.nativeBaseline`) whenever an APK is built. If what is installed now differs, the release is an APK. This catches a kit upgrade that brings a new native module, and libraries no name pattern would catch. It reads `node_modules`, which the workflow has after `npm ci`. The first release after you adopt this records the baseline and forces nothing: it assumes the APK on phones matches.

**2. The files that changed since the last APK.** List folders or files, as globs, in `app.json`. `init` pre-fills the block with a comment:

```json
{ "expo": { "extra": { "mobileKit": { "release": {
  "apk": ["modules/**", "assets/images/icon.png"],
  "ota": ["assets/fonts/**", "content/**"]
} } } } }
```

| A changed file that matches | Result |
|---|---|
| `apk`, or the built-in `android/**`, `ios/**`, `patches/**`, `plugins/**`, `eas.json`, `metro.config.js`, `babel.config.js` | APK |
| `ota`, or the built-in `app/**`, `src/**`, `__tests__/**`, `docs/**`, `backend/**`, `scripts/**`, `.github/**`, `*.md` | OTA is fine |
| neither | **APK, to be safe.** The reason names the file. List it under `ota` (or `apk`) so it stops asking |

`apk` wins over `ota`, so `"apk": ["src/native/**"]` works even though `src/**` is JS-only. `package.json`, the lock files and `app.json` are judged by the first check, not by name.

| What you do | Version | Runtime | Result |
|---|---|---|---|
| Push as usual (`fix: ...`) | `1.2.7` to `1.2.8` | same | OTA only |
| Push a native change (a native package, plugin, patch, permission, an `apk`-listed file) | `1.2.7` to `1.3.0` | new | APK |
| Push with `[apk]` in a commit message | `1.2.7` to `1.2.8` | same | OTA **and** an APK attached. Phones on the old APK keep getting OTA |
| Push with `[native]` or `[runtime]` | `1.2.7` to `1.3.0` | new | APK |
| Push with `[major]` | `1.2.7` to `2.0.0` | new | APK |
| Upgrade the Expo SDK in `package.json` | next minor | new | APK. A bundle for another SDK would crash old builds |
| The patch counter wraps | `1.2.99` to `1.3.0` | new | APK |
| `runtimeVersion` in `app.json` is not a plain `x.y` (an Expo policy object, or missing) | next patch | set to `x.y` | APK, once. The kit cannot tell which runtime the installed builds have |
| Run the workflow with `build_apk` | `1.2.7` to `1.2.8` | same | OTA and an APK |
| Run the workflow with `bump: minor` or `major` | `1.2.7` to `1.3.0` / `2.0.0` | new | APK |
| Run the workflow with `set_version` | the version you give | new if `x.y` changes | APK if the runtime changed, else OTA |

The patch counts 0 to 99 and the minor 0 to 49, then they roll over. `versionCode` is derived from the version, so it always increases. If the app already has older builds out, set offsets in `app.json` before the first release, so the new APK installs over the old one and no bundle reaches an incompatible phone:

```json
{ "expo": { "extra": { "mobileKit": { "versionCodeBase": 100000, "runtimeMajorBase": 100 } } } }
```

Both default to 0. If you set `runtimeMajorBase`, set the same value as `upande_mobile_runtime_major_base` in the Frappe site's `site_config.json`.

## Commit messages

The kit reads the commit messages since the last `v*` tag (subject and body, any letter case) for markers in square brackets. You rarely need them: they are overrides.

| Marker | Effect |
|---|---|
| `[apk]` or `[build-apk]` | Build and attach an APK to this release. The version is a normal patch and the runtime is unchanged, so OTA keeps working for existing phones |
| `[native]` or `[runtime]` | Native code changed: a minor bump (a new runtime) and an APK |
| `[major]` | A major bump, a new runtime and an APK |
| `[ota]` or `[skip-apk]` | Only in the **newest** commit: switches off the automatic APK and any `[apk]` marker for this release. It does not cancel `[native]` or `[major]`. The native change is not forgotten: the next release still sees it |

```bash
git commit -m "fix: correct the gate count"                    # OTA only
git commit -m "fix: correct the gate count [apk]"              # OTA and an APK
git commit -m "feat: scan IDs with the camera [native]"        # new runtime and an APK
git commit -m "feat!: new login [major]"                       # 2.0.0 and an APK
```

- A marker can be in any commit that lands on the release branch since the last release, in the subject or the body. Merge commits are ignored: with **Squash and merge** put the marker in the squash commit's title or description; with **Create a merge commit** or **Rebase and merge** a marker in any of the branch's own commits counts.
- A marker must be a whole bracketed token. `[apkish]`, or the word apk in a sentence, does nothing.
- `--bump minor`, `--bump major` and `--set` (workflow inputs) always win over markers. An Expo SDK upgrade always forces a minor bump and an APK.
- The conventional commit type (`feat`, `fix`, ...) does not change the release. It sorts the release notes: `feat` Features, `fix` Bug Fixes, `perf` Performance, `refactor` Refactoring, `docs` Documentation, `build` Build System, `ci` CI, `chore` Chores, anything else Other. `feat!:` or a `BREAKING CHANGE:` line puts the commit under "BREAKING CHANGES" in the notes only.
- A line starting with `Note:` (or `What's new:`) in a commit body is for the **users** of the app. It leads the GitHub release notes under "What's new" and has no effect on the version. The app itself shows no release notes.

  ```bash
  git commit -m "feat(scan): batch the reads" -m "Note: Scanning is twice as fast"
  ```

## Preview a release before you push

```bash
npx upande-mobile-kit version
```

Prints the next version, the release type and the reason, without changing anything. Commit first (a local commit is enough):

```text
1.2.7 -> 1.2.8 (patch, versionCode 5208, 2 commits since v1.2.7)
release: APK - commit 93b887d contains [apk]; an APK is built on the unchanged runtime 1.2; the OTA bundle is published too
```

Do not run it with `--apply`: that writes the version, and the workflow would bump it a second time. `--json` prints the same decision.

## Running the workflow by hand

Use this to get an APK without a new commit, or to release a specific version.

1. Push your changes first. The workflow builds what is on GitHub, not your local files.
2. On GitHub open **Actions**, choose **Release**, click **Run workflow**, pick the release branch.
3. Fill in the inputs and click the green **Run workflow** button:

| Input | Values |
|---|---|
| `bump` | `auto` (the rules above decide), `patch`, `minor`, `major` |
| `set_version` | an exact version such as `2.0.0`; when set, `bump` is ignored |
| `build_apk` | tick it to also build and attach an APK (same runtime, OTA keeps working) |

From a terminal, with a token that may run workflows: `gh workflow run release.yml --ref main -f build_apk=true`, or

```bash
curl -X POST -H "Authorization: Bearer $GITHUB_TOKEN" -H "Accept: application/vnd.github+json" \
  https://api.github.com/repos/<owner>/<repo>/actions/workflows/release.yml/dispatches \
  -d '{"ref":"main","inputs":{"build_apk":"true"}}'
```

## Where things end up

- **GitHub Releases:** one per version, tagged `v<version>`. APK releases attach `<apk-name>_v<version>.apk` and a fixed-name `<apk-name>.apk` (always the newest, at `https://github.com/<owner>/<repo>/releases/latest/download/<apk-name>.apk`). OTA releases are titled "(OTA)" and have no file.
- **`gh-pages` branch:** `ota/android/<runtime>/manifest.json`, the bundle and its assets. Older runtimes are kept.
- **The run summary and the Release:** the release type and its reason, runtime, `versionCode`, the APK link, and whether it was signed with your key or the debug key.
- **Workflow artifacts:** the APK is also kept for 90 days, even if a later step fails.

## When a release fails

- The OTA bundle is published before the version commit and tag. A failure before the tag leaves no tag behind, and the next run retries the same version. A tag push that GitHub refuses is reported as a warning and the Release creates the tag itself.
- A failed APK build still keeps its artifacts. Fix the cause and re-run the workflow.
- There is no rollback step. To undo a bad OTA, revert the change on the release branch and push: the next release publishes the old code as a new version.
- The workflow regenerates `android/` with `expo prebuild --clean` on every APK build. Hand edits in a committed `android/` folder are not used; put native changes in config plugins.

## Upgrading the kit

Upgrading is a pull request you merge. `init` writes `.github/workflows/upgrade-kit.yml`. Every Monday (or when you press **Run workflow** on it) it looks for a newer kit release and, if there is one, opens `chore: update @upande/mobile-kit to vX.Y.Z`. The pull request changes the kit dependency and lockfile and installs or removes the native modules the new kit needs. **Merge it.** The release that follows works out by itself whether the upgrade needs a new APK or only an update over the air, and says why in its summary. Nothing is run by hand.

- **Required, once:** **Settings > Actions > General > Allow GitHub Actions to create and approve pull requests**, or the job cannot open the pull request.
- **Optional, `KIT_UPGRADE_TOKEN`:** a fine-grained token on this repo with *Contents*, *Pull requests* and *Workflows* read and write, saved as a repository secret. With it the pull request also moves the pins in `.github/workflows/` to the new kit version, so workflow fixes arrive too. Without it GitHub does not let the built-in token edit workflow files: only the dependency and lockfile change, the release keeps working, and the pull request says the pins were not moved.

The workflow files are pinned to the kit version that wrote them (`...release.yml@v0.18.0`), because a floating tag would send workflow changes to every app at once. For an app whose pins are behind, `npx upande-mobile-kit init --update-workflow` rewrites them and adds `upgrade-kit.yml` if it is missing; `verify` and `doctor` warn about old pins.
