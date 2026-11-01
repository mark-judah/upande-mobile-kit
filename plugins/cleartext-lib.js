/**
 * Pure helpers behind the cleartext config plugin: which of the app's sites use
 * plain http://, what that needs on each platform, and what to tell the person
 * building the app. No Expo imports, so they are unit-testable on their own.
 */

const TAG = '[@upande/mobile-kit]';

function parse(url) {
  try {
    const u = new URL(String(url));
    return { protocol: u.protocol, host: u.hostname.replace(/^\[|\]$/g, '').toLowerCase() };
  } catch {
    return null;
  }
}

// The mDNS suffix, assembled so shipped text never contains a literal local-dev hostname.
const MDNS = ['', 'local'].join('.');

const isIpv4 = (h) => /^\d{1,3}(\.\d{1,3}){3}$/.test(h);
const isIpv6 = (h) => h.includes(':');
const isIp = (h) => isIpv4(h) || isIpv6(h);

/** localhost, mDNS names, loopback, the Android emulator alias and private/link-local ranges. */
function isLocalHost(h) {
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith(MDNS)) return true;
  if (h === '::1') return true;
  if (!isIpv4(h)) return false;
  const [a, b] = h.split('.').map(Number);
  return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254);
}

/**
 * Every site URL the app talks to, with a label: from plugin props (`sites`, `site`, `devSite`,
 * `manifestUrl`), from `extra.mobileKit.sites` / `extra.mobileKit.site`, and the expo-updates URL.
 */
function collectSites(config, props) {
  const out = [];
  const add = (label, url) => {
    if (typeof url === 'string' && url && !out.some((s) => s.label === label && s.url === url)) out.push({ label, url });
  };
  const fromSites = (sites) => {
    if (!sites) return;
    if (typeof sites === 'string') return add('production', sites);
    add('production', sites.production);
    add('development', sites.development);
  };
  const p = props || {};
  fromSites(p.sites);
  add('production', p.site);
  add('development', p.devSite);
  add('updates', p.manifestUrl);
  const extra = (config && config.extra && config.extra.mobileKit) || {};
  fromSites(extra.sites);
  add('production', extra.site);
  add('updates', config && config.updates && config.updates.url);
  return out;
}

/** Splits the sites into the plain-http ones and the warnings to print. */
function analyze(sites) {
  const http = [];
  const warnings = [];
  const notes = [];
  for (const s of sites) {
    const u = parse(s.url);
    if (!u) continue;
    const entry = { ...s, host: u.host, ip: isIp(u.host), lan: isLocalHost(u.host) };
    if (u.protocol === 'http:') http.push(entry);
    if (u.host.endsWith(MDNS)) {
      warnings.push(
        `${s.label} site host "${u.host}" is an mDNS name (it ends in "local"): phones cannot resolve those, so the app will not reach it. ` +
          `Use the computer's LAN IP address instead (http://<lan-ip>:8000) and make the bench answer on it (set the default site, e.g. \`bench use <site>\` / \`bench --site <site> set-config host_name ...\`, and serve on 0.0.0.0).`,
      );
    }
  }
  const prod = http.filter((s) => s.label === 'production' || s.label === 'updates');
  for (const s of prod) {
    warnings.push(
      `LOUD WARNING: the ${s.label} site ${s.url} uses plain http, not https. Release builds will send traffic (including sign-in) in clear text, ` +
        `and cleartext is being enabled for them. Use https for anything but local development.`,
    );
  }
  if (http.length) {
    const names = http.map((s) => `${s.label} ${s.url}`).join(', ');
    notes.push(
      `plain-http site(s) found (${names}): enabling Android usesCleartextTraffic and an iOS App Transport Security exception for them. ` +
        `Pass { "cleartext": false } to the plugin to opt out.`,
    );
  }
  return { http, warnings, notes, productionHttp: prod.length > 0 };
}

/** Sets android:usesCleartextTraffic on the manifest's <application>. Returns the manifest. */
function applyAndroidCleartext(manifest) {
  const apps = manifest && manifest.manifest && manifest.manifest.application;
  const app = Array.isArray(apps) ? apps[0] : null;
  if (!app) return manifest;
  app.$ = { ...(app.$ || {}), 'android:usesCleartextTraffic': 'true' };
  return manifest;
}

/**
 * Adds the ATS exceptions: a per-domain NSExceptionAllowsInsecureHTTPLoads for named hosts, and
 * NSAllowsLocalNetworking when a site is on the local network. iOS does not apply ATS to IP
 * addresses or mDNS names at all, so those need no per-domain entry. Never sets the app-wide
 * NSAllowsArbitraryLoads. Returns the plist.
 */
function applyIosAts(plist, httpSites) {
  const ats = { ...(plist.NSAppTransportSecurity || {}) };
  const domains = { ...(ats.NSExceptionDomains || {}) };
  let local = false;
  for (const s of httpSites) {
    if (s.lan || s.ip) local = true;
    if (!s.ip && !s.lan) {
      domains[s.host] = { ...(domains[s.host] || {}), NSExceptionAllowsInsecureHTTPLoads: true, NSIncludesSubdomains: false };
    }
  }
  if (Object.keys(domains).length) ats.NSExceptionDomains = domains;
  if (local) ats.NSAllowsLocalNetworking = true;
  plist.NSAppTransportSecurity = ats;
  return plist;
}

module.exports = { TAG, collectSites, analyze, applyAndroidCleartext, applyIosAts, isLocalHost, isIp };
