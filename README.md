# @upande/mobile-kit

Updates, device management, monitoring and support for Expo apps, backed by a Frappe site. Push your code and GitHub Actions ships it to phones, as an over-the-air update or a new APK, with no Expo (EAS) account. Installed from this GitHub repository by tag. The backend is [`upande_mobile`](https://github.com/mark-judah/upande-mobile).

**Needs:** an Expo SDK 54+ app using expo-router, Node 20+, npm with a committed `package-lock.json`, a Frappe 16 site, and a public GitHub repository for the app. Android only.

## Do this once

Everything you must do is on this page. Skip a step and something silently does not work, so the last column says how to check each one.

### A. On the Frappe server (once per site)

```bash
bench get-app https://github.com/mark-judah/upande-mobile
bench --site your.site install-app upande_mobile
bench build --app upande_mobile
bench --site your.site migrate
bench restart
```

Then register the app (the wizard in step B prints this line with your values filled in):

```bash
bench --site your.site execute upande_mobile.api.register_app --kwargs \
  '{"app_name": "My App", "github_repo": "owner/my-app", "ota_base_url": "https://<owner>.github.io/<repo>/ota", "enabled": 1}'
```

Add the people who look after the apps to the **IT Team** role profile in Desk. Only they can open the [IT dashboard](docs/features.md#the-it-dashboard).

### B. In your app (once per app)

```bash
npm install github:mark-judah/upande-mobile-kit#v0.18.0   # or the newest tag on the Releases page
npx upande-mobile-kit init
git add -A && git commit -m "feat: add the mobile kit" && git push
```

`init` asks a few questions and does the rest: it writes the settings and Devices pages, the config file and both workflows, edits `app.json`, `package.json` and your root layout, and installs the native modules. [Details](docs/setup.md#2-install-the-kit-and-run-the-wizard).

### C. In the GitHub repository (Settings): the steps people forget

| # | Turn on | Where | If you skip it | How to check |
|---|---|---|---|---|
| 1 | **Read and write permissions**, and **Allow GitHub Actions to create and approve pull requests** | Settings > Actions > General > Workflow permissions | Releases cannot push their version commit and tag, and **kit upgrades never open their pull request** | Run **Actions > Upgrade the kit > Run workflow**. A red "not permitted to create or approve pull requests" means it is off |
| 2 | **GitHub Pages** from branch `gh-pages`, folder `/ (root)` (after the first push has created the branch) | Settings > Pages | OTA bundles are served from a fallback address instead of Pages | Open `https://<owner>.github.io/<repo>/ota/android/<runtime>/manifest.json`. A 404 means it is off |
| 3 | **A public repository** (or at least public releases) | Settings > General > Danger zone | Phones get **no APK offers** and no OTA | Open the repo's Releases page in a private browser window |
| 4 | **Allow all actions** | Settings > Actions > General > Actions permissions | The workflows do not run | The Actions tab shows runs after a push |
| 5 | **Signing key** (recommended): the four `ANDROID_KEY*` secrets | Settings > Secrets and variables > Actions | The APK is signed with Android's public debug key. Switching to a real key later forces every phone to uninstall first | The run summary says which key signed the APK. [How to create one](docs/setup.md#4-set-up-github-then-make-the-first-release-an-apk) |
| 6 | **Let `github-actions[bot]` push** to the release branch, if it requires pull requests | Settings > Branches | The release cannot commit the version bump | A failed run at "push" |
| 7 | **`KIT_UPGRADE_TOKEN`** (optional) | Settings > Secrets and variables > Actions | Upgrade pull requests change the kit but not the workflow files | The pull request says whether the workflow pins were moved |

### D. Make the first release an APK

No phone has the kit yet, so the first release must be a native build. **Actions > Release > Run workflow**, tick **build_apk**, run it (about 14 minutes). Download the APK from the new GitHub Release and install it once. From then on every update reaches phones by itself.

**You are done when** the app shows a Settings button, Settings lists the app, kit and server versions, and a later push reaches the phone the next time the app opens.

## Day to day

| I want to | Do this |
|---|---|
| **Update the app** (screens, logic, fixes) | Commit and push. Phones get it the next time the app opens. That is all |
| **I changed native code** (added a package, plugin or permission, changed the icon) | Commit and push, the same. The release notices the native change by itself, builds a new APK on a new runtime (`1.2.8` becomes `1.3.0`) and says why in the run summary and the Release title. Phones download the APK in the background and ask to install it. If it said OTA and you know it needs an APK, add `[native]` to the commit message. If you added a file or folder the kit does not know, list it in `app.json` ([how](docs/releasing.md#how-it-decides-ota-or-apk)) |
| **The kit has an update** | A pull request named `chore: update @upande/mobile-kit to vX.Y.Z` opens by itself (Mondays, or press **Run workflow** on **Upgrade the kit**). Read it and **merge it**. The release that follows decides APK or OTA. If no pull request ever appears, step C1 is off |
| **Get an APK now**, with no code change | **Actions > Release > Run workflow**, tick **build_apk** |
| **See what a push will do**, before pushing | Commit, then `npx upande-mobile-kit version` |
| **Undo a bad update** | Revert the commit and push. The next release publishes the old code as a new version |
| **Release an exact version** | **Actions > Release > Run workflow**, fill **set_version** |
| **Find out who is behind** | The [IT dashboard](docs/features.md#the-it-dashboard) at `https://your.site/it-dashboard`, or the in-app [Devices page](docs/features.md#the-devices-page) |

You never choose OTA or APK yourself, and you never bump a version. Commit markers (`[apk]`, `[native]`, `[major]`, `[ota]`) only force an outcome; [what they do](docs/releasing.md#commit-messages).

## When it does not work

| Symptom | Check first |
|---|---|
| A push produced no release | The change only touched `*.md` or `docs/`. Or the workflow is disabled (C4). Or the run failed: open **Actions** |
| A release built no APK and you expected one | Read the reason in the run summary. Native change in a file the kit does not know: list it in `app.json`, or add `[apk]` to a commit |
| A release built an APK you did not expect | The reason names the file or package. A file in no list builds an APK to be safe; list it under `release.ota` |
| Phones get no update | The app is not registered on the server (A), the repo is private (C3), or the runtime does not match. Run `npx upande-mobile-kit verify --site <production>` |
| The APK will not install ("package appears to be invalid") | It is signed with a different key than the installed app. Sign every release with one key (C5), or uninstall once and install fresh |
| No upgrade pull request | C1 is off |
| Tapping Install does nothing | The installed build predates kit 0.17: use **Download in your browser instead**, then install |

More in [Troubleshooting](docs/troubleshooting.md).

## What the kit gives your app

| Area | Features |
|---|---|
| **Updates** | [OTA updates](docs/features.md#ota-updates) when the app opens · [APK updates](docs/features.md#apk-updates) that download in the background · [forced install](docs/features.md#forced-install) · a [progress ring](docs/features.md#progress-ring) |
| **Settings and sign-in** | [Settings page](docs/features.md#the-settings-page) · [floating button](docs/features.md#the-floating-button) · [version information](docs/features.md#version-information) · [fingerprint unlock](docs/features.md#fingerprint-unlock) · [sign-in vault](docs/features.md#fingerprint-sign-in-vault) · [silent re-login](docs/features.md#silent-re-login) |
| **Fleet and monitoring** | [Devices page](docs/features.md#the-devices-page) · [crash and API monitoring](docs/features.md#crash-and-api-monitoring) · [network and performance](docs/features.md#network-and-performance) · [device identifiers](docs/features.md#device-identifiers) · [IT dashboard](docs/features.md#the-it-dashboard) |
| **Help and support** | [Report a problem](docs/features.md#report-a-problem) · [My reports and chat](docs/features.md#my-reports-and-chat-with-support) · [reply notifications](docs/features.md#reply-notifications) · [connection banner](docs/features.md#connection-banner) |

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

## More

| Page | What is in it |
|---|---|
| [Setting up an app](docs/setup.md) | The wizard, every file it writes, local and production sites, signing the APK |
| [Shipping updates](docs/releasing.md) | How OTA or APK is decided, commit markers, running a release by hand, failures, upgrading the kit |
| [What the kit does in the app](docs/features.md) | Every page and tool |
| [Configuration](docs/configuration.md) | Every setting, native modules, the command line |
| [Troubleshooting, security and privacy](docs/troubleshooting.md) | Symptom to fix; what is stored and who can read it |
| [For maintainers](docs/maintainers.md) | Releasing the kit itself |

## License

MIT
