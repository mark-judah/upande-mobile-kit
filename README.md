# @upande/mobile-kit

Updates, device management, monitoring and support for Expo apps, backed by a Frappe site. Install one package and your app gets a Settings page with over-the-air and APK updates, fingerprint sign-in, a device register, crash and API monitoring, problem reports and chat with your team. A GitHub Actions workflow ships every push, with no Expo (EAS) account.

The package is installed from this GitHub repository by tag. Its backend is the Frappe app [`upande_mobile`](https://github.com/mark-judah/upande-mobile).

**Contents:** [What you get](#what-you-get) · [How it fits together](#how-it-fits-together) · [Requirements](#requirements) · [Set up an app](#set-up-an-app) · [Shipping updates](#shipping-updates) · [Upgrading the kit](#upgrading-the-kit) · [In the app](#in-the-app) · [Configuration](#configuration) · [Native modules](#native-modules) · [Command line](#command-line) · [Troubleshooting](#troubleshooting) · [Security and privacy](#security-and-privacy) · [For maintainers](#for-maintainers)

## What you get

| Area | Features |
|---|---|
| **Updates** | [OTA updates](#ota-updates) when the app opens · [APK updates](#apk-updates) that download in the background · [forced install](#forced-install) · a [progress ring](#progress-ring) · a [release workflow](#shipping-updates) that decides OTA or APK for you |
| **Settings and sign-in** | [Settings page](#the-settings-page) · [floating button](#the-floating-button) · [version information](#version-information) · [fingerprint unlock](#fingerprint-unlock) · [fingerprint sign-in vault](#fingerprint-sign-in-vault) · [silent re-login](#silent-re-login) |
| **Fleet and monitoring** | [Devices page](#the-devices-page) · [crash and API monitoring](#crash-and-api-monitoring) · [network and performance](#network-and-performance) · [device identifiers](#device-identifiers) · [IT dashboard](#the-it-dashboard) |
| **Help and support** | [Report a problem](#report-a-problem) · [My reports and chat](#my-reports-and-chat-with-support) · [reply notifications](#reply-notifications) · [last crash capture](#last-crash-capture) · [connection banner](#connection-banner) |

Most features are on by default. Each one that is not is turned on with a single setting, listed in [Configuration](#configuration). A few need an optional native module ([Native modules](#native-modules)).

## How it fits together

```
  Your Expo app + this kit
     |        |        |
     |        |        +-- every 15 min ----> GitHub Releases   (APK files)
     |        |
     |        +-- device reports, crash reports -+
     |                                           v
     +-- asks for OTA manifest -----------> Frappe site  (upande_mobile app)
                                                 |  reads the manifest from
                                                 v
                                           GitHub Pages  (gh-pages branch: OTA bundles)
                                                 ^
  GitHub Actions (release workflow) -------------+---- also builds the APK when native code changed
```

## Requirements

| What | Needed |
|---|---|
| Expo app | Expo SDK 54 or newer (`expo >=54`, `react-native >=0.81`, `react >=19`, `expo-router >=6`), using expo-router |
| Node | 20 or newer (the workflows use 22) |
| Package manager | npm. The release workflow runs `npm ci`, so `package-lock.json` must be committed |
| Frappe site | Frappe 16 with the `upande_mobile` app installed |
| GitHub | A repository for the app. Its releases must be readable without logging in |
| Android | APK updates and the release workflow are Android only |

## Set up an app

Four steps, once per app. The wizard does most of the work.

### 1. Install the backend on your Frappe site

On the server (or on your own bench for development):

```bash
bench get-app https://github.com/mark-judah/upande-mobile
bench --site your.site install-app upande_mobile
bench build --app upande_mobile
bench --site your.site migrate
bench restart
```

The wizard in step 2 can do this for a bench on your own machine. Production is always yours to run. See the [backend README](https://github.com/mark-judah/upande-mobile#readme).

### 2. Install the kit and run the wizard

```bash
cd my-expo-app
npm install github:mark-judah/upande-mobile-kit#v0.18.0   # or the newest tag on the Releases page
npx upande-mobile-kit init
```

The wizard detects your app name, GitHub repo, package manager and any local bench, and asks only the rest:

| Question | Asked | Answer |
|---|---|---|
| Production site URL | always | Your live Frappe site, for example `https://your.site`. Release builds use it |
| Local/dev site URL | always, optional | For example `http://localhost:8000`. Blank means dev builds use production too |
| GitHub repo (owner/repo) | only if there is no git `origin` | The repo that will publish releases |
| Install the Frappe backend on a bench on this machine? | always | Yes if you have a local bench. It then asks which bench folder and site |
| Your auth hook file and its exported name | only if it cannot find your sign-in state | For example `src/store/auth.ts` and `useAuthStore`. Blank skips it |
| Your API client file | only if `axios` is installed and it cannot find the client | The file exporting a function named `api`. Blank skips it |
| Apply? | always | It prints every file it will change first |

After you confirm, it:

- writes `app/mobile-kit/settings.tsx`, `app/mobile-kit/devices.tsx`, `src/mobile-kit.ts`, `.github/workflows/release.yml` and `.github/workflows/upgrade-kit.yml`;
- edits `app.json` (plugin entry, `expo.updates.url`, `runtimeVersion`, `android.versionCode`, `extra.otaBaseUrl`, and `extra.mobileKit` with every kit setting and a comment), `package.json` (helper scripts) and your root layout (adds the config import and wraps the app in `<MobileKitProvider>`);
- installs the native modules the kit needs with `npx expo install`;
- installs and registers the backend on the bench you chose, and prints the commands for the production server;
- saves your answers to `upande-mobile-kit.json` (kept out of git) so a re-run is just Enter, Enter, Enter;
- runs `doctor` and prints what still needs doing.

Every file it changes is first copied to `.upande-mobile-kit/backup/<timestamp>/` (outside `app/`, which would turn a backup into a route). Delete the folder once you have reviewed the diff.

If it does not recognise your root layout it leaves it alone and prints the edit. By hand:

```tsx
import { MobileKitProvider } from '@upande/mobile-kit';

export default function RootLayout() {
  return (
    <MobileKitProvider>
      <Stack />
    </MobileKitProvider>
  );
}
```

On the production server the app must also be registered, or phones get no OTA. The wizard prints this command with your values filled in:

```bash
bench --site your.site execute upande_mobile.api.register_app --kwargs \
  '{"app_name": "My App", "github_repo": "owner/my-app", "ota_base_url": "https://<owner>.github.io/<repo>/ota", "enabled": 1}'
```

### 3. Commit and push

```bash
git add -A
git commit -m "feat: add the mobile kit"
git push
```

`init` adds `upande-mobile-kit.json` (it holds a path on your machine) and `.upande-mobile-kit/` to `.gitignore`, so `git add -A` is safe. If either was already committed, run `git rm --cached upande-mobile-kit.json`.

The push starts the release workflow, which creates the `gh-pages` branch.

### 4. Set up GitHub, then make the first release an APK

Once per repository:

1. **Actions.** Enable workflows in the **Actions** tab. Under **Settings > Actions > General > Actions permissions**, allow all actions (the workflow uses `actions/*`, `peaceiris/actions-gh-pages`, `softprops/action-gh-release`, `gradle/actions`, `android-actions/setup-android` and `peter-evans/create-pull-request`). If your organisation restricts actions to a list, add those.
2. **Workflow permissions.** **Settings > Actions > General > Workflow permissions > Read and write permissions**, and tick **Allow GitHub Actions to create and approve pull requests** (the [kit upgrade](#upgrading-the-kit) needs it). Save.
3. **Public releases.** Keep the repo, or at least its releases, public. Phones check `api.github.com` for new APKs without logging in, and your Frappe site reads the OTA files from public URLs. A private repo gets no APK offers.
4. **GitHub Pages**, after the first workflow run has created `gh-pages`: **Settings > Pages > Source: Deploy from a branch > Branch `gh-pages`, folder `/ (root)`**. OTA files are then served at `https://<owner>.github.io/<repo>/ota/android/<runtime>/manifest.json`, which is what `extra.otaBaseUrl` points at. Until Pages is on, your Frappe site falls back to `raw.githubusercontent.com`, so OTA can already work for a public repo.
5. **Android signing (optional, recommended).** Without it the APK is signed with Android's public debug key. Add these under **Settings > Secrets and variables > Actions**:

   | Secret | Value |
   |---|---|
   | `ANDROID_KEYSTORE_BASE64` | the keystore file, base64 on one line |
   | `ANDROID_KEYSTORE_PASSWORD` | the keystore password |
   | `ANDROID_KEY_ALIAS` | the key alias |
   | `ANDROID_KEY_PASSWORD` | the key password (the same as the keystore password for a PKCS12 keystore) |
   | `ANDROID_KEY_SHA256` | optional: the certificate SHA-256. When set, the build fails if the APK is signed with anything else |

   The first four must all be set, or the build falls back to the debug key.

   ```bash
   keytool -genkeypair -v -storetype PKCS12 -keystore release.keystore -alias upload \
     -keyalg RSA -keysize 2048 -validity 10000
   base64 -w0 release.keystore            # macOS: base64 -i release.keystore | tr -d '\n'
   keytool -list -v -keystore release.keystore -alias upload   # copy the "SHA256:" line
   ```

   Keep `release.keystore` and its passwords safe. **Phones cannot update an app over an APK signed with a different key.** Switching from the debug key to a real one later means every phone uninstalls first.
6. **Branch protection.** If your release branch requires pull requests, allow `github-actions[bot]` to push to it. The workflow pushes a `chore(release): <version>` commit directly.
7. **Optional: `KIT_UPGRADE_TOKEN`.** See [Upgrading the kit](#upgrading-the-kit).

**The first release must be an APK**, because no phone has the kit yet. In your repo go to **Actions > Release > Run workflow**, tick **build_apk** (or set `bump` to `minor`) and run it. Download the APK from the new GitHub Release, install it once, and from then on every update reaches the phone by itself. `init` sets `runtimeVersion` from your current version (`1.0.0` gives `1.0`).

### Local and production sites

Dev builds (`__DEV__`: Metro, dev clients) use the dev site. Release builds and OTA use the production site. `init` writes both:

```ts
site: { production: 'https://your.site', development: 'http://localhost:8000' },
```

Without a development site every build uses production. Pin one with `environment: 'production'` or `'development'`.

- `localhost` works in the iOS simulator. The Android emulator needs `http://10.0.2.2:<port>`. A real phone needs your computer's LAN address, and a bench listening on it.
- Names ending in `.local` do not resolve from phones or the Android emulator. Use the LAN IP and make the bench answer on it (`bench use <site>` sets the default site).
- A plain `http://` site needs Android cleartext traffic and an iOS App Transport Security exception. The config plugin sets both for the hosts under `expo.extra.mobileKit.sites`, never the global "allow all HTTP" flag, and warns at prebuild. An `http://` production site gets a loud warning. Opt out with `["@upande/mobile-kit", { "cleartext": false }]`. This is native configuration, so it needs a new native build.

## Shipping updates

**Every push to your release branch is a release.** You never choose OTA or APK by hand: the release works it out, says why in the run summary, and the version bumps itself. The rest of this section explains how, so you can steer it when you need to.

### What happens on a push

Pushing to your release branch starts the workflow, except for changes that only touch `*.md` files or `docs/`. It:

1. plans the version and decides OTA or APK (below). The decision and its reason go into the run summary and the GitHub Release;
2. exports the JavaScript bundle and publishes it to the `gh-pages` branch under `ota/`, for every release;
3. if the release is an APK, runs `expo prebuild` and Gradle to build a signed (or debug-signed) APK;
4. commits `chore(release): <version> [skip ci]`, tags `v<version>`, and creates the GitHub Release.

An APK release takes about 14 minutes. The workflow times out after 45 minutes and runs queue behind each other. Do not start your own commit message with `chore(release):`; the workflow ignores those to avoid loops.

### How it decides: OTA or APK

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

### Commit messages

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

### Preview a release before you push

```bash
npx upande-mobile-kit version
```

Prints the next version, the release type and the reason, without changing anything. Commit first (a local commit is enough):

```text
1.2.7 -> 1.2.8 (patch, versionCode 5208, 2 commits since v1.2.7)
release: APK - commit 93b887d contains [apk]; an APK is built on the unchanged runtime 1.2; the OTA bundle is published too
```

Do not run it with `--apply`: that writes the version, and the workflow would bump it a second time. `--json` prints the same decision.

### Running the workflow by hand

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

### Where things end up

- **GitHub Releases:** one per version, tagged `v<version>`. APK releases attach `<apk-name>_v<version>.apk` and a fixed-name `<apk-name>.apk` (always the newest, at `https://github.com/<owner>/<repo>/releases/latest/download/<apk-name>.apk`). OTA releases are titled "(OTA)" and have no file.
- **`gh-pages` branch:** `ota/android/<runtime>/manifest.json`, the bundle and its assets. Older runtimes are kept.
- **The run summary and the Release:** the release type and its reason, runtime, `versionCode`, the APK link, and whether it was signed with your key or the debug key.
- **Workflow artifacts:** the APK is also kept for 90 days, even if a later step fails.

### When a release fails

- The OTA bundle is published before the version commit and tag. A failure before the tag leaves no tag behind, and the next run retries the same version. A tag push that GitHub refuses is reported as a warning and the Release creates the tag itself.
- A failed APK build still keeps its artifacts. Fix the cause and re-run the workflow.
- There is no rollback step. To undo a bad OTA, revert the change on the release branch and push: the next release publishes the old code as a new version.
- The workflow regenerates `android/` with `expo prebuild --clean` on every APK build. Hand edits in a committed `android/` folder are not used; put native changes in config plugins.

## Upgrading the kit

Upgrading is a pull request you merge. `init` writes `.github/workflows/upgrade-kit.yml`. Every Monday (or when you press **Run workflow** on it) it looks for a newer kit release and, if there is one, opens `chore: update @upande/mobile-kit to vX.Y.Z`. The pull request changes the kit dependency and lockfile and installs or removes the native modules the new kit needs. **Merge it.** The release that follows works out by itself whether the upgrade needs a new APK or only an update over the air, and says why in its summary. Nothing is run by hand.

- **Required, once:** **Settings > Actions > General > Allow GitHub Actions to create and approve pull requests**, or the job cannot open the pull request.
- **Optional, `KIT_UPGRADE_TOKEN`:** a fine-grained token on this repo with *Contents*, *Pull requests* and *Workflows* read and write, saved as a repository secret. With it the pull request also moves the pins in `.github/workflows/` to the new kit version, so workflow fixes arrive too. Without it GitHub does not let the built-in token edit workflow files: only the dependency and lockfile change, the release keeps working, and the pull request says the pins were not moved.

The workflow files are pinned to the kit version that wrote them (`...release.yml@v0.18.0`), because a floating tag would send workflow changes to every app at once. For an app whose pins are behind, `npx upande-mobile-kit init --update-workflow` rewrites them and adds `upgrade-kit.yml` if it is missing; `verify` and `doctor` warn about old pins.

## In the app

### The Settings page

Every user of your app gets this page at `/mobile-kit/settings`, once `<MobileKitProvider>` is mounted. Add your own rows without forking: `<SettingsScreen extraSections={...} profileExtra={...} />`. From top to bottom:

| Card | What it has |
|---|---|
| Profile | The user's initial, name, email and site, from your `useAuth` |
| Dev notice | Development builds only: which of `useAuth`, `api` and `storage` are still on the kit's stand-ins |
| Security | The fingerprint switch ([unlock](#fingerprint-unlock), [vault](#fingerprint-sign-in-vault)). With `biometric: 'host'` it still shows whenever your own `useAuth` is wired: it sets your `biometricEnabled` and your app does the locking |
| Help | **Report a problem**, **My reports**, **Ask support** ([Help and support](#help-and-support)) |
| Diagnostics | The **Send crash reports** switch, and a **Send test error** button in development. Hidden with `monitor.showToggle: false` |
| App & Server | The [version information](#version-information), **Check for updates** and the **Download updates** choice ([updates on the phone](#updates-on-the-phone)) |
| Not available in this build | Only when an optional native module is missing, for example "Battery info unavailable: rebuild required" |
| Your own rows | Anything you pass as `extraSections` or `profileExtra` |
| Devices | A link to the [Devices page](#the-devices-page). System Managers only |
| Session | **Sign out** and **Forget this device**, shown when your `useAuth` provides `logout` and `forgetDevice` |

### The floating button

A small translucent button opens Settings from any screen. It hides on the kit's own pages and while the keyboard is open, and, when your own `useAuth` is wired, before anyone has signed in (your sign-in gate would send the page straight back to login). It shows a [progress ring](#progress-ring) while an update downloads.

- **Moving it.** Press the button and drag: it follows your finger, snaps to the nearest screen edge and stays where you leave it, so move it clear of whatever it covers. A tap opens Settings; a long press opens [Report a problem](#report-a-problem).
- **Options.** `fab: false` removes it (open the page yourself with `openKitSettings()`, `<KitSettingsButton />` or `router.push('/mobile-kit/settings')`). `fab: 'dev'` shows it in development builds only. `fab: { initialSide: 'left', bottom: 96, whenSignedOut: true }` sets where it starts and when it shows.

### Version information

The **App & Server** card lists:

| Row | What it is |
|---|---|
| App, Site | The app name and the site it talks to |
| Frappe, ERPNext | Versions of the apps on the site (change the list with `serverApps`) |
| **Upande Mobile Kit (server)** | The `upande_mobile` backend's version. "not installed" when the site lacks it. Always listed |
| **Upande Mobile Kit** | The version of this package the app was built with |
| Installed, Latest | The running app version and the newest published |
| APK | The version of the installed APK. OTA changes the code a phone runs but never its APK, so this can differ from Installed |
| Code | Which JavaScript is running: the embedded build, or the OTA bundle id, date and channel |

Each device also reports its kit version, so the [IT dashboard](#the-it-dashboard) shows which phones are on an old kit.

### Updates on the phone

#### OTA updates

On open, the app checks for an over-the-air bundle. If one downloads in the first 20 seconds the app restarts into it; a later download waits for the next opening, so the app never restarts under someone mid-task (`otaOpenWindowMs`).

Handhelds are rarely restarted, so the app also looks again every time it returns to the foreground (at most once every 10 minutes, `foregroundUpdateCheckMinMs`) and every 15 minutes while it stays open, for a new APK and a new bundle. The APK check asks GitHub with the last ETag, so "nothing new" is a free `304` that does not count against GitHub's rate limit. A bundle found this way is downloaded and the person is **asked**: **Restart now** or **Later**. It is never applied behind their back, and each bundle is offered once. Turn it off with `otaOnForeground: false`. OTA bundles carry JavaScript only; native changes need an [APK](#apk-updates).

#### APK updates

- **Check for updates** (App & Server) checks GitHub Releases for a new APK first, because a new APK carries a new runtime and supersedes any OTA bundle. If the APK is current it asks for an OTA bundle. When an APK is available the same button reads **Download v1.3.0 (size)**, then **Install v1.3.0**.
- **Download updates** is a choice under that button: **Wi-Fi only** (default), **Any network** or **Off**. The user's choice wins over `apk.autoDownload`. Once a day, and whenever the app returns to the foreground, it checks GitHub Releases; a newer APK downloads by itself in the background. A download skipped on mobile data starts when the app is next opened on Wi-Fi. A finished download is kept, so a cancelled installer can be reopened without downloading again. A dropped connection resumes where it stopped.
- **Android cannot install an APK silently.** The person always confirms in Android's installer, and the first time Android also asks to allow installs from this app.

#### Forced install

Once a newer APK is on the phone, an **Update required** dialog covers the whole app with one button, **Install now**; the Android back button does nothing. If the person cancels Android's installer they land on the dialog again. If Android has not yet allowed installs from this app, the dialog offers a shortcut to that setting. If the installer closes without installing (or never appears), the dialog says so and keeps **Download in your browser instead** one tap away, so the person is never stuck. On by default; `apk: { force: false }` gives a softer **Install now / Later** prompt that asks again next time.

**The install permission.** Opening Android's installer needs `android.permission.REQUEST_INSTALL_PACKAGES` in the manifest. Without it Android 8+ never offers the "Install unknown apps" switch and tapping Install does nothing, with no error. The config plugin adds it for you (`{ "installPermission": false }` opts out). It is a manifest entry, so it reaches a phone only with a **new APK**; until then an older build can update only through the browser button.

#### Progress ring

While an APK or an OTA bundle downloads, a ring of dots appears around the [floating button](#the-floating-button). For an APK the dots light up clockwise with the real progress; an OTA bundle has no known size, so a short arc travels around the ring. The Settings page shows the same progress as text and as a bar in the update card.

### Fingerprint unlock

Set with `biometric`:

| Mode | Who does what |
|---|---|
| `'kit'` (default) | The Settings switch stores the user's choice; your sign-in flow acts on it |
| `'host'` | Your app already has its own lock and enforces it. `init` detects an existing use of `expo-local-authentication` and sets this for you |
| `'vault'` | The kit keeps the sign-in behind the fingerprint ([vault](#fingerprint-sign-in-vault)) |

Needs `expo-local-authentication` (not with `'host'`). The **Biometric unlock** switch is in the Security card.

- **Turning it on** asks the phone to confirm with a fingerprint or face (the PIN is not accepted here). Without the native module it says to install the latest build; with no fingerprint enrolled it says to enrol one first.
- **Turning it off** needs no prompt.
- **Where the choice is saved:** through your `useAuth` (`biometricEnabled`, `setBiometricEnabled`), so it lands in your own auth store; without `useAuth` the kit keeps it in its own storage.
- **What the kit does not do:** it adds no lock screen and does not lock your app on open. Your sign-in flow reads `biometricEnabled` and prompts with the kit's helper, which is safe on a build without the native module (it reports "not available" instead of crashing):

  ```ts
  import { Biometric } from '@upande/mobile-kit';

  if (biometricEnabled && (await Biometric.isAvailable())) {
    const { success } = await Biometric.authenticate({ promptMessage: 'Unlock' });
    // success: let the user in; otherwise fall back to the password
  }
  ```
- **With `'host'`** the kit never prompts for or enforces a lock. The Settings switch stays when your `useAuth` provides `biometricEnabled` and `setBiometricEnabled` (it flips your own setting, after a fingerprint check when turning on); without a wired `useAuth` it is hidden.
- **Sign out** and **Forget this device** (Session card) call the functions your `useAuth` provides, then go to `loginRoute` (default `/login`). Forget this device clears the session and disables biometric unlock.

### Fingerprint sign-in vault

Set `biometric: 'vault'`. The vault stores the person's sign-in in the phone's secure storage behind their fingerprint or face, so the login screen can offer **Sign in with fingerprint**. Needs `expo-secure-store` and `expo-local-authentication` in the build; without them the switch says so and nothing is stored.

1. **Turn it on.** Settings shows **Fingerprint sign-in**. It asks for the password once (in the kit's own sheet, so it works on Android), then the phone asks for the fingerprint to store it. Turning it off wipes it.
2. **Offer it after login**, once per device, from your login screen:

   ```tsx
   import { useBiometricVault, BiometricSignIn } from '@upande/mobile-kit';

   const vault = useBiometricVault();
   // after a successful password login:
   await vault.offer({ server: siteUrl, user: email, password });

   // on the login screen: renders only when a sign-in is stored
   <BiometricSignIn onCredentials={({ server, user, password }) => signIn(server, user, password)} />
   ```
3. **How it signs in.** The button asks for the fingerprint, then hands the stored `{ server, user, password }` to your `onCredentials`, which runs your normal login. If the password changed on the server, the login fails, the message shows under the button, and the person signs in with the new password and turns the switch on again.

The password never leaves the phone except through your own login call. A plain marker (not the password) tells the screen whether one is stored, so checking never prompts.

### Silent re-login

A session can die while someone is working. Without help the app throws them to the login screen. With the vault on, the kit signs in again by itself and retries the call:

```ts
configureMobileKit({
  // ...
  biometric: 'vault',
  sessionRecovery: {
    login: ({ server, user, password }) => myAppSignIn(server, user, password), // your normal login; refreshes the session
    onFailure: () => router.replace('/login'),   // optional: nothing worked, send them to sign in
  },
});
```

- **What triggers it:** not only HTTP 401. Frappe reports a dead session as a 400 CSRF failure, a 403 `AuthenticationError`, `session_expired`, or a 417 whose message says the session expired. An ordinary permission error does not count.
- **The credentials** are kept in memory only, after a fingerprint unlock or when the person turns the vault on, and only for a person who did. Sign out and Forget this device drop them.
- **One retry.** A burst of failing calls shares a single login, and each call is retried once.
- **For your own client,** wrap it with `withSessionRecovery(api, { login, onFailure })`. After a normal password login call `rememberCredentials({ server, user, password })` (kept only if the vault is on), and call `forgetCredentials()` on your own sign-out.

### The Devices page

At `/mobile-kit/devices`, the install register for this app, inside the app. It answers: which phones run which build, and who is behind.

- **Who can open it:** System Managers (your `useAuth` reports `isSystemManager`); anyone else is sent back to Settings. They reach it from the Devices row on the Settings page.
- **What it lists:** every device that has run this app and reported in, newest activity first, 30 at a time. It reads `upande_mobile.api.installs` and shows only this app's devices. Devices appear only after the app has signed in to a Frappe user at least once.
- **Each row:** a phone icon (a desktop icon for an emulator), the device name or brand and model, "(this device)" for the phone you hold, platform and OS version, app name and version, last seen, the last user and how many users used it, and a status badge. When an update is needed, a line such as "Update to 1.3.0 (reopen the app)".
- **Tap a row** for every account that used the device (each with its app version and last seen), the model, the OS, the previous version and when it was upgraded, sign-ins and launches, first seen, the IP the server saw, and the first 8 characters of the install id.
- **Filters:** All, 7 days or 30 days of activity; **Dormant** to include devices not seen for a while; a search over user, device, model, OS, version and IP. A summary under them counts devices per status.

| Status | Meaning |
|---|---|
| Current | Running the latest published version |
| Behind | A newer JavaScript update exists; reopening the app applies it |
| Needs APK | The device's runtime is older than the latest, so it needs a new APK |
| Ahead | Newer than the latest published version |
| Dormant | Not seen for the app's dormant days (7 by default) |
| Unknown | The app is not registered and enabled on the site, or no latest version is known yet |

Status and the "Update to" text come from the server; nothing is worked out on the phone. Battery, storage, network and the per-device crash history are in the [IT dashboard](#the-it-dashboard).

### Crash and API monitoring

On by default. Everything captured shows in the [IT dashboard](#the-it-dashboard). The user can turn reporting off in Settings, and `monitor: { enabled: false }` installs nothing.

**What is captured**

- Unhandled JavaScript errors (a fatal one is sent at once), unhandled promise rejections, and render errors if you wrap the app in `<MonitorErrorBoundary>` or set `monitor.errorBoundary`.
- `console.error(err)` calls that carry an Error (turn off with `captureConsoleErrors: false`). Plain strings and React warnings are not reported.
- Failed API calls (status 400 and up, network errors, timeouts): method, URL, status, duration, headers, request and response bodies. Successful calls are not sent unless you set `sampleSuccess`, and then only as metadata.
- The last 30 screens and API calls as breadcrumbs.
- The device: OS version and build, brand, model, battery level and state, low-power mode, free and total storage, memory, network, locale, time zone, screen, build type, app, runtime and update ids, and any optional native modules missing from this build.
- The signed-in user your `useAuth` reports: id, name and roles.
- The connection and how it performs (next section).

**Hooks.** `MobileKitProvider` wraps `fetch`. For axios call `attachAxios(instance)` once; for a custom client wrap it with `withMonitoring(api)`. By hand:

```ts
import { captureException, captureMessage, addBreadcrumb } from '@upande/mobile-kit';

captureException(err, { orderId });
captureMessage('Sync finished late', 'warning');
addBreadcrumb({ type: 'user', message: 'Opened the scanner' });
```

**Cost to the app.** Capturing only pushes a small object into a bounded in-memory buffer. Redaction, serialising and device probes run later, off the interaction path, in one batched request: every 30 seconds while events wait, at 20 events, and when the app goes to the background. Repeats within 60 seconds become one event with a count, a session sends at most 200 events, and an offline queue (100 events, 1 MB) retries with back-off. Reports need a signed-in session; earlier events wait and are sent after sign-in.

**Privacy.** Read this before shipping.

- Secrets are redacted on the phone, then again on the server. Header, query and body field names containing `authorization`, `cookie`, `token`, `secret`, `password`, `passwd`, `api_key`, `session`, plus the whole words `sid`, `pwd`, `pin`, `otp`, `cvv` and `card` become `[redacted]`. Add more with `monitor.redactKeys`.
- Redaction is by name. A secret in a field with another name, or in free text, is not found by the phone. If your responses carry personal data, set `captureBodies: false` or add the field names to `redactKeys`.
- Bodies are cut at `maxBodyBytes` (8 KB). Binary bodies are never recorded, only their size.
- The server stores the IP address it sees and a hash of the device identifier.
- Ignore noisy calls with `ignoreUrls`, for example `['exp.host/--/api/v2/push', /\/healthz$/]`.

### Network and performance

Every report and device snapshot carries how the network treats the app:

- **Connection type**, and whether the phone is online and the internet reachable.
- **Latency to your server:** a tiny `GET /api/method/ping`, at most once a minute, in the background.
- **How long the app's own calls take:** count, average and 95th-percentile response time and the share that failed, over the last 100 calls.
- **Wi-Fi details** with `@react-native-community/netinfo` in the build: the Wi-Fi name, signal strength, link speed and band, and the cellular generation. Android shows the Wi-Fi name only when the app holds the location permission; without it that field is left out.

Nothing here is a speed test: link speed is what the radio negotiated, and latency and response times are measured from real use. To keep the Wi-Fi name out of your data, leave netinfo out.

### Device identifiers

Every device snapshot, and the register, carries what identifies the phone:

| Fact | Where it comes from | When it is there |
|---|---|---|
| **Build number** | The installed app's build (the Android `versionCode`), from `expo-application` | Always |
| **Device ID** | The **Android ID** (16 hex characters), read from React Native's own platform module, so no extra package. Android only | Always on Android. It is not hidden from apps, stays the same across updates and reinstalls, and changes after a factory reset, so it is the identifier to link a phone to an asset. (`device_key`, a SHA-256 of it, is what the register matches on) |
| **Device IP** | The address the phone has on its own network, from the Wi-Fi details (`netinfo`) or `expo-network` | When connected. The server separately records the address it saw (**IP seen**) |
| **MAC address** and **serial number** | `deviceInfo` in the config, or `react-native-device-info` if the app has it | **Rarely on a stock phone.** Android 10+ and iOS return placeholders (`02:00:00:00:00:00`, `unknown`); a placeholder is dropped and the field stays empty |

Managed handhelds (a device-owner app, or a vendor SDK such as Zebra's) can pass the real values:

```ts
configureMobileKit({
  // ...
  deviceInfo: async () => ({ serial_number: await Vendor.serial(), mac_address: await Vendor.mac() }),
});
```

The callback is read once and its failure never reaches the app. They identify a phone, so leave out what you do not want: do not pass `deviceInfo` and do not install `react-native-device-info`.

### The IT dashboard

Reports from your apps land on a web page the backend serves: **`https://your.site/it-dashboard`** (the old `/mobile-monitor` address redirects there).

- **Who can open it:** people on the **IT Team** role profile, and no one else. Anyone without it gets a page saying they cannot access the dashboard. Sign in to your Frappe site, then open the address; it has no Frappe menu entry, so bookmark it.
- **What you get:** an overview (events per day, top issues, app versions, device models and OS versions, fleet health); every crash, error and failed API request grouped into issues, with the stack, request and response (secrets removed), breadcrumbs, device and user, and Resolve/Ignore; a Devices view with filters for low battery, low storage, offline, old OS and old app, and each device's timeline with its Wi-Fi, latency, kit version and Device ID; a **Support** inbox for [problem reports and chat](#help-and-support); and an **Apps** page per app. The dashboard also manages users, roles, doctype permissions and user permissions for the IT team, without System Manager.
- **What it needs:** the backend installed with `bench build --app upande_mobile` run once, the app registered on that site, and the app signed in so it can send reports.

The dashboard is for you; the Settings page is for your users. The [backend README](https://github.com/mark-judah/upande-mobile#the-web-portal) describes it in full.

### Help and support

The **Help** card in Settings has **Report a problem** and **My reports** / **Ask support** (**Chat with support** on a site without Issues). Each can be turned off: `support: false`, `support: { chat: false }`. They need the backend (`upande_mobile` 0.2.0 or newer, then `bench migrate`).

#### Report a problem

The person writes a subject and what happened. The kit adds a **screenshot of the screen they were on**, taken at the moment they ask, before anything covers it (needs `react-native-view-shot`; without it the report goes without one), the **device and connection**, the **last 15 requests** (addresses and results only, secrets removed) and the **[last crash](#last-crash-capture)**. A "What will be sent" list shows all of it before they send.

It does not have to start in Settings. Each of these screenshots the current screen, then opens the sheet over it:

| Trigger | How |
|---|---|
| Long-press the floating button | Built in. Hold for about half a second: a ring fills while the button shrinks, then it buzzes and pulses once and the sheet opens. A tap still opens Settings; dragging moves the button |
| A button in your own header or menu | `<ReportProblemButton />` (an icon, or `label="Report a problem"`) |
| Anything else (a menu item, an error screen) | `await openReportProblem()`, or `const { reportProblem } = useReportProblem()` |

```tsx
import { ReportProblemButton, openSupportChat } from '@upande/mobile-kit';

<Stack.Screen options={{ headerRight: () => <ReportProblemButton /> }} />
// and for chat: openSupportChat()
```

These do nothing, and return `false`, when the tool is off (`support: false`).

**Where it lands.** On a site with the **Issue** doctype (ERPNext or Helpdesk) the report is an ordinary **Issue**: subject `[Your App] what they wrote`, raised by the person's email, the diagnostics in the description, and the **screenshot attached**. It then follows your normal support workflow. A site without Issue gets a *Mobile Report* record instead.

#### My reports and chat with support

On a site with Issue, a conversation **is an Issue**, the way your support team already works:

- **My reports** (Settings > Help) says how many reports are open and how many have a new reply, and lists the person's own Issues for this app, newest first, each with a status chip (Open, Replied, Resolved, Closed), when it last moved, and a dot when support has answered since they last looked. **Ask support** starts a new conversation.
- **A conversation** is one timeline: a status header, what they wrote, every comment on the Issue (support's marked with the time), and every **change of status** as a line between messages. **Support replies by adding a Comment on the Issue in Desk**, and the answer appears in the app within seconds while it is open. (The status history needs `upande_mobile` 0.5.0 or newer; an older backend still shows the messages.)
- **The person answers** in the app; that becomes a Comment on the same Issue, and an Issue that was Replied or Resolved goes back to Open. A Closed conversation cannot be replied to; the person starts a new one.
- **New message** starts a conversation: a subject and a first message, filed as an Issue (with diagnostics, without a screenshot).

On a site without Issue the kit falls back to a single chat thread with support, answered from the dashboard's Support page. Only the person's own Issues are shown, and only replies they have not yet seen count as unread.

#### Reply notifications

When support answers, the person's phone gets a push notification, and tapping it opens that conversation. Settings > Help has a **Notify me about replies** switch (they are also asked once, in words, after their first message); it appears only in a build that can receive notifications.

The phone registers its Expo push token with your site (`register_push`), kept per person and app. When your team adds a **Comment** to the person's Issue, the site sends the push through Expo's push service (nothing else is contacted). A token Expo reports as gone is deleted; signing out forgets the phone's token. The kit never changes how your app's own notifications are shown.

What the app needs, once (all standard Expo):

| Requirement | How |
|---|---|
| `expo-notifications` in the build | `npx expo install expo-notifications`, add `"expo-notifications"` to `plugins` in `app.json`, then a new native build |
| An Expo project id | `expo.extra.eas.projectId` in `app.json` (a free Expo account is enough), or `push: { projectId }` in the kit config |
| Firebase on Android | `android.googleServicesFile` pointing at your `google-services.json`, and the Firebase (FCM v1) credentials uploaded to your Expo project |

`push: false` turns it off. Without the requirements the switch does not appear.

#### Last crash capture

Unhandled errors and render errors are saved on the phone, so a report filed after a black screen or restart still carries what broke. The crash is sent only inside a report the person chooses to send, then forgotten.

#### Connection banner

A banner appears when the phone has been offline for 25 seconds, when the last round trip to your server took 3 seconds or more, or **at once when the server answers 503 or 502**, which is what a deployment looks like from the phone: *"The system is being updated right now. Please try again shortly."* with a **Try again** button. While it shows, the kit asks the server every few seconds and the banner goes the moment it answers normally.

**It does not trust Android alone.** Some handhelds (the Honeywell EDA52, for one) keep reporting "connected" after the Wi-Fi radio has stopped carrying data. After **two requests to your server in a row that never got an answer**, the phone counts as offline whatever Android says, and the kit probes the server every few seconds so a single answer clears it. Only your own server counts. It has a **Wi-Fi settings** shortcut, because an app cannot switch Wi-Fi itself on modern Android. Tune it with `connectionBanner: { staleAfterSec: 25, slowMs: 3000 }` or turn it off with `connectionBanner: false`.

## Configuration

`src/mobile-kit.ts` starts this short. Everything but `appName` and `githubRepo` is optional.

```ts
import { configureMobileKit } from '@upande/mobile-kit';

configureMobileKit({
  appName: 'My App',
  githubRepo: 'owner/my-app',
  site: { production: 'https://your.site', development: 'http://localhost:8000' },
});
```

Release settings (offsets, the `apk` and `ota` lists) live in `app.json` under `expo.extra.mobileKit`, not here; see [Shipping updates](#shipping-updates).

**Identity and connection**

| Key | Default | Meaning |
|---|---|---|
| `appName` | required | The Mobile App name on the server and the app's title |
| `githubRepo` | required | `owner/repo` whose Releases carry the APKs |
| `site` | none | Site URL, or `{ production, development }` |
| `environment` | from `__DEV__` | `'development'` or `'production'` to pin the choice |
| `useAuth` | stand-in | `() => ({ isSystemManager, user, instanceUrl, biometricEnabled, setBiometricEnabled, roles?, fullName?, email?, logout?, forgetDevice? })` |
| `api` | built-in `fetch` | Your Frappe client; must resolve to the response body |
| `authHeaders` | none | Extra headers for the built-in client |
| `storage` | AsyncStorage, else memory | `{ get, set, remove }` |
| `loginRoute` | `'/login'` | Where Sign out and Forget this device go |
| `endpoints` | the `upande_mobile` paths | Override `registerInstall`, `installs`, `versions`, `ingest`, `submitReport`, `chat`, `supportThreads`, `supportThread`, `supportReply`, `registerPush`, `unregisterPush` |
| `instanceKey`, `deviceKey` | none | Optional hooks: how a server URL becomes a storage key, and a better hardware id |

Without `useAuth`, `api` and `storage` the kit runs on stand-ins. The Settings page looks fine, but sign-out, the biometric switch and the device register are not connected to your session. `init` wires them when it finds your auth store, API client and storage, development builds log what is still a stand-in, and `getConfigGaps()` returns the list.

**Updates**

| Key | Default | Meaning |
|---|---|---|
| `apk.autoDownload` | `'wifi'` | `'wifi'`, `'always'` or `'never'`. The user's Settings choice wins |
| `apk.force` | `true` | `true`: a downloaded APK blocks the app until installed. `false`: the dialog has **Later** |
| `otaOpenWindowMs` | `20000` | A bundle downloaded within this long of opening restarts the app at once |
| `otaOnForeground` | `true` | Also look for updates on return to the foreground, and ask before restarting |
| `foregroundUpdateCheckMinMs` | `600000` | Minimum time between two foreground update checks |
| `foregroundReportMinMs` | `30000` | Minimum time between foreground device reports |

**Interface**

| Key | Default | Meaning |
|---|---|---|
| `fab` | `true` | `true`, `false`, `'dev'` or `{ initialSide: 'left' \| 'right', bottom: 96, whenSignedOut: false }` |
| `deviceInfo` | none | `() => ({ serial_number?, mac_address?, local_ip? })`: identifiers only your app can read |
| `theme`, `ui` | the Upande design system | Colours and fonts ([Look and feel](#look-and-feel)), or swap `Screen`, `Card`, `Button`, `useToast`, `showDialog`, `useOnline` |
| `serverApps` | Frappe and ERPNext | `[key, label][]` site apps to list on Settings. The kit's backend is always added |
| `settingsRoute`, `devicesRoute` | `/mobile-kit/settings`, `/mobile-kit/devices` | Rarely needed; the defaults live in a folder no app uses, so they cannot collide |
| `errorMessage`, `onAvatarLongPress` | none | Optional hooks |

**Security**

| Key | Default | Meaning |
|---|---|---|
| `biometric` | `'kit'` | `'kit'`, `'host'` or `'vault'` ([Fingerprint unlock](#fingerprint-unlock)) |
| `sessionRecovery` | none | `{ login, onFailure? }`: silent re-login (needs the vault) |

**Help and support**

| Key | Default | Meaning |
|---|---|---|
| `support` | `true` | `false` hides **Report a problem** and **Chat with support**; `{ report: false }` or `{ chat: false }` hides one |
| `push` | `true` | Reply notifications: `false` turns them off; `{ projectId }` sets the Expo project id when it is not in `extra.eas.projectId` |
| `connectionBanner` | `true` | `false`, or `{ staleAfterSec: 25, slowMs: 3000 }` |

**Monitoring.** `monitor` takes:

| Key | Default |
|---|---|
| `enabled` | `true` |
| `captureBodies` | `true` |
| `captureConsoleErrors` | `true` |
| `maxBodyBytes` | `8192` |
| `redactKeys` | `[]` |
| `ignoreUrls` | `[]` (strings or RegExps) |
| `sampleSuccess` | `0` (0 to 1) |
| `breadcrumbs` | `30` |
| `consoleBreadcrumbs` | `false` |
| `maxEventsPerSession` | `200` |
| `flushIntervalSec` | `30` |
| `errorBoundary` | `false` |
| `showToggle` | `true` (the "Send crash reports" row) |
| `showTestActions` | `__DEV__` (the "Send test error" button) |

### Look and feel

Every page and sheet follows the Upande design system: a near-black primary on a `#FAFAFA` background, white cards with a hairline `#E5E5E5` border, radius 10 and 14, small uppercase section captions, DM Sans for text and Poppins for headings, and colour only for status. Icons are Ionicons. The fonts are used when the app has loaded them (`@expo-google-fonts/dm-sans` and `@expo-google-fonts/poppins`) and fall back to the system font. An app with other tokens passes `theme`, and the whole kit follows:

```ts
configureMobileKit({
  // ...
  theme: { primary: '#0F766E', fontRegular: 'Inter_400Regular', fontSemiBold: 'Inter_600SemiBold' },
});
```

| Token | Default | Used for |
|---|---|---|
| `primary`, `textOnPrimary` | `#171717`, `#FFFFFF` | Buttons, the floating button, switches, the avatar |
| `text`, `textSecondary`, `textMuted` | `#171717`, `#525252`, `#A3A3A3` | Text, in three strengths |
| `background`, `surface`, `surfaceAlt`, `border` | `#FAFAFA`, `#FFFFFF`, `#F5F5F5`, `#E5E5E5` | Page, cards, soft panels, hairlines |
| `success`, `warning`, `danger` | `#22C55E`, `#F59E0B`, `#EF4444` | Status chips and errors |
| `fontRegular`, `fontMedium`, `fontSemiBold`, `fontBold` | DM Sans and Poppins | Text and headings |

### Config plugin

Props go in `app.json`, for example `["@upande/mobile-kit", { "strict": false }]`: `manifestUrl`, `otaBaseUrl`, `sites` / `site` / `devSite`, `cleartext` (`false` opts out), `installPermission` (`false` opts out), `strict` (`false` turns the missing-native-module build failure into a warning) and `biometric` (`'host'` leaves out `expo-local-authentication`).

## Native modules

The kit needs ten native modules: `expo-updates`, `expo-constants`, `expo-file-system`, `expo-intent-launcher`, `expo-local-authentication`, `expo-network`, `expo-device`, `expo-battery`, `expo-localization` and `@react-native-async-storage/async-storage`. `init` installs the missing ones with `npx expo install`, which picks the version that fits your SDK. They are not `peerDependencies` on purpose: npm would install the newest version, which is wrong for most SDKs.

- The config plugin stops `expo prebuild`, EAS and CI with the exact command if one is missing (`strict: false` makes it a warning). `verify` and `doctor` report it as an error, and `npx upande-mobile-kit fix` repairs it.
- A native module added later works only after a new native build; an OTA update cannot deliver it. The release notices the change and builds the APK. Settings shows "rebuild required" for a module that is installed but not in the running binary.

**Optional extras.** Never required and never nagging; each switches on one feature when it is in the build. Install with `npx expo install <package>` and make a new native build.

| Package | Adds |
|---|---|
| `react-native-view-shot` | The screenshot in [Report a problem](#report-a-problem) |
| `expo-notifications` | [Reply notifications](#reply-notifications) (also needs an Expo project id and, on Android, Firebase) |
| `expo-secure-store` | The [fingerprint sign-in vault](#fingerprint-sign-in-vault) |
| `@react-native-community/netinfo` | Wi-Fi name, signal, link speed and band ([Network and performance](#network-and-performance)) and the phone's own IP address |
| `react-native-device-info` | The MAC address and serial number, where the phone allows ([Device identifiers](#device-identifiers)) |

## Command line

There is one command to know, and you run it once per app:

| Command | What it does |
|---|---|
| `npx upande-mobile-kit init` | The setup wizard (flags below) |

Everything else is automatic: pushes release by themselves, and a pull request upgrades the kit. Settings live in `app.json` under `expo.extra.mobileKit`. The remaining commands exist for the workflows and for repair, not for day-to-day use: `fix` (install missing native modules; `--dry-run`, `--align`, `--yes`), `verify` and `doctor` (self-tests), `version` (plan a version bump; run with no flags to [preview a release](#preview-a-release-before-you-push)), `publish-ota` (build the OTA bundle) and, in the kit's own repository only, `release`.

`init` with no value flags runs the wizard; any value flag runs the plain, non-interactive version.

| Flag | Meaning |
|---|---|
| `--yes` | Ask nothing: use remembered answers, detected values and flags. The production site must come from `--site` or a remembered answer |
| `--no-install` | Run no commands; print them. The setup is incomplete until you run `fix` |
| `--site URL`, `--dev-site URL` | Production and development sites |
| `--bench PATH`, `--bench-site NAME` | Install the backend on this bench and site |
| `--name "My App"` | Mobile App name (default `expo.name`) |
| `--repo owner/repo` | GitHub repo that publishes releases (default: git origin) |
| `--ota-base-url URL` | Where bundles are served (default: the repo's GitHub Pages `ota` folder) |
| `--apk-name my_app` | APK file name stem (default: your app name in snake case) |
| `--branch main` | Release branch (default: the current branch) |
| `--biometric host\|kit` | Who owns the biometric lock (default: detected) |
| `--backend-repo URL`, `--kit-repo owner/repo` | For forks of the backend or the kit |
| `--no-adapters` | Do not look for your auth store, API client and storage |
| `--update-workflow` | Rewrite only the workflow files to the installed kit's version (adding `upgrade-kit.yml` if missing), keeping app name, APK name and branch |
| `--no-backup` | Do not copy changed files into `.upande-mobile-kit/backup/` |
| `--force` | Overwrite files that exist |
| `--settings-route PATH`, `--devices-route PATH` | Rarely needed: other paths for the kit's pages |

Without a terminal and without `--yes`, `init` stops and lists the flags to pass:

```bash
npx upande-mobile-kit init --yes --site https://your.site --dev-site http://localhost:8000 --bench /path/to/bench --bench-site my.site
```

## Troubleshooting

**Releases and updates**

| Symptom | Cause | Fix |
|---|---|---|
| A release has no APK | Nothing in it needed one: no native dependency, plugin, patch or `apk`-listed file changed, and every changed file is JS-only | Read the reason in the run summary. If a file should have needed an APK, add it to `release.apk` in `app.json`. Otherwise `[apk]` in a commit message, `build_apk` on a manual run, or `bump: minor` |
| A release built an APK you did not expect | A changed file is in neither list, or a native package changed | The reason names the file or package. List the file under `release.ota` if it is safe over the air |
| `Run workflow` has no `build_apk` box | The workflow file is from an older kit | `npx upande-mobile-kit init --update-workflow`, commit and push |
| The upgrade pull request is not opened | "Allow GitHub Actions to create and approve pull requests" is off | Turn it on, then run **Upgrade the kit** by hand |
| The upgrade pull request did not move the workflow pins | No `KIT_UPGRADE_TOKEN` secret (the built-in token cannot edit workflow files) | Add the secret, or run `init --update-workflow` once |
| The workflow fails at `npm ci` | `package-lock.json` is missing or out of date | Run `npm install` and commit the lockfile |
| The workflow fails pushing the version commit | The release branch is protected | Allow `github-actions[bot]` to push to it |
| No OTA update arrives | The app is not registered and enabled on the production site; the runtime does not match; Pages is off for a private repo; the site cannot be reached | `verify --site <production>`; on the server run `register_app`; check the release's runtime equals `expo.runtimeVersion` |
| OTA arrives but the app does not restart into it | The bundle finished downloading more than 20 s after opening | It applies on the next opening. Raise `otaOpenWindowMs` if you want |
| No APK offer | The repo's releases are private, the latest APK is not newer, the check ran in the last 15 minutes, or downloads are Off or the phone is not on Wi-Fi | Check the Releases page; use Settings > Check for updates |
| The APK will not install ("package appears to be invalid") | Signed with a different key than the installed app (debug versus your key, or a build from another machine), or a lower `versionCode` | Sign every release with one key. Set `versionCodeBase` above the old build's `versionCode`. For a key change, uninstall once, then install. `adb install -r app.apk` prints the exact reason |
| Tapping Install does nothing | The build lacks `REQUEST_INSTALL_PACKAGES` | Ship a new APK from kit 0.17 or later; until then use **Download in your browser instead** |
| The Update required dialog keeps coming back | The installer was cancelled, or Android blocks installs from this app | Tap **Install now** and allow installs from this app. `apk: { force: false }` adds **Later** |
| Metro says "Unable to resolve ..." for a file that exists in `node_modules` | The dev server started before you updated the kit | Stop it and run `npx expo start -c` |

**In the app**

| Symptom | Cause | Fix |
|---|---|---|
| "Not available in this build", or `verify` reports a missing module | A native module is not installed, or not in the running binary | `npx upande-mobile-kit fix`, then a new native build |
| No Settings button | `fab` is `false` or `'dev'` in a release build, or `<MobileKitProvider>` is not mounted | Remove `fab` from `src/mobile-kit.ts`; run `verify` |
| The button froze the screen when dragged | An older kit animated it two ways at once | Upgrade to 0.17.2 or later |
| `/mobile-kit/settings` shows another screen | A file in your app serves that path | `verify` names it. Rename or remove it |
| No ring on the floating button while updating | The button is hidden (kit pages, keyboard, before sign-in) or `fab` is off | The ring is part of the floating button |
| Devices page is empty | The register needs a signed-in Frappe user and a `useAuth` that reports one | Wire `useAuth` in `src/mobile-kit.ts` |
| Events do not reach the dashboard | Not signed in, monitoring is off in Settings or on the Mobile App record, or the app is not registered | Sign in; check `enable_monitoring`; run `register_app` |
| The dashboard says you cannot access it | Your user is not on the **IT Team** role profile | Add the profile to the user |
| **Report a problem** says it could not send | The backend is older than 0.2.0 or has not been migrated, or the phone is offline | Update `upande_mobile`, run `bench --site your.site migrate`, retry |
| A report is not in the Issue list | The site has no Issue doctype, so it went to Mobile Report | Look under the dashboard's Support page, or install ERPNext/Helpdesk |
| A report has no screenshot | `react-native-view-shot` is not in the build | `npx expo install react-native-view-shot`, then a new native build |
| **Chat with support** never shows replies, or a reply is not seen | Nobody replied yet, the backend lacks the support endpoints, or the reply was an email or note instead of a **Comment** | On a site with Issues add a **Comment** in Desk. Update the backend to 0.3.0 or newer and run `bench migrate` |
| No notification when support replies | Not turned on; the build lacks `expo-notifications`; no Expo project id or Firebase credentials; the reply was not a **Comment**; or the site has push off (`upande_mobile_push: 0`) | Check Settings > Help > Notify me about replies and the [requirements](#reply-notifications) |
| The "Notify me about replies" switch is missing | The build cannot receive notifications, or `push: false` | `npx expo install expo-notifications`, add the plugin, make a new native build |
| The person is thrown to the login screen when the session expires | No silent re-login | Turn on the [vault](#fingerprint-sign-in-vault) and set `sessionRecovery.login` |
| The fingerprint switch says "Needs a newer build" | `expo-secure-store` is not in the running build | `npx expo install expo-secure-store`, then a new native build |
| The banner says the connection is slow | The last round trip took 3 seconds or more | Check the network; raise `connectionBanner.slowMs` or turn it off |
| The offline banner never appears on one handheld model | An older kit trusted Android's "connected" | Update the kit |
| "Upande Mobile Kit (server)" says "not installed" | The site does not have the `upande_mobile` app | Install the backend ([step 1](#1-install-the-backend-on-your-frappe-site)) |
| `.local` site unreachable from the phone | Phones do not resolve `.local` names | Use your computer's LAN IP |
| `http://` site blocked | Cleartext not enabled in the native build | List the site under `expo.extra.mobileKit.sites` and make a new native build |
| Expo Go ignores part of the setup | Expo Go does not run config plugins or add native modules | Use a development build |

## Security and privacy

- This package is public. Nothing secret belongs in it or in `src/mobile-kit.ts`.
- Reports go only to your own Frappe site. Both the phone and the server redact secrets before they are stored ([Privacy](#crash-and-api-monitoring)).
- Device facts reported with each snapshot include the build number and the phone's own IP address, and, when the phone or your app supplies them, the MAC address and serial number. The Wi-Fi name (only with netinfo and the location permission), signal and speed are stored with the device's health. Leave `@react-native-community/netinfo` out if you do not want them.
- The Android ID is stored only as a hash. The server also records the IP address it sees. It never records location.
- A problem report contains what the person typed, an optional screenshot of their screen (it may show anything that was on it) and the diagnostics listed in the sheet, which the person sees before sending. Reports and chat messages are readable by System Managers only.
- The fingerprint vault keeps the sign-in in the phone's secure storage and nowhere else.
- The device register is readable by System Managers; the IT dashboard only by the IT Team role profile.
- The kit's own calls to GitHub are unauthenticated. GitHub allows 60 per hour per IP address. Each phone checks every 15 minutes with a conditional request (an unchanged answer is a `304` that GitHub does not count).

## For maintainers

The kit is installed from this repository, so a release is a git tag. Commit to `main`, then from the kit checkout:

```bash
npx upande-mobile-kit release --dry-run   # show what would happen
npx upande-mobile-kit release patch       # patch (default) | minor | major | 1.4.0
npx upande-mobile-kit release --push      # same, and push the branch and the tag
npx upande-mobile-kit release --list      # tags that exist
```

`release` refuses to run on a dirty tree, off `main` (override with `--allow-branch`), or when the tag already exists. It runs typecheck, tests and `check:pack` (skip with `--skip-checks`), sets `"version"` in `package.json`, commits `chore(release): <version>`, and creates the annotated tag `v<version>`. It never pushes unless you pass `--push`, and never moves or replaces a tag. It prints the line apps use to install that version.

- **Tests:** `npm test` runs jest, the web jest config and the CLI tests; `npm run typecheck` runs the type check.
- **Shipping check:** `check:pack` verifies what would be published and also reads `KIT_DENY_PATTERNS` (regexes separated by `;`), so names that must never ship do not have to be written into this repo.
- **Workflows:** the files `init` writes into apps call this repo's reusable `release.yml` and `upgrade.yml`, pinned to the tag with the kit's own version (`WORKFLOW_REF` in `cli/constants.mjs` is `v` plus the version in `package.json`). So every release must be tagged with exactly `v<version>`. Apps move to a new version by merging the upgrade pull request.
- **Publishing:** the package is `"private": false` with public access, so it can be published to npm; installs today use the GitHub tag. A first publish needs an npm account that owns the `@upande` scope.
- **Forks** change `KIT_REPO` and `BACKEND_REPO_URL` in `cli/constants.mjs` and the URLs in `package.json`.
- A list of everything a person runs or does with the kit is in [`ACTIONS.md`](ACTIONS.md).

## License

MIT
