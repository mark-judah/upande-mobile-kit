# @upande/mobile-kit

> Distributed from GitHub, not npm: no npm account needed. Install with `npm install github:mark-judah/upande-mobile-kit#v0.2.1` (pin a release tag).

A drop-in **Settings page for Expo apps**, with the update plumbing behind it:

- **OTA updates** (JavaScript patches) applied when the app opens, plus a "Check for updates" button.
- **APK updates** found on your GitHub Releases, **downloaded in the background** (Wi-Fi only by default) and offered with an **Install now** prompt. A finished download is kept, so a dismissed installer can be reopened without downloading again.
- **Biometric unlock** switch (a safe native probe, so an OTA bundle can never crash an older APK).
- **Version info**: app, runtime, OTA bundle and the connected site's app versions.
- **Device register**: which phones run which build; a Devices screen for site administrators.
- **Release tooling**: odometer versioning, a JS-only OTA export, a reusable GitHub Actions workflow and Expo config plugins. No Expo (EAS) account needed.

The server side is a small Frappe app (`upande_mobile`): it keeps the device register and serves the OTA manifest with the headers `expo-updates` insists on.

## Quick start

```bash
# 1. add it to your Expo app (from GitHub; pin a release tag)
npm install github:mark-judah/upande-mobile-kit#v0.2.1

# 2. wire everything: Settings + Devices pages, config, release workflow, backend.
#    --site is production; --dev-site is your local bench (used by dev builds)
npx upande-mobile-kit init --site https://your.site --dev-site http://localhost:8000 --bench /path/to/frappe-bench

# 3. wrap your app in the provider (the one edit init cannot guess), then:
npx upande-mobile-kit doctor --site https://your.site --dev-site http://localhost:8000
```

**Local and production.** Dev builds (`__DEV__`: Metro, dev clients) talk to the `--dev-site`; release builds and OTA talk to `--site`. `--dev-site` is optional; without it every build uses `--site`. With `--bench`, the backend is installed on the **development** site (a bench on your machine is the local one) and `init` prints the exact commands to run on the production server's bench: it never touches production. `localhost` works in the iOS simulator; the Android emulator needs `http://10.0.2.2:<port>`, and a real phone needs your computer's LAN address (and a bench listening on it).

For step 3, in `app/_layout.tsx`:

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

Open `/settings` in the app. That's the whole page.

What `init` does:

| It | How |
|---|---|
| adds the pages | writes `app/settings.tsx` and `app/devices.tsx` (one-line re-exports) |
| points the app at your backend | writes `src/mobile-kit.ts`, imports it in `app/_layout.tsx`, sets `expo.updates.url` (production site only: OTA is off in dev builds) to `https://your.site/api/method/upande_mobile.api.ota.manifest?app=<name>`, `expo.extra.otaBaseUrl`, `runtimeVersion` and the plugin entry in `app.json` |
| installs the backend | with `--bench`: `bench get-app`, `bench --site <site> install-app upande_mobile`, then registers your app. Without `--bench` it prints exactly those commands |
| gives you OTA + APK releases | writes a 15-line `.github/workflows/release.yml` that calls this package's reusable workflow |

It never overwrites an existing file unless you pass `--force`. Options: `--dev-site`, `--bench-site`, `--backend-repo`, `--kit-repo`, `--name`, `--repo`, `--ota-base-url`, `--apk-name`, `--branch`.

Also install the native modules the kit uses (`init` prints the command):

```bash
npx expo install expo-updates expo-constants expo-file-system expo-intent-launcher \
  expo-local-authentication expo-network @react-native-async-storage/async-storage
```

`expo-intent-launcher`, `expo-local-authentication`, `expo-network` and AsyncStorage are optional: without them the kit degrades (APKs open in the browser, no biometric switch, downloads never start on an unknown network, settings are kept in memory).

## How updates reach a phone

1. A merge to your release branch runs the workflow. It bumps the version one odometer step.
2. A **patch** (`1.2.3 → 1.2.4`) keeps the runtime: the JS bundle goes to GitHub Pages and every installed 1.2 APK picks it up the next time the app opens.
3. A **minor/major** (`1.2.9 → 1.3.0`) moves the runtime: the workflow builds an APK and attaches it to a GitHub Release.
4. The app checks GitHub once a day. Per the person's choice (Settings → *Download updates*: Wi-Fi only / any network / off; the default is Wi-Fi only) it downloads the new APK in the background, then asks **Install now**.

### What it cannot do

- **Android cannot install an APK silently.** Without device-owner rights, the system installer always asks the person to confirm. "Auto-install" therefore means: downloaded in the background, one tap to install. The first time, Android also asks to allow installs from this app.
- **APK updates are Android only.** On iOS the kit gives you OTA updates, biometrics, versions and the register; native updates there go through the App Store / TestFlight.
- **It needs a Frappe site.** The device register and the OTA manifest live in the `upande_mobile` Frappe app. (The APK check talks to GitHub directly and works without the site.)
- **The device register needs a signed-in Frappe user.** An app that passes no `useAuth` still gets OTA, APK and biometrics, but its devices are not registered.
- **This package is public.** Nothing secret goes in it or in your `src/mobile-kit.ts`; keep keys in your own secure storage.
- GitHub's unauthenticated API allows 60 calls/hour per IP; the kit checks once a day per phone and says so if it is rate limited.

## Configuration

`src/mobile-kit.ts` is as short as:

```ts
configureMobileKit({
  appName: 'My App',            // the "Mobile App" record on the server
  githubRepo: 'owner/my-app',   // repo that publishes the GitHub Releases
  site: 'https://your.site',    // the Frappe site running upande_mobile
  // or one per environment (dev builds use `development`, release builds `production`):
  // site: { production: 'https://your.site', development: 'http://localhost:8000' },
});
```

Everything else is optional. If the app already has a Frappe client, storage and sign-in, hand them over so the Devices screen and the register use the real session:

| Option | Purpose |
|---|---|
| `appName`, `githubRepo` | required |
| `site` | base URL for the built-in `fetch` client: a string, or `{ production, development }` (dev builds use `development`, falling back to `production`) |
| `environment` | `'development'` or `'production'`: pin the choice instead of deriving it from `__DEV__` |
| `api`, `authHeaders` | your own Frappe client (resolves to the response body), or headers for the built-in one |
| `storage` | `{ get, set, remove }`; default AsyncStorage, else memory |
| `useAuth` | `() => ({ isSystemManager, user, instanceUrl, biometricEnabled, setBiometricEnabled, logout?, forgetDevice?, fullName?, email? })` |
| `apk.autoDownload` | `'wifi'` (default), `'always'`, `'never'`; the person's Settings choice wins |
| `theme`, `ui` | colours / fonts, or swap `Screen`, `Card`, `Button`, `useToast`, `showDialog`, `useOnline` for your design system |
| `endpoints` | override `registerInstall`, `installs`, `versions`, `ingest` |
| `monitor` | crash & API monitoring options, see below |
| `serverApps` | which site apps to list on Settings, `[key, label][]` |
| `loginRoute`, `devicesRoute`, `settingsRoute`, `instanceKey`, `deviceKey`, `errorMessage`, `onAvatarLongPress`, `otaOpenWindowMs` | optional hooks |

Add your own rows without forking: `<SettingsScreen extraSections={…} profileExtra={…} />`.

Other exports: `useUpdatePrompt(active)` (an "Update available" dialog before downloading, for apps that prefer asking first), `Biometric.*` for your lock screen, `reportInstall`, `fetchInstalls`, `restartForInstance` / `consumeInstanceSwitched`, `checkForApk`, `downloadApk`, `launchInstaller`, `useApkUpdate`.

## Crash & API monitoring

Sentry-style reporting that lands on a dashboard in your Frappe site (`/mobile-monitor`, System Managers only, served by the `upande_mobile` app). It is **on by default**; the person can turn it off in Settings ("Send crash reports"), and `monitor: { enabled: false }` installs nothing.

**What is captured**

- every unhandled JavaScript error (a fatal one is queued and sent at once), unhandled promise rejections, and render errors if you wrap the app in `<MonitorErrorBoundary>` (or set `monitor.errorBoundary`);
- every **failed** API call (status 400 and up, a network error or a timeout): method, URL, status, duration, request and response headers, request and response bodies. Successful calls are not sent unless you set `monitor.sampleSuccess` (then metadata only, no bodies);
- breadcrumbs: the last 30 screens and API calls, and optionally `console.warn` / `console.error`;
- the device: platform, OS version and build, brand and model, battery level and state, low-power mode, free and total storage, memory, network type and reachability, locale, time zone, screen size, orientation, app state, colour scheme, JS engine, build type (embedded / OTA / dev), and app, runtime and update ids. The optional native modules `expo-device`, `expo-battery`, `expo-network` and `expo-localization` add fields when installed; without them the field is simply left out (`npx upande-mobile-kit doctor` tells you which);
- the signed-in user the host's `useAuth` reports: id, full name and roles.

**Where it hooks in.** `MobileKitProvider` starts everything. It wraps `fetch` (React Native's own and anything built on it). For axios call `attachAxios(instance)` once; for a custom client wrap it with `withMonitoring(api)`. You can also report by hand:

```ts
import { captureException, captureMessage, addBreadcrumb } from '@upande/mobile-kit';

captureException(err, { orderId });           // extra values are kept (secret-looking keys are redacted)
captureMessage('Sync finished late', 'warning');
addBreadcrumb({ type: 'user', message: 'Opened the scanner' });
```

**Speed.** When something happens the code only pushes a small object onto a bounded in-memory buffer (200 items, oldest dropped). Redaction, JSON, device probes, storage and the network all happen later, in a flush that runs when the app is idle: every 30 s while events wait, at 20 events, and when the app goes to the background. A flush sends one batched request (up to 50 events and 512 KB). Details:

- repeats of the same error within 60 s become one event with a count;
- at most 200 events per app session;
- device facts are read once per 30 s, each probe with a 1 s timeout;
- when offline or the server errors, events wait in a persisted queue (100 events, 1 MB) and are retried with exponential back-off (30 s up to 15 min);
- reports need a signed-in session; events raised before sign-in wait and are sent after.

A jest test in this repo (`__tests__/monitor-perf-test.ts`) checks that 40,000 captures neither serialise nor redact anything and that the buffer stays bounded.

**Privacy.** Read this before shipping to users.

- Redaction happens on the phone, before anything is sent, and again on the server. Header, query-string, JSON and form-field names containing `authorization`, `cookie`, `token`, `secret`, `password`, `passwd`, `api_key`, `session`, plus the whole words `sid`, `pwd`, `pin`, `otp`, `cvv` and `card`, are replaced with `[redacted]`. Add your own with `monitor.redactKeys`. Redaction is by name: a secret in a field called something else, or inside free text, is not found. If your responses carry personal data, set `captureBodies: false`, or keep it and add the field names to `redactKeys`.
- Bodies are cut to `maxBodyBytes` (8 KB); file uploads and other binary bodies are never recorded, only their size.
- The server stores the IP address it sees and the device identifier it is sent (hashed). Tell your users what you collect.
- `setMonitoringEnabled(false)` is the user's switch: it stops capture, discards anything waiting and is remembered.
- The package is public and contains no endpoint secrets; reports go only to your own site.

Settings shows the "Send crash reports" row by default (`monitor.showToggle: false` hides it) and a "Send test error" button in development (`monitor.showTestActions` to force it either way).

## Release tooling

```bash
npx upande-mobile-kit version [--apply] [--json] [--notes] [--bump minor|major] [--set 1.0.0]
npx upande-mobile-kit publish-ota [--out dir]
npx upande-mobile-kit doctor [--site https://your.site] [--dev-site http://localhost:8000]
```

- **Odometer versions**: each merge is one step (`1.0.99 → 1.1.0`, `1.49.99 → 2.0.0`); `versionCode` and `runtimeVersion` are derived. A new Expo SDK always becomes a new runtime.
- **Offsets** for an app that already has older builds out: `app.json → expo.extra.mobileKit = { versionCodeBase, runtimeMajorBase }` (both default to `0`). Set them before the first release so a new APK never gets a lower `versionCode` than the one installed.
- **Reusable workflow** (`.github/workflows/release.yml`, `workflow_call`): bumps, publishes the JS bundle to GitHub Pages, builds a signed APK when the runtime changed, tags and creates the GitHub Release (attaching `<apk-name>_v<version>.apk` and a fixed-name `<apk-name>.apk`). Signing is optional and uses the `ANDROID_*` repository secrets.
- **Config plugin** (`"plugins": ["@upande/mobile-kit"]`): Gradle memory tuning, device-only ABIs, release signing driven by Gradle properties, and optional `manifestUrl` / `otaBaseUrl` props for `expo-updates`.

## Releasing this package (GitHub only)

The package is installed straight from this repository, so a release is a git tag. It is marked `"private": true` so it can never be pushed to npm by accident; remove that line (and add `publishConfig`) only if you later decide to publish there.

The package names two repositories of its own, in `package.json` and `cli/constants.mjs`: this repo (the reusable workflow's home) and the backend app's git URL. If you fork, change both, or pass `--kit-repo` / `--backend-repo` to `init`.

```bash
npm run typecheck && npm test
npm run check:pack      # lists what an install would contain; fails on stray hostnames, emails, credential shapes
git tag v0.1.0 && git push origin v0.1.0
git tag -f v0 && git push -f origin v0      # callers' `uses: <owner>/upande-mobile-kit/…@v0` resolves to this
```

Users then run `npm install github:mark-judah/upande-mobile-kit#v0.2.1`. To update, they change the tag. Bump `version` in `package.json` before each tag so it matches.

Notes: a GitHub install has no registry listing, download counts or integrity record beyond the git commit, so pin a tag (or a commit hash), never a branch. `npx upande-mobile-kit …` works after the install because the command is linked into `node_modules/.bin`.

`check:pack` also reads `KIT_DENY_PATTERNS` (regexes separated by `;`) for names that must never ship, so those names never have to be written into this public repo.

The package ships TypeScript source (Metro compiles it).
