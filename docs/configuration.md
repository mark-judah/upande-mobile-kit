# Configuration and reference

Every setting, the native modules, and the one command.

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

Release settings (offsets, the `apk` and `ota` lists) live in `app.json` under `expo.extra.mobileKit`, not here; see [Shipping updates](releasing.md).

**Identity and connection**

| Key | Default | Meaning |
|---|---|---|
| `appName` | required | The Mobile App name on the server and the app's title |
| `githubRepo` | required | `owner/repo` whose Releases carry the APKs: the app's repo, or its [releases repository](releasing.md#private-source-and-one-app-per-branch) |
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
| `biometric` | `'kit'` | `'kit'`, `'host'` or `'vault'` ([Fingerprint unlock](features.md#fingerprint-unlock)) |
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
| `react-native-view-shot` | The screenshot in [Report a problem](features.md#report-a-problem) |
| `expo-notifications` | [Reply notifications](features.md#reply-notifications) (also needs an Expo project id and, on Android, Firebase) |
| `expo-secure-store` | The [fingerprint sign-in vault](features.md#fingerprint-sign-in-vault) |
| `@react-native-community/netinfo` | Wi-Fi name, signal, link speed and band ([Network and performance](features.md#network-and-performance)) and the phone's own IP address |
| `react-native-device-info` | The MAC address and serial number, where the phone allows ([Device identifiers](features.md#device-identifiers)) |

## Command line

There is one command to know, and you run it once per app:

| Command | What it does |
|---|---|
| `npx upande-mobile-kit init` | The setup wizard (flags below) |

Everything else is automatic: pushes release by themselves, and a pull request upgrades the kit. Settings live in `app.json` under `expo.extra.mobileKit`. The remaining commands exist for the workflows and for repair, not for day-to-day use: `fix` (install missing native modules; `--dry-run`, `--align`, `--yes`), `verify` and `doctor` (self-tests), `version` (plan a version bump; run with no flags to [preview a release](releasing.md#preview-a-release-before-you-push)), `publish-ota` (build the OTA bundle) and, in the kit's own repository only, `release`.

`init` with no value flags runs the wizard; any value flag runs the plain, non-interactive version.

| Flag | Meaning |
|---|---|
| `--yes` | Ask nothing: use remembered answers, detected values and flags. The production site must come from `--site` or a remembered answer |
| `--no-install` | Run no commands; print them. The setup is incomplete until you run `fix` |
| `--site URL`, `--dev-site URL` | Production and development sites |
| `--bench PATH`, `--bench-site NAME` | Install the backend on this bench and site |
| `--name "My App"` | Mobile App name (default `expo.name`) |
| `--repo owner/repo` | The app's source repo on GitHub (default: git origin) |
| `--release-repo owner/repo` | Publish releases, APKs and OTA bundles to this separate public repo ([Private source and one app per branch](#private-source-and-one-app-per-branch)). `''` removes it |
| `--ota-base-url URL` | Where bundles are served (default: the GitHub Pages `ota` folder of the releases repo, else of the repo) |
| `--apk-name my_app` | APK file name stem (default: your app name in snake case) |
| `--branch main` | Release branch (default: the current branch) |
| `--biometric host\|kit` | Who owns the biometric lock (default: detected) |
| `--backend-repo URL`, `--kit-repo owner/repo` | For forks of the backend or the kit |
| `--no-adapters` | Do not look for your auth store, API client and storage |
| `--update-workflow` | Rewrite only the workflow files to the installed kit's version (adding `upgrade-kit.yml` if missing), keeping app name, APK name, branch and `release-repo` |
| `--no-backup` | Do not copy changed files into `.upande-mobile-kit/backup/` |
| `--force` | Overwrite files that exist |
| `--settings-route PATH`, `--devices-route PATH` | Rarely needed: other paths for the kit's pages |

Without a terminal and without `--yes`, `init` stops and lists the flags to pass:

```bash
npx upande-mobile-kit init --yes --site https://your.site --dev-site http://localhost:8000 --bench /path/to/bench --bench-site my.site
```

## Private source and one app per branch

A private source repo, or one repo with a branch per client, publishes to a separate **public releases repository** per app and branch. In short:

1. Create a public repo, for example `owner/my-app-mutara-releases`, with a README.
2. Create a fine-grained token with **Contents: Read and write** on only that repo.
3. Save it in the source repo as the Actions secret `RELEASE_REPO_TOKEN`.
4. On the branch, run `npx upande-mobile-kit init --release-repo owner/my-app-mutara-releases`, run the `register_app` line it prints on the server, commit and push.
5. After the first release, turn on Pages for `gh-pages` in the releases repo.

`init` writes the releases repo into `githubRepo`, `extra.otaBaseUrl` and the `release-repo` input of `.github/workflows/release.yml` (remembered in `upande-mobile-kit.json`). Tags in the source repo become `<branch>/v<version>`. The details are in [Shipping updates](releasing.md#private-source-and-one-app-per-branch).
