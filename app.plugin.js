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
 * Applies: Gradle build tuning (memory, device-only ABIs), release signing
 * driven by Gradle properties (no secrets in the repo), and the expo-updates URL.
 * Every prop is optional.
 */
const withBuildTuning = require('./plugins/withBuildTuning');
const withReleaseSigning = require('./plugins/withReleaseSigning');
const withUpdatesUrl = require('./plugins/withUpdatesUrl');

module.exports = function withUpandeMobileKit(config, props = {}) {
  config = withUpdatesUrl(config, props);
  config = withBuildTuning(config, props);
  config = withReleaseSigning(config);
  return config;
};
