/**
 * `upande-mobile-kit doctor` — check an Expo app is set up for the kit.
 * Run from the app root. Exit code 1 when anything fails (warnings don't fail).
 *
 *   --site https://your.site   also probe the site's OTA manifest endpoint
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseVersion } from './version-lib.mjs';

const PKG = '@upande/mobile-kit';

/** @returns {Promise<{level:'ok'|'warn'|'fail', msg:string}[]>} */
export async function check(root = process.cwd(), { site, fetchImpl = globalThis.fetch } = {}) {
  const out = [];
  const add = (level, msg) => out.push({ level, msg });
  const read = (rel) => {
    try {
      return readFileSync(join(root, rel), 'utf8');
    } catch {
      return null;
    }
  };

  const raw = read('app.json');
  if (!raw) {
    add('fail', 'app.json not found — run from the app root.');
    return out;
  }
  const expo = JSON.parse(raw).expo ?? {};

  try {
    parseVersion(expo.version);
    add('ok', `expo.version ${expo.version} is a valid odometer version.`);
  } catch (e) {
    add('fail', `expo.version: ${e.message}`);
  }
  if (typeof expo.runtimeVersion === 'string' && /^\d+\.\d+$/.test(expo.runtimeVersion)) add('ok', `runtimeVersion ${expo.runtimeVersion}`);
  else add('fail', 'expo.runtimeVersion must be a "major.minor" string — run `npx upande-mobile-kit version --apply` once.');
  if (expo.android?.package) add('ok', `android.package ${expo.android.package}`);
  else add('fail', 'expo.android.package is not set.');
  if (expo.updates?.enabled !== false && expo.updates?.url) add('ok', 'expo.updates.url is set.');
  else add('fail', 'expo.updates.url is not set (or updates are disabled): OTA cannot work.');
  if (/^https:\/\//.test(expo.extra?.otaBaseUrl ?? '')) add('ok', 'expo.extra.otaBaseUrl is set.');
  else add('fail', 'expo.extra.otaBaseUrl must be the https URL the OTA bundles are served from.');
  const plugins = (expo.plugins ?? []).map((p) => (Array.isArray(p) ? p[0] : p));
  if (plugins.includes(PKG)) add('ok', `${PKG} is in plugins.`);
  else add('warn', `${PKG} is not in expo.plugins (build tuning and signing will not apply).`);

  const pkg = JSON.parse(read('package.json') ?? '{}');
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  if (deps[PKG]) add('ok', `${PKG} ${deps[PKG]} installed.`);
  else add('fail', `${PKG} is not in package.json.`);
  for (const d of ['expo-updates', 'expo-constants', 'expo-file-system', 'expo-router']) {
    if (!deps[d]) add('fail', `${d} is missing from package.json (peer dependency of the kit).`);
  }
  const degraded = {
    'expo-intent-launcher': 'APKs open in the browser instead of the installer',
    'expo-local-authentication': 'biometric unlock is unavailable',
    'expo-network': 'background APK downloads never start (the network type is unknown), and crash reports leave out the connection type',
    '@react-native-async-storage/async-storage': 'kit settings are kept in memory and lost on restart',
    'expo-device': 'crash reports leave out the device model, OS build and memory',
    'expo-battery': 'crash reports leave out the battery level and low-power mode',
    'expo-localization': 'crash reports fall back to Intl for locale and time zone',
  };
  for (const [d, effect] of Object.entries(degraded)) {
    if (!deps[d]) add('warn', `${d} is not installed: ${effect}.`);
  }

  const kitTs = read('src/mobile-kit.ts');
  if (!kitTs) add('fail', 'src/mobile-kit.ts not found — run `npx upande-mobile-kit init`.');
  else if (!kitTs.includes('configureMobileKit(')) add('fail', 'src/mobile-kit.ts does not call configureMobileKit().');
  else add('ok', 'src/mobile-kit.ts configures the kit.');
  const layout = read('app/_layout.tsx') ?? '';
  if (/mobile-kit['"]/.test(layout)) add('ok', 'app/_layout.tsx imports the kit config.');
  else add('warn', "app/_layout.tsx does not import './mobile-kit' — the screens will throw 'not configured'.");
  if (layout.includes('MobileKitProvider')) add('ok', 'app/_layout.tsx mounts <MobileKitProvider>.');
  else add('warn', 'app/_layout.tsx does not mount <MobileKitProvider> (no OTA-on-open, APK check or device reporting).');
  for (const f of ['app/settings.tsx', 'app/devices.tsx']) {
    if (existsSync(join(root, f))) add('ok', `${f} present.`);
    else add('warn', `${f} missing (the route will not exist).`);
  }
  if (existsSync(join(root, '.github/workflows/release.yml'))) add('ok', 'release workflow present.');
  else add('warn', '.github/workflows/release.yml missing.');

  if (site) {
    const base = String(site).replace(/\/+$/, '');
    const name = expo.name ?? '';
    try {
      const res = await fetchImpl(`${base}/api/method/upande_mobile.api.ota.manifest?app=${encodeURIComponent(name)}`, {
        headers: { 'expo-runtime-version': String(expo.runtimeVersion ?? ''), 'expo-platform': 'android', 'expo-protocol-version': '1' },
      });
      const proto = res.headers.get('expo-protocol-version');
      if ((res.status === 200 || res.status === 204) && proto === '1') add('ok', `site OTA endpoint answers ${res.status} with the protocol header.`);
      else add('fail', `site OTA endpoint answered ${res.status}${proto ? '' : ' without expo-protocol-version'} — is the upande_mobile app installed?`);
    } catch (e) {
      add('fail', `could not reach ${base}: ${e.message}`);
    }
  }
  return out;
}

export async function run(argv, root = process.cwd()) {
  const i = argv.indexOf('--site');
  const results = await check(root, { site: i === -1 ? undefined : argv[i + 1] });
  const mark = { ok: '✓', warn: '!', fail: '✗' };
  const text = results.map((r) => `${mark[r.level]} ${r.msg}`).join('\n') + '\n';
  return { text, ok: !results.some((r) => r.level === 'fail') };
}
