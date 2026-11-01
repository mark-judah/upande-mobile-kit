/**
 * Expo config plugin: let the app reach a plain-http:// site (a local bench).
 *
 * Android blocks cleartext traffic from API 28 and iOS blocks it through App
 * Transport Security, so a dev build pointed at http://<lan-ip>:8000 fails with a
 * network error and no hint why. When any site the app uses is http://, this sets
 * `android:usesCleartextTraffic="true"` and an ATS exception scoped to that host
 * (never the app-wide NSAllowsArbitraryLoads), and says so at prebuild. A
 * plain-http PRODUCTION site and mDNS hostnames (phones cannot resolve them) get their own warnings.
 *
 * Sites come from the plugin props (`sites`, `site`, `devSite`, `manifestUrl`) and from
 * `expo.extra.mobileKit.sites`. `{ "cleartext": false }` opts out of the changes.
 */
const { withAndroidManifest, withInfoPlist } = require('expo/config-plugins');
const { TAG, analyze, applyAndroidCleartext, applyIosAts, collectSites } = require('./cleartext-lib');

const said = new Set();
const say = (message) => {
  if (said.has(message)) return; // the config is resolved more than once per prebuild
  said.add(message);
  console.warn(`${TAG} ${message}`);
};

function withCleartext(config, props = {}) {
  const found = analyze(collectSites(config, props));
  found.warnings.forEach(say);
  if (!found.http.length) return config;
  if (props && props.cleartext === false) {
    say('cleartext: false: plain-http site(s) will be blocked by Android and iOS in this build.');
    return config;
  }
  found.notes.forEach(say);
  config = withAndroidManifest(config, (c) => {
    c.modResults = applyAndroidCleartext(c.modResults);
    return c;
  });
  config = withInfoPlist(config, (c) => {
    c.modResults = applyIosAts(c.modResults, found.http);
    return c;
  });
  return config;
}

module.exports = withCleartext;
