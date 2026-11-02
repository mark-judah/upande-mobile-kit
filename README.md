# @upande/mobile-kit

Updates, device management, monitoring and support for Expo apps, backed by a Frappe site. Install one package and your app gets a Settings page with over-the-air and APK updates, fingerprint sign-in, a device register, crash and API monitoring, problem reports and chat with your team.

The package is installed from GitHub, not npm. Its backend is the Frappe app [`upande_mobile`](https://github.com/mark-judah/upande-mobile).

**Jump to:** [Features](#features) · [Quick start](#quick-start) · [Configuration](#configuration) · [CLI reference](#cli-reference) · [Troubleshooting](#troubleshooting)

## Features

Every feature name links to its section. "Needs" lists native modules beyond the ones `init` installs for you; see [Native modules](#native-modules).

**Updates**

| Feature | What it does | Needs |
|---|---|---|
| [OTA updates](#ota-updates) | JavaScript fixes reach phones when the app opens | none |
| [APK updates](#apk-updates) | New native builds download in the background, with one tap to install | none |
| [Forced install](#forced-install) | A downloaded APK must be installed before the app can be used again | none |
| [Download progress ring](#download-progress-ring) | A ring around the floating button shows that something is downloading, and how far | none |
| [Release workflow](#releasing) | Push to your release branch and GitHub Actions publishes the OTA bundle or builds the APK. No Expo (EAS) account | a GitHub repository |

**Settings and sign-in**

| Feature | What it does | Needs |
|---|---|---|
| [Settings page](#the-settings-page) | One page of versions, update controls, switches and sign-out | none |
| [Floating button](#the-floating-button) | Opens Settings from any screen of any app | none |
| [Version information](#version-information) | App, runtime, running bundle, the kit's own version and the site's apps, including the backend | none |
| [Fingerprint unlock](#fingerprint-unlock) | A fingerprint or face switch, or your app's own lock | `expo-local-authentication` |
| [Fingerprint sign-in vault](#fingerprint-sign-in-vault) | Sign in with a fingerprint instead of typing the password | `expo-secure-store` |
| [Silent re-login](#silent-re-login) | When the session dies mid-task, sign in again with the vault's credentials and retry, instead of sending the person to the login screen | the vault |

**Fleet and monitoring**

| Feature | What it does | Needs |
|---|---|---|
| [Devices page](#the-devices-page) | Which phones run which build, who used them, and which are behind | none |
| [Crash and API monitoring](#crash-and-api-monitoring) | Errors and failed requests with headers, payload and response, plus device and user details | none |
| [Network and performance](#network-and-performance) | Wi-Fi name and speed, latency to your server and how long the app's own calls take | `@react-native-community/netinfo` for the Wi-Fi details |
| [Web portal](#the-web-portal) | Issues, devices, per-app pages and support, on your own Frappe site | none |

**Help and support**

| Feature | What it does | Needs |
|---|---|---|
| [Report a problem](#report-a-problem) | From any screen (header button, long-press or your own trigger): a screenshot, the device, the last requests and the last crash, filed as an Issue on your site | `react-native-view-shot` for the screenshot |
| [Chat with support](#chat-with-support) | The person's conversations with your team, as Issues: support answers with a comment on the Issue, the answer shows in the app | none |
| [Reply notifications](#reply-notifications) | A push notification when support replies; tapping it opens the conversation | `expo-notifications`, an Expo project id, Firebase on Android |
| [What's new](#whats-new) | The release notes, shown once after an update | none |
| [Last crash capture](#last-crash-capture) | The crash that made someone write in is attached to their report | none |
| [Connection banner](#connection-banner) | A warning when the phone is really offline (even when Android claims otherwise) or the server is slow, with a Wi-Fi settings shortcut | none |

**Tooling**

| Feature | What it does |
|---|---|
| [Command line](#cli-reference) | `init` (setup wizard), `fix`, `verify`, `doctor`, `version`, `publish-ota` and `release` (tag a kit release) |

Most features are on by default. Each one that is not is turned on with a single setting; see [Configuration](#configuration).

## How the pieces fit

```
  Your Expo app + this kit
     |        |        |
     |        |        +-- once a day --------> GitHub Releases   (APK files)
     |        |
     |        +-- device reports, crash reports -+
     |                                           v
     +-- asks for OTA manifest -----------> Frappe site  (upande_mobile app)
                                                 |  reads the manifest from
                                                 v
                                           GitHub Pages  (gh-pages branch: OTA bundles)
                                                 ^
  GitHub Actions (release workflow) -------------+---- also builds the APK on a new runtime
```

## Requirements

| What | Needed |
|---|---|
| Expo app | Expo SDK 54 or newer (peer ranges: `expo >=54`, `react-native >=0.81`, `react >=19`, `expo-router >=6`), using expo-router |
| Node | 20 or newer (the release workflow uses 22) |
| Package manager | npm for the release workflow (it runs `npm ci`, so `package-lock.json` must be committed) |
| Frappe site | Frappe 16 with the `upande_mobile` app installed |
| GitHub | A repository for the app. Releases must be readable without logging in (see [GitHub setup](#github-setup)) |
| Android | APK updates are Android only. The release workflow builds and publishes for Android |

Some features need an extra native module, listed in [Native modules](#native-modules). Each is optional and switches on only its own feature.

## Quick start

### 1. Install the backend on your Frappe site

Run this once per site, on the server (or on your own bench for development):

```bash
bench get-app https://github.com/mark-judah/upande-mobile
bench --site your.site install-app upande_mobile
bench build --app upande_mobile
bench --site your.site migrate
bench restart
```

The wizard in step 2 can do this for a bench on your own machine. Production is always yours to run. See the [backend README](https://github.com/mark-judah/upande-mobile#readme).

### 2. Install the kit in your app and run the wizard

```bash
cd my-expo-app
npm install github:mark-judah/upande-mobile-kit#v0.11.0   # or the newest tag on the Releases page
npx upande-mobile-kit init
```

The wizard detects your app name, GitHub repo, package manager and any local bench. It asks only the rest:

| Question | Asked | Answer |
|---|---|---|
| Production site URL | always | Your live Frappe site, for example `https://your.site`. Release builds use it. |
| Local/dev site URL | always, optional | For example `http://localhost:8000`. Dev builds use it. Blank means dev builds use production too. |
| GitHub repo (owner/repo) | only if there is no git `origin` | The repo that will publish releases. |
| Install the Frappe backend on a bench on this machine? | always | Yes if you have a local bench. Then it asks which bench folder and which bench site. |
| Your auth hook file and its exported name | only if it cannot find your sign-in state | For example `src/store/auth.ts` and `useAuthStore`. Blank skips it. |
| Your API client file | only if `axios` is installed and it cannot find the client | The file exporting a function named `api`. Blank skips it. |
| Apply? | always | It prints every file it will change first. |

After you confirm, it:

- writes `app/mobile-kit/settings.tsx`, `app/mobile-kit/devices.tsx`, `src/mobile-kit.ts` and `.github/workflows/release.yml`;
- edits `app.json` (plugin entry, `expo.updates.url`, `runtimeVersion`, `android.versionCode`, `extra.otaBaseUrl`, `extra.mobileKit.sites`), `package.json` (helper scripts) and your root layout (adds the config import and wraps the app in `<MobileKitProvider>`);
- installs the native modules the kit needs with `npx expo install`;
- installs and registers the backend on the bench you chose, and prints the commands to run on the production server;
- saves your answers to `upande-mobile-kit.json` (kept out of git automatically) so a re-run is just Enter, Enter, Enter;
- runs `doctor` and prints what still needs doing.

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

On the production server, the app must also be registered or phones get no OTA. The wizard prints this command with your values filled in; run it there (replace the placeholders if you type it yourself):

```bash
bench --site your.site execute upande_mobile.api.register_app --kwargs \
  '{"app_name": "My App", "github_repo": "owner/my-app", "ota_base_url": "https://<owner>.github.io/<repo>/ota", "enabled": 1}'
```

### 3. Commit, push and turn on GitHub Pages

```bash
git add -A
git commit -m "feat: add the mobile kit"
git push
```

`init` adds `upande-mobile-kit.json` (it holds a path on your machine) and `.upande-mobile-kit/` (backups of files `init` changed) to your `.gitignore`, creating the file if needed, so `git add -A` is safe. If either file was already committed, remove it from git with `git rm --cached upande-mobile-kit.json`.

The push starts the release workflow, which creates the `gh-pages` branch. When that run finishes, do the [GitHub setup](#github-setup), mainly enabling Pages.

### 4. Make the first release an APK

No phone has the kit yet, so the first release must be a native build. In your repo: **Actions > Release > Run workflow**, tick **build_apk** (or set `bump` to `minor`), and run it. Download the APK from the new GitHub Release, install it once, and from then on every update reaches the phone by itself. Details in [Releasing](#releasing).

## Local and production sites

Dev builds (`__DEV__`: Metro, dev clients) use the dev site. Release builds and OTA use the production site. `init` writes both:

```ts
site: { production: 'https://your.site', development: 'http://localhost:8000' },
```

Without a development site every build uses production. Pin one with `environment: 'production'` or `'development'`.

- `localhost` works in the iOS simulator. The Android emulator needs `http://10.0.2.2:<port>`. A real phone needs your computer's LAN address, and a bench listening on it.
- Names ending in `.local` do not resolve from phones or the Android emulator. Use the LAN IP and make the bench answer on it (`bench use <site>` sets the default site).
- A plain `http://` site needs Android cleartext traffic and an iOS App Transport Security exception. The kit's config plugin sets both for the hosts listed under `expo.extra.mobileKit.sites`, never the global "allow all HTTP" flag, and warns at prebuild. An `http://` production site gets a loud warning. Opt out with `["@upande/mobile-kit", { "cleartext": false }]`. This is native configuration, so it needs a new native build.

## GitHub setup

Do this once per app repository.

1. **Actions.** Open the repo's **Actions** tab. If workflows are disabled, enable them. Under **Settings > Actions > General > Actions permissions**, allow all actions (the workflow uses `actions/*`, `peaceiris/actions-gh-pages`, `softprops/action-gh-release`, `gradle/actions` and `android-actions/setup-android`). If your organisation restricts actions to a list, add those.
2. **Workflow permissions.** **Settings > Actions > General > Workflow permissions > Read and write permissions > Save.** The workflow asks for `contents: write` itself, but an organisation policy can cap it, and the workflow must be able to push the version commit, the tag, the `gh-pages` branch and the Release.
3. **Public releases.** Keep the repo public, or at least its releases. Phones check `api.github.com` for new APKs without logging in, and your Frappe site reads the OTA files from public URLs. A private repo gets no APK offers.
4. **GitHub Pages.** After the first workflow run has created the `gh-pages` branch: **Settings > Pages > Build and deployment > Source: Deploy from a branch > Branch: `gh-pages`, folder `/ (root)` > Save.** The OTA files are then served at `https://<owner>.github.io/<repo>/ota/android/<runtime>/manifest.json`, which is what `extra.otaBaseUrl` points at. Until Pages is on, your Frappe site falls back to reading the same files from `raw.githubusercontent.com`, so OTA can still work for a public repo.
5. **Android signing (optional, recommended).** Without it the APK is signed with Android's public debug key. Add these under **Settings > Secrets and variables > Actions > New repository secret**:

   | Secret | Value |
   |---|---|
   | `ANDROID_KEYSTORE_BASE64` | the keystore file, base64 on one line |
   | `ANDROID_KEYSTORE_PASSWORD` | the keystore password |
   | `ANDROID_KEY_ALIAS` | the key alias |
   | `ANDROID_KEY_PASSWORD` | the key password (for a PKCS12 keystore, the same as the keystore password) |
   | `ANDROID_KEY_SHA256` | optional: the certificate SHA-256; when set, the build fails if the APK is signed with anything else |

   All four of the first group must be set, or the build falls back to the debug key. To create them:

   ```bash
   keytool -genkeypair -v -storetype PKCS12 -keystore release.keystore -alias upload \
     -keyalg RSA -keysize 2048 -validity 10000
   base64 -w0 release.keystore            # macOS: base64 -i release.keystore | tr -d '\n'
   keytool -list -v -keystore release.keystore -alias upload   # copy the "SHA256:" line
   ```

   Keep `release.keystore` and its passwords somewhere safe. **Phones cannot update an app over an APK signed with a different key.** If you switch from debug to a real key later, every phone has to uninstall first.
6. **Branch protection.** If your release branch requires pull requests, allow `github-actions[bot]` to push to it. The workflow pushes a `chore(release): <version>` commit directly.

## The Settings page

Every user of your app gets this page at `/mobile-kit/settings`, once `<MobileKitProvider>` is mounted. Add your own rows without forking: `<SettingsScreen extraSections={...} profileExtra={...} />`.

### What the page shows

From top to bottom:

| Card | What it has |
|---|---|
| Profile | The user's initial, name, email and site, taken from your `useAuth` |
| Dev notice | Development builds only: which of `useAuth`, `api` and `storage` are still on the kit's stand-ins |
| Security | The fingerprint switch (see [Fingerprint unlock](#fingerprint-unlock) and the [vault](#fingerprint-sign-in-vault)). With `biometric: 'host'` it still shows whenever your own `useAuth` is wired: it sets your `biometricEnabled` and your app does the locking |
| Help | **Report a problem**, **Chat with support** and **What's new** (see [Help and support](#help-and-support)) |
| Diagnostics | The **Send crash reports** switch, and a **Send test error** button in development. Hidden with `monitor.showToggle: false` |
| App & Server | The [version information](#version-information), the **Check for updates** button and the **Download updates** choice (see [Updates on the phone](#updates-on-the-phone)) |
| Not available in this build | Only when an optional native module is missing, for example "Battery info unavailable: rebuild required" |
| Your own rows | Anything you pass as `extraSections` or `profileExtra` |
| Devices | A link to the [Devices page](#the-devices-page). System Managers only |
| Session | **Sign out** and **Forget this device**, shown when your `useAuth` provides `logout` and `forgetDevice` |

### The floating button

A small translucent button opens Settings from any screen, whatever your navigation looks like. It can be dragged to either screen edge and remembers where it was left. It hides on the kit's own pages and while the keyboard is open, and, when your own `useAuth` is wired, before anyone has signed in (your sign-in gate would send the page straight back to login). It shows a [progress ring](#download-progress-ring) while an update downloads.

Set `fab: false` to remove it and open the page yourself with `openKitSettings()`, `<KitSettingsButton />` or `router.push('/mobile-kit/settings')`. Options: `fab: 'dev'` (development builds only) or `fab: { initialSide: 'left', bottom: 96, whenSignedOut: true }`.

### Version information

The **App & Server** card lists:

| Row | What it is |
|---|---|
| App, Site | The app name and the site it talks to |
| Frappe, ERPNext | Versions of the apps on the site (change the list with `serverApps`) |
| **Upande Mobile Kit (server)** | The `upande_mobile` backend's version, read from the same call as the rows above. "not installed" when the site lacks it. Always listed, even with your own `serverApps` |
| **Upande Mobile Kit** | The version of this npm package the app was built with |
| Installed, Latest | The running app version and the newest one published |
| Code | Which JavaScript is running: the embedded build, or the OTA bundle id, date and channel |

Each device also reports its kit version, so the [web portal](#the-web-portal) shows which phones are on an old kit.

## Updates on the phone

### OTA updates

On open, the app checks for an over-the-air bundle. If one downloads in the first 20 seconds, the app restarts into it. A later download waits for the next opening, so the app never restarts under someone mid-task. Change the window with `otaOpenWindowMs`.

**On return to the app.** Handhelds are rarely restarted, so checking only at launch would leave them on old code for days. Each time the app comes back to the foreground (at most once every 10 minutes, `foregroundUpdateCheckMinMs`) it looks again: for a new APK (the daily check) and for a new bundle. A bundle found this way is downloaded and the person is **asked**: **Restart now** or **Later**. It is never applied behind their back, and is offered once per run. Turn it off with `otaOnForeground: false`. OTA bundles carry JavaScript only: native changes need an [APK](#apk-updates). How bundles are published is in [Releasing](#releasing).

### APK updates

- **Check for updates.** The one button in App & Server. It checks GitHub Releases for a new APK first, because a new APK carries a new runtime and supersedes any OTA bundle. If the APK is current it asks for an OTA bundle. When an APK is available the same button reads **Download v1.3.0 (size)**, then **Install v1.3.0**.
- **Download updates.** A choice under that button: **Wi-Fi only** (the default), **Any network** or **Off**. The user's choice wins over `apk.autoDownload`. Once a day the app checks GitHub Releases; on Wi-Fi it downloads a newer APK in the background. A finished download is kept, so a cancelled installer can be reopened without downloading again.
- **Android cannot install an APK silently.** The user always confirms in Android's installer, and the first time Android also asks to allow installs from this app.

### Forced install

Once a newer APK is on the phone, an **Update required** dialog covers the whole app. It has one button, **Install now**, and the Android back button does nothing. If the person cancels Android's installer they land on the dialog again. If Android has not yet allowed installs from this app, the dialog offers a shortcut to that setting.

On by default. Set `apk: { force: false }` for a softer prompt with an **Install now / Later** choice that asks again next time.

### Download progress ring

While an APK or an OTA bundle downloads, a ring of dots appears around the [floating button](#the-floating-button). For an APK the dots light up clockwise with the real progress. An OTA bundle has no known size, so a short arc travels around the ring instead. The Settings page shows the same progress as text.

## Releasing

### Cheat sheet

Every push to your release branch is a release. By default it is an **OTA** update: no APK, phones get it when the app opens. To ship an **APK**, say so in a commit message or on the Run workflow screen:

| I want | Do this |
|---|---|
| a normal update (JavaScript only) | commit as usual: `git commit -m "fix: correct the gate count"` |
| the same update **plus an APK** | add `[apk]` to a commit message: `git commit -m "fix: correct the gate count [apk]"` |
| an APK after changing native code (new packages, plugins, SDK) | add `[native]`: `git commit -m "feat: scan IDs [native]"` |
| an APK right now, without a new commit | **Actions > Release > Run workflow**, tick **build_apk** ([steps](#running-the-workflow-by-hand)) |
| to see what a push would do | `npx upande-mobile-kit version` |

### What `init` leaves to commit

| File | Purpose |
|---|---|
| `.github/workflows/release.yml` | a short workflow that calls the kit's shared release workflow |
| `app/mobile-kit/settings.tsx`, `app/mobile-kit/devices.tsx` | the two pages (one-line re-exports) |
| `src/mobile-kit.ts` | your configuration |
| `app.json`, `package.json`, `package-lock.json` | plugin entry, update URL, runtime version, helper scripts, native modules |
| your root layout | the config import and `<MobileKitProvider>` |

### How a release happens

Merging (pushing) to your release branch starts the workflow, except for changes that only touch `*.md` files or `docs/`. It:

1. bumps the version one step and decides OTA or APK (from the version, the commit messages and the inputs; see below). The decision and its reason are written to the run summary and to the GitHub Release;
2. exports the JavaScript bundle and publishes it to the `gh-pages` branch under `ota/`, for every release;
3. if the release is an APK, runs `expo prebuild` and Gradle to build a signed (or debug-signed) APK;
4. commits `chore(release): <version> [skip ci]`, tags `v<version>`, and creates the GitHub Release.

A release takes about 14 minutes when it builds an APK. The workflow times out after 45 minutes, and runs queue behind each other. Do not start a commit message with `chore(release):`; the workflow ignores those to avoid loops.

### Why a patch release has no APK

This is by design, not an error. Versions are `x.y.z` and the runtime is `x.y`. An OTA bundle can only reach phones that have the same runtime, and a normal merge only moves `z` (`1.2.7` to `1.2.8`), so the native part is unchanged and there is nothing new to build. Only the JavaScript is shipped, and phones with a 1.2 build get it the next time the app opens. The GitHub Release is titled "(OTA)" and has no APK file. A release gets an APK when the runtime changes, or when you ask for one with a commit marker or the `build_apk` input.

### OTA or APK

| What you do | Version | Runtime | Result |
|---|---|---|---|
| Merge as usual (`fix: ...`) | `1.2.7` to `1.2.8` | same | OTA only |
| Merge with `[apk]` in a commit message | `1.2.7` to `1.2.8` | same | OTA **and** an APK attached to the release. Phones on the old APK keep getting OTA updates. |
| Merge with `[native]` or `[runtime]` | `1.2.7` to `1.3.0` | new | APK |
| Merge with `[major]` | `1.2.7` to `2.0.0` | new | APK |
| Run the workflow with `build_apk` ticked | `1.2.7` to `1.2.8` | same | OTA and an APK |
| Run the workflow with `bump: minor` or `major` | `1.2.7` to `1.3.0` / `2.0.0` | new | APK |
| Run the workflow with `set_version` | the version you give | new if `x.y` changes | APK if the runtime changed, else OTA |
| Merge when the patch counter wraps | `1.2.99` to `1.3.0` | new | APK |
| Upgrade the Expo SDK in `package.json` | next minor | new | APK. A bundle for another SDK would crash old builds, so the kit forces a minor bump. |
| `runtimeVersion` in `app.json` is not a plain `x.y` string (an Expo policy object, or missing) | next patch | set to `x.y` | APK, once. The kit cannot tell which runtime the installed builds have, so it writes a plain one and builds an APK. |

The patch counts 0 to 99 and the minor 0 to 49, then they roll over. `versionCode` is derived from the version, so it always increases. If the app already has older builds out, set `expo.extra.mobileKit` in `app.json` before the first release, so the new APK installs over the old one and no bundle reaches an incompatible phone:

```json
{ "expo": { "extra": { "mobileKit": { "versionCodeBase": 100000, "runtimeMajorBase": 100 } } } }
```

Both default to 0. If you set `runtimeMajorBase`, set the same value as `upande_mobile_runtime_major_base` in the Frappe site's `site_config.json`.

### Commit messages

The kit reads the commit messages since the last `v*` tag (subject and body, any letter case) for these markers, written in square brackets:

| Marker | Effect |
|---|---|
| `[apk]` or `[build-apk]` | Build and attach an APK to this release. The version is a normal patch and the runtime is unchanged, so OTA keeps working for existing phones. |
| `[native]` or `[runtime]` | Native code changed: a minor bump, which is a new runtime, and an APK. |
| `[major]` | A major bump, a new runtime, and an APK. |
| `[ota]` or `[skip-apk]` | Only in the **newest** commit: cancels any `[apk]` marker in this release range (including its own). It does not cancel `[native]` or `[major]`. |


**Native changes need no marker.** Compared with the last release, a changed native dependency (`expo-*`, `react-native-*` and similar), a changed `plugins`, `android` or `ios` block in `app.json`, or anything under `android/` or `ios/` builds an APK on its own, and the plan says why. `[ota]` in the newest commit still cancels it. The release tag the app installed from is a good reminder: an OTA update never changes the APK, so the Settings page shows an **APK** row beside **Installed**.

Examples:

```bash
git commit -m "fix: correct the gate count"                    # OTA only
git commit -m "fix: correct the gate count [apk]"              # OTA and an APK
git commit -m "feat: scan IDs with the camera [native]"        # new runtime and an APK
git commit -m "feat!: new login [major]"                       # 2.0.0 and an APK
```

Rules:

- The marker can be in any commit that lands on the release branch since the last release, in the subject or the body. Merge commits themselves are ignored, so: with **Squash and merge** put the marker in the squash commit's title or description (GitHub shows it in the box before you confirm); with **Create a merge commit** or **Rebase and merge** a marker in any of the branch's own commits counts.
- A marker must be a whole bracketed token. `[apkish]` or the word apk in a sentence does nothing.
- `--bump minor`, `--bump major` and `--set` (workflow inputs) always win over markers. `--bump auto`, `patch`, or nothing leave the decision to the markers.
- An Expo SDK upgrade still forces a minor bump and an APK, whatever the markers say.

A line starting with `Note:` (or `What's new:`) in a commit body is a note for the **users** of the app. It leads the release notes under "What's new" and is what the in-app [What's new](#whats-new) sheet shows. It has no effect on the version.

The conventional commit type (`type(scope): description`) does not change the release. It only sorts the release notes:

| Type | Section in the notes |
|---|---|
| `feat` | Features |
| `fix` | Bug Fixes |
| `perf` | Performance |
| `refactor` | Refactoring |
| `docs` | Documentation |
| `build` | Build System |
| `ci` | CI |
| `chore` | Chores |
| anything else | Other |

A `!` after the type (`feat!: ...`) or a `BREAKING CHANGE:` line in the body puts the commit under "BREAKING CHANGES". That marks it in the notes only. It does not change the version.

### Preview a release before you push

```bash
npx upande-mobile-kit version
```

Prints the next version, the release type and the reason, without changing anything:

```text
1.2.7 -> 1.2.8 (patch, versionCode 5208, 2 commits since v1.2.7)
release: APK - commit 93b887d contains [apk]; an APK is built on the unchanged runtime 1.2; the OTA bundle is published too
```

It reads your local commits. Commit first (a local commit is enough); do not run it with `--apply`, which writes the version and would be bumped a second time by the workflow. `--json` prints the same decision as `release`, `reason` and `forceApk`.

### The first release is an APK

`init` sets `runtimeVersion` from your current version (`1.0.0` gives `1.0`). The push in Quick start step 3 is a patch bump, so it only publishes OTA. For the first APK, run the workflow by hand with **build_apk** ticked (it stays `1.0.1`, runtime `1.0`), or with `bump: minor` (it becomes `1.1.0`, runtime `1.1`), or put `[apk]` in a commit message.

### Running the workflow by hand

Use this to get an APK without making a commit, or to release a specific version.

1. Push your changes first. The workflow builds what is on GitHub, not your local files.
2. Open your repository on GitHub and go to **Actions**.
3. In the left list choose **Release**.
4. Click **Run workflow** (the button above the list of runs, on the right).
5. Pick the **branch** (your release branch).
6. Fill in the inputs, then click the green **Run workflow** button:

| Input | Values |
|---|---|
| `bump` | `auto` (the commit markers decide; patch if there are none), `patch`, `minor`, `major` |
| `set_version` | an exact version such as `2.0.0`; when set, `bump` is ignored |
| `build_apk` | tick it to also build and attach an APK (same runtime, OTA keeps working) |

The run appears at the top of the list within a few seconds. An APK build takes about 14 minutes. When it finishes, the APK is under **Releases** in your repository, attached to the new version as `<apk-name>_v<version>.apk` and `<apk-name>.apk` (the second name always points to the newest build).

**No `build_apk` box?** Your `release.yml` is from an older kit: run `npx upande-mobile-kit init --update-workflow` and push it ([details](#keeping-the-workflow-up-to-date)).

**From a script or terminal** (needs a token that may run workflows; this example builds an APK on branch `main`):

```bash
curl -X POST \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  https://api.github.com/repos/<owner>/<repo>/actions/workflows/release.yml/dispatches \
  -d '{"ref":"main","inputs":{"build_apk":"true"}}'
```

With the GitHub CLI: `gh workflow run release.yml --ref main -f build_apk=true`.

### Keeping the workflow up to date

`init` writes `.github/workflows/release.yml` pinned to the kit version that wrote it, for example `...release.yml@v0.11.0`. A floating tag would never carry workflow fixes to apps that already have the file, so the pin is exact. After you update the kit, bring the workflow up to date:

```bash
npx upande-mobile-kit init --update-workflow
```

It rewrites only that file, keeps your app name, APK name and branch, saves the old file under `.upande-mobile-kit/backup/` (skip with `--no-backup`), and does nothing if it is already current. Commit and push it. `verify` and `doctor` warn when the workflow is on a floating ref such as `@v0`, is older than the installed kit, or has no `build_apk` input.

### Where things end up

- **GitHub Releases:** one per version, tagged `v<version>`. APK releases attach `<apk-name>_v<version>.apk` and a fixed-name `<apk-name>.apk`. OTA releases are titled "(OTA)" and have no file. The newest APK is always at `https://github.com/<owner>/<repo>/releases/latest/download/<apk-name>.apk`.
- **`gh-pages` branch:** `ota/android/<runtime>/manifest.json`, the bundle and its assets. Older runtimes are kept.
- **The workflow run summary and the GitHub Release:** the release type and the reason (for example `Release type: APK (reason: commit abc1234 contains [apk])`), runtime, `versionCode`, the APK link and whether it was signed with your key or the debug key.
- **Workflow artifacts:** the APK is also kept as an artifact for 90 days, even if a later step fails.

### When a release fails

- The OTA bundle is published before the version commit and tag. A failure before the tag leaves no tag behind, and the next run retries the same version.
- A failed APK build still keeps its artifacts. Fix the cause and re-run the workflow.
- There is no rollback step. To undo a bad OTA, revert the change on the release branch and merge: the next patch release publishes the old code as a new version.
- The workflow regenerates `android/` with `expo prebuild --clean` on every APK build. Hand edits in a committed `android/` folder are not used; put native changes in config plugins.

## Fingerprint unlock

Three modes, set with `biometric`:

| Mode | Who does what |
|---|---|
| `'kit'` (default) | The Settings switch stores the user's choice; your sign-in flow acts on it |
| `'host'` | Your app already has its own lock and enforces it |
| `'vault'` | The kit keeps the sign-in behind the fingerprint: see the [vault](#fingerprint-sign-in-vault) |

Needs `expo-local-authentication` (not needed with `biometric: 'host'`).

The **Biometric unlock** switch lives in the Security card of the Settings page. It is the user's choice to use a fingerprint (or face) instead of a password to sign back in.

- **Turning it on** asks the phone to confirm with a fingerprint or face ("Confirm biometric unlock"; the phone's PIN is not accepted here). If the build has no `expo-local-authentication`, it says to install the latest build. If no fingerprint or face is enrolled in the phone's settings, it says to enrol one first. On success the choice is saved.
- **Turning it off** needs no prompt.
- **Where the choice is saved:** through your `useAuth` (`biometricEnabled` and `setBiometricEnabled`), so it lands in your own auth store. With no `useAuth`, the kit keeps it in its own storage.
- **What the kit does not do:** it does not add a lock screen, and it does not lock your app when it opens. It asks for the fingerprint when the user turns the switch on and stores the choice. Your sign-in flow decides what to do with it: read `biometricEnabled` from your auth state and prompt with the kit's helper.

  ```ts
  import { Biometric } from '@upande/mobile-kit';

  if (biometricEnabled && (await Biometric.isAvailable())) {
    const { success } = await Biometric.authenticate({ promptMessage: 'Unlock' });
    // success: let the user in; otherwise fall back to the password
  }
  ```

  The helper is safe on a build without the native module: it reports "not available" instead of crashing.
- **If your app already has its own lock**, set `biometric: 'host'`. The kit then never prompts for or enforces a lock itself, so there is one lock. The Settings switch stays when your `useAuth` provides `biometricEnabled` and `setBiometricEnabled`: it flips your own setting (after a fingerprint check when turning it on), and your app does the locking. Without a wired `useAuth` the switch is hidden, because there would be no real setting behind it. `init` detects an existing use of `expo-local-authentication` and sets `biometric: 'host'` for you.
- **Sign out and Forget this device** are in the Session card. Sign out asks "You can sign back in with biometrics or your password." Forget this device asks "Clears your session and disables biometric unlock." Both call the functions your `useAuth` provides and then go to `loginRoute` (default `/login`).

### Fingerprint sign-in vault

Set `biometric: 'vault'`. The vault stores the person's sign-in in the phone's secure storage, behind their fingerprint or face, so the login screen can offer **Sign in with fingerprint**. Needs `expo-secure-store` and `expo-local-authentication` in the build (`npx expo install expo-secure-store`, then a new native build); without them the Settings switch says so and nothing is stored.

1. **Turn it on.** Settings shows **Fingerprint sign-in**. Turning it on asks for the password once (in the kit's own sheet, so it also works on Android), then the phone asks for the fingerprint to store it. Turning it off wipes it.
2. **Offer it after login** (once per device) from your login screen:

   ```tsx
   import { useBiometricVault, BiometricSignIn } from '@upande/mobile-kit';

   const vault = useBiometricVault();
   // after a successful password login:
   await vault.offer({ server: siteUrl, user: email, password });

   // on the login screen: renders only when a sign-in is stored
   <BiometricSignIn onCredentials={({ server, user, password }) => signIn(server, user, password)} />
   ```
3. **How it signs in.** The button asks for the fingerprint, then hands the stored `{ server, user, password }` to your `onCredentials`, which runs your normal login. If the password was changed on the server, the login fails and the message shows under the button; the person signs in with the new password and turns the switch on again.

### Silent re-login

A session can die while someone is working (it expired, or the server restarted). Without help the app throws them to the login screen. With the vault on, the kit can sign in again by itself and retry the call:

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

- **What triggers it.** Not only HTTP 401: Frappe reports a dead session as a 400 CSRF failure, a 403 `AuthenticationError`, `session_expired`, or a 417 whose message says the session expired. All of those count; an ordinary permission error does not.
- **The credentials** are kept in memory only, after a fingerprint unlock or when the person turns the vault on, and only for a person who did. Sign out and Forget this device drop them. Nothing is written to disk besides the vault itself.
- **One retry.** A burst of failing calls shares a single login, and each call is retried once.
- **For your own client**, wrap it: `withSessionRecovery(api, { login, onFailure })`. After a normal password login call `rememberCredentials({ server, user, password })` (it keeps them only if the vault is on), and call `forgetCredentials()` on your own sign-out.

The password never leaves the phone and is never sent to your site except by your own login call. The kit keeps no copy outside secure storage; a plain marker (not the password) tells the screen whether one exists, so checking never prompts.

## The Devices page

The Devices page, at `/mobile-kit/devices`, is the install register for this app, inside the app. It answers one question for an administrator: which phones run which build, and who is behind.

- **Who can open it:** System Managers (your `useAuth` reports `isSystemManager`). Anyone else is sent back to Settings. System Managers reach it from the Devices row on the Settings page.
- **What it lists:** every device that has run this app and reported in, newest activity first, 30 at a time with **Show more**. It reads `upande_mobile.api.installs` on your Frappe site and shows only this app's devices.
- **Each device row shows:** a phone icon (or a desktop icon for an emulator), the device name or brand and model, "(this device)" for the phone you are holding, platform and OS version, the app name and version, how long ago it was last seen, the last user and how many users have used it, and a status badge. When an update is needed, a line such as "Update to 1.3.0 (reopen the app)".
- **Tap a row to expand it:** every account that used the device, each with its own app version and last seen; the model; the OS; the previous version and when it was upgraded; the number of sign-ins and launches; first seen; the IP address the server saw; and the first 8 characters of the install id.
- **Filters:** All, 7 days or 30 days of activity; a **Dormant** chip to include devices that have not been seen for a while (hidden by default); and a search box over user, device, model, OS, version and IP.
- **The summary under the filters:** a count of devices per status.

| Status | Meaning |
|---|---|
| Current | Running the latest published version |
| Behind | A newer JavaScript update exists; reopening the app applies it |
| Needs APK | The device's runtime is older than the latest one, so it needs a new APK |
| Ahead | Newer than the latest published version |
| Dormant | Not seen for the app's dormant days (7 by default) |
| Unknown | The app is not registered and enabled on the site, or no latest version is known yet |

The status and the "Update to" text come from the server. Nothing is worked out on the phone. Devices only appear after the app has signed in to a Frappe user at least once, because the register only records signed-in accounts.

The page shows versions and who used each phone. Battery, storage, network and the per-device crash history are in the [web portal](#the-web-portal), under Devices.

## Crash and API monitoring

On by default. Everything captured is shown in the [web portal](#the-web-portal) at **`https://your.site/mobile-monitor`** (System Managers only). The user can turn reporting off in Settings, and `monitor: { enabled: false }` installs nothing.

### What is captured

- Unhandled JavaScript errors (a fatal one is sent at once), unhandled promise rejections, and render errors if you wrap the app in `<MonitorErrorBoundary>` or set `monitor.errorBoundary`.
- `console.error(err)` calls that carry an Error, which covers errors your app catches and logs. Plain strings and React warnings are not reported. Turn off with `captureConsoleErrors: false`.
- Failed API calls (status 400 and up, network errors, timeouts): method, URL, status, duration, headers, request and response bodies. Successful calls are not sent unless you set `sampleSuccess`, and then only as metadata.
- The last 30 screens and API calls as breadcrumbs.
- The device: OS version and build, brand, model, battery level and state, low-power mode, free and total storage, memory, network, locale, time zone, screen, build type, app, runtime and update ids, and any optional native modules missing from this build.
- The signed-in user your `useAuth` reports: id, name and roles.
- The connection and how it performs; see [Network and performance](#network-and-performance).

### Network and performance

Every report and device snapshot carries how the network treats the app:

- **Connection type**, and whether the phone is online and the internet reachable.
- **Latency to your server**: a tiny `GET /api/method/ping`, at most once a minute, in the background.
- **How long the app's own calls take**: the count, the average and 95th-percentile response time, and the share that failed, over the last 100 calls.
- **Wi-Fi details** with `@react-native-community/netinfo` in the build (`npx expo install @react-native-community/netinfo`, then a new native build): the Wi-Fi name, signal strength, link speed and band, and the cellular generation. Android only shows the Wi-Fi name when the app holds the location permission; without it that one field is left out.

Nothing here is a speed test: link speed is what the radio negotiated, and latency and response times are measured from real use. The portal shows these on the Devices view, a device's page and every report. To keep the Wi-Fi name out of your data, leave netinfo out.

### Cost to the app

Capturing only pushes a small object into a bounded in-memory buffer. Redaction, serialising and device probes run later, off the interaction path, in one batched request: every 30 seconds while events wait, at 20 events, and when the app goes to the background. Repeats within 60 seconds become one event with a count, a session sends at most 200 events, and an offline queue (100 events, 1 MB) retries with back-off. Reports need a signed-in session; earlier events wait and are sent after sign-in.

### Hooks

`MobileKitProvider` wraps `fetch`. For axios call `attachAxios(instance)` once. For a custom client wrap it with `withMonitoring(api)`. By hand:

```ts
import { captureException, captureMessage, addBreadcrumb } from '@upande/mobile-kit';

captureException(err, { orderId });
captureMessage('Sync finished late', 'warning');
addBreadcrumb({ type: 'user', message: 'Opened the scanner' });
```

### Privacy

Read this before shipping.

- Secrets are redacted on the phone, then again on the server. Header, query and body field names containing `authorization`, `cookie`, `token`, `secret`, `password`, `passwd`, `api_key`, `session`, plus the whole words `sid`, `pwd`, `pin`, `otp`, `cvv` and `card` become `[redacted]`. Add more with `monitor.redactKeys`.
- Redaction is by name. A secret in a field with another name, or inside free text, is not found by the phone. If your responses carry personal data, set `captureBodies: false` or add the field names to `redactKeys`.
- Bodies are cut at `maxBodyBytes` (8 KB). Binary bodies are never recorded, only their size.
- The server stores the IP address it sees, and a hash of the device identifier.
- Ignore noisy calls with `ignoreUrls`, for example `['exp.host/--/api/v2/push', /\/healthz$/]`.

## The web portal

Reports from your apps land on a web portal that the backend serves: **`https://your.site/mobile-monitor`**.

- **How to open it:** sign in to your Frappe site as a System Manager, then open that address in a browser. If you are signed out you are sent to the login page and back. Other users get a permission error. The portal has no menu entry in Frappe, so bookmark it.
- **What you get:**
  - an overview: events per day, top issues, app versions, device models and OS versions in use, and fleet health;
  - every crash, error and failed API request grouped into issues, each with the stack, the request and response (headers and payload, secrets removed), breadcrumbs, the device (OS, model, battery, storage, network, app and runtime versions) and the signed-in user, with Resolve and Ignore;
  - a Devices view of every registered phone, with filters for low battery, low storage, offline, old OS and old app, and each device's timeline, with its Wi-Fi, latency and kit version;
  - a **Support** page for [problem reports and chat](#help-and-support), where you set a report's status and reply to people;
  - an **App** page per app: current version, how many devices have it, and what is new.
- **What it needs:** the backend installed with `bench build --app upande_mobile` run once, the app registered on that site, and the app signed in so it can send reports. See [Crash and API monitoring](#crash-and-api-monitoring) for what the app captures, and the [backend README](https://github.com/mark-judah/upande-mobile#the-web-portal) for the portal itself.

The portal is separate from the Settings page inside your app: the portal is for you, the Settings page is for your users.

## Help and support

The **Help** card in Settings has three rows, **Report a problem**, **Chat with support** and **What's new**. Each can be turned off: `support: false`, `support: { chat: false }`, `whatsNew: false`. They need the backend (`upande_mobile` 0.2.0 or newer, then `bench migrate`).

### Report a problem

The person writes a subject and what happened. The kit adds:

- **a screenshot of the screen they were on**, taken at the moment they ask, before anything covers it (needs `react-native-view-shot`; without it the report goes without a screenshot);
- the **device and connection**, the **last 15 requests** (addresses and results only, secrets removed) and the **[last crash](#last-crash-capture)**.

A "What will be sent" list shows all of it before they send.

**From any screen.** The report does not have to start in Settings. Each of these screenshots the screen the person is on, then opens the sheet over it:

| Trigger | How |
|---|---|
| Long-press the floating button | Built in (600 ms). A tap still opens Settings |
| A button in your own header or menu | `<ReportProblemButton />` (an icon, or pass `label="Report a problem"`) |
| Anything else (a shake handler, a menu item, an error screen) | `await openReportProblem()`, or `const { reportProblem } = useReportProblem()` |

```tsx
import { ReportProblemButton, openSupportChat } from '@upande/mobile-kit';

<Stack.Screen options={{ headerRight: () => <ReportProblemButton /> }} />
// and for chat: openSupportChat()
```

The sheet is mounted by `<MobileKitProvider>`, so these work wherever the provider does. They do nothing, and return `false`, when the tool is off (`support: false`).

**Where it lands.** On a site with the **Issue** doctype (ERPNext or Helpdesk) the report is filed as an ordinary **Issue**: subject `[Your App] what they wrote`, raised by the person's email, the diagnostics in the description under a divider line, and the **screenshot attached to the Issue**. It then follows your normal support workflow (numbering, SLA, assignment, replies). The [web portal](#the-web-portal)'s **Support** page lists these Issues and links to each in Desk. A site without Issue gets a *Mobile Report* record instead. See the [backend README](https://github.com/mark-judah/upande-mobile#problem-reports).

### Chat with support

On a site with the **Issue** doctype (ERPNext or Helpdesk) a conversation **is an Issue**, the way your support team already works:

- **The list** shows the person's own Issues for this app (their reports and questions), newest first, with the status and a dot on every conversation support has answered since they last opened it. The Help row shows how many.
- **A conversation** opens with what they wrote, then every comment on the Issue. **Support replies by adding a Comment on the Issue in Desk**, no new tool to learn; the answer appears in the app within a few seconds while the conversation is open.
- **The person answers** in the app; that is added as a Comment on the same Issue, and an Issue that was Replied or Resolved goes back to Open so support sees it. A Closed conversation cannot be replied to; the person starts a new one.
- **New message** starts a conversation: a subject and the first message, filed as an Issue (with the diagnostics, without a screenshot).

On a site without Issue the kit falls back to a single chat thread with support (Mobile Chat doctypes, answered from the portal's Support page).

Only the person's own Issues are ever shown, and only replies they have not yet seen count as unread. Replies reach the phone as [push notifications](#reply-notifications) when the person turns them on; otherwise the badge updates when the app opens or the chat is open.

### Reply notifications

When support answers a conversation, the person's phone gets a push notification, and tapping it opens that conversation.

**For the person.** Settings > Help has a **Notify me about replies** switch. They are also asked once, in words, right after their first message. Turning it on asks Android for permission. The switch only appears in a build that can receive notifications.

**How it works.** The phone registers its Expo push token with your site (`register_push`), kept per person and app. When someone on your team adds a **Comment** to the person's Issue, the site sends the push through Expo's push service (nothing else is contacted). The notification says "Reply on <subject>" and shows the start of the reply. A token Expo reports as gone is deleted. Signing out forgets the phone's token, and the next person to sign in registers it for themselves. The kit never changes how your app's own notifications are shown, and only reacts to notifications that carry its own marker.

**What the app needs** (once, all of it is standard Expo):

| Requirement | How |
|---|---|
| `expo-notifications` in the build | `npx expo install expo-notifications`, add `"expo-notifications"` to `plugins` in `app.json`, then a new native build |
| An Expo project id | `expo.extra.eas.projectId` in `app.json` (a free Expo account is enough; no EAS builds are needed), or `push: { projectId }` in the kit config |
| Firebase on Android | `android.googleServicesFile` pointing at your `google-services.json`, and the Firebase (FCM v1) credentials uploaded to your Expo project |

`push: false` turns the whole feature off. Without the requirements the switch simply does not appear (or says what is missing if you tap it).

### What's new

After the app updates, a sheet shows the new version's release notes once. It never shows on a first install, and shows nothing for a version without notes. The row in Settings reopens it any time. The notes are read from the GitHub Release, once per version.

**Write them for the people who use the app.** Commit messages are written for developers ("fix: batch the reads"). Add a line starting with `Note:` (or `What's new:`) to the body of any commit and the release workflow puts it in a **What's new** section at the top of the release notes:

```bash
git commit -m "feat(scan): batch the reads" -m "Note: Scanning is twice as fast"
```

The in-app sheet then shows **only those lines**, with a "Show technical changes" link for the rest. A release with no `Note:` lines shows the full developer notes, as before.

### Last crash capture

Unhandled errors and render errors are saved on the phone, so a report filed after a black screen or a restart still carries what broke. The crash is sent only inside a report the person chooses to send, then forgotten.

### Connection banner

A banner appears when the phone has been offline for 25 seconds, or when the last round trip to your server took 3 seconds or more.

**It does not trust Android alone.** Some handhelds (the Honeywell EDA52, for one) keep reporting "connected" after the Wi-Fi radio has stopped carrying data. So the kit also watches what really happens: after **two requests to your server in a row that never got an answer**, the phone counts as offline whatever Android says, and the kit probes the server every few seconds so a single answer clears it. Only your own server counts; a failing third-party call does not. It has a **Wi-Fi settings** shortcut, because an app cannot switch Wi-Fi itself on modern Android. Tune it with `connectionBanner: { staleAfterSec: 25, slowMs: 3000 }` or turn it off with `connectionBanner: false`.

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

### Identity and connection

| Key | Default | Meaning |
|---|---|---|
| `appName` | required | The Mobile App name on the server and the app's title |
| `githubRepo` | required | `owner/repo` whose Releases carry the APKs |
| `site` | none | Site URL, or `{ production, development }` (see [Local and production sites](#local-and-production-sites)) |
| `environment` | from `__DEV__` | `'development'` or `'production'` to pin the choice |
| `useAuth` | stand-in | `() => ({ isSystemManager, user, instanceUrl, biometricEnabled, setBiometricEnabled, roles?, fullName?, email?, logout?, forgetDevice? })` |
| `api` | built-in `fetch` | Your Frappe client; must resolve to the response body |
| `authHeaders` | none | Extra headers for the built-in client |
| `storage` | AsyncStorage, else memory | `{ get, set, remove }` |
| `loginRoute` | `'/login'` | Where Sign out and Forget this device go |
| `endpoints` | the `upande_mobile` paths | Override `registerInstall`, `installs`, `versions`, `ingest`, `submitReport`, `chat`, `supportThreads`, `supportThread`, `supportReply`, `registerPush`, `unregisterPush` |
| `instanceKey`, `deviceKey` | none | Optional hooks: how a server URL becomes a storage key, and a better hardware id |

Without `useAuth`, `api` and `storage` the kit runs on stand-ins. The Settings page looks fine, but sign-out, the biometric switch and the device register are not connected to your session. `init` wires them when it finds your auth store, API client and storage, development builds log what is still a stand-in, and `getConfigGaps()` returns the list.

### Updates

| Key | Default | Meaning |
|---|---|---|
| `apk.autoDownload` | `'wifi'` | `'wifi'`, `'always'` or `'never'`. The user's Settings choice wins |
| `apk.force` | `true` | `true`: a downloaded APK blocks the app with a dialog that cannot be closed until it is installed ([forced install](#forced-install)). `false`: the dialog has a **Later** button |
| `otaOpenWindowMs` | `20000` | A bundle downloaded within this long of opening restarts the app at once |
| `otaOnForeground` | `true` | Also look for updates when the app returns to the foreground, and ask before restarting into a new bundle |
| `foregroundUpdateCheckMinMs` | `600000` | Minimum time between two foreground update checks |
| `foregroundReportMinMs` | `30000` | Minimum time between foreground device reports |

### Interface

| Key | Default | Meaning |
|---|---|---|
| `fab` | `true` | `true`, `false`, `'dev'` or `{ initialSide: 'left' \| 'right', bottom: 96, whenSignedOut: false }` (see [the floating button](#the-floating-button)) |
| `theme`, `ui` | built-in look | Colours and fonts, or swap `Screen`, `Card`, `Button`, `useToast`, `showDialog`, `useOnline` |
| `serverApps` | Frappe and ERPNext | `[key, label][]` site apps to list on Settings. The kit's backend is always added |
| `settingsRoute`, `devicesRoute` | `/mobile-kit/settings`, `/mobile-kit/devices` | Rarely needed; the defaults live in a folder no app uses, so they cannot collide |
| `errorMessage`, `onAvatarLongPress` | none | Optional hooks |

### Security

| Key | Default | Meaning |
|---|---|---|
| `sessionRecovery` | none | `{ login, onFailure? }`: silent re-login for the kit's own calls when the session dies (needs the vault). See [Silent re-login](#silent-re-login) |
| `biometric` | `'kit'` | `'kit'`: the Settings switch stores the choice and your sign-in flow acts on it. `'host'`: your app has its own lock and enforces it. `'vault'`: the kit keeps the sign-in behind the fingerprint. See [Fingerprint unlock](#fingerprint-unlock) |

### Help and support

| Key | Default | Meaning |
|---|---|---|
| `support` | `true` | `false` hides **Report a problem** and **Chat with support**; `{ report: false }` or `{ chat: false }` hides one |
| `push` | `true` | Reply notifications: `false` turns them off; `{ projectId }` sets the Expo project id when it is not in `extra.eas.projectId`. See [Reply notifications](#reply-notifications) |
| `whatsNew` | `true` | Show release notes once after an update, and the Settings row |
| `connectionBanner` | `true` | `false`, or `{ staleAfterSec: 25, slowMs: 3000 }` |

### Monitoring

| Key | Default | Meaning |
|---|---|---|
| `monitor` | see below | Crash and API monitoring options |

`monitor` options:

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

### Config plugin

Config plugin props (in `app.json`, for example `["@upande/mobile-kit", { "strict": false }]`): `manifestUrl`, `otaBaseUrl`, `sites` / `site` / `devSite`, `cleartext` (`false` opts out), `strict` (`false` turns the missing-native-module build failure into a warning) and `biometric` (`'host'` leaves out `expo-local-authentication`).

## Native modules

The kit needs ten native modules: `expo-updates`, `expo-constants`, `expo-file-system`, `expo-intent-launcher`, `expo-local-authentication`, `expo-network`, `expo-device`, `expo-battery`, `expo-localization` and `@react-native-async-storage/async-storage`. `init` installs the missing ones with `npx expo install`, which picks the version that fits your SDK. They are not `peerDependencies` on purpose: npm would install the newest version, which is wrong for most SDKs.

- Repair at any time: `npx upande-mobile-kit fix`.
- `verify` and `doctor` report a missing module as an error.
- The config plugin stops `expo prebuild`, EAS and CI with the exact command if one is missing. `strict: false` makes it a warning.
- A native module added later only works after a new native build. An OTA update cannot deliver it. Settings shows "rebuild required" for a module that is installed but not in the running binary.

### Optional extras

These are never required and never nag; each switches on one feature when it is in the build.

| Package | Adds |
|---|---|
| `react-native-view-shot` | The screenshot in [Report a problem](#report-a-problem) |
| `expo-notifications` | [Reply notifications](#reply-notifications) (also needs an Expo project id and, on Android, Firebase) |
| `expo-secure-store` | The [fingerprint sign-in vault](#fingerprint-sign-in-vault) |
| `@react-native-community/netinfo` | Wi-Fi name, signal, link speed and band ([Network and performance](#network-and-performance)) |

Install with `npx expo install <package>` and make a new native build (an OTA update cannot add native code).

## CLI reference

Run all commands from the app root (the folder with `app.json`), except `release`, which runs in the kit's own repository.

| Command | What it does |
|---|---|
| `npx upande-mobile-kit init` | The setup wizard. Flags below. |
| `npx upande-mobile-kit fix [--dry-run] [--align] [--yes]` | Installs missing native modules with `expo install`. `--dry-run` only prints the command. `--align` also re-pins installed ones to your SDK's versions. Never prompts. |
| `npx upande-mobile-kit verify [--site URL] [--dev-site URL]` | Self-test. One line per check (`✓` fine, `!` look at it, `✗` broken), each with a fix. Exits 1 on any `✗`. Checks `app.json`, routes, the provider, the config import, wiring, native modules, that the sites answer, and cleartext. |
| `npx upande-mobile-kit doctor [--site URL] [--dev-site URL]` | The quick version of `verify`. |
| `npx upande-mobile-kit version [--apply] [--json] [--notes] [--bump auto\|patch\|minor\|major] [--set X.Y.Z] [--apk] [--keep-version]` | Prints the next version, the release type (OTA or APK) and the reason (a dry run), or with `--apply` writes the version to `app.json` and `package.json`. `--apk` builds an APK for this release on the same runtime. Used by the workflow. |
| `npx upande-mobile-kit publish-ota [--out dir]` | Builds the OTA bundle into `./ota`. Used by the workflow. |
| `npx upande-mobile-kit release [patch\|minor\|major\|X.Y.Z] [--push] [--dry-run] [--list] [--skip-checks] [--allow-branch]` | For maintainers, run in the kit's own repository (not in an app): checks, bumps the version, commits and tags `v<version>`. See [For maintainers](#for-maintainers). |

`init` flags. With no value flags it runs the wizard. Any value flag runs the plain, non-interactive version.

| Flag | Meaning |
|---|---|
| `--yes` | Ask nothing: use remembered answers, detected values and flags. The production site must come from `--site` or a remembered answer. |
| `--no-install` | Run no commands; print them. The setup is incomplete until you run `fix`. |
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
| `--update-workflow` | Rewrite only `.github/workflows/release.yml` to the installed kit's version, keeping app name, APK name and branch |
| `--no-backup` | Do not copy changed files into `.upande-mobile-kit/backup/` |
| `--force` | Overwrite files that exist |
| `--settings-route PATH`, `--devices-route PATH` | Rarely needed: other paths for the kit's pages |

Without a terminal and without `--yes`, `init` stops and lists the flags to pass:

```bash
npx upande-mobile-kit init --yes --site https://your.site --dev-site http://localhost:8000 --bench /path/to/bench --bench-site my.site
```

`init` copies every file it changes into `.upande-mobile-kit/backup/<timestamp>/` first, outside `app/` (a backup inside `app/` would become a route). The folder is listed in `.gitignore` for you. Delete it once you have reviewed the diff.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Metro says "Unable to resolve ..." for a file that exists in `node_modules` | The dev server started before you updated the kit and does not see new files | Stop it and run `npx expo start -c` |
| "Not available in this build", or `verify` reports a missing module | A native module is not installed, or not in the running binary | Run `npx upande-mobile-kit fix`, then make a new native build |
| No Settings button | `fab` is `false` or `'dev'` in a release build, or `<MobileKitProvider>` is not mounted | Remove `fab` from `src/mobile-kit.ts`; run `npx upande-mobile-kit verify` |
| `/mobile-kit/settings` shows another screen | A file in your app serves that path | `verify` names it. Rename or remove it |
| No OTA update arrives | The app is not registered and enabled on the production site; the runtime does not match; Pages is off for a private repo; the site cannot be reached | Run `verify --site <production>`. On the server, run `register_app`. Check the release's runtime equals the app's `expo.runtimeVersion` |
| OTA arrives but the app does not restart into it | The bundle finished downloading more than 20 s after opening | It applies on the next opening. Raise `otaOpenWindowMs` if you want |
| No APK offer | The repo's releases are private, the latest APK is not newer, the check ran in the last 24 hours, or the user set downloads to Off or the phone is not on Wi-Fi | Check the Releases page; use Settings > Check for updates |
| The APK will not install over the old one | Signed with a different key (debug versus your key), or a lower `versionCode` | Sign with one key. Set `versionCodeBase` above the old build's `versionCode` |
| A release has no APK | A patch release (same runtime) is OTA only, by design | Put `[apk]` in a commit message, tick `build_apk` when you run the workflow by hand, or use `bump: minor`. See [Releasing](#releasing) |
| `Run workflow` has no `build_apk` box | The workflow file is from an older kit | `npx upande-mobile-kit init --update-workflow`, then commit and push |
| The workflow fails at `npm ci` | `package-lock.json` is missing or out of date | Run `npm install` and commit the lockfile |
| The workflow fails pushing the version commit | The release branch is protected | Allow `github-actions[bot]` to push to it |
| Events do not reach the portal | Not signed in, monitoring is off in Settings or on the Mobile App record, or the app is not registered | Sign in; check `enable_monitoring`; run `register_app` |
| Devices page is empty | The device register needs a signed-in Frappe user and a `useAuth` that reports one | Wire `useAuth` in `src/mobile-kit.ts` |
| `.local` site unreachable from the phone | Phones do not resolve `.local` names | Use your computer's LAN IP |
| `http://` site blocked | Cleartext not enabled in the native build | List the site under `expo.extra.mobileKit.sites` and make a new native build |
| The Update required dialog keeps coming back | The installer was cancelled, or Android blocks installs from this app | Tap **Install now** and allow installs from this app when Android asks. Set `apk: { force: false }` for a dialog with **Later** |
| No ring on the floating button while updating | The button is hidden (kit pages, keyboard, before sign-in) or `fab` is off | The ring is part of the floating button; see [the floating button](#the-floating-button) |
| The What's new sheet shows commit-style text | The release has no `Note:` lines | Add `Note: ...` lines to commit bodies ([What's new](#whats-new)) |
| **Report a problem** says it could not send | The backend is older than 0.2.0 or has not been migrated, or the phone is offline | Update `upande_mobile`, run `bench --site your.site migrate`, retry |
| A report is not in the Issue list | The site has no Issue doctype, so it went to Mobile Report | Look under the portal's Support page, or install ERPNext/Helpdesk |
| A report has no screenshot | `react-native-view-shot` is not in the build, or Settings was opened without the floating button | `npx expo install react-native-view-shot`, then a new native build |
| **Chat with support** never shows replies | Nobody has replied yet, or the backend lacks the support endpoints | On a site with Issues, reply with a Comment on the Issue in Desk. Update the backend to 0.3.0 or newer and run `bench migrate` |
| A reply was written on the Issue but the person does not see it | It was an email reply or an internal note, not a Comment | Add a **Comment** on the Issue; only Comments appear in the app |
| No notification arrives when support replies | Not turned on; the build lacks `expo-notifications`; no Expo project id or Firebase credentials; the reply was an email or note, not a **Comment**; or the site has push off (`upande_mobile_push: 0`) | Check Settings > Help > Notify me about replies; see the requirements in [Reply notifications](#reply-notifications); add a Comment on the Issue |
| The "Notify me about replies" switch is missing | The build cannot receive notifications, or `push: false` | `npx expo install expo-notifications`, add the plugin, make a new native build |
| Tapping a notification does not open the conversation | The notification was not sent by the kit's backend (no support marker) | Only support-reply notifications carry it |
| The offline banner never appears on one handheld model | Older kit versions trusted Android's "connected" | Update the kit; the banner now also counts failed requests |
| The person is thrown to the login screen when the session expires | No silent re-login | Turn on the [vault](#fingerprint-sign-in-vault) and set `sessionRecovery.login` |
| "What's new" never appears | A first install, no notes on that GitHub release, or `whatsNew: false` | Add notes through commit messages; the row in Settings reopens it |
| The fingerprint switch says "Needs a newer build" | `expo-secure-store` is not in the running build | `npx expo install expo-secure-store`, then a new native build |
| The banner says the connection is slow | The last round trip to your server took 3 seconds or more | Check the network; raise `connectionBanner.slowMs` or turn it off |
| "Upande Mobile Kit (server)" says "not installed" | The site does not have the `upande_mobile` app | Install the backend ([Quick start](#quick-start)) |
| Expo Go ignores part of the setup | Expo Go does not run config plugins or add native modules | Use a development build |

## Security and privacy

- This package is public. Nothing secret belongs in it or in `src/mobile-kit.ts`.
- Reports go only to your own Frappe site. Both the phone and the server redact secrets before they are stored. See [Privacy](#crash-and-api-monitoring).
- The Wi-Fi name (only with netinfo and the location permission), signal and speed are stored with the device's health. Leave `@react-native-community/netinfo` out if you do not want them.
- A problem report contains what the person typed, an optional screenshot of their screen (it may show anything that was on it) and the diagnostics listed in the sheet. The person sees the list before sending. Reports and chat messages are readable by System Managers only.
- The fingerprint vault keeps the sign-in in the phone's secure storage and nowhere else.
- The Android ID is stored only as a hash. The server also records the IP address it sees. It never records location.
- Only System Managers can read the device register and the web portal.
- The kit's own server calls to GitHub are unauthenticated. GitHub allows 60 per hour per IP address. Each phone checks once a day.

## For maintainers

The kit is installed from this repository, so a release is a git tag. Commit your changes to `main`, then from the kit checkout:

```bash
npx upande-mobile-kit release --dry-run   # show what would happen
npx upande-mobile-kit release minor       # patch (default) | minor | major | 1.4.0
npx upande-mobile-kit release --push      # same, and push the branch and the tag
npx upande-mobile-kit release --list      # tags that exist
```

`release` refuses to run on a dirty tree, off `main` (override with `--allow-branch`), or when the tag already exists. It runs typecheck, tests and `check:pack` (skip with `--skip-checks`), sets `"version"` in `package.json`, commits `chore(release): <version>`, and creates the annotated tag `v<version>`. It never pushes unless you pass `--push`, and never moves or replaces a tag. It prints the line apps use to install that version.

By hand it is the same: run the three checks, bump `"version"`, commit, `git tag v<version>`, `git push origin main v<version>`.

- `check:pack` also reads `KIT_DENY_PATTERNS` (regexes separated by `;`), so names that must never ship do not have to be written into this repo.
- The package is `"private": true` so it cannot be published to npm by accident. Remove that line and add `publishConfig` to publish there.
- The workflow `init` writes into apps calls this repo's shared workflow pinned to the tag with the kit's own version (`WORKFLOW_REF` in `cli/constants.mjs` is `v` plus the version in `package.json`). So every release must be tagged with exactly `v<version>`, and nothing needs moving. Apps pick up workflow changes with `npx upande-mobile-kit init --update-workflow`.
- Forks change `KIT_REPO` and `BACKEND_REPO_URL` in `cli/constants.mjs` and the URLs in `package.json`.

## License

MIT
