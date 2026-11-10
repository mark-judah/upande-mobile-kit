/**
 * Checks about the Frappe sites an app talks to: are they reachable, does the
 * OTA endpoint answer, and can a phone actually reach them over the scheme and
 * hostname used (cleartext http on Android/iOS, `.local` names).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PKG = '@upande/mobile-kit';

const hostOf = (u) => {
  try {
    return new URL(u).hostname;
  } catch {
    return '';
  }
};

/** The sites to check: flags win, then app.json `extra.mobileKit.sites`, then the `site:` line of src/mobile-kit.ts. */
export function sitesFrom(root, { site, devSite } = {}, expo = {}) {
  if (site || devSite) return { production: site, development: devSite };
  const fromExtra = expo.extra?.mobileKit?.sites;
  if (fromExtra?.production) return { production: fromExtra.production, development: fromExtra.development };
  try {
    const src = readFileSync(join(root, 'src/mobile-kit.ts'), 'utf8');
    const both = /site:\s*\{\s*production:\s*'([^']+)'(?:\s*,\s*development:\s*'([^']+)')?/.exec(src);
    if (both) return { production: both[1], development: both[2] };
    const one = /^\s*site:\s*'([^']+)'/m.exec(src);
    if (one) return { production: one[1] };
  } catch {
    /* no config */
  }
  return {};
}

/** Probe the site's OTA manifest endpoint. */
export async function probeSite(label, target, expo, fetchImpl = globalThis.fetch) {
  const base = String(target).replace(/\/+$/, '');
  try {
    const res = await fetchImpl(`${base}/api/method/upande_mobile.api.ota.manifest?app=${encodeURIComponent(expo.name ?? '')}`, {
      signal: AbortSignal.timeout(10000),
      headers: { 'expo-runtime-version': String(expo.runtimeVersion ?? ''), 'expo-platform': 'android', 'expo-protocol-version': '1' },
    });
    const proto = res.headers.get('expo-protocol-version');
    if ((res.status === 200 || res.status === 204) && proto === '1') return { level: 'ok', msg: `${label} site OTA endpoint answers ${res.status} with the protocol header.` };
    return { level: 'fail', msg: `${label} site OTA endpoint answered ${res.status}${proto ? '' : ' without expo-protocol-version'} — is the upande_mobile app installed there?`, fix: `install it: bench get-app <backend repo> && bench --site <site> install-app upande_mobile (npx upande-mobile-kit init prints the exact commands)` };
  } catch (e) {
    return {
      level: label === 'development' ? 'warn' : 'fail',
      msg: `could not reach the ${label} site ${base}: ${e.message}`,
      fix: label === 'development' ? 'start your bench (it is only a warning while it is off)' : 'check the URL and that the site is up',
    };
  }
}

const kitPlugin = (expo) => (expo.plugins ?? []).some((p) => (Array.isArray(p) ? p[0] : p) === PKG);
const kitCovers = (expo, host) => {
  const s = expo.extra?.mobileKit?.sites ?? {};
  return kitPlugin(expo) && [s.production, s.development].some((u) => u && hostOf(u) === host);
};

function buildPropsCleartext(expo) {
  return (expo.plugins ?? []).some((p) => Array.isArray(p) && p[0] === 'expo-build-properties' && p[1]?.android?.usesCleartextTraffic === true);
}

function iosAllows(expo, host) {
  const ats = expo.ios?.infoPlist?.NSAppTransportSecurity;
  if (!ats) return false;
  return ats.NSAllowsArbitraryLoads === true || ats.NSAllowsLocalNetworking === true || !!ats.NSExceptionDomains?.[host];
}

/**
 * What a phone needs to reach each site: https needs nothing; http needs
 * Android cleartext traffic and an iOS ATS exception; `.local` names do not
 * resolve from phones. Results are `{ level, msg, fix }`.
 */
export function reachabilityChecks(expo, sites) {
  const out = [];
  const add = (level, msg, fix) => out.push({ level, msg, fix });
  for (const [label, url] of [['production', sites.production], ['development', sites.development]]) {
    if (!url) continue;
    const host = hostOf(url);
    if (/\.local$/i.test(host)) {
      add('warn', `the ${label} site ${host} is an mDNS name (the kind ending in "local"): phones and the Android emulator do not resolve it`, `use your computer's LAN IP, e.g. http://<your-lan-ip>:8000, and set bench's default site (bench use <site>) so requests to the IP reach it`);
    }
    if (!url.startsWith('http://')) {
      if (url.startsWith('https://')) add('ok', `${label} site uses https.`);
      continue;
    }
    if (label === 'production') add('warn', `the production site ${host} uses plain http`, 'serve production over https');
    const android = kitCovers(expo, host) || buildPropsCleartext(expo) || expo.android?.usesCleartextTraffic === true;
    if (android) add('ok', `Android cleartext traffic is enabled for ${host}${kitCovers(expo, host) ? ' (by the kit plugin; needs a new native build)' : ''}.`);
    else add('fail', `Android blocks http:// traffic, so the app cannot reach ${host}`, `list the site under expo.extra.mobileKit.sites and keep the ${PKG} plugin (it enables cleartext for those hosts), or add ["expo-build-properties", { "android": { "usesCleartextTraffic": true } }]; then rebuild`);
    const hasIos = !!expo.ios || (expo.platforms ?? []).includes('ios');
    if (hasIos) {
      if (kitCovers(expo, host) || iosAllows(expo, host)) add('ok', `iOS allows http for ${host}.`);
      else add('fail', `iOS (App Transport Security) blocks http:// to ${host}`, `add ios.infoPlist.NSAppTransportSecurity (NSAllowsLocalNetworking or an NSExceptionDomains entry for ${host}), or list the site under expo.extra.mobileKit.sites with the ${PKG} plugin; then rebuild`);
    }
  }
  return out;
}

/**
 * The release repository, read the way a phone and the server read it: without logging in. Public, with releases (one
 * carrying an APK), and its Pages serving the manifest of the app's current runtime. Results are `{ level, msg, fix }`.
 */
export async function probeReleaseRepo(repo, expo = {}, fetchImpl = globalThis.fetch) {
  const out = [];
  const add = (level, msg, fix) => out.push({ level, msg, fix });
  const doc = 'docs/releasing.md, "Private source and one app per branch"';
  try {
    const res = await fetchImpl(`https://api.github.com/repos/${repo}/releases?per_page=30`, {
      signal: AbortSignal.timeout(10000),
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (res.status === 404) add('fail', `the release repository ${repo} does not exist or is private: phones read it without logging in`, `create ${repo} as a PUBLIC repository (${doc})`);
    else if (res.status === 403 || res.status === 429) add('warn', `GitHub refused to list the releases of ${repo} (${res.status}, probably the hourly limit for unauthenticated calls)`, 'run verify again later');
    else if (!res.ok) add('warn', `GitHub answered ${res.status} for the releases of ${repo}`, 'run verify again later');
    else {
      const list = (await res.json()).filter((r) => r && !r.draft);
      const withApk = list.filter((r) => (r.assets ?? []).some((a) => /\.apk$/i.test(a.name ?? '')));
      if (!list.length) add('warn', `the release repository ${repo} has no releases yet`, 'push to the release branch; the first release must be an APK (Actions > Release > Run workflow, tick build_apk)');
      else if (!withApk.length) add('warn', `${repo} has ${list.length} release(s) but none with an APK, so phones are offered nothing to install`, 'Actions > Release > Run workflow, tick build_apk');
      else add('ok', `${repo} is public and has ${list.length} release(s); the newest APK is ${withApk[0].tag_name}.`);
    }
  } catch (e) {
    add('warn', `could not reach api.github.com to check ${repo}: ${e.message}`, 'check the network and run verify again');
  }
  const base = String(expo.extra?.otaBaseUrl ?? '').replace(/\/+$/, '');
  const runtime = typeof expo.runtimeVersion === 'string' ? expo.runtimeVersion : '';
  if (base && runtime) {
    const url = `${base}/android/${runtime}/manifest.json`;
    try {
      const res = await fetchImpl(url, { signal: AbortSignal.timeout(10000) });
      if (res.ok) add('ok', `the OTA manifest for runtime ${runtime} is served at ${url}.`);
      else add('warn', `${url} answered ${res.status}: GitHub Pages is off on ${repo}, or no release has published runtime ${runtime} yet`, `${repo} > Settings > Pages > Deploy from a branch > gh-pages, / (root); then push a release`);
    } catch (e) {
      add('warn', `could not fetch ${url}: ${e.message}`, 'check the network and run verify again');
    }
  }
  return out;
}
