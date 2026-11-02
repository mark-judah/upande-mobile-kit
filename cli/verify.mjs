/**
 * `upande-mobile-kit verify` — a self-test for an app that uses the kit.
 * One line per check: ✓ passes, ! needs attention, ✗ is broken; every ✗ and !
 * carries a one-line fix. Exit code 1 when any check fails (warnings don't fail).
 *
 *   --site https://your.site      probe the production site (default: from app.json / src/mobile-kit.ts)
 *   --dev-site http://localhost:8000   and the development site (unreachable is only a warning)
 *
 * It is a superset of `doctor`: routes (files, collisions, a link to them),
 * provider and config import order, config completeness (stand-ins, who owns
 * the biometric lock), native modules, and whether a phone can reach the sites.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { detectHostBiometric, STAND_IN_EFFECT } from './adapters.mjs';
import { KIT_REPO } from './constants.mjs';
import { describeMissing, FIX_COMMAND, hostOwnsBiometric, moduleStatus, skipFor } from './native-modules.mjs';
import { configuredRoutes, findCollisions, findLegacyKitFiles, isKitFile, linkedFrom, rootLayoutFile, routeFileFor } from './routes.mjs';
import { probeSite, reachabilityChecks, sitesFrom } from './site-checks.mjs';
import { parseVersion } from './version-lib.mjs';

const PKG = '@upande/mobile-kit';
/** @returns {Promise<{ level: 'ok'|'warn'|'fail', msg: string, fix?: string }[]>} */
export async function verify(root = process.cwd(), { site, devSite, fetchImpl = globalThis.fetch } = {}) {
  const out = [];
  const add = (level, msg, fix) => out.push({ level, msg, fix });
  const read = (rel) => {
    try {
      return readFileSync(join(root, rel), 'utf8');
    } catch {
      return null;
    }
  };

  const raw = read('app.json');
  if (!raw) {
    add('fail', 'app.json not found', 'run this from the root of your Expo app');
    return out;
  }
  const expo = JSON.parse(raw).expo ?? {};

  /* app.json */
  const plugins = (expo.plugins ?? []).map((p) => (Array.isArray(p) ? p[0] : p));
  if (plugins.includes(PKG)) add('ok', `app.json: ${PKG} is in plugins.`);
  else add('warn', `app.json: ${PKG} is not in expo.plugins (build tuning, signing and the cleartext setting do not apply)`, 'npx upande-mobile-kit init');
  if (expo.updates?.enabled !== false && expo.updates?.url) add('ok', 'app.json: expo.updates.url is set.');
  else add('fail', 'app.json: expo.updates.url is not set (or updates are disabled): OTA cannot work', 'npx upande-mobile-kit init --site https://your.site');
  try {
    parseVersion(expo.version);
    if (typeof expo.runtimeVersion === 'string' && /^\d+\.\d+$/.test(expo.runtimeVersion)) add('ok', `app.json: version ${expo.version}, runtimeVersion ${expo.runtimeVersion}.`);
    else add('fail', 'app.json: expo.runtimeVersion must be a "major.minor" string', 'npx upande-mobile-kit version --apply');
  } catch (e) {
    add('fail', `app.json: expo.version: ${e.message}`, 'set expo.version to major.minor.patch, e.g. 1.0.0');
  }

  /* routes */
  const routes = configuredRoutes(root);
  const files = {};
  const oldFiles = findLegacyKitFiles(root);
  if (oldFiles.length) add('warn', `an older version put the kit's pages at ${oldFiles.map((o) => o.file).join(' and ')}; they now live under /mobile-kit/`, 'npx upande-mobile-kit init  (moves them and tidies src/mobile-kit.ts; your own screens are not touched)');
  for (const key of ['settings', 'devices']) {
    const route = routes[key];
    const file = routeFileFor(root, route);
    files[key] = file;
    const taken = findCollisions(root, route);
    if (taken.length) add('fail', `route ${route} is also served by ${taken.map((t) => t.file).join(', ')}: the kit's page is hidden or hides it`, 'rename or remove that file (the kit\'s pages live under /mobile-kit/, so this should not happen)');
    else if (!existsSync(join(root, file))) add('fail', `route ${route}: ${file} is missing, so nothing serves it`, 'npx upande-mobile-kit init');
    else if (!isKitFile(root, file)) add('fail', `route ${route}: ${file} does not re-export the kit's screen`, `export { ${key === 'devices' ? 'DevicesRoute' : 'SettingsRoute'} as default } from '${PKG}';`);
    else add('ok', `route ${route} -> ${file}`);
  }
  // How people reach the page: the floating button the provider renders (default), unless the config turned it off.
  const cfgSource = read('src/mobile-kit.ts') ?? '';
  const fab = /\bfab\s*:\s*(false|['"]dev['"])/.exec(cfgSource)?.[1]?.replace(/['"]/g, '') ?? 'on';
  const links = linkedFrom(root, routes.settings, [files.settings]);
  if (fab === 'on') add('ok', `a floating Settings button opens ${routes.settings} (fab is on).`);
  else if (links.length) add('ok', `something links to ${routes.settings} (${links[0]}).`);
  else if (fab === 'dev') add('warn', `the floating Settings button only shows in development builds and nothing in your app links to ${routes.settings}, so people with a release build cannot find the page`, `remove \`fab: 'dev'\` from src/mobile-kit.ts, or add <KitSettingsButton /> / router.push('${routes.settings}') to your own menu`);
  else add('warn', `fab is off and nothing in your app links to ${routes.settings}, so people cannot find the page`, `remove \`fab: false\` from src/mobile-kit.ts, or add <KitSettingsButton /> (from '${PKG}') or router.push('${routes.settings}') to a menu, button or navigator`);

  /* provider + config import */
  const layoutRel = rootLayoutFile(root);
  const layout = (layoutRel && read(layoutRel)) || '';
  if (!layoutRel) add('fail', 'no root layout (app/_layout) found', 'create app/_layout.tsx and render <MobileKitProvider> in it');
  else {
    if (layout.includes('MobileKitProvider')) add('ok', `${layoutRel} mounts <MobileKitProvider>.`);
    else add('fail', `${layoutRel} does not mount <MobileKitProvider> (no OTA on open, APK check or device reporting)`, `wrap what ${layoutRel} returns in <MobileKitProvider> (import it from '${PKG}')`);
    const firstImport = /^import\s[^;]*?['"]([^'"]+)['"];?|^import\s+['"]([^'"]+)['"];?/m.exec(layout);
    const firstTarget = firstImport ? firstImport[1] ?? firstImport[2] : '';
    if (/mobile-kit$/.test(firstTarget)) add('ok', `${layoutRel} imports the kit config first.`);
    else if (/mobile-kit['"]/.test(layout)) add('warn', `${layoutRel} imports the kit config, but not first: a screen module that runs before it throws "not configured"`, "move import '../src/mobile-kit'; to the top of the file");
    else add('fail', `${layoutRel} does not import src/mobile-kit.ts: the screens throw "not configured"`, "add import '../src/mobile-kit'; as the first import");
  }

  /* config completeness */
  const cfg = read('src/mobile-kit.ts');
  if (!cfg) add('fail', 'src/mobile-kit.ts not found', 'npx upande-mobile-kit init');
  else if (!cfg.includes('configureMobileKit(')) add('fail', 'src/mobile-kit.ts does not call configureMobileKit()', 'npx upande-mobile-kit init --force');
  else {
    add('ok', 'src/mobile-kit.ts configures the kit.');
    const wired = (key) => new RegExp(`^[ \\t]*${key}\\b[^\\n]*`, 'm').test(cfg.replace(/^[ \t]*\/\/.*$/gm, ''));
    for (const k of ['useAuth', 'api', 'storage']) {
      if (wired(k)) add('ok', `config: ${k} is the app's own.`);
      else add('warn', `config: ${k} is on the kit's stand-in: ${STAND_IN_EFFECT[k]}`, `wire ${k} in src/mobile-kit.ts (README: "Wiring your app"), or re-run init --force to detect it`);
    }
    const hostLocks = detectHostBiometric(root);
    const owner = /biometric:\s*'host'/.test(cfg) ? 'host' : 'kit';
    if (hostLocks.length && owner === 'kit') add('warn', `two biometric locks: your app already uses expo-local-authentication (${hostLocks[0]}) and the kit adds its own`, "set biometric: 'host' in src/mobile-kit.ts so your app owns the lock");
    else if (owner === 'host') add('ok', "biometric lock is owned by your app (biometric: 'host'); the kit adds none.");
    else add('ok', 'biometric lock is owned by the kit.');
  }

  /* native modules */
  let pkg = {};
  try {
    pkg = JSON.parse(read('package.json') ?? '{}');
  } catch {
    /* handled below */
  }
  const deps = { ...pkg.devDependencies, ...pkg.dependencies };
  if (!deps[PKG]) add('fail', `${PKG} is not in package.json`, `npm install github:${KIT_REPO}#<tag>`);
  // expo-router is the host's own; the kit's native modules come from one list and one fix command.
  if (!deps['expo-router']) add('fail', 'expo-router is missing from package.json (the kit needs it)', 'npx expo install expo-router');
  else if (!existsSync(join(root, 'node_modules', 'expo-router'))) add('fail', 'expo-router is in package.json but not installed', 'npm install');
  const hostLock = hostOwnsBiometric(root);
  const statuses = moduleStatus(root);
  for (const st of statuses) {
    if (st.inPackageJson && st.installed) continue;
    // A host that owns the lock may not use expo-local-authentication at all through the kit: only a warning.
    const level = hostLock && skipFor({ biometricHost: true }).includes(st.pkg) ? 'warn' : 'fail';
    add(level, describeMissing(st), `${FIX_COMMAND}  (then make a new native build: an OTA update cannot add native modules)`);
  }
  if (statuses.every((st) => st.inPackageJson && st.installed)) add('ok', 'all native modules are installed (new ones only work after a new native build, not an OTA update).');

  /* sites */
  const sites = sitesFrom(root, { site, devSite }, expo);
  if (!sites.production) add('warn', 'no site configured to check', 'pass --site https://your.site or run npx upande-mobile-kit init');
  out.push(...reachabilityChecks(expo, sites));
  for (const [label, url] of [['production', sites.production], ['development', sites.development]]) {
    if (url) out.push(await probeSite(label, url, expo, fetchImpl));
  }
  return out;
}

export async function run(argv, root = process.cwd()) {
  const val = (f) => {
    const i = argv.indexOf(f);
    return i === -1 ? undefined : argv[i + 1];
  };
  const results = await verify(root, { site: val('--site'), devSite: val('--dev-site') });
  const mark = { ok: '✓', warn: '!', fail: '✗' };
  const text =
    results.map((r) => `${mark[r.level]} ${r.msg}${r.fix && r.level !== 'ok' ? ` — fix: ${r.fix}` : ''}`).join('\n') +
    `\n\n${results.filter((r) => r.level === 'fail').length} failed, ${results.filter((r) => r.level === 'warn').length} to look at, ${results.filter((r) => r.level === 'ok').length} fine.\n`;
  return { text, ok: !results.some((r) => r.level === 'fail') };
}
