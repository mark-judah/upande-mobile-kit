# @upande/mobile-kit

> Distributed from GitHub, not npm: no npm account needed. Install with `npm install github:mark-judah/upande-mobile-kit#v0.7.0` (pin a release tag).

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
npm install github:mark-judah/upande-mobile-kit#v0.7.0

# 2. run the wizard: it asks a few questions, then does the rest
npx upande-mobile-kit init
```

That is all. The wizard detects your app name, GitHub repo, package manager and any Frappe bench on your machine, so it only asks for what it cannot know:

```
Setting up My App (acme/my-app).

Production site URL (release builds use this): https://your.site
Local/dev site URL (dev builds use this; blank = same as production, try http://localhost:8000): http://localhost:8000
Install the Frappe backend (upande_mobile) on a bench on this machine now? [Y/n]:
Which bench?
  1) /home/you/frappe-bench
  2) Another folder…
Choose 1-2 [1]:
Which bench site?
  1) localhost
Choose 1-1 [1]:
File exporting your auth store hook, e.g. src/store/auth.ts (blank = skip): src/store/auth.ts   ← only when it could not find it

This will: write the pages, config and release workflow; wrap the root layout in <MobileKitProvider>;
install the native modules (always: no question); install the backend on /home/you/frappe-bench (site localhost); run doctor …
Apply? [Y/n]:
```

After **Apply** it writes `app/mobile-kit/settings.tsx`, `app/mobile-kit/devices.tsx`, `src/mobile-kit.ts` and the release workflow, edits `app.json`, wraps your root layout in `<MobileKitProvider>` (a small edit: see [Reviewing what init changes](#reviewing-what-init-changes)), wires your app's own sign-in, API client and storage into the config when it can find them, runs `npx expo install` for the native modules (with your package manager's flag), installs and registers the backend on your local bench, runs `doctor`, and prints the commands for the production server's bench.

**Your answers are remembered** in `upande-mobile-kit.json` at the app root (site URLs, repo, bench folder and site name; no secrets). Run `init` again and every question already has its answer: Enter, Enter, Enter. The file holds a path on your machine, so add it to `.gitignore` if the repo is shared.

**Flags are for CI and scripts.** `init --yes` asks nothing (remembered answers, detected values, and flags win), and `--no-install` never runs a command (it prints them). Any value flag on its own (`--site`, `--dev-site`, `--bench`, `--bench-site`, `--name`, `--repo`, …) runs the plain, non-interactive init, as in earlier versions. Without a terminal and without `--yes`, `init` stops at once and says which flags to pass:

```bash
npx upande-mobile-kit init --yes --site https://your.site --dev-site http://localhost:8000 --bench /path/to/frappe-bench --bench-site my.site
```

**Local and production.** Dev builds (`__DEV__`: Metro, dev clients) talk to the dev site; release builds and OTA talk to the production site. The dev site is optional; without it every build uses the production site. A bench on your machine is the local one, so the backend is installed on the **development** site; `init` prints the exact commands to run on the production server's bench and never touches production. `localhost` works in the iOS simulator; the Android emulator needs `http://10.0.2.2:<port>`, and a real phone needs your computer's LAN address (and a bench listening on it).

If the wizard does not recognise your root layout it leaves the file alone and prints the edit to make. By hand, in `app/_layout.tsx`:

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

A **floating Settings button** appears over your app as soon as `<MobileKitProvider>` is mounted: it works whatever your navigation looks like, so there is nothing to link. Tap it to open `/mobile-kit/settings` (see [Where the pages live](#where-the-pages-live)); drag it to either screen edge and it stays there. It hides on the kit's own pages and while the keyboard is open. Prefer your own entry? Set `fab: false` and use `<KitSettingsButton />` or `openKitSettings()` / `router.push('/mobile-kit/settings')`. Then run `npx upande-mobile-kit verify` to check the whole setup.

**New native build needed.** `init` adds native packages (`expo-device`, `expo-battery`, `expo-localization`, `expo-file-system`, …) and a plugin entry, and changes `expo.updates.url` / `runtimeVersion`. **An OTA update does not deliver any of that**: the app must be rebuilt (`npx expo prebuild && npx expo run:android`, or push to your release branch and let the workflow build the APK). `init` finishes with a block that lists exactly which packages and `app.json` changes need the new build. Until it is installed the kit degrades instead of crashing (no battery or device model on crash reports, APKs open in the browser, …) and `verify` says which module is missing.

What `init` does:

| It | How |
|---|---|
| adds the pages | writes `app/mobile-kit/settings.tsx` and `app/mobile-kit/devices.tsx` (one-line re-exports) |
| points the app at your backend | writes `src/mobile-kit.ts`, imports it in `app/_layout.tsx`, sets `expo.updates.url` (production site only: OTA is off in dev builds) to `https://your.site/api/method/upande_mobile.api.ota.manifest?app=<name>`, `expo.extra.otaBaseUrl`, `runtimeVersion` and the plugin entry in `app.json` |
| installs the backend | with a bench (wizard, or `--bench`): `bench get-app`, `bench --site <site> install-app upande_mobile`, then registers your app. Without `--bench` it prints exactly those commands |
| gives you OTA + APK releases | writes a 15-line `.github/workflows/release.yml` that calls this package's reusable workflow |

It never overwrites an existing file unless you pass `--force`, Options: `--dev-site`, `--bench-site`, `--backend-repo`, `--kit-repo`, `--name`, `--repo`, `--ota-base-url`, `--apk-name`, `--branch`, `--settings-route`, `--devices-route`, `--biometric host|kit`, `--no-adapters`, `--no-backup`.

### Native modules: installed for you, repaired with one command

The kit needs ten native modules (`expo-updates`, `expo-constants`, `expo-file-system`, `expo-intent-launcher`, `expo-local-authentication`, `expo-network`, `expo-device`, `expo-battery`, `expo-localization`, `@react-native-async-storage/async-storage`). You never install them by hand:

- **Every `init` path installs the missing ones** with Expo's own SDK-aware `npx expo install` (the wizard, `--yes`, and the flag-driven `init --site ...` alike), unless you pass `--no-install`. Re-running `init` installs whatever is still missing, even when every file already exists.
- **`--no-install`, or an install that fails, ends with a loud `✗ SETUP INCOMPLETE` block** naming the one command that finishes the job. It is never just a quiet "last steps" line.
- **`npx upande-mobile-kit fix`** installs and repairs them at any time: it finds the modules missing from `package.json` or `node_modules`, runs `npx expo install <them>` with your package manager (from the lockfile), prints what changed, re-checks, and ends with the "needs a NEW NATIVE BUILD" note when something was added. `fix --dry-run` only prints the command; `fix --align` also re-pins the modules you already have to the versions your SDK expects. It never prompts (it runs with `CI=1`) and never hangs (a time limit). With everything in place it changes nothing.
- **`verify` and `doctor` treat a missing module as an error** (✗), with `npx upande-mobile-kit fix` as the fix. The one exception is `expo-local-authentication` when your app owns the biometric lock (`biometric: 'host'`): that stays a warning.
- **The build stops too.** The config plugin checks the modules from your **project** root when `expo prebuild`, EAS or CI runs it, and throws with the list and the command if any is missing, so you never ship an app with features silently off. Plugin props: `"strict": false` turns the failure into a warning, and `"biometric": "host"` leaves out `expo-local-authentication` (a `biometric: 'host'` in `src/mobile-kit.ts` is honoured too, so the prop is rarely needed). Example: `["@upande/mobile-kit", { "strict": false }]`.
- **In the running app**, Settings shows a "Not available in this build" card and development builds log **one** console line. It tells two cases apart: *"not installed, run `npx upande-mobile-kit fix`"* (the package is not in the app) and *"rebuild required"* (the package is installed, but this binary was built without its native side). Crash reports carry the list as `missing_modules`.

**Why these are not `peerDependencies`.** Only `expo install` knows which version fits your Expo SDK: `expo-file-system` is `~19.0` on SDK 54 and `~58.0` on SDK 58. A required peer would be auto-installed by npm at the **highest** version it allows, which is the wrong one for most apps and breaks at runtime, a worse failure than a missing module. So the kit lists them only as *optional* peers (never auto-installed) and leaves the install to `expo install`, driven by `init`, `fix` and the build-time check above. For the same reason it does not install anything from a `postinstall` script: a nested package-manager run from inside another install is fragile.

## Where the pages live

The kit's pages are `app/mobile-kit/settings.tsx` and `app/mobile-kit/devices.tsx`, so they are served at **`/mobile-kit/settings`** and **`/mobile-kit/devices`**. That folder is the kit's own, so the pages cannot collide with a screen your app already has (an `app/(tabs)/settings.tsx` serves `/settings` and is left alone). There is nothing to configure. Open the page from anywhere in your app:

```tsx
import { Link, router } from 'expo-router';
<Link href="/mobile-kit/settings">Settings</Link>   // or: router.push('/mobile-kit/settings')
```

`init` no longer edits your Drawer or Tabs: the floating button is the way in. `verify` only warns about a missing entry point when you turned the button off (`fab: false`, or `'dev'` for release builds) and nothing in your app links to the page.

**Upgrading from an older install.** Earlier versions wrote the pages to `app/settings.tsx` and `app/devices.tsx` (or a path you chose). Run `npx upande-mobile-kit init` again: it moves those files (only when they are exactly the kit's own one-line re-export, never a screen you wrote), backs them up, and removes the `settingsRoute` / `devicesRoute` lines that pointed at them from `src/mobile-kit.ts`. `doctor` and `verify` warn until you do. Update any link of yours from `/settings` to `/mobile-kit/settings`.

(For forks that insist on other paths, `init --settings-route /x --devices-route /y` writes the pages there. Only an existing file at the kit's own path stops `init`, and it names the file.)

## Wiring your app

Without `useAuth`, `api` and `storage` the kit runs on stand-ins: the Settings page looks fine, but **sign-out, the biometric switch and the device register are not connected to your session**. So `init` wires them as part of setup, and says what it wired and what is still a stand-in.

It looks for:

| It finds | And generates |
|---|---|
| a zustand-style `useAuthStore` (or a `useAuth` hook returning `roles` / `isSystemManager`) | `useAuth`: maps `roles` (`isSystemManager` = has "System Manager"), `fullName`, `email`, `instanceUrl`, `biometricEnabled` / `setBiometricEnabled`, `logout`, `forgetDevice` from the fields the store actually has |
| a module exporting `api` (in a file named like client / api / http) | `api: hostApi` (it must resolve to the response **body**) |
| a module exporting `storage` with `get` / `set` / `remove` | `storage: hostStorage` |

When it is not confident the wizard asks (the file and the exported hook name, or blank to skip). `--yes` never guesses: it skips and prints the stand-in warning. A store with neither `roles` nor `isSystemManager` is not wired (the kit could not tell who may open Devices). The generated adapter is plain TypeScript in `src/mobile-kit.ts` that you can edit. `init` leaves an existing `src/mobile-kit.ts` alone (use `--force` to regenerate it); `verify` tells you what is still on a stand-in.

## Who owns the biometric lock

If your app already locks itself (it uses `expo-local-authentication` or has its own lock screen), two locks would fight. `init` detects that, writes `biometric: 'host'` into `src/mobile-kit.ts`, and states in its summary which one owns the lock. With `biometric: 'host'` **your app owns the lock**: the kit adds no lock of its own and hides its biometric switch. With the default `biometric: 'kit'` the kit owns it (Settings has the switch and the kit's `Biometric.*` helpers do the prompt). `--biometric host|kit` forces either. `verify` warns when both exist.

## Reviewing what init changes

`init` is built to be reviewed in a normal diff:

- **The root layout edit is minimal.** It adds the import and wraps what the layout returns in `<MobileKitProvider>`; where the JSX already sits on its own lines, no existing line is re-indented or reformatted (one line before and one after). A layout it does not recognise is left alone, and the exact edit is printed.
- **Backups live outside `app/`**, in `.upande-mobile-kit/backup/<timestamp>/` (a `.bak` next to a layout would itself become a route). Every existing file `init` changes is copied there first: `app.json`, `package.json`, the layout, and a navigator it edits. Add `.upande-mobile-kit/` to `.gitignore` and delete it once you have reviewed the diff. `--no-backup` writes none.
- **The summary lists everything before it writes anything**: every file to create or edit, and the dependencies that will be **added** or may have their **versions changed** (`expo install` can bump `expo-constants` and friends). After the install it prints the actual diff (`+ added`, `~ old -> new`).

## Verify your setup

```bash
npx upande-mobile-kit verify [--site https://your.site] [--dev-site http://localhost:8000]
```

One line per check, `✓` fine, `!` look at it, `✗` broken, and every `!` / `✗` carries a one-line fix. Exit code 1 when anything is `✗`. It checks:

- `app.json`: the plugin entry, `expo.updates.url`, `runtimeVersion`;
- routes: both pages exist under `/mobile-kit/` and re-export the kit, nothing else serves those paths, no old kit pages remain at `/settings` or `/devices`, and something in your app **links** to the Settings page;
- `<MobileKitProvider>` in the root layout, and `src/mobile-kit.ts` imported **first**;
- config completeness: `useAuth` / `api` / `storage` are your app's own (or listed as stand-ins), and who owns the biometric lock;
- native modules are in `package.json` and installed, with the rebuild note;
- the sites answer on the OTA endpoint (a dev site that is down is only a warning), and a phone can actually reach them: **`http://` needs Android cleartext traffic and an iOS ATS exception**. The kit plugin enables cleartext for the hosts you list under `expo.extra.mobileKit.sites` (`init` writes that), or use `expo-build-properties` (`android.usesCleartextTraffic`) and `ios.infoPlist.NSAppTransportSecurity`. Changing these needs a new native build.

`doctor` stays as the quick check (it reports route problems too); `verify` is the superset.

### Plain HTTP sites (cleartext)

Android blocks plain `http://` traffic and iOS App Transport Security does too. When any site in `expo.extra.mobileKit.sites`, the `updates.url` or the plugin props is `http://`, the config plugin handles it at prebuild: Android gets `usesCleartextTraffic="true"`, and iOS gets an exception scoped to that host (IPs and localhost get `NSAllowsLocalNetworking`). It never sets the global "allow all HTTP" flag, and it prints what it enabled. An `http://` **production** site gets a loud warning, because release builds would then send traffic in clear text. Opt out with `["@upande/mobile-kit", { "cleartext": false }]` in `app.json`. This is native config, so it needs a new native build.

### What needs a native rebuild

An OTA update only replaces JavaScript. Native modules (`expo-device`, `expo-battery`, `expo-localization`, `expo-file-system`, `expo-network`, `expo-intent-launcher`, `expo-local-authentication`, AsyncStorage) and plugin entries need a **new native build**; `init` ends by listing what it added. Where a build lacks an optional module, Settings shows a "Not available in this build" card (for example "Battery info unavailable: rebuild required") instead of hiding the gap, and crash reports carry `missing_modules` so the dashboard shows it too.

### `.local` hostnames do not work on phones

A dev site addressed by an mDNS name (one ending in `.local`) resolves on your computer but **not from a phone or the Android emulator** (phones do not resolve mDNS names). Use your computer's LAN IP instead, `http://<your-lan-ip>:8000`, and make bench serve it: set bench's default site (`bench use <site>`, which sets `default_site`) so a request to the bare IP reaches your site, and start the bench listening on all interfaces. `verify` warns about any `.local` host. The IP is plain `http://`, so the cleartext settings above apply.

## How updates reach a phone

1. A merge to your release branch runs the workflow. It bumps the version one odometer step.
2. A **patch** (`1.2.3 → 1.2.4`) keeps the runtime: the JS bundle goes to GitHub Pages and every installed 1.2 APK picks it up the next time the app opens.
3. A **minor/major** (`1.2.9 → 1.3.0`) moves the runtime: the workflow builds an APK and attaches it to a GitHub Release.
4. The app checks GitHub once a day. Per the person's choice (Settings → *Download updates*: Wi-Fi only / any network / off; the default is Wi-Fi only) it downloads the new APK in the background, then asks **Install now**.

### What it cannot do

- **Android cannot install an APK silently.** Without device-owner rights, the system installer always asks the person to confirm. "Auto-install" therefore means: downloaded in the background, one tap to install. The first time, Android also asks to allow installs from this app.
- **APK updates are Android only.** On iOS the kit gives you OTA updates, biometrics, versions and the register; native updates there go through the App Store / TestFlight.
- **It needs a Frappe site.** The device register and the OTA manifest live in the `upande_mobile` Frappe app. (The APK check talks to GitHub directly and works without the site.)
- **Expo Go is a limited host.** It has no APK installs, ignores the config plugin (so no cleartext/ATS changes: use a development build for an `http://` site), cannot add native modules, and runs the app under its own identity, so the optional modules the kit reads (`expo-file-system`, AsyncStorage, `expo-intent-launcher`, `expo-local-authentication`, …) may be missing; Settings lists what is unavailable ("rebuild required") and crash reports carry `missing_modules`. Use a development build to see everything.
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
| `fab` | the floating Settings button: `true` (default), `false`, `'dev'` (development builds only) or `{ initialSide: 'left' \| 'right', bottom: 96 }` for where it starts. The person can drag it; the spot is remembered |
| `biometric` | `'kit'` (default: the kit owns the lock and shows the switch) or `'host'` (your app already locks itself: the kit adds no lock and hides its switch) |
| `useAuth` | `() => ({ isSystemManager, user, instanceUrl, biometricEnabled, setBiometricEnabled, logout?, forgetDevice?, fullName?, email? })` |
| `apk.autoDownload` | `'wifi'` (default), `'always'`, `'never'`; the person's Settings choice wins |
| `theme`, `ui` | colours / fonts, or swap `Screen`, `Card`, `Button`, `useToast`, `showDialog`, `useOnline` for your design system |
| `endpoints` | override `registerInstall`, `installs`, `versions`, `ingest` |
| `monitor` | crash & API monitoring options, see below |
| `serverApps` | which site apps to list on Settings, `[key, label][]` |
| `loginRoute`, `instanceKey`, `deviceKey`, `errorMessage`, `onAvatarLongPress`, `otaOpenWindowMs` | optional hooks. `settingsRoute` / `devicesRoute` exist but are rarely needed: the defaults (`/mobile-kit/settings`, `/mobile-kit/devices`) cannot collide |

Add your own rows without forking: `<SettingsScreen extraSections={…} profileExtra={…} />`.

Other exports: `useUpdatePrompt(active)` (an "Update available" dialog before downloading, for apps that prefer asking first), `Biometric.*` for your lock screen, `reportInstall`, `fetchInstalls`, `restartForInstance` / `consumeInstanceSwitched`, `checkForApk`, `downloadApk`, `launchInstaller`, `useApkUpdate`.

Development helpers: when `useAuth`, `api` or `storage` are not passed, the kit runs on stand-ins (the device register and sign-out are then **not** connected to your session). Dev builds log this once and show a "Dev notice" card on Settings; `getConfigGaps()` returns the list. In dev the kit also warns once if its page is open but another screen renders at that path. Other options: `biometric: 'host'` (your app owns the lock; the kit hides its switch and never prompts), and `foregroundReportMinMs` (at most one foreground device report per this many ms, default 30000, on top of the 15-minute throttle).

## Crash & API monitoring

Sentry-style reporting that lands on a dashboard in your Frappe site (`/mobile-monitor`, System Managers only, served by the `upande_mobile` app). It is **on by default**; the person can turn it off in Settings ("Send crash reports"), and `monitor: { enabled: false }` installs nothing.

**What is captured**

- every unhandled JavaScript error (a fatal one is queued and sent at once), unhandled promise rejections (also in development, where the kit sits in front of React Native's own tracker and still calls it, so LogBox keeps working), errors your app catches and logs with `console.error(err)` (see `captureConsoleErrors`), and render errors if you wrap the app in `<MonitorErrorBoundary>` (or set `monitor.errorBoundary`);
- every **failed** API call (status 400 and up, a network error or a timeout): method, URL, status, duration, request and response headers, request and response bodies. Successful calls are not sent unless you set `monitor.sampleSuccess` (then metadata only, no bodies);
- breadcrumbs: the last 30 screens and API calls, and optionally `console.warn` / `console.error`;
- the device: platform, OS version and build, brand and model, battery level and state, low-power mode, free and total storage, memory, network type and reachability, locale, time zone, screen size, orientation, app state, colour scheme, JS engine, build type (embedded / OTA / dev), and app, runtime and update ids. The optional native modules `expo-device`, `expo-battery`, `expo-network` and `expo-localization` add fields when installed; without them the field is simply left out (`npx upande-mobile-kit doctor` tells you which);
- the signed-in user the host's `useAuth` reports: id, full name and roles.

**Caught-and-logged errors.** Apps often `try { … } catch (e) { console.error(e) }`. Those never reach the global handler, so the kit also reports `console.error` calls that carry an Error (or an error-like object with a name or stack); a leading string such as `console.error('Could not load orders', err)` rides along as context. Plain strings, React render warnings and non-error objects are never reported. The same error object is reported once however many places log it. Turn it off with `monitor: { captureConsoleErrors: false }`.

**Noise you do not want.** Everything failed is captured on purpose, including calls the platform itself makes. If one is not interesting, ignore it by URL: `monitor: { ignoreUrls: ['exp.host/--/api/v2/push', /\/healthz$/] }`. (In Expo Go the push-token request to `exp.host` fails every launch; that is the example above.)

**Device health.** Every device report (on launch, on sign-in and at most every 15 minutes when the app returns to the foreground) also carries the full device snapshot, so the Devices view shows battery, storage, memory, network, locale, screen, build and missing modules for every phone, not only ones that crashed. The probes get one second; whatever has not answered by then is left out rather than delaying the report. The device name is sent when `expo-device` is installed.

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
- reports need a signed-in session; events raised before sign-in wait and are sent after;
- the first send after a launch waits (up to 5 s) for the launch device registration, so a server that creates an app record from the registration already has it; a fatal error never waits;
- when the server answers `paused` (monitoring switched off, or the app is not set up there yet) the events stay in the queue and are retried later; a reply that took nothing and did not say paused means the events themselves were bad, and they are dropped.

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
npx upande-mobile-kit verify [--site https://your.site] [--dev-site http://localhost:8000]
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

Users then run `npm install github:mark-judah/upande-mobile-kit#v0.7.0`. To update, they change the tag. Bump `version` in `package.json` before each tag so it matches.

Notes: a GitHub install has no registry listing, download counts or integrity record beyond the git commit, so pin a tag (or a commit hash), never a branch. `npx upande-mobile-kit …` works after the install because the command is linked into `node_modules/.bin`.

`check:pack` also reads `KIT_DENY_PATTERNS` (regexes separated by `;`) for names that must never ship, so those names never have to be written into this public repo.

The package ships TypeScript source (Metro compiles it).
