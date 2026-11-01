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
 *   --force                  overwrite files that exist
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BACKEND_APP, BACKEND_REPO_URL, isPlaceholder, KIT_REPO, WORKFLOW_REF } from './constants.mjs';
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

const quote = (a) => (/^[\w@%+=:,./-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`);
export const commandLine = (argv) => argv.map(quote).join(' ');

export function run(argv, root = process.cwd(), { exec } = {}) {
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

  const put = (rel, content) => {
    const target = join(root, rel);
    if (existsSync(target) && !force) {
      log.push(`skip   ${rel} (exists; --force to overwrite)`);
      return;
    }
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
      .replaceAll('__KIT_REPO__', kitRepo)
      .replaceAll('__WORKFLOW_REF__', WORKFLOW_REF);

  put('app/settings.tsx', tpl('settings-route.tsx'));
  put('app/devices.tsx', tpl('devices-route.tsx'));
  put('src/mobile-kit.ts', fill(tpl('mobile-kit.ts')));
  put('.github/workflows/release.yml', fill(tpl('release-caller.yml')).replace('branches: [main]', `branches: [${branch}]`));

  // Load the kit config first thing in the root layout (an import is hoisted, so this is safe to prepend).
  const layoutPath = join(root, 'app/_layout.tsx');
  if (existsSync(layoutPath)) {
    const layout = readFileSync(layoutPath, 'utf8');
    if (/mobile-kit['"]/.test(layout)) log.push('skip   app/_layout.tsx import (already there)');
    else {
      writeFileSync(layoutPath, `import '../src/mobile-kit';\n${layout}`);
      log.push("edit   app/_layout.tsx (added import '../src/mobile-kit')");
    }
  }

  // app.json: plugin, OTA feed, versions (idempotent).
  const expo = appJson.expo;
  const plugins = expo.plugins ?? [];
  if (!plugins.some((p) => (Array.isArray(p) ? p[0] : p) === PKG)) plugins.push(PKG);
  expo.plugins = plugins;
  expo.extra = { ...expo.extra, otaBaseUrl: expo.extra?.otaBaseUrl ?? otaBaseUrl };
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
      const go = exec ?? ((argv) => execFileSync(argv[0], argv.slice(1), { cwd: bench, stdio: 'inherit' }));
      for (const step of plan) {
        log.push(`run    ${commandLine(step.argv)}   # ${step.note}`);
        try {
          go(step.argv);
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

  log.push(
    '',
    'Last steps:',
    '  1. npx expo install expo-updates expo-constants expo-file-system expo-intent-launcher expo-local-authentication expo-network @react-native-async-storage/async-storage',
    "  2. In app/_layout.tsx wrap the app in <MobileKitProvider> (import it from '@upande/mobile-kit'); the config import is already added.",
    `  3. Enable GitHub Pages for the gh-pages branch of ${repo} (the first release creates it), then run \`npx upande-mobile-kit doctor${site ? ` --site ${site}${devSite ? ` --dev-site ${devSite}` : ''}` : ''}\`.`,
    '  Open /settings in the app: OTA, APK, biometric and devices are all there.',
  );
  return log.join('\n') + '\n';
}
