# Setting up an app in detail

The short checklist is in the [README](../README.md#do-this-once). This page has every detail: the wizard, what it writes, the GitHub settings and the signing key.

Four steps, once per app. The wizard does most of the work.

## 1. Install the backend on your Frappe site

On the server (or on your own bench for development):

```bash
bench get-app https://github.com/mark-judah/upande-mobile
bench --site your.site install-app upande_mobile
bench build --app upande_mobile
bench --site your.site migrate
bench restart
```

The wizard in step 2 can do this for a bench on your own machine. Production is always yours to run. See the [backend README](https://github.com/mark-judah/upande-mobile#readme).

## 2. Install the kit and run the wizard

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
| Separate public repo for the releases | only off `main`/`master`, or when one is already set | Blank, or `owner/repo` of a public [releases repository](releasing.md#private-source-and-one-app-per-branch) for a private source repo or one app per branch |
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

## 3. Commit and push

```bash
git add -A
git commit -m "feat: add the mobile kit"
git push
```

`init` adds `upande-mobile-kit.json` (it holds a path on your machine) and `.upande-mobile-kit/` to `.gitignore`, so `git add -A` is safe. If either was already committed, run `git rm --cached upande-mobile-kit.json`.

The push starts the release workflow, which creates the `gh-pages` branch.

## 4. Set up GitHub, then make the first release an APK

Once per repository:

1. **Actions.** Enable workflows in the **Actions** tab. Under **Settings > Actions > General > Actions permissions**, allow all actions (the workflow uses `actions/*`, `peaceiris/actions-gh-pages`, `softprops/action-gh-release`, `gradle/actions`, `android-actions/setup-android` and `peter-evans/create-pull-request`). If your organisation restricts actions to a list, add those.
2. **Workflow permissions.** **Settings > Actions > General > Workflow permissions > Read and write permissions**, and tick **Allow GitHub Actions to create and approve pull requests** (the [kit upgrade](releasing.md#upgrading-the-kit) needs it). Save.
3. **Public releases.** Keep the repo, or at least its releases, public. Phones check `api.github.com` for new APKs without logging in, and your Frappe site reads the OTA files from public URLs. A private repo gets no APK offers. If the source must stay private, or you keep one app per branch, publish to a separate public repo instead: see [Private source and one app per branch](releasing.md#private-source-and-one-app-per-branch). Steps 3 and 4 then apply to that repo, and you add the `RELEASE_REPO_TOKEN` secret here.
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
7. **Optional: `KIT_UPGRADE_TOKEN`.** See [Upgrading the kit](releasing.md#upgrading-the-kit).

**The first release must be an APK**, because no phone has the kit yet. In your repo go to **Actions > Release > Run workflow**, tick **build_apk** (or set `bump` to `minor`) and run it. Download the APK from the new GitHub Release, install it once, and from then on every update reaches the phone by itself. `init` sets `runtimeVersion` from your current version (`1.0.0` gives `1.0`).

## Local and production sites

Dev builds (`__DEV__`: Metro, dev clients) use the dev site. Release builds and OTA use the production site. `init` writes both:

```ts
site: { production: 'https://your.site', development: 'http://localhost:8000' },
```

Without a development site every build uses production. Pin one with `environment: 'production'` or `'development'`.

- `localhost` works in the iOS simulator. The Android emulator needs `http://10.0.2.2:<port>`. A real phone needs your computer's LAN address, and a bench listening on it.
- Names ending in `.local` do not resolve from phones or the Android emulator. Use the LAN IP and make the bench answer on it (`bench use <site>` sets the default site).
- A plain `http://` site needs Android cleartext traffic and an iOS App Transport Security exception. The config plugin sets both for the hosts under `expo.extra.mobileKit.sites`, never the global "allow all HTTP" flag, and warns at prebuild. An `http://` production site gets a loud warning. Opt out with `["@upande/mobile-kit", { "cleartext": false }]`. This is native configuration, so it needs a new native build.
