import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { check } from '../../cli/doctor.mjs';
import { KIT_VERSION } from '../../cli/constants.mjs';
import { renderCaller } from '../../cli/workflow.mjs';
import { backendPlan, commandLine, defaultOtaBaseUrl, manifestUrl, repoFromRemote, run as realInit, snake } from '../../cli/init.mjs';
// Plain init now installs the native modules by default. Tests must never run a real `expo install`
// (network, minutes), so every call gets a recording no-op exec unless the test passes its own.
const nativeCalls = [];
const init = (argv, root, opts = {}) => realInit(argv, root, { exec: (a, o) => { nativeCalls.push({ argv: a, cwd: o?.cwd }); }, ...opts });

import { denyPatternsFromEnv, scanText } from '../../cli/check-shipped.mjs';

const require = createRequire(import.meta.url);

function app(extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'kit-app-'));
  writeFileSync(
    join(dir, 'app.json'),
    JSON.stringify({ expo: { name: 'My App', version: '1.0.0', android: { package: 'com.example.myapp' }, ...extra } }),
  );
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'my-app', scripts: { start: 'expo start' }, dependencies: {} }));
  return dir;
}

test('repoFromRemote reads https and ssh remotes', () => {
  assert.equal(repoFromRemote('https://github.com/acme/app.git'), 'acme/app');
  assert.equal(repoFromRemote('git@github.com:acme/app.git'), 'acme/app');
  assert.equal(repoFromRemote('https://github.com/acme/app'), 'acme/app');
  assert.equal(repoFromRemote('https://gitlab.example.com/acme/app'), '');
});

test('snake makes an apk stem', () => {
  assert.equal(snake('Field Notes Pro'), 'field_notes_pro');
  assert.equal(snake(' My  App! '), 'my_app');
});

test('init scaffolds routes, config stub, workflow, plugin entry and scripts, and never overwrites', () => {
  const dir = app();
  const out = init(['--repo', 'acme/my-app', '--branch', 'trunk', '--site', 'https://erp.example.com', '--kit-repo', 'acme/mobile-kit'], dir);
  for (const f of ['app/mobile-kit/settings.tsx', 'app/mobile-kit/devices.tsx', 'src/mobile-kit.ts', '.github/workflows/release.yml']) {
    assert.ok(existsSync(join(dir, f)), f);
  }
  assert.match(readFileSync(join(dir, 'app/mobile-kit/settings.tsx'), 'utf8'), /SettingsRoute as default.*@upande\/mobile-kit/);
  const cfg = readFileSync(join(dir, 'src/mobile-kit.ts'), 'utf8');
  assert.match(cfg, /appName: 'My App'/);
  assert.match(cfg, /githubRepo: 'acme\/my-app'/);
  assert.match(cfg, /site: 'https:\/\/erp\.example\.com'/);
  const wf = readFileSync(join(dir, '.github/workflows/release.yml'), 'utf8');
  assert.match(wf, /branches: \[trunk\]/);
  assert.match(wf, new RegExp(`uses: acme/mobile-kit/\\.github/workflows/release\\.yml@v${KIT_VERSION.replaceAll('.', '\\.')}$`, 'm'));
  assert.doesNotMatch(wf, /release\.yml@v0\s/); // pinned to the kit version, never a floating tag
  assert.match(wf, /app-name: "My App"\n\s+apk-name: my_app\n/);
  assert.doesNotMatch(wf, /__/);
  const expo = JSON.parse(readFileSync(join(dir, 'app.json'), 'utf8')).expo;
  assert.deepEqual(expo.plugins, ['@upande/mobile-kit']);
  assert.equal(expo.updates.url, 'https://erp.example.com/api/method/upande_mobile.api.ota.manifest?app=My%20App');
  assert.equal(expo.extra.otaBaseUrl, 'https://acme.github.io/my-app/ota');
  assert.equal(expo.runtimeVersion, '1.0');
  assert.equal(expo.android.versionCode, 5000);
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['ota:build'], 'upande-mobile-kit publish-ota');
  assert.equal(pkg.scripts.start, 'expo start');
  assert.match(out, /Last steps/);
  assert.match(out, /bench get-app/); // no --bench: the commands are printed

  // second run: the kit's own files are kept, the plugin is not duplicated
  const again = init(['--repo', 'acme/my-app', '--site', 'https://erp.example.com'], dir);
  assert.match(again, /skip   app\/mobile-kit\/settings\.tsx/);
  assert.equal(JSON.parse(readFileSync(join(dir, 'app.json'), 'utf8')).expo.plugins.length, 1);
  // a page of the app's own at /settings is simply left alone: the kit lives under /mobile-kit/, even with --force
  writeFileSync(join(dir, 'app/settings.tsx'), '// mine');
  const forced = init(['--repo', 'acme/my-app', '--force'], dir);
  assert.equal(readFileSync(join(dir, 'app/settings.tsx'), 'utf8'), '// mine');
  assert.match(forced, /your \/settings is untouched \(app\/settings\.tsx\); the kit lives at \/mobile-kit\/settings/);
  // --force still regenerates the config
  writeFileSync(join(dir, 'src/mobile-kit.ts'), '// stale');
  init(['--repo', 'acme/my-app', '--force'], dir);
  assert.match(readFileSync(join(dir, 'src/mobile-kit.ts'), 'utf8'), /configureMobileKit/);
});

test('init explains what is missing', () => {
  assert.throws(() => init([], mkdtempSync(join(tmpdir(), 'kit-empty-'))), /No app\.json/);
  assert.throws(() => init([], app()), /--repo/);
});

test('doctor flags an unconfigured app and passes a configured one', async () => {
  const bad = await check(app());
  assert.ok(bad.some((r) => r.level === 'fail' && /runtimeVersion/.test(r.msg)));
  assert.ok(bad.some((r) => r.level === 'fail' && /otaBaseUrl/.test(r.msg)));
  assert.ok(bad.some((r) => r.level === 'fail' && /not in package.json/.test(r.msg)));

  const dir = app({
    runtimeVersion: '1.0',
    updates: { enabled: true, url: 'https://example.com/m' },
    extra: { otaBaseUrl: 'https://example.com/ota' },
    plugins: ['@upande/mobile-kit'],
  });
  const dev = { '@upande/mobile-kit': '^0.1.0', 'expo-updates': '*', 'expo-constants': '*', 'expo-file-system': '*', 'expo-router': '*', 'expo-intent-launcher': '*', 'expo-local-authentication': '*', 'expo-network': '*', 'expo-device': '*', 'expo-battery': '*', 'expo-localization': '*', 'expo-sensors': '*', '@react-native-async-storage/async-storage': '*' };
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x', dependencies: dev }));
  for (const m of Object.keys(dev)) {
    mkdirSync(join(dir, 'node_modules', m), { recursive: true });
    writeFileSync(join(dir, 'node_modules', m, 'package.json'), JSON.stringify({ name: m, version: '1.0.0' }));
  }
  mkdirSync(join(dir, 'src'));
  mkdirSync(join(dir, 'app'));
  mkdirSync(join(dir, '.github/workflows'), { recursive: true });
  writeFileSync(join(dir, 'src/mobile-kit.ts'), 'configureMobileKit({})');
  writeFileSync(join(dir, 'app/_layout.tsx'), "import '@/src/mobile-kit'; <MobileKitProvider/>");
  mkdirSync(join(dir, 'app/mobile-kit'), { recursive: true });
  writeFileSync(join(dir, 'app/mobile-kit/settings.tsx'), "export { SettingsRoute as default } from '@upande/mobile-kit';");
  writeFileSync(join(dir, 'app/mobile-kit/devices.tsx'), "export { DevicesRoute as default } from '@upande/mobile-kit';");
  writeFileSync(join(dir, '.github/workflows/release.yml'), renderCaller({ appName: 'My App', apkName: 'my_app' }));
  const good = await check(dir);
  assert.deepEqual(good.filter((r) => r.level !== 'ok'), []);
});

test('init --dev-site writes a development/production pair; the bench goes to the dev site and production commands are printed', () => {
  const dir = app();
  const bench = mkdtempSync(join(tmpdir(), 'kit-bench-'));
  const ran = [];
  const out = init(['--repo', 'acme/my-app', '--site', 'https://erp.example.com', '--dev-site', 'http://localhost:8000/', '--bench', bench, '--backend-repo', 'https://github.com/acme/upande_mobile.git'], dir, { exec: (argv) => ran.push(argv.join(' ')) });
  const cfg = readFileSync(join(dir, 'src/mobile-kit.ts'), 'utf8');
  assert.match(cfg, /site: \{ production: 'https:\/\/erp\.example\.com', development: 'http:\/\/localhost:8000' \}/);
  assert.doesNotMatch(cfg, /__(SITE|APP|GITHUB|APK|KIT)\w*__/);
  // production OTA feed in app.json; the bench installs on the DEV host, never production
  assert.match(JSON.parse(readFileSync(join(dir, 'app.json'), 'utf8')).expo.updates.url, /^https:\/\/erp\.example\.com\//);
  assert.ok(ran.some((r) => /--site localhost install-app upande_mobile/.test(r)), ran.join('\n'));
  assert.ok(!ran.some((r) => /erp\.example\.com/.test(r)));
  assert.match(out, /Backend installed on localhost \(development\)/);
  assert.match(out, /Production \(https:\/\/erp\.example\.com\): run these/);
  assert.match(out, /--site erp\.example\.com install-app upande_mobile/);
  assert.match(out, /verify --site https:\/\/erp\.example\.com --dev-site http:\/\/localhost:8000/);
  // --dev-site alone is refused: release builds need a production site
  assert.throws(() => init(['--repo', 'acme/my-app', '--dev-site', 'http://localhost:8000'], app()), /--dev-site needs --site/);
  assert.throws(() => init(['--repo', 'acme/my-app', '--site', 'https://e.example.com', '--dev-site', 'localhost'], app()), /--dev-site must be a URL/);
});

test('doctor probes the development site too, and an unreachable dev site is only a warning', async () => {
  const dir = app({ runtimeVersion: '1.0' });
  const seen = [];
  const res = await check(dir, {
    site: 'https://prod.example.com',
    devSite: 'http://localhost:8000',
    fetchImpl: async (url) => {
      seen.push(url);
      if (url.startsWith('http://localhost')) throw new Error('ECONNREFUSED');
      return { status: 204, headers: { get: (k) => (k === 'expo-protocol-version' ? '1' : null) } };
    },
  });
  assert.equal(seen.length, 2);
  assert.ok(res.some((r) => r.level === 'ok' && /production site OTA/.test(r.msg)));
  assert.ok(res.some((r) => r.level === 'warn' && /development site/.test(r.msg)));
  assert.ok(!res.some((r) => r.level === 'fail' && /site/.test(r.msg)));
});

test('doctor --site checks the manifest endpoint answers with the protocol header', async () => {
  const dir = app({ runtimeVersion: '1.0' });
  const seen = [];
  const ok = await check(dir, {
    site: 'https://site.example.com/',
    fetchImpl: async (url, init) => {
      seen.push([url, init.headers['expo-runtime-version']]);
      return { status: 204, headers: { get: (k) => (k === 'expo-protocol-version' ? '1' : null) } };
    },
  });
  assert.ok(ok.some((r) => r.level === 'ok' && /production site OTA endpoint/.test(r.msg)));
  assert.equal(seen[0][0], 'https://site.example.com/api/method/upande_mobile.api.ota.manifest?app=My%20App');
  assert.equal(seen[0][1], '1.0');
  const bad = await check(dir, { site: 'https://site.example.com', fetchImpl: async () => ({ status: 200, headers: { get: () => null } }) });
  assert.ok(bad.some((r) => r.level === 'fail' && /expo-protocol-version/.test(r.msg)));
  const down = await check(dir, { site: 'https://site.example.com', fetchImpl: async () => { throw new Error('ECONNREFUSED'); } });
  assert.ok(down.some((r) => r.level === 'fail' && /could not reach/.test(r.msg)));
});

test('the updates-url plugin substitutes the runtime and stores otaBaseUrl', () => {
  const withUpdatesUrl = require('../../plugins/withUpdatesUrl.js');
  const out = withUpdatesUrl({ runtimeVersion: '1.2', extra: { keep: 1 } }, { manifestUrl: 'https://x.example.com/m?rt={runtime}', otaBaseUrl: 'https://x.example.com/ota' });
  assert.equal(out.updates.url, 'https://x.example.com/m?rt=1.2');
  assert.equal(out.updates.enabled, true);
  assert.deepEqual(out.extra, { keep: 1, otaBaseUrl: 'https://x.example.com/ota' });
  const cfg = { name: 'x' };
  assert.equal(withUpdatesUrl(cfg, {}), cfg);
});

test('the publish gate catches hostnames, personal names and credential shapes', () => {
  const found = (text) => scanText('f.txt', text);
  assert.ok(found('see https://staging.example.org').length);
  assert.ok(found('a person: dev@company.io').length);
  assert.ok(found('https://owner.github.io/x').length);
  assert.ok(found('host 192.168.88.231').length);
  assert.ok(found('ghp_abcdefghijklmnopqrstuvwxyz0123456789').length);
  assert.ok(found('api_key: "abcd1234efgh5678"').length);
  assert.ok(found('const k = "0123456789abcdef0123456789abcdef"').length);
  assert.ok(found('-----BEGIN RSA PRIVATE KEY-----').length);
  assert.ok(found('https://unlisted-host.example.net/path').length);
  // names that must never ship come from the environment, never from this file
  assert.deepEqual(scanText('f.txt', 'secret-codename here'), []);
  assert.ok(scanText('f.txt', 'secret-codename here', denyPatternsFromEnv('secret-codename;other')).length);
  assert.deepEqual(denyPatternsFromEnv(''), []);
  // fine
  assert.deepEqual(found('https://github.com/acme/app and https://docs.expo.dev/x and https://your.site'), []);
  assert.deepEqual(found("url: 'https://<site>/api/method/x'"), []);
});

test('the CLI binary prints help and rejects unknown commands', () => {
  const bin = join(import.meta.dirname, '../../bin/upande-mobile-kit.mjs');
  assert.match(execFileSync('node', [bin, '--help'], { encoding: 'utf8' }), /init .*set this Expo app up/);
  assert.throws(() => execFileSync('node', [bin, 'nope'], { stdio: 'pipe' }));
  const dir = app();
  assert.match(execFileSync('node', [bin, 'version'], { cwd: dir, encoding: 'utf8' }), /1\.0\.0 -> 1\.0\.1/);
});

test('backendPlan lists get-app, install-app and the register step; hasApp skips get-app', () => {
  const base = { benchSite: 'erp.example.com', backendRepo: 'https://github.com/acme/upande_mobile.git', appName: 'My App', githubRepo: 'acme/my-app', otaBaseUrl: 'https://acme.github.io/my-app/ota' };
  const plan = backendPlan(base);
  assert.deepEqual(plan[0].argv, ['bench', 'get-app', 'https://github.com/acme/upande_mobile.git']);
  assert.deepEqual(plan[1].argv, ['bench', '--site', 'erp.example.com', 'install-app', 'upande_mobile']);
  assert.deepEqual(plan[2].argv.slice(0, 5), ['bench', '--site', 'erp.example.com', 'execute', 'upande_mobile.api.register_app']);
  const kw = JSON.parse(plan[2].argv[6]);
  assert.deepEqual(kw, { app_name: 'My App', github_repo: 'acme/my-app', ota_base_url: 'https://acme.github.io/my-app/ota', enabled: 1 });
  assert.equal(backendPlan({ ...base, hasApp: true }).length, 2);
  assert.match(commandLine(plan[2].argv), /--kwargs '\{"app_name"/);
});

test('urls: manifest endpoint and default OTA base', () => {
  assert.equal(manifestUrl('https://s.example.com/', 'My App'), 'https://s.example.com/api/method/upande_mobile.api.ota.manifest?app=My%20App');
  assert.equal(defaultOtaBaseUrl('Acme/My-App'), 'https://acme.github.io/My-App/ota');
});

test('init --bench runs the plan in order, stops on a failed register, and refuses a placeholder backend repo', () => {
  const dir = app();
  const bench = mkdtempSync(join(tmpdir(), 'kit-bench-'));
  const ran = [];
  const out = init(['--repo', 'acme/my-app', '--site', 'https://erp.example.com', '--bench', bench, '--backend-repo', 'https://github.com/acme/upande_mobile.git'], dir, {
    exec: (argv) => { ran.push(argv.slice(0, 5).join(' ')); },
  });
  // the backend steps, then the native modules (every init path installs them)
  assert.deepEqual(ran.map((r) => r.split(' ').slice(1, 4).join(' ')), ['get-app https://github.com/acme/upande_mobile.git', '--site erp.example.com install-app', '--site erp.example.com execute', 'expo install expo-updates']);
  assert.match(out, /Backend installed on erp\.example\.com/);
  // register_app is idempotent, so a failure there is real (e.g. a rejected URL) and must stop init
  assert.throws(
    () => init(['--repo', 'acme/my-app', '--site', 'https://erp.example.com', '--bench', bench, '--backend-repo', 'https://github.com/acme/y.git', '--force'], app(), { exec: (argv) => { if (argv.includes('execute')) throw new Error('ValidationError: bad url'); } }),
    /bad url/,
  );
  // a failing get-app aborts
  assert.throws(
    () => init(['--repo', 'acme/my-app', '--site', 'https://erp.example.com', '--bench', bench, '--backend-repo', 'https://github.com/acme/x.git', '--force'], app(), { exec: () => { throw new Error('boom'); } }),
    /failed: boom/,
  );
  // placeholder repo: refuse before running anything
  let called = false;
  assert.throws(() => init(['--repo', 'acme/my-app', '--site', 'https://erp.example.com', '--bench', bench, '--backend-repo', 'https://github.com/REPLACE-ME/x.git'], app(), { exec: () => { called = true; } }), /placeholder/);
  assert.equal(called, false);
});

test('init adds the config import to the root layout once', () => {
  const dir = app();
  mkdirSync(join(dir, 'app'), { recursive: true });
  writeFileSync(join(dir, 'app/_layout.tsx'), "import { Stack } from 'expo-router';\nexport default () => <Stack />;\n");
  init(['--repo', 'acme/my-app', '--site', 'https://erp.example.com'], dir);
  init(['--repo', 'acme/my-app', '--site', 'https://erp.example.com'], dir);
  const layout = readFileSync(join(dir, 'app/_layout.tsx'), 'utf8');
  assert.equal(layout.match(/mobile-kit/g).length, 1);
  assert.ok(layout.startsWith("import '../src/mobile-kit';"));
});
