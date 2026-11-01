/**
 * Describes this app to @upande/mobile-kit. Imported once, first thing, by
 * app/_layout.tsx. Written by `npx upande-mobile-kit init`.
 *
 * `useAuth`, `api` and `storage` should be the app's OWN (init wires them when it
 * can find them): on the kit's stand-ins the Settings page looks fine, but
 * sign-out, the biometric switch and the device register are not connected to
 * the real session.
 */
import { configureMobileKit } from '@upande/mobile-kit';__ADAPTER_IMPORTS__

configureMobileKit({
  appName: '__APP_NAME__', // the "Mobile App" record on the server
  githubRepo: '__GITHUB_REPO__', // owner/repo that publishes the GitHub Releases (APKs)
  site: __SITE_VALUE__,
__SITE_NOTE____ROUTES____BIOMETRIC__  // apk: { autoDownload: 'wifi' }, // 'wifi' (default) | 'always' | 'never'
  // fab: true, // the floating Settings button: true (default) | false | 'dev' | { initialSide: 'left', bottom: 96 }
  //
  // Crash & API monitoring is ON by default. The person can turn it off in Settings. Defaults shown:
  // monitor: {
  //   enabled: true,            // false installs nothing
  //   captureConsoleErrors: true, // console.error(err) calls that carry an Error
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
__HOST_BLOCK__});
