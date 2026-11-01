/**
 * Expo config plugin: point expo-updates at the site's OTA manifest endpoint.
 *
 * `manifestUrl` is the full URL of the `upande_mobile` Frappe app's manifest
 * endpoint for this app, e.g.
 *   https://<your-site>/api/method/upande_mobile.api.ota.manifest?app=<Mobile App name>
 * `{runtime}` in the URL, if present, is replaced with the config's
 * runtimeVersion. `otaBaseUrl` (where the static bundles are served from) is
 * stored in `extra` for `upande-mobile-kit publish-ota`.
 *
 * Neither value has a default: they are per-deployment and come from the app's
 * own app.json / app.config.js plugin props.
 */
function withUpdatesUrl(config, props = {}) {
  const { manifestUrl, otaBaseUrl } = props || {};
  if (!manifestUrl && !otaBaseUrl) return config;
  const next = { ...config };
  if (manifestUrl) {
    const runtime = typeof config.runtimeVersion === 'string' ? config.runtimeVersion : '';
    next.updates = {
      enabled: true,
      checkAutomatically: 'ON_LOAD',
      fallbackToCacheTimeout: 0,
      ...config.updates,
      url: String(manifestUrl).replace('{runtime}', runtime),
    };
  }
  if (otaBaseUrl) next.extra = { ...config.extra, otaBaseUrl };
  return next;
}

module.exports = withUpdatesUrl;
