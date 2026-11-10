# Troubleshooting, security and privacy

Find the symptom, read the fix.

## Troubleshooting

**Releases and updates**

| Symptom | Cause | Fix |
|---|---|---|
| A release has no APK | Nothing in it needed one: no native dependency, plugin, patch or `apk`-listed file changed, and every changed file is JS-only | Read the reason in the run summary. If a file should have needed an APK, add it to `release.apk` in `app.json`. Otherwise `[apk]` in a commit message, `build_apk` on a manual run, or `bump: minor` |
| A release built an APK you did not expect | A changed file is in neither list, or a native package changed | The reason names the file or package. List the file under `release.ota` if it is safe over the air |
| `Run workflow` has no `build_apk` box | The workflow file is from an older kit | `npx upande-mobile-kit init --update-workflow`, commit and push |
| The upgrade pull request is not opened | "Allow GitHub Actions to create and approve pull requests" is off | Turn it on, then run **Upgrade the kit** by hand |
| The upgrade pull request did not move the workflow pins | No `KIT_UPGRADE_TOKEN` secret (the built-in token cannot edit workflow files) | Add the secret, or run `init --update-workflow` once |
| The release stops at "Check the release repository" | `release-repo` is set but `RELEASE_REPO_TOKEN` is missing, does not include that repo, or lacks Contents write | The error names which. Save the token in the source repo (not the releases repo); see [Private source and one app per branch](releasing.md#private-source-and-one-app-per-branch) |
| A client's phone is offered another client's APK | Several branches of one repo publish to the same Releases | Give each branch its own releases repo: `init --release-repo` on that branch |
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
| No notification when support replies | Not turned on; the build lacks `expo-notifications`; no Expo project id or Firebase credentials; the reply was not a **Comment**; or the site has push off (`upande_mobile_push: 0`) | Check Settings > Help > Notify me about replies and the [requirements](features.md#reply-notifications) |
| The "Notify me about replies" switch is missing | The build cannot receive notifications, or `push: false` | `npx expo install expo-notifications`, add the plugin, make a new native build |
| The person is thrown to the login screen when the session expires | No silent re-login | Turn on the [vault](features.md#fingerprint-sign-in-vault) and set `sessionRecovery.login` |
| The fingerprint switch says "Needs a newer build" | `expo-secure-store` is not in the running build | `npx expo install expo-secure-store`, then a new native build |
| The banner says the connection is slow | The last round trip took 3 seconds or more | Check the network; raise `connectionBanner.slowMs` or turn it off |
| The offline banner never appears on one handheld model | An older kit trusted Android's "connected" | Update the kit |
| "Upande Mobile Kit (server)" says "not installed" | The site does not have the `upande_mobile` app | Install the backend ([step 1](setup.md#1-install-the-backend-on-your-frappe-site)) |
| `.local` site unreachable from the phone | Phones do not resolve `.local` names | Use your computer's LAN IP |
| `http://` site blocked | Cleartext not enabled in the native build | List the site under `expo.extra.mobileKit.sites` and make a new native build |
| Expo Go ignores part of the setup | Expo Go does not run config plugins or add native modules | Use a development build |

## Security and privacy

- This package is public. Nothing secret belongs in it or in `src/mobile-kit.ts`.
- Reports go only to your own Frappe site. Both the phone and the server redact secrets before they are stored ([Privacy](features.md#crash-and-api-monitoring)).
- Device facts reported with each snapshot include the build number and the phone's own IP address, and, when the phone or your app supplies them, the MAC address and serial number. The Wi-Fi name (only with netinfo and the location permission), signal and speed are stored with the device's health. Leave `@react-native-community/netinfo` out if you do not want them.
- The Android ID is stored only as a hash. The server also records the IP address it sees. It never records location.
- A problem report contains what the person typed, an optional screenshot of their screen (it may show anything that was on it) and the diagnostics listed in the sheet, which the person sees before sending. Reports and chat messages are readable by System Managers only.
- The fingerprint vault keeps the sign-in in the phone's secure storage and nowhere else.
- The device register is readable by System Managers; the IT dashboard only by the IT Team role profile.
- The kit's own calls to GitHub are unauthenticated. GitHub allows 60 per hour per IP address. Each phone checks every 15 minutes with a conditional request (an unchanged answer is a `304` that GitHub does not count).
