/**
 * `upande-mobile-kit doctor` — check an Expo app is set up for the kit.
 * Run from the app root. Exit code 1 when anything fails (warnings don't fail).
 *
 *   --site https://your.site   also probe the production site's OTA manifest endpoint
 *   --dev-site http://localhost:8000  and the development site's (unreachable is only a warning)
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describeMissing, FIX_COMMAND, hostOwnsBiometric, moduleStatus, skipFor } from './native-modules.mjs';
import { probeSite } from './site-checks.mjs';
import { configuredRoutes, findCollisions, findLegacyKitFiles, isKitFile, rootLayoutFile, routeFileFor } from './routes.mjs';
import { workflowChecks } from './workflow.mjs';
import { parseVersion } from './version-lib.mjs';

const PKG = '@upande/mobile-kit';

/** @returns {Promise<{level:'ok'|'warn'|'fail', msg:string}[]>} */
export async function check(root = process.cwd(), { site, devSite, fetchImpl = globalThis.fetch } = {}) {
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
  if (!deps['expo-router']) add('fail', 'expo-router is missing from package.json.');
  const hostLock = hostOwnsBiometric(root);
  for (const st of moduleStatus(root)) {
    if (st.inPackageJson && st.installed) continue;
    const level = hostLock && skipFor({ biometricHost: true }).includes(st.pkg) ? 'warn' : 'fail';
    add(level, `${describeMissing(st)}. Fix: ${FIX_COMMAND}`);
  }

  const kitTs = read('src/mobile-kit.ts');
  if (!kitTs) add('fail', 'src/mobile-kit.ts not found — run `npx upande-mobile-kit init`.');
  else if (!kitTs.includes('configureMobileKit(')) add('fail', 'src/mobile-kit.ts does not call configureMobileKit().');
  else add('ok', 'src/mobile-kit.ts configures the kit.');
  const layoutRel = rootLayoutFile(root);
  const layout = (layoutRel && read(layoutRel)) || '';
  const layoutName = layoutRel ?? 'the root layout';
  if (/mobile-kit['"]/.test(layout)) add('ok', `${layoutName} imports the kit config.`);
  else add('warn', `${layoutName} does not import './mobile-kit' — the screens will throw 'not configured'.`);
  if (layout.includes('MobileKitProvider')) add('ok', `${layoutName} mounts <MobileKitProvider>.`);
  else add('warn', `${layoutName} does not mount <MobileKitProvider> (no OTA-on-open, APK check or device reporting).`);
  const routes = configuredRoutes(root);
  const oldFiles = findLegacyKitFiles(root);
  if (oldFiles.length) add('warn', `an older version put the kit's pages at ${oldFiles.map((o) => o.file).join(' and ')}; they now live under /mobile-kit/ — fix: npx upande-mobile-kit init (moves them; your own screens are not touched).`);
  for (const key of ['settings', 'devices']) {
    const file = routeFileFor(root, routes[key]);
    const taken = findCollisions(root, routes[key]);
    if (taken.length) {
      add('fail', `${routes[key]} is also served by ${taken.map((t) => t.file).join(', ')}: the kit's ${key} page is hidden or hides it — fix: rename or remove that file (the kit's pages live under /mobile-kit/, so this should not happen).`);
    } else if (!existsSync(join(root, file))) add('warn', `${file} missing (nothing serves ${routes[key]}).`);
    else if (!isKitFile(root, file)) add('fail', `${file} does not re-export the kit's screen (export { ${key === 'devices' ? 'DevicesRoute' : 'SettingsRoute'} as default } from '${PKG}').`);
    else add('ok', `${file} present (${routes[key]}).`);
  }
  if (existsSync(join(root, '.github/workflows/release.yml'))) {
    add('ok', 'release workflow present.');
    for (const w of workflowChecks(root)) if (w.level !== 'ok') add(w.level, `${w.msg} — fix: ${w.fix}.`);
  } else add('warn', '.github/workflows/release.yml missing.');

  for (const [label, target] of [['production', site], ['development', devSite]]) {
    if (!target) continue;
    const r = await probeSite(label, target, expo, fetchImpl);
    add(r.level, r.msg);
  }
  return out;
}

export async function run(argv, root = process.cwd()) {
  const val = (f) => {
    const i = argv.indexOf(f);
    return i === -1 ? undefined : argv[i + 1];
  };
  const results = await check(root, { site: val('--site'), devSite: val('--dev-site') });
  const mark = { ok: '✓', warn: '!', fail: '✗' };
  const text = results.map((r) => `${mark[r.level]} ${r.msg}`).join('\n') + '\n';
  return { text, ok: !results.some((r) => r.level === 'fail') };
}
