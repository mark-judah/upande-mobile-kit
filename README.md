# @upande/mobile-kit

A Settings page and the update plumbing behind it, for Expo apps.

- **Updates that reach phones by themselves.** JavaScript fixes ship over the air (OTA). New native builds ship as an APK that downloads in the background and asks the user to tap Install.
- **A Settings page** with versions, a "Check for updates" button, a fingerprint unlock switch and a floating button that opens it from any screen.
- **A Devices page** in the app. System Managers see which phones run which build, who used them, and which are behind.
- **Crash and API monitoring** on a web portal in your own Frappe site (`/mobile-monitor`): errors, failed requests with headers, payload and response, device details and the signed-in user.
- **One release workflow.** Merge to your release branch and GitHub Actions publishes the OTA bundle or builds the APK. No Expo (EAS) account.

The package is installed from GitHub, not npm. Its backend is the Frappe app [`upande_mobile`](https://github.com/mark-judah/upande-mobile).

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

## The web portal

Reports from your apps land on a web portal that the backend serves: **`https://your.site/mobile-monitor`**.

- **How to open it:** sign in to your Frappe site as a System Manager, then open that address in a browser. If you are signed out you are sent to the login page and back. Other users get a permission error. The portal has no menu entry in Frappe, so bookmark it.
- **What you get:**
  - an overview: events per day, top issues, app versions, device models and OS versions in use, and fleet health;
  - every crash, error and failed API request grouped into issues, each with the stack, the request and response (headers and payload, secrets removed), breadcrumbs, the device (OS, model, battery, storage, network, app and runtime versions) and the signed-in user, with Resolve and Ignore;
  - a Devices view of every registered phone, with filters for low battery, low storage, offline, old OS and old app, and each device's timeline.
- **What it needs:** the backend installed with `bench build --app upande_mobile` run once, the app registered on that site, and the app signed in so it can send reports. See [Crash and API monitoring](#crash-and-api-monitoring) for what the app captures, and the [backend README](https://github.com/mark-judah/upande-mobile#the-web-portal) for the portal itself.

The portal is separate from the Settings page inside your app: the portal is for you, the Settings page is for your users.

## Requirements

| What | Needed |
|---|---|
| Expo app | Expo SDK 54 or newer (peer ranges: `expo >=54`, `react-native >=0.81`, `react >=19`, `expo-router >=6`), using expo-router |
| Node | 20 or newer (the release workflow uses 22) |
| Package manager | npm for the release workflow (it runs `npm ci`, so `package-lock.json` must be committed) |
| Frappe site | Frappe 16 with the `upande_mobile` app installed |
| GitHub | A repository for the app. Releases must be readable without logging in (see [GitHub setup](#github-setup)) |
| Android | APK updates are Android only. The release workflow builds and publishes for Android |

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
npm install github:mark-judah/upande-mobile-kit#v0.8.0
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

## Releasing

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

Examples:

```bash
git commit -m "fix: correct the gate count"                    # OTA only
git commit -m "fix: correct the gate count [apk]"              # OTA and an APK
git commit -m "feat: scan IDs with the camera [native]"        # new runtime and an APK
git commit -m "feat!: new login [major]"                       # 2.0.0 and an APK
```

Rules:

- A marker must be a whole bracketed token. `[apkish]` or the word apk in a sentence does nothing.
- `--bump minor`, `--bump major` and `--set` (workflow inputs) always win over markers. `--bump auto`, `patch`, or nothing leave the decision to the markers.
- An Expo SDK upgrade still forces a minor bump and an APK, whatever the markers say.

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

**Actions > Release > Run workflow.** Pick the branch, then:

| Input | Values |
|---|---|
| `bump` | `auto` (the commit markers decide; patch if there are none), `patch`, `minor`, `major` |
| `set_version` | an exact version such as `2.0.0`; when set, `bump` is ignored |
| `build_apk` | tick it to also build and attach an APK (same runtime, OTA keeps working) |

It builds what is on GitHub, not your local files: push your changes first.

### Keeping the workflow up to date

`init` writes `.github/workflows/release.yml` pinned to the kit version that wrote it, for example `...release.yml@v0.8.0`. A floating tag would never carry workflow fixes to apps that already have the file, so the pin is exact. After you update the kit, bring the workflow up to date:

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

## The Settings page

Every user of your app gets this page at `/mobile-kit/settings`. A floating button opens it from any screen once `<MobileKitProvider>` is mounted. Drag the button to either screen edge; it remembers where you left it, and it hides on the kit's own pages and while the keyboard is open. Set `fab: false` to remove it and open the page yourself with `openKitSettings()`, `<KitSettingsButton />` or `router.push('/mobile-kit/settings')`.

From top to bottom, the page shows:

| Card | What it has |
|---|---|
| Profile | The user's initial, name, email and site, taken from your `useAuth` |
| Dev notice | Development builds only: which of `useAuth`, `api` and `storage` are still on the kit's stand-ins |
| Security | The **Biometric unlock** switch (see [Fingerprint unlock](#fingerprint-unlock)). Hidden when `biometric: 'host'` |
| Diagnostics | The **Send crash reports** switch, and a **Send test error** button in development. Hidden with `monitor.showToggle: false` |
| App & Server | The app name, the site, the versions of the apps on the site (Frappe and ERPNext by default), **Installed** version, **Latest** version, which bundle is running (embedded build, or the OTA bundle id, date and channel), the **Check for updates** button and the **Download updates** choice (see [Updates on the phone](#updates-on-the-phone)) |
| Not available in this build | Only when an optional native module is missing, for example "Battery info unavailable: rebuild required" |
| Your own rows | Anything you pass as `extraSections` or `profileExtra` |
| Devices | A link to the Devices page. System Managers only |
| Session | **Sign out** and **Forget this device**, shown when your `useAuth` provides `logout` and `forgetDevice` |

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

## Fingerprint unlock

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
- **If your app already has its own lock**, set `biometric: 'host'`. The kit then hides its switch so there is one lock and one switch. `init` detects an existing use of `expo-local-authentication` and sets this for you.
- **Sign out and Forget this device** are in the Session card. Sign out asks "You can sign back in with biometrics or your password." Forget this device asks "Clears your session and disables biometric unlock." Both call the functions your `useAuth` provides and then go to `loginRoute` (default `/login`).

## Updates on the phone

- **On open.** The app checks for an OTA bundle. If one downloads in the first 20 seconds, it restarts into it. A later download waits for the next opening, so the app never restarts under someone mid-task.
- **Check for updates.** The one button in App & Server. It checks GitHub Releases for a new APK first, because a new APK carries a new runtime and supersedes any OTA bundle. If the APK is current it asks for an OTA bundle. When an APK is available the same button reads **Download v1.3.0 (size)**, then **Install v1.3.0**.
- **Download updates.** A choice under that button: **Wi-Fi only** (the default), **Any network** or **Off**. The user's choice wins over `apk.autoDownload`. Once a day the app checks GitHub Releases; on Wi-Fi it downloads a newer APK in the background and offers **Install now**. **Later** is remembered for that version. A finished download is kept, so a dismissed installer can be reopened without downloading again.
- **Android cannot install an APK silently.** The user always confirms in Android's installer, and the first time Android also asks to allow installs from this app.

## Local and production sites

Dev builds (`__DEV__`: Metro, dev clients) use the dev site. Release builds and OTA use the production site. `init` writes both:

```ts
site: { production: 'https://your.site', development: 'http://localhost:8000' },
```

Without a development site every build uses production. Pin one with `environment: 'production'` or `'development'`.

- `localhost` works in the iOS simulator. The Android emulator needs `http://10.0.2.2:<port>`. A real phone needs your computer's LAN address, and a bench listening on it.
- Names ending in `.local` do not resolve from phones or the Android emulator. Use the LAN IP and make the bench answer on it (`bench use <site>` sets the default site).
- A plain `http://` site needs Android cleartext traffic and an iOS App Transport Security exception. The kit's config plugin sets both for the hosts listed under `expo.extra.mobileKit.sites`, never the global "allow all HTTP" flag, and warns at prebuild. An `http://` production site gets a loud warning. Opt out with `["@upande/mobile-kit", { "cleartext": false }]`. This is native configuration, so it needs a new native build.

## Crash and API monitoring

On by default. Everything captured is shown in the [web portal](#the-web-portal) at **`https://your.site/mobile-monitor`** (System Managers only). The user can turn reporting off in Settings, and `monitor: { enabled: false }` installs nothing.

**Captured**

- Unhandled JavaScript errors (a fatal one is sent at once), unhandled promise rejections, and render errors if you wrap the app in `<MonitorErrorBoundary>` or set `monitor.errorBoundary`.
- `console.error(err)` calls that carry an Error, which covers errors your app catches and logs. Plain strings and React warnings are not reported. Turn off with `captureConsoleErrors: false`.
- Failed API calls (status 400 and up, network errors, timeouts): method, URL, status, duration, headers, request and response bodies. Successful calls are not sent unless you set `sampleSuccess`, and then only as metadata.
- The last 30 screens and API calls as breadcrumbs.
- The device: OS version and build, brand, model, battery level and state, low-power mode, free and total storage, memory, network, locale, time zone, screen, build type, app, runtime and update ids, and any optional native modules missing from this build.
- The signed-in user your `useAuth` reports: id, name and roles.

**Cost to the app.** Capturing only pushes a small object into a bounded in-memory buffer. Redaction, serialising and device probes run later, off the interaction path, in one batched request: every 30 seconds while events wait, at 20 events, and when the app goes to the background. Repeats within 60 seconds become one event with a count, a session sends at most 200 events, and an offline queue (100 events, 1 MB) retries with back-off. Reports need a signed-in session; earlier events wait and are sent after sign-in.

**Hooks.** `MobileKitProvider` wraps `fetch`. For axios call `attachAxios(instance)` once. For a custom client wrap it with `withMonitoring(api)`. By hand:

```ts
import { captureException, captureMessage, addBreadcrumb } from '@upande/mobile-kit';

captureException(err, { orderId });
captureMessage('Sync finished late', 'warning');
addBreadcrumb({ type: 'user', message: 'Opened the scanner' });
```

**Privacy.** Read this before shipping.

- Secrets are redacted on the phone, then again on the server. Header, query and body field names containing `authorization`, `cookie`, `token`, `secret`, `password`, `passwd`, `api_key`, `session`, plus the whole words `sid`, `pwd`, `pin`, `otp`, `cvv` and `card` become `[redacted]`. Add more with `monitor.redactKeys`.
- Redaction is by name. A secret in a field with another name, or inside free text, is not found by the phone. If your responses carry personal data, set `captureBodies: false` or add the field names to `redactKeys`.
- Bodies are cut at `maxBodyBytes` (8 KB). Binary bodies are never recorded, only their size.
- The server stores the IP address it sees, and a hash of the device identifier.
- Ignore noisy calls with `ignoreUrls`, for example `['exp.host/--/api/v2/push', /\/healthz$/]`.

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
| `fab` | `true` | `true`, `false`, `'dev'` (development builds only) or `{ initialSide: 'left' \| 'right', bottom: 96, whenSignedOut: false }`. With your own `useAuth` wired the button hides until someone is signed in (your sign-in gate would send the page straight back to login); `whenSignedOut: true` shows it anyway |
| `biometric` | `'kit'` | `'kit'`: Settings shows the Biometric unlock switch (it confirms with a fingerprint and stores the choice; your sign-in flow acts on it). `'host'`: your app already has its own lock, so the kit hides its switch and never prompts. See [Fingerprint unlock](#fingerprint-unlock) |
| `apk.autoDownload` | `'wifi'` | `'wifi'`, `'always'` or `'never'`. The user's Settings choice wins |
| `monitor` | see below | Crash and API monitoring options |
| `theme`, `ui` | built-in look | Colours and fonts, or swap `Screen`, `Card`, `Button`, `useToast`, `showDialog`, `useOnline` |
| `serverApps` | Frappe and ERPNext | `[key, label][]` site apps to list on Settings |
| `loginRoute` | `'/login'` | Where Sign out and Forget this device go |
| `endpoints` | the `upande_mobile` paths | Override `registerInstall`, `installs`, `versions`, `ingest` |
| `otaOpenWindowMs` | `20000` | A bundle downloaded within this long of opening restarts the app at once |
| `foregroundReportMinMs` | `30000` | Minimum time between foreground device reports |
| `settingsRoute`, `devicesRoute` | `/mobile-kit/settings`, `/mobile-kit/devices` | Rarely needed; the defaults live in a folder no app uses, so they cannot collide |
| `instanceKey`, `deviceKey`, `errorMessage`, `onAvatarLongPress` | none | Optional hooks |

Without `useAuth`, `api` and `storage` the kit runs on stand-ins. The Settings page looks fine, but sign-out, the biometric switch and the device register are not connected to your session. `init` wires them when it finds your auth store, API client and storage, development builds log what is still a stand-in, and `getConfigGaps()` returns the list.

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

Config plugin props (in `app.json`, for example `["@upande/mobile-kit", { "strict": false }]`): `manifestUrl`, `otaBaseUrl`, `sites` / `site` / `devSite`, `cleartext` (`false` opts out), `strict` (`false` turns the missing-native-module build failure into a warning) and `biometric` (`'host'` leaves out `expo-local-authentication`).

Add your own rows to Settings without forking: `<SettingsScreen extraSections={...} profileExtra={...} />`.

## Native modules

The kit needs ten native modules: `expo-updates`, `expo-constants`, `expo-file-system`, `expo-intent-launcher`, `expo-local-authentication`, `expo-network`, `expo-device`, `expo-battery`, `expo-localization` and `@react-native-async-storage/async-storage`. `init` installs the missing ones with `npx expo install`, which picks the version that fits your SDK. They are not `peerDependencies` on purpose: npm would install the newest version, which is wrong for most SDKs.

- Repair at any time: `npx upande-mobile-kit fix`.
- `verify` and `doctor` report a missing module as an error.
- The config plugin stops `expo prebuild`, EAS and CI with the exact command if one is missing. `strict: false` makes it a warning.
- A native module added later only works after a new native build. An OTA update cannot deliver it. Settings shows "rebuild required" for a module that is installed but not in the running binary.

## CLI reference

Run all commands from the app root (the folder with `app.json`).

| Command | What it does |
|---|---|
| `npx upande-mobile-kit init` | The setup wizard. Flags below. |
| `npx upande-mobile-kit fix [--dry-run] [--align] [--yes]` | Installs missing native modules with `expo install`. `--dry-run` only prints the command. `--align` also re-pins installed ones to your SDK's versions. Never prompts. |
| `npx upande-mobile-kit verify [--site URL] [--dev-site URL]` | Self-test. One line per check (`✓` fine, `!` look at it, `✗` broken), each with a fix. Exits 1 on any `✗`. Checks `app.json`, routes, the provider, the config import, wiring, native modules, that the sites answer, and cleartext. |
| `npx upande-mobile-kit doctor [--site URL] [--dev-site URL]` | The quick version of `verify`. |
| `npx upande-mobile-kit version [--apply] [--json] [--notes] [--bump auto\|patch\|minor\|major] [--set X.Y.Z] [--apk] [--keep-version]` | Prints the next version, the release type (OTA or APK) and the reason (a dry run), or with `--apply` writes the version to `app.json` and `package.json`. `--apk` builds an APK for this release on the same runtime. Used by the workflow. |
| `npx upande-mobile-kit publish-ota [--out dir]` | Builds the OTA bundle into `./ota`. Used by the workflow. |

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
| Expo Go ignores part of the setup | Expo Go does not run config plugins or add native modules | Use a development build |

## Security and privacy

- This package is public. Nothing secret belongs in it or in `src/mobile-kit.ts`.
- Reports go only to your own Frappe site. Both the phone and the server redact secrets before they are stored. See [Privacy](#crash-and-api-monitoring).
- The Android ID is stored only as a hash. The server also records the IP address it sees. It never records location.
- Only System Managers can read the device register and the web portal.
- The kit's own server calls to GitHub are unauthenticated. GitHub allows 60 per hour per IP address. Each phone checks once a day.

## For maintainers

The kit is installed from this repository, so a release is a git tag:

```bash
npm run typecheck && npm test
npm run check:pack            # fails on stray hostnames, emails or credential-shaped text
# bump "version" in package.json and commit, then:
git tag v0.8.0 && git push origin v0.8.0
```

- `check:pack` also reads `KIT_DENY_PATTERNS` (regexes separated by `;`), so names that must never ship do not have to be written into this repo.
- The package is `"private": true` so it cannot be published to npm by accident. Remove that line and add `publishConfig` to publish there.
- The workflow `init` writes into apps calls this repo's shared workflow pinned to the tag with the kit's own version (`WORKFLOW_REF` in `cli/constants.mjs` is `v` plus the version in `package.json`). So every release must be tagged with exactly `v<version>`, and nothing needs moving. Apps pick up workflow changes with `npx upande-mobile-kit init --update-workflow`.
- Forks change `KIT_REPO` and `BACKEND_REPO_URL` in `cli/constants.mjs` and the URLs in `package.json`.

## License

MIT
