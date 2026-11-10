# What the kit does in the app

Every page and tool the kit adds to your app, and how each behaves.

## The Settings page

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

## The floating button

A small translucent button opens Settings from any screen. It hides on the kit's own pages and while the keyboard is open, and, when your own `useAuth` is wired, before anyone has signed in (your sign-in gate would send the page straight back to login). It shows a [progress ring](#progress-ring) while an update downloads.

- **Moving it.** Press the button and drag: it follows your finger, snaps to the nearest screen edge and stays where you leave it, so move it clear of whatever it covers. A tap opens Settings; a long press opens [Report a problem](#report-a-problem).
- **Options.** `fab: false` removes it (open the page yourself with `openKitSettings()`, `<KitSettingsButton />` or `router.push('/mobile-kit/settings')`). `fab: 'dev'` shows it in development builds only. `fab: { initialSide: 'left', bottom: 96, whenSignedOut: true }` sets where it starts and when it shows.

## Version information

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

## Updates on the phone

### OTA updates

On open, the app checks for an over-the-air bundle. If one downloads in the first 20 seconds the app restarts into it; a later download waits for the next opening, so the app never restarts under someone mid-task (`otaOpenWindowMs`).

Handhelds are rarely restarted, so the app also looks again every time it returns to the foreground (at most once every 10 minutes, `foregroundUpdateCheckMinMs`) and every 15 minutes while it stays open, for a new APK and a new bundle. The APK check asks GitHub with the last ETag, so "nothing new" is a free `304` that does not count against GitHub's rate limit. A bundle found this way is downloaded and the person is **asked**: **Restart now** or **Later**. It is never applied behind their back, and each bundle is offered once. Turn it off with `otaOnForeground: false`. OTA bundles carry JavaScript only; native changes need an [APK](#apk-updates).

### APK updates

- **Check for updates** (App & Server) checks GitHub Releases for a new APK first, because a new APK carries a new runtime and supersedes any OTA bundle. If the APK is current it asks for an OTA bundle. When an APK is available the same button reads **Download v1.3.0 (size)**, then **Install v1.3.0**.
- **Download updates** is a choice under that button: **Wi-Fi only** (default), **Any network** or **Off**. The user's choice wins over `apk.autoDownload`. Once a day, and whenever the app returns to the foreground, it checks GitHub Releases; a newer APK downloads by itself in the background. A download skipped on mobile data starts when the app is next opened on Wi-Fi. A finished download is kept, so a cancelled installer can be reopened without downloading again. A dropped connection resumes where it stopped.
- **Android cannot install an APK silently.** The person always confirms in Android's installer, and the first time Android also asks to allow installs from this app.

### Forced install

Once a newer APK is on the phone, an **Update required** dialog covers the whole app with one button, **Install now**; the Android back button does nothing. If the person cancels Android's installer they land on the dialog again. If Android has not yet allowed installs from this app, the dialog offers a shortcut to that setting. If the installer closes without installing (or never appears), the dialog says so and keeps **Download in your browser instead** one tap away, so the person is never stuck. On by default; `apk: { force: false }` gives a softer **Install now / Later** prompt that asks again next time.

**The install permission.** Opening Android's installer needs `android.permission.REQUEST_INSTALL_PACKAGES` in the manifest. Without it Android 8+ never offers the "Install unknown apps" switch and tapping Install does nothing, with no error. The config plugin adds it for you (`{ "installPermission": false }` opts out). It is a manifest entry, so it reaches a phone only with a **new APK**; until then an older build can update only through the browser button.

### Progress ring

While an APK or an OTA bundle downloads, a ring of dots appears around the [floating button](#the-floating-button). For an APK the dots light up clockwise with the real progress; an OTA bundle has no known size, so a short arc travels around the ring. The Settings page shows the same progress as text and as a bar in the update card.

## Fingerprint unlock

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

## Fingerprint sign-in vault

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

## Silent re-login

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

## The Devices page

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

## Crash and API monitoring

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

## Network and performance

Every report and device snapshot carries how the network treats the app:

- **Connection type**, and whether the phone is online and the internet reachable.
- **Latency to your server:** a tiny `GET /api/method/ping`, at most once a minute, in the background.
- **How long the app's own calls take:** count, average and 95th-percentile response time and the share that failed, over the last 100 calls.
- **Wi-Fi details** with `@react-native-community/netinfo` in the build: the Wi-Fi name, signal strength, link speed and band, and the cellular generation. Android shows the Wi-Fi name only when the app holds the location permission; without it that field is left out.

Nothing here is a speed test: link speed is what the radio negotiated, and latency and response times are measured from real use. To keep the Wi-Fi name out of your data, leave netinfo out.

## Device identifiers

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

## The IT dashboard

Reports from your apps land on a web page the backend serves: **`https://your.site/it-dashboard`** (the old `/mobile-monitor` address redirects there).

- **Who can open it:** people on the **IT Team** role profile, and no one else. Anyone without it gets a page saying they cannot access the dashboard. Sign in to your Frappe site, then open the address; it has no Frappe menu entry, so bookmark it.
- **What you get:** an overview (events per day, top issues, app versions, device models and OS versions, fleet health); every crash, error and failed API request grouped into issues, with the stack, request and response (secrets removed), breadcrumbs, device and user, and Resolve/Ignore; a Devices view with filters for low battery, low storage, offline, old OS and old app, and each device's timeline with its Wi-Fi, latency, kit version and Device ID; a **Support** inbox for [problem reports and chat](#help-and-support); and an **Apps** page per app. The dashboard also manages users, roles, doctype permissions and user permissions for the IT team, without System Manager.
- **What it needs:** the backend installed with `bench build --app upande_mobile` run once, the app registered on that site, and the app signed in so it can send reports.

The dashboard is for you; the Settings page is for your users. The [backend README](https://github.com/mark-judah/upande-mobile#the-web-portal) describes it in full.

## Help and support

The **Help** card in Settings has **Report a problem** and **My reports** / **Ask support** (**Chat with support** on a site without Issues). Each can be turned off: `support: false`, `support: { chat: false }`. They need the backend (`upande_mobile` 0.2.0 or newer, then `bench migrate`).

### Report a problem

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

### My reports and chat with support

On a site with Issue, a conversation **is an Issue**, the way your support team already works:

- **My reports** (Settings > Help) says how many reports are open and how many have a new reply, and lists the person's own Issues for this app, newest first, each with a status chip (Open, Replied, Resolved, Closed), when it last moved, and a dot when support has answered since they last looked. **Ask support** starts a new conversation.
- **A conversation** is one timeline: a status header, what they wrote, every comment on the Issue (support's marked with the time), and every **change of status** as a line between messages. **Support replies by adding a Comment on the Issue in Desk**, and the answer appears in the app within seconds while it is open. (The status history needs `upande_mobile` 0.5.0 or newer; an older backend still shows the messages.)
- **The person answers** in the app; that becomes a Comment on the same Issue, and an Issue that was Replied or Resolved goes back to Open. A Closed conversation cannot be replied to; the person starts a new one.
- **New message** starts a conversation: a subject and a first message, filed as an Issue (with diagnostics, without a screenshot).

On a site without Issue the kit falls back to a single chat thread with support, answered from the dashboard's Support page. Only the person's own Issues are shown, and only replies they have not yet seen count as unread.

### Reply notifications

When support answers, the person's phone gets a push notification, and tapping it opens that conversation. Settings > Help has a **Notify me about replies** switch (they are also asked once, in words, after their first message); it appears only in a build that can receive notifications.

The phone registers its Expo push token with your site (`register_push`), kept per person and app. When your team adds a **Comment** to the person's Issue, the site sends the push through Expo's push service (nothing else is contacted). A token Expo reports as gone is deleted; signing out forgets the phone's token. The kit never changes how your app's own notifications are shown.

What the app needs, once (all standard Expo):

| Requirement | How |
|---|---|
| `expo-notifications` in the build | `npx expo install expo-notifications`, add `"expo-notifications"` to `plugins` in `app.json`, then a new native build |
| An Expo project id | `expo.extra.eas.projectId` in `app.json` (a free Expo account is enough), or `push: { projectId }` in the kit config |
| Firebase on Android | `android.googleServicesFile` pointing at your `google-services.json`, and the Firebase (FCM v1) credentials uploaded to your Expo project |

`push: false` turns it off. Without the requirements the switch does not appear.

### Last crash capture

Unhandled errors and render errors are saved on the phone, so a report filed after a black screen or restart still carries what broke. The crash is sent only inside a report the person chooses to send, then forgotten.

### Connection banner

A banner appears when the phone has been offline for 25 seconds, when the last round trip to your server took 3 seconds or more, or **at once when the server answers 503 or 502**, which is what a deployment looks like from the phone: *"The system is being updated right now. Please try again shortly."* with a **Try again** button. While it shows, the kit asks the server every few seconds and the banner goes the moment it answers normally.

**It does not trust Android alone.** Some handhelds (the Honeywell EDA52, for one) keep reporting "connected" after the Wi-Fi radio has stopped carrying data. After **two requests to your server in a row that never got an answer**, the phone counts as offline whatever Android says, and the kit probes the server every few seconds so a single answer clears it. Only your own server counts. It has a **Wi-Fi settings** shortcut, because an app cannot switch Wi-Fi itself on modern Android. Tune it with `connectionBanner: { staleAfterSec: 25, slowMs: 3000 }` or turn it off with `connectionBanner: false`.
