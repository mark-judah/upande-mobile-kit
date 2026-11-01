/**
 * Describes this app to @upande/mobile-kit. Imported once, first thing, by
 * app/_layout.tsx. Written by `npx upande-mobile-kit init`.
 *
 * With only these three values the kit uses `fetch` against the site, its own
 * storage and a local biometric switch. If the app already has a Frappe client,
 * storage and sign-in, pass them in (commented below) so the Devices screen,
 * the install register and Sign out use the real session.
 */
import { configureMobileKit } from '@upande/mobile-kit';

configureMobileKit({
  appName: '__APP_NAME__', // the "Mobile App" record on the server
  githubRepo: '__GITHUB_REPO__', // owner/repo that publishes the GitHub Releases (APKs)
  site: __SITE_VALUE__,
__SITE_NOTE__  // apk: { autoDownload: 'wifi' }, // 'wifi' (default) | 'always' | 'never'
  //
  // Crash & API monitoring is ON by default. The person can turn it off in Settings. Defaults shown:
  // monitor: {
  //   enabled: true,            // false installs nothing
  //   captureBodies: true,      // request/response bodies of FAILED calls (secrets redacted, capped)
  //   maxBodyBytes: 8192,
  //   redactKeys: [],           // extra key names to hide, on top of password/token/authorization/cookie/...
  //   ignoreUrls: [],           // strings or RegExps never recorded
  //   sampleSuccess: 0,         // 0-1: share of successful calls recorded (metadata only)
  //   breadcrumbs: 30,
  //   consoleBreadcrumbs: false,
  //   errorBoundary: false,     // true wraps the app in <MonitorErrorBoundary>
  //   showToggle: true,         // the "Send crash reports" row in Settings
  // },
  //
  // Use the app's own session instead of the built-in stand-ins:
  // api,        // (req) => Promise<response body>; sends the signed-in user's session
  // storage,    // { get, set, remove }
  // useAuth: () => ({ isSystemManager, user, instanceUrl, biometricEnabled,
  //                   setBiometricEnabled, logout, forgetDevice, fullName, email }),
  // theme: { primary: '#...' },
});
