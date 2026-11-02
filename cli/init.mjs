/**
 * `upande-mobile-kit init` — wire an Expo app to the kit. Run from the app
 * root. Never overwrites an existing file unless --force.
 *
 *   --site https://your.site   the PRODUCTION Frappe site that runs the upande_mobile app
 *   --dev-site http://localhost:8000  the LOCAL/development site (dev builds use it, release builds use --site)
 *   --bench /path/to/bench   also install the backend there (get-app, install-app, register this app);
 *                            goes to --dev-site when given, otherwise --site
 *   --bench-site my.site     the bench site name (default: the host of the site the bench installs to)
 *   --backend-repo URL       git URL of the backend app (default: the constant in cli/constants.mjs)
 *   --kit-repo owner/repo    where the reusable release workflow lives (default: constants.mjs)
 *   --name "My App"          Mobile App record name (default: app.json expo.name)
 *   --repo owner/repo        GitHub repo that publishes releases (default: git origin)
 *   --ota-base-url URL       where JS bundles are served (default: GitHub Pages of --repo)
 *   --apk-name my_app        APK file-name stem (default: snake_case of --name)
 *   --branch main            release branch (default: current branch)
 *   --settings-route /path   rarely needed: another path for the kit's Settings page (default /mobile-kit/settings)
 *   --devices-route /path    rarely needed: another path for the kit's Devices page (default /mobile-kit/devices)
 *   --biometric host|kit     who owns the biometric lock (default: detected; `host` when the app already locks itself)
 *   --no-adapters            do not look for the app's own auth store / API client / storage
 *   --no-backup              do not copy the files init changes into .upande-mobile-kit/backup/
 *   --force                  overwrite files that exist
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAdapters, detectHost, detectHostBiometric, STAND_IN_EFFECT } from './adapters.mjs';
import { backupNote, createBackup } from './backup.mjs';
import { BACKEND_APP, BACKEND_REPO_URL, isPlaceholder, KIT_REPO, NATIVE_MODULES, WORKFLOW_REF } from './constants.mjs';
import { FIX_COMMAND, METRO_NOTE } from './native-modules.mjs';
import { installNativeModules } from './native-install.mjs';
import {
  appDir,
  DEFAULT_ROUTES,
  describeCollision,
  findCollisions,
  findLegacyKitFiles,
  isKitFile,
  listRouteFiles,
  routeFileFor,
  stripRedundantRouteLines,
  validateRoute,
} from './routes.mjs';
import { offsetsFrom, runtimeVersionFor, versionCodeFor } from './version-lib.mjs';

const TEMPLATES = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'templates');
const PKG = '@upande/mobile-kit';

const sh = (root, ...args) => {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
};

/** owner/repo from a git remote URL (https or ssh), or ''. */
export function repoFromRemote(url) {
  const m = /github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(String(url).trim());
  return m ? m[1] : '';
}

export const snake = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

/** Where the JS bundles are served from when nothing else is said: the repo's GitHub Pages. */
export const defaultOtaBaseUrl = (repo) => {
  const [owner, name] = repo.split('/');
  return `https://${owner.toLowerCase()}.github.io/${name}/ota`;
};

/** The manifest endpoint the phones ask (the backend proxies it with the headers expo-updates needs). */
export const manifestUrl = (site, appName) =>
  `${site.replace(/\/+$/, '')}/api/method/${BACKEND_APP}.api.ota.manifest?app=${encodeURIComponent(appName)}`;

/**
 * The backend install as argv lists, in order. Run from the bench folder.
 * The app is registered with the backend's idempotent `register_app`, so a re-run
 * updates the same record; any failure there is real and stops the run.
 */
export function backendPlan({ benchSite, backendRepo, appName, githubRepo, otaBaseUrl, hasApp = false }) {
  const kwargs = { app_name: appName, github_repo: githubRepo, ota_base_url: otaBaseUrl, enabled: 1 };
  return [
    ...(hasApp ? [] : [{ argv: ['bench', 'get-app', backendRepo], note: 'fetch the backend app' }]),
    { argv: ['bench', '--site', benchSite, 'install-app', BACKEND_APP], note: 'install it on the site' },
    {
      argv: ['bench', '--site', benchSite, 'execute', 'upande_mobile.api.register_app', '--kwargs', JSON.stringify(kwargs)],
      note: 'register this app (safe to re-run: it updates the same record)',
    },
  ];
}

/** The `site:` value written into src/mobile-kit.ts. */
export const siteValue = (site, devSite) =>
  devSite
    ? `{ production: '${site}', development: '${devSite}' }`
    : `'${site || 'https://your.site'}'`;

const siteNote = (devSite) =>
  devSite
    ? "  // Dev builds (Metro / dev client, __DEV__) talk to `development`; release builds to `production`.\n  // Pin one with `environment: 'production'`. localhost works in the iOS simulator; the Android emulator needs http://10.0.2.2:<port>, a real phone your computer's LAN address.\n"
    : '  // Add a local one with  site: { production: \'https://your.site\', development: \'http://localhost:8000\' }\n';

const BIOMETRIC_HOST_LINE = "  biometric: 'host', // your app already locks itself with expo-local-authentication; the kit adds no lock of its own\n";

/** `settingsRoute` / `devicesRoute` lines, only for a path that is not the default. */
const routesBlock = (routes) =>
  (routes.settings !== DEFAULT_ROUTES.settings ? `  settingsRoute: '${routes.settings}',\n` : '') +
  (routes.devices !== DEFAULT_ROUTES.devices ? `  devicesRoute: '${routes.devices}',\n` : '');

/** The tail of the config: wired adapters, then commented hints for what is still on stand-ins. */
const hostBlock = (a) =>
  (a.lines.length ? `  // Wired to this app's own modules (found by \`npx upande-mobile-kit init\`):\n${a.lines.join('\n')}\n  //\n  // Still on the kit's stand-ins (uncomment to wire them):\n` : "  // Use the app's own session instead of the built-in stand-ins:\n") +
  `${a.hints.join('\n')}\n`;

/** What was wired to the app, what runs on stand-ins and who owns the biometric lock. */
export function wiringReport({ adapters, biometric, hostLocks }) {
  const out = ['Wiring:'];
  for (const w of adapters.wired) out.push(`  ✓ ${w}`);
  for (const n of adapters.notes) out.push(`  ! ${n}`);
  for (const k of adapters.standIns) out.push(`  ! ${k} runs on the kit's stand-in: ${STAND_IN_EFFECT[k]}. Wire it in src/mobile-kit.ts.`);
  out.push(
    biometric === 'host'
      ? `  ✓ biometric lock: owned by YOUR app (it uses expo-local-authentication${hostLocks?.length ? ` in ${hostLocks.slice(0, 2).join(', ')}` : ''}); the kit adds no lock and hides its switch`
      : '  ✓ biometric lock: owned by the kit (Settings has the switch). If your app also locks itself, set biometric: \'host\' in src/mobile-kit.ts.',
  );
  return out.join('\n');
}

/**
 * The "needs a new native build" block. `added` = packages that were not in
 * package.json before; `changed` = `[name, before, after]`.
 */
export function rebuildBlock({ added = [], changed = [], pluginAdded = false, updatesChanged = false, pending = [] } = {}) {
  const items = [];
  if (added.length) items.push(`packages added: ${added.join(', ')}`);
  if (changed.length) items.push(`packages whose version changed: ${changed.map(([n, a, b]) => `${n} ${a} -> ${b}`).join(', ')}`);
  if (pending.length) items.push(`packages still to install (run ${FIX_COMMAND}): ${pending.join(', ')}`);
  if (pluginAdded) items.push(`app.json: the ${PKG} plugin entry`);
  if (updatesChanged) items.push('app.json: expo.updates.url and runtimeVersion (baked into the native app)');
  if (!items.length) return '';
  return [
    'These changes need a NEW NATIVE BUILD (an OTA update will not deliver them):',
    ...items.map((i) => `  • ${i}`),
    '  Until that build is installed, the kit degrades (no battery or device model on crash reports, APKs open in the browser, ...).',
    '  Build: npx expo prebuild && npx expo run:android   (or push to your release branch and let the workflow build the APK)',
  ].join('\n');
}

/** Where the page is, and how people reach it: the floating button the provider renders. */
export function openBlock({ route, file }) {
  return [
    `A floating Settings button appears in your app (draggable, bottom right): tap it to open ${route} (rendered by ${file}).`,
    `Prefer your own entry? Set fab: false in src/mobile-kit.ts and use <KitSettingsButton /> or router.push('${route}').`,
  ].join('\n');
}

const quote = (a) => (/^[\w@%+=:,./-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`);
export const commandLine = (argv) => argv.map(quote).join(' ');

export function run(argv, root = process.cwd(), { exec, lastSteps = true, wiring, backup: sharedBackup } = {}) {
  const flag = (n) => {
    const i = argv.indexOf(`--${n}`);
    return i === -1 ? undefined : argv[i + 1];
  };
  const force = argv.includes('--force');
  const log = [];
  const appJsonPath = join(root, 'app.json');
  if (!existsSync(appJsonPath)) throw new Error('No app.json here — run this from the root of an Expo app.');
  const appJson = JSON.parse(readFileSync(appJsonPath, 'utf8'));
  appJson.expo = appJson.expo ?? {};

  const name = flag('name') ?? appJson.expo.name;
  if (!name) throw new Error('Pass --name: app.json has no expo.name.');
  const repo = flag('repo') ?? repoFromRemote(sh(root, 'remote', 'get-url', 'origin'));
  if (!repo) throw new Error('Pass --repo owner/repo: no GitHub origin remote found.');
  const site = (flag('site') ?? '').replace(/\/+$/, '');
  if (site && !/^https?:\/\/[^/\s]+/.test(site)) throw new Error('--site must be a URL like https://your.site');
  const devSite = (flag('dev-site') ?? '').replace(/\/+$/, '');
  if (devSite && !/^https?:\/\/[^/\s]+/.test(devSite)) throw new Error('--dev-site must be a URL like http://localhost:8000');
  if (devSite && !site) throw new Error('--dev-site needs --site too: that is the production site release builds use.');
  const apkName = flag('apk-name') ?? snake(name);
  const branch = flag('branch') ?? (sh(root, 'rev-parse', '--abbrev-ref', 'HEAD') || 'main');
  const kitRepo = flag('kit-repo') ?? KIT_REPO;
  const otaBaseUrl = flag('ota-base-url') ?? defaultOtaBaseUrl(repo);

  // The kit's two pages live under /mobile-kit/, so nothing of the app's collides. A page already served there
  // (it should not happen) is the only thing that stops us, before anything is written.
  const routes = { settings: flag('settings-route') ?? DEFAULT_ROUTES.settings, devices: flag('devices-route') ?? DEFAULT_ROUTES.devices };
  for (const [key, flagName] of [['settings', '--settings-route'], ['devices', '--devices-route']]) {
    const bad = validateRoute(routes[key]);
    if (bad) throw new Error(`${flagName}: ${bad}`);
    const taken = findCollisions(root, routes[key]);
    if (taken.length) throw new Error(describeCollision(routes[key], taken, flagName));
  }
  if (routes.settings === routes.devices) throw new Error('--settings-route and --devices-route must differ.');
  const backup = sharedBackup ?? createBackup(root, !argv.includes('--no-backup'));

  // Who owns the biometric lock, and which of the app's own modules the kit can use for sign-in, API and storage.
  const hostLocks = detectHostBiometric(root);
  const biometric = flag('biometric') ?? (hostLocks.length ? 'host' : 'kit');
  if (biometric !== 'host' && biometric !== 'kit') throw new Error('--biometric must be host or kit.');
  const wire = wiring ?? (argv.includes('--no-adapters') ? { auth: null, api: null, storage: null } : detectHost(root));
  const adapters = buildAdapters({ root, ...wire });

  const put = (rel, content) => {
    const target = join(root, rel);
    if (existsSync(target) && !force) {
      log.push(`skip   ${rel} (exists; --force to overwrite)`);
      return;
    }
    backup.save(rel);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
    log.push(`write  ${rel}`);
  };
  const tpl = (file) => readFileSync(join(TEMPLATES, file), 'utf8');
  const fill = (s) =>
    s
      .replaceAll('__APP_NAME__', name)
      .replaceAll('__GITHUB_REPO__', repo)
      .replaceAll('__APK_NAME__', apkName)
      .replaceAll('__SITE_VALUE__', siteValue(site, devSite))
      .replaceAll('__SITE_NOTE__', siteNote(devSite))
      .replaceAll('__ROUTES__', routesBlock(routes))
      .replaceAll('__BIOMETRIC__', biometric === 'host' ? BIOMETRIC_HOST_LINE : '')
      .replaceAll('__ADAPTER_IMPORTS__', adapters.imports.map((i) => `\n${i}`).join(''))
      .replaceAll('__HOST_BLOCK__', hostBlock(adapters))
      .replaceAll('__KIT_REPO__', kitRepo)
      .replaceAll('__WORKFLOW_REF__', WORKFLOW_REF);

  const settingsFile = routeFileFor(root, routes.settings);
  const devicesFile = routeFileFor(root, routes.devices);

  // Pages an older version wrote at the app's own /settings and /devices: move them under /mobile-kit/.
  // Only files that are exactly the kit's one-line re-export; a page the app wrote itself is never touched.
  const legacy = findLegacyKitFiles(root).filter((l) => routes[l.key] === DEFAULT_ROUTES[l.key]);
  for (const l of legacy) {
    backup.save(l.file);
    unlinkSync(join(root, l.file));
    log.push(`move   ${l.file} -> ${routeFileFor(root, DEFAULT_ROUTES[l.key])} (the kit's ${l.key} page now lives at ${DEFAULT_ROUTES[l.key]}, where it cannot collide with your screens)`);
  }
  put(settingsFile, tpl('settings-route.tsx'));
  put(devicesFile, tpl('devices-route.tsx'));
  put('src/mobile-kit.ts', fill(tpl('mobile-kit.ts')));
  // An existing config that still names the old kit pages: drop those now-redundant lines (other values stay).
  {
    const cfgPath = join(root, 'src/mobile-kit.ts');
    if (existsSync(cfgPath) && !force) {
      const cur = readFileSync(cfgPath, 'utf8');
      const next = stripRedundantRouteLines(cur, legacy);
      if (next !== cur) {
        backup.save('src/mobile-kit.ts');
        writeFileSync(cfgPath, next);
        log.push('edit   src/mobile-kit.ts (removed settingsRoute/devicesRoute lines that pointed at the old kit pages; the defaults are right now)');
      }
    }
  }
  const ownSettings = listRouteFiles(root).filter((f) => f.url === '/settings' && !isKitFile(root, f.file));
  if (ownSettings.length || legacy.length) {
    log.push(`note   ${ownSettings.length ? `your /settings is untouched (${ownSettings[0].file})` : 'nothing of yours uses /settings'}; the kit lives at ${routes.settings}`);
  }
  put('.github/workflows/release.yml', fill(tpl('release-caller.yml')).replace('branches: [main]', `branches: [${branch}]`));

  // Load the kit config first thing in the root layout (an import is hoisted, so this is safe to prepend).
  const layoutRel = ['tsx', 'jsx', 'js'].map((e) => `${appDir(root)}/_layout.${e}`).find((r) => existsSync(join(root, r)));
  if (layoutRel) {
    const layoutPath = join(root, layoutRel);
    const layout = readFileSync(layoutPath, 'utf8');
    if (/mobile-kit['"]/.test(layout)) log.push(`skip   ${layoutRel} import (already there)`);
    else {
      backup.save(layoutRel);
      const up = appDir(root) === 'app' ? '..' : '../..';
      writeFileSync(layoutPath, `import '${up}/src/mobile-kit';\n${layout}`);
      log.push(`edit   ${layoutRel} (added import '${up}/src/mobile-kit')`);
    }
  }

  // app.json: plugin, OTA feed, versions (idempotent).
  const expo = appJson.expo;
  const plugins = expo.plugins ?? [];
  const pluginWasThere = plugins.some((p) => (Array.isArray(p) ? p[0] : p) === PKG);
  if (!pluginWasThere) plugins.push(PKG);
  expo.plugins = plugins;
  expo.extra = { ...expo.extra, otaBaseUrl: expo.extra?.otaBaseUrl ?? otaBaseUrl };
  // The build plugin reads these to allow cleartext (http) traffic for a local site, and only for those hosts.
  if (site) {
    expo.extra.mobileKit = { ...expo.extra.mobileKit, sites: { production: site, ...(devSite ? { development: devSite } : {}) } };
  }
  if (site) {
    expo.updates = {
      enabled: true,
      checkAutomatically: 'ON_LOAD',
      fallbackToCacheTimeout: 0,
      ...expo.updates,
      url: manifestUrl(site, name),
    };
  } else log.push('note   no --site: expo.updates.url left alone (re-run with --site)');
  expo.version = expo.version ?? '1.0.0';
  try {
    const offsets = offsetsFrom(appJson);
    if (!expo.runtimeVersion) expo.runtimeVersion = runtimeVersionFor(expo.version, offsets);
    expo.android = { ...expo.android, versionCode: expo.android?.versionCode ?? versionCodeFor(expo.version, offsets) };
  } catch (e) {
    log.push(`note   could not set runtimeVersion (${e.message}); run \`npx upande-mobile-kit version --apply\``);
  }
  backup.save('app.json');
  writeFileSync(appJsonPath, `${JSON.stringify(appJson, null, 2)}\n`);
  log.push(`edit   app.json (plugin, extra.otaBaseUrl, updates.url${site ? '' : ' skipped'}, runtimeVersion ${expo.runtimeVersion ?? '-'})`);

  // package.json: helper scripts.
  const pkgPath = join(root, 'package.json');
  if (existsSync(pkgPath)) {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    pkg.scripts = {
      'version:next': 'upande-mobile-kit version',
      'version:apply': 'upande-mobile-kit version --apply',
      'ota:build': 'upande-mobile-kit publish-ota',
      'kit:doctor': 'upande-mobile-kit doctor',
      ...pkg.scripts,
    };
    backup.save('package.json');
    writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
    log.push('edit   package.json (added version:*, ota:build, kit:doctor scripts where missing)');
  }

  // The backend: install it when a bench is given, otherwise say exactly what to run.
  const bench = flag('bench');
  const backendRepo = flag('backend-repo') ?? BACKEND_REPO_URL;
  // A bench on this machine is the local/dev one; production is installed on its own server.
  const benchTarget = devSite || site;
  let benchSite = flag('bench-site');
  if (!benchSite && benchTarget) benchSite = new URL(benchTarget).hostname;
  log.push('');
  if (!site) {
    log.push('Backend: pass --site (and --bench) to install the Frappe app; nothing was installed.');
  } else {
    const plan = backendPlan({
      benchSite,
      backendRepo,
      appName: name,
      githubRepo: repo,
      otaBaseUrl,
      hasApp: !!bench && existsSync(join(bench, 'apps', BACKEND_APP)),
    });
    if (bench) {
      if (isPlaceholder(backendRepo) && plan[0].argv[1] === 'get-app') {
        throw new Error('The backend repo is still a placeholder. Pass --backend-repo <git url> (see cli/constants.mjs).');
      }
      const go = exec ?? ((argv, o) => execFileSync(argv[0], argv.slice(1), { cwd: o.cwd, stdio: 'inherit' }));
      for (const step of plan) {
        log.push(`run    ${commandLine(step.argv)}   # ${step.note}`);
        try {
          go(step.argv, { cwd: bench });
        } catch (e) {
          if (!step.tolerant) throw new Error(`\`${commandLine(step.argv)}\` failed: ${e.message}`);
          log.push(`note   ${step.note}: ${String(e.message).split('\n')[0]}`);
        }
      }
      log.push(`Backend installed on ${benchSite}${devSite ? ' (development)' : ''}. Restart the bench (\`bench restart\`) so the new app is served.`);
    } else {
      log.push(`Backend: run these in your bench folder (or re-run init with --bench <path>):`);
      for (const step of plan) log.push(`  ${commandLine(step.argv)}`);
    }
    if (devSite) {
      // Production lives on its own server: never touched from here, only told what to run.
      const prod = backendPlan({ benchSite: new URL(site).hostname, backendRepo, appName: name, githubRepo: repo, otaBaseUrl });
      log.push('', `Production (${site}): run these in the bench on that server, then restart it:`);
      for (const step of prod) log.push(`  ${commandLine(step.argv)}`);
    }
  }

  // The native modules: every init path installs the missing ones (the wizard does it itself, so it passes lastSteps: false).
  const depsOf = () => ({ ...(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).dependencies ?? {}) });
  const depsBeforeNative = depsOf();
  const native = lastSteps
    ? installNativeModules(root, { exec: exec ? (a, o) => exec(a, o) : undefined, noInstall: argv.includes('--no-install'), biometric })
    : null;
  if (native) log.push('', ...native.lines);
  const addedNative = native ? NATIVE_MODULES.filter((m) => !depsBeforeNative[m] && depsOf()[m]) : [];
  const missingNative = NATIVE_MODULES.filter((m) => !depsOf()[m]);
  if (!lastSteps) return log.join('\n') + '\n'; // the wizard prints its own report, blocks and backup note
  log.push('', wiringReport({ adapters, biometric, hostLocks }));
  if (backup.files.length) log.push('', backupNote(backup));
  log.push(
    '',
    rebuildBlock({ added: addedNative, pluginAdded: !pluginWasThere, updatesChanged: !!site, pending: native && native.ok ? [] : missingNative }),
    '',
    'Last steps:',
    native && !native.ok ? `  1. ${FIX_COMMAND}   (REQUIRED: the native modules are not installed yet)` : '  1. (the native modules are installed)',
    "  2. In the root layout wrap the app in <MobileKitProvider> (import it from '@upande/mobile-kit'); the config import is already added.",
    `  3. Enable GitHub Pages for the gh-pages branch of ${repo} (the first release creates it), then run \`npx upande-mobile-kit verify${site ? ` --site ${site}${devSite ? ` --dev-site ${devSite}` : ''}` : ''}\`.`,
    '',
    openBlock({ root, route: routes.settings, file: settingsFile }),
    '',
    METRO_NOTE,
  );
  // last thing printed, so it cannot be missed
  if (native && !native.ok) log.push('', native.lines[native.lines.length - 1]);
  return log.join('\n') + '\n';
}
