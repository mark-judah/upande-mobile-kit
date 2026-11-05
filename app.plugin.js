/**
 * Expo config plugin entry — add to app.json:
 *
 *   "plugins": [
 *     ["@upande/mobile-kit", {
 *       "manifestUrl": "https://<site>/api/method/upande_mobile.api.ota.manifest?app=<App Name>",
 *       "otaBaseUrl": "https://<static-host>/<path>/ota"
 *     }]
 *   ]
 *
 * Applies: the REQUEST_INSTALL_PACKAGES permission the in-app APK installer needs (`"installPermission": false` opts out), Gradle build tuning (memory, device-only ABIs), release signing
 * driven by Gradle properties (no secrets in the repo), the expo-updates URL, and cleartext
 * access (Android usesCleartextTraffic + an iOS ATS exception) when a site is plain http://
 * (`"cleartext": false` opts out; sites come from the props `sites` / `site` / `devSite`
 * or `expo.extra.mobileKit.sites`). Every prop is optional.
 *
 * The build STOPS when a native module the kit needs is missing from the app (run `npx upande-mobile-kit fix`).
 * `"strict": false` makes that a warning; `"biometric": "host"` (your app owns the lock) leaves out expo-local-authentication.
 */
const withBuildTuning = require('./plugins/withBuildTuning');
const withReleaseSigning = require('./plugins/withReleaseSigning');
const withUpdatesUrl = require('./plugins/withUpdatesUrl');
const withCleartext = require('./plugins/withCleartext');
const withNativeModulesCheck = require('./plugins/withNativeModulesCheck');
const withInstallPermission = require('./plugins/withInstallPermission');

module.exports = function withUpandeMobileKit(config, props = {}) {
  config = withNativeModulesCheck(config, props);
  config = withUpdatesUrl(config, props);
  config = withCleartext(config, props);
  config = withInstallPermission(config, props);
  config = withBuildTuning(config, props);
  config = withReleaseSigning(config);
  return config;
};
