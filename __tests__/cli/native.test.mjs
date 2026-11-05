import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { check as doctorCheck } from '../../cli/doctor.mjs';
import { run as fix, rebuildNote } from '../../cli/fix.mjs';
import { NATIVE_MODULES } from '../../cli/constants.mjs';
import { detectPackageManager, expoInstallArgv, FIX_COMMAND, MODULES, moduleStatus, missingModules, skipFor } from '../../cli/native-modules.mjs';
import { verify } from '../../cli/verify.mjs';

const require = createRequire(import.meta.url);
const plugin = require('../../app.plugin.js');
const { checkNativeModules } = require('../../plugins/withNativeModulesCheck.js');

/** A throwaway app. `declared` are in package.json, `installed` have node_modules/<pkg>/package.json. */
function app({ declared = [], installed = declared, lock = null, biometricHost = false, parent = null } = {}) {
  const root = parent ?? mkdtempSync(join(tmpdir(), 'kit-native-'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'x', dependencies: Object.fromEntries(declared.map((m) => [m, '~1.0.0'])) }));
  writeFileSync(join(root, 'app.json'), JSON.stringify({ expo: { name: 'X', version: '1.0.0' } }));
  for (const m of installed) {
    mkdirSync(join(root, 'node_modules', m), { recursive: true });
    writeFileSync(join(root, 'node_modules', m, 'package.json'), JSON.stringify({ name: m, version: '1.0.0' }));
  }
  if (lock) writeFileSync(join(root, lock), '');
  if (biometricHost) {
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src/mobile-kit.ts'), "configureMobileKit({ biometric: 'host' });");
  }
  return root;
}

/** What a successful `expo install` leaves behind. */
const fakeInstall = (root, pkgs, version = '2.0.0') => {
  const pj = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  for (const m of pkgs) {
    pj.dependencies[m] = `~${version}`;
    mkdirSync(join(root, 'node_modules', m), { recursive: true });
    writeFileSync(join(root, 'node_modules', m, 'package.json'), JSON.stringify({ name: m, version }));
  }
  writeFileSync(join(root, 'package.json'), JSON.stringify(pj));
};

/* ── the one shared list ── */

test('the shared list is the one source: eleven modules, the CLI constant is derived from it, file-system probes its real native names', () => {
  assert.equal(MODULES.length, 11);
  assert.deepEqual(NATIVE_MODULES, MODULES.map((m) => m.pkg));
  assert.deepEqual(NATIVE_MODULES, [
    'expo-updates', 'expo-constants', 'expo-file-system', 'expo-intent-launcher', 'expo-local-authentication',
    'expo-network', 'expo-device', 'expo-battery', 'expo-localization', 'expo-sensors', '@react-native-async-storage/async-storage',
  ]);
  const fs = MODULES.find((m) => m.pkg === 'expo-file-system');
  assert.deepEqual(fs.native, ['FileSystem', 'ExponentFileSystem']);
  assert.equal(FIX_COMMAND, 'npx upande-mobile-kit fix');
  // none is a peerDependency: only `expo install` knows the version for the app's SDK
  const kit = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  // a required peer would be auto-installed by npm at the HIGHEST version, wrong for the app's SDK; optional peers are never auto-installed
  for (const m of NATIVE_MODULES) {
    assert.ok(!(m in (kit.peerDependencies ?? {})) || kit.peerDependenciesMeta?.[m]?.optional === true, `${m} must not be a required peerDependency`);
  }
  assert.ok((kit.files ?? []).includes('shared'), 'the shared list ships with the package');
});

test('moduleStatus/missingModules: declared-but-not-installed and installed-but-not-declared both count as missing; hoisted parents count as installed', () => {
  const root = app({ declared: ['expo-updates', 'expo-constants'], installed: ['expo-updates'] });
  const st = Object.fromEntries(moduleStatus(root).map((s) => [s.pkg, s]));
  assert.deepEqual([st['expo-updates'].inPackageJson, st['expo-updates'].installed], [true, true]);
  assert.deepEqual([st['expo-constants'].inPackageJson, st['expo-constants'].installed], [true, false]);
  assert.deepEqual([st['expo-network'].inPackageJson, st['expo-network'].installed], [false, false]);
  assert.equal(missingModules(root).length, 10);
  // installed only in a parent folder's node_modules (a monorepo): fine
  const mono = mkdtempSync(join(tmpdir(), 'kit-mono-'));
  app({ declared: [], installed: ['expo-device'], parent: mono });
  const child = join(mono, 'apps', 'mobile');
  mkdirSync(child, { recursive: true });
  writeFileSync(join(child, 'package.json'), JSON.stringify({ dependencies: { 'expo-device': '~1.0.0' } }));
  assert.equal(moduleStatus(child).find((s) => s.pkg === 'expo-device').installed, true);
});

test('skipFor leaves out expo-local-authentication only for a host-owned lock', () => {
  assert.deepEqual(skipFor(), []);
  assert.deepEqual(skipFor({ biometricHost: true }), ['expo-local-authentication']);
});

test('expoInstallArgv puts the package manager flag from the lockfile before the packages', () => {
  assert.deepEqual(expoInstallArgv(null, ['a', 'b']), ['npx', 'expo', 'install', 'a', 'b']);
  assert.deepEqual(expoInstallArgv('pnpm', ['a']), ['npx', 'expo', 'install', '--pnpm', 'a']);
  for (const [lock, pm] of [['pnpm-lock.yaml', 'pnpm'], ['yarn.lock', 'yarn'], ['bun.lockb', 'bun'], ['package-lock.json', 'npm']]) {
    assert.equal(detectPackageManager(app({ lock })), pm);
  }
  assert.equal(detectPackageManager(app()), null);
});

/* ── fix ── */

test('fix --dry-run prints the command and why, and changes nothing', () => {
  const root = app({ declared: ['expo-updates'], installed: [], lock: 'yarn.lock' });
  const ran = [];
  const r = fix(['--dry-run'], root, { exec: (a) => ran.push(a) });
  assert.deepEqual(ran, []);
  assert.equal(r.ok, true);
  assert.match(r.text, /Would run \(nothing was changed\):\n {2}npx expo install --yarn expo-updates expo-constants /);
  assert.match(r.text, /✗ expo-updates: in package.json but not installed/);
  assert.match(r.text, /✗ expo-constants: not installed/);
  assert.deepEqual(r.argv.slice(0, 4), ['npx', 'expo', 'install', '--yarn']);
});

test('fix installs only what is missing through the injected exec, reports the changes and the new-native-build note, and is idempotent', () => {
  const have = NATIVE_MODULES.filter((m) => m !== 'expo-battery' && m !== 'expo-file-system');
  const root = app({ declared: have });
  const ran = [];
  const r = fix([], root, { exec: (a, o) => { ran.push({ a, cwd: o.cwd }); fakeInstall(root, ['expo-battery', 'expo-file-system'], '3.1.4'); } });
  assert.equal(ran.length, 1);
  assert.deepEqual(ran[0].a, ['npx', 'expo', 'install', 'expo-file-system', 'expo-battery']);
  assert.equal(ran[0].cwd, root);
  assert.equal(r.ok, true);
  assert.match(r.text, /run    npx expo install expo-file-system expo-battery/);
  assert.match(r.text, /Changes:\n {2}\+ expo-file-system ~3\.1\.4\n {2}\+ expo-battery ~3\.1\.4/);
  assert.match(r.text, /✓ all 11 native modules are installed\./);
  assert.match(r.text, /These changes need a NEW NATIVE BUILD \(an OTA update will not deliver them\):\n {2}• expo-file-system\n {2}• expo-battery/);
  assert.match(r.text, /Expo Go already includes these modules/);
  // again: nothing to do, nothing run
  const again = fix([], root, { exec: () => assert.fail('must not run') });
  assert.equal(again.ok, true);
  assert.match(again.text, /all 11 native modules are installed .* Nothing to do\./);
  assert.doesNotMatch(again.text, /NEW NATIVE BUILD/);
});

test('fix --align also re-pins the modules already installed and shows the version changes', () => {
  const root = app({ declared: NATIVE_MODULES });
  const r = fix(['--align'], root, { exec: (a) => { assert.equal(a.length, 3 + NATIVE_MODULES.length); fakeInstall(root, ['expo-network'], '9.9.9'); } });
  assert.match(r.text, /--align: re-pinning 11 installed module\(s\)/);
  assert.match(r.text, /~ expo-network: 1\.0\.0 -> 9\.9\.9/);
  assert.match(r.text, /NEW NATIVE BUILD[\s\S]*expo-network/);
});

test('fix reports a failed install with the exact command, and a module that is still missing afterwards, and exits not-ok', () => {
  const root = app({ declared: [] });
  const failed = fix([], root, { exec: () => { throw new Error('network down\nlong stack'); } });
  assert.equal(failed.ok, false);
  assert.match(failed.text, /✗ the install failed: network down/);
  assert.match(failed.text, /fix: run it yourself from the app root: {2}npx expo install expo-updates/);
  assert.ok(!/long stack/.test(failed.text));
  // the command "succeeds" but one package never lands
  const partial = fix([], app({ declared: [] }), { exec: () => {} });
  assert.equal(partial.ok, false);
  assert.match(partial.text, /✗ expo-updates is still not in package\.json/);
});

test('fix leaves out expo-local-authentication when the host owns the biometric lock', () => {
  const root = app({ declared: NATIVE_MODULES.filter((m) => m !== 'expo-local-authentication'), biometricHost: true });
  const r = fix([], root, { exec: () => assert.fail('nothing is missing') });
  assert.equal(r.ok, true);
  assert.match(r.text, /expo-local-authentication skipped: your app owns the biometric lock/);
  assert.match(r.text, /all 10 native modules are installed/);
});

test('fix needs a package.json and never prompts or hangs: the default exec runs with CI=1 and a time limit', () => {
  assert.throws(() => fix([], mkdtempSync(join(tmpdir(), 'kit-empty-'))), /No package\.json/);
  const src = readFileSync(new URL('../../cli/fix.mjs', import.meta.url), 'utf8');
  assert.match(src, /CI: '1'/);
  assert.match(src, /timeout: INSTALL_TIMEOUT_MS/);
  assert.match(rebuildNote(['a']), /• a/);
});

/* ── verify / doctor: missing modules are errors now ── */

test('verify and doctor mark every missing module as an error naming the one fix command; only a host-owned lock softens expo-local-authentication', async () => {
  const root = app({ declared: ['expo-router'] });
  const res = await verify(root, { fetchImpl: async () => ({ status: 204, headers: { get: () => '1' } }) });
  const mods = res.filter((r) => /is not installed in this app/.test(r.msg));
  assert.equal(mods.length, 11);
  assert.ok(mods.every((r) => r.level === 'fail' && /^npx upande-mobile-kit fix/.test(r.fix)), JSON.stringify(mods));
  const doc = await doctorCheck(root);
  const dmods = doc.filter((r) => /is not installed in this app/.test(r.msg));
  assert.equal(dmods.length, 11);
  assert.ok(dmods.every((r) => r.level === 'fail' && /npx upande-mobile-kit fix/.test(r.msg)));

  const host = app({ declared: ['expo-router'], biometricHost: true });
  const hres = await verify(host, { fetchImpl: async () => ({ status: 204, headers: { get: () => '1' } }) });
  const lockLine = hres.find((r) => /expo-local-authentication is not installed/.test(r.msg));
  assert.equal(lockLine.level, 'warn');
  assert.equal(hres.filter((r) => /is not installed in this app/.test(r.msg) && r.level === 'fail').length, 10);
  const dhost = await doctorCheck(host);
  assert.equal(dhost.find((r) => /expo-local-authentication is not installed/.test(r.msg)).level, 'warn');
  // in package.json but not in node_modules is its own wording
  const half = app({ declared: ['expo-router', 'expo-updates'], installed: ['expo-router'] });
  const hh = await verify(half, { fetchImpl: async () => ({ status: 204, headers: { get: () => '1' } }) });
  assert.ok(hh.some((r) => r.level === 'fail' && /expo-updates is in package\.json but not in node_modules/.test(r.msg)));
});

/* ── the config plugin stops the build ── */

test('the plugin throws when a native module is missing, listing them and the fix command', () => {
  const root = app({ declared: NATIVE_MODULES.filter((m) => m !== 'expo-device' && m !== 'expo-battery') });
  assert.throws(
    () => plugin({ name: 'x', _internal: { projectRoot: root } }, {}),
    (e) => /needs native modules this app is missing: expo-device, expo-battery/.test(e.message) && /npx upande-mobile-kit fix/.test(e.message) && /strict": false/.test(e.message),
  );
  const msg = checkNativeModules(root, {});
  assert.match(msg, /- expo-device: not installed \(device model and memory unavailable\)/);
});

test('the plugin passes when everything is installed, and "strict": false downgrades the failure to a warning', () => {
  const full = app({ declared: NATIVE_MODULES });
  assert.equal(checkNativeModules(full, {}), null);
  assert.doesNotThrow(() => plugin({ name: 'x', _internal: { projectRoot: full } }, {}));

  const bare = app({ declared: [] });
  const warned = [];
  const old = console.warn;
  console.warn = (...a) => warned.push(a.join(' '));
  try {
    const out = plugin({ name: 'x', _internal: { projectRoot: bare } }, { strict: false });
    assert.equal(out.name, 'x');
  } finally {
    console.warn = old;
  }
  assert.equal(warned.length, 1);
  assert.match(warned[0], /\[@upande\/mobile-kit\].*expo-updates/s);
});

test('the plugin skips expo-local-authentication for biometric: "host" (prop or src/mobile-kit.ts) and only that', () => {
  const others = NATIVE_MODULES.filter((m) => m !== 'expo-local-authentication');
  const root = app({ declared: others });
  assert.match(checkNativeModules(root, {}), /expo-local-authentication/);
  assert.equal(checkNativeModules(root, { biometric: 'host' }), null);
  const viaConfig = app({ declared: others, biometricHost: true });
  assert.equal(checkNativeModules(viaConfig, {}), null);
  // another missing module still stops the build under biometric: host
  const missingOther = app({ declared: others.filter((m) => m !== 'expo-network') });
  assert.match(checkNativeModules(missingOther, { biometric: 'host' }), /expo-network/);
});

test('the plugin looks from the PROJECT root, not from where the kit sits inside node_modules, and finds hoisted installs', () => {
  const mono = mkdtempSync(join(tmpdir(), 'kit-plugin-mono-'));
  app({ declared: [], installed: NATIVE_MODULES, parent: mono }); // hoisted to the workspace root
  const project = join(mono, 'apps', 'mobile');
  mkdirSync(project, { recursive: true });
  writeFileSync(join(project, 'package.json'), JSON.stringify({ dependencies: Object.fromEntries(NATIVE_MODULES.map((m) => [m, '~1.0.0'])) }));
  assert.doesNotThrow(() => plugin({ name: 'x', _internal: { projectRoot: project } }, {}));
  // a project with a node_modules of its own that lacks them, run "from inside node_modules" of the kit: still judged by its own root
  const lacking = app({ declared: [] });
  const kitInside = join(lacking, 'node_modules', '@upande', 'mobile-kit');
  mkdirSync(kitInside, { recursive: true });
  const prev = process.cwd();
  process.chdir(kitInside);
  try {
    assert.throws(() => plugin({ name: 'x', _internal: { projectRoot: lacking } }, {}), /needs native modules this app is missing/);
  } finally {
    process.chdir(prev);
  }
  // no _internal.projectRoot: falls back to the working directory
  const viaCwd = app({ declared: NATIVE_MODULES });
  process.chdir(viaCwd);
  try {
    assert.doesNotThrow(() => plugin({ name: 'x' }, {}));
  } finally {
    process.chdir(prev);
  }
});
