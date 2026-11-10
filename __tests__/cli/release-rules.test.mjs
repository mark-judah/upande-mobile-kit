import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { classifyFiles, fileReasons, globToRegExp, nativeSurface, releaseLists, surfaceDiff } from '../../cli/release-rules.mjs';
import { run as version } from '../../cli/version.mjs';

test('globs: ** crosses folders, * and ? stay inside one, **/ may match nothing', () => {
  const m = (g, f) => globToRegExp(g).test(f);
  assert.ok(m('src/**', 'src/a/b/c.ts'));
  assert.ok(!m('src/**', 'srcx/a.ts'));
  assert.ok(m('**/*.md', 'README.md'));
  assert.ok(m('**/*.md', 'docs/a/b.md'));
  assert.ok(m('assets/fonts/*.ttf', 'assets/fonts/a.ttf'));
  assert.ok(!m('assets/fonts/*.ttf', 'assets/fonts/x/a.ttf'));
  assert.ok(m('a?.js', 'ab.js'));
  assert.ok(!m('a.js', 'abjs'));
});

test('classifyFiles: JS-only is quiet, native is APK, unknown means APK, the app lists add to the defaults', () => {
  const files = ['src/a.ts', 'app/b.tsx', 'README.md', 'patches/x.patch', 'modules/cam/index.ts', 'assets/fonts/a.ttf', 'package.json', 'mystery.bin'];
  const r = classifyFiles(files, { apk: ['modules/**'], ota: ['assets/fonts/**'] });
  assert.deepEqual(r.apk, ['patches/x.patch', 'modules/cam/index.ts']);
  assert.deepEqual(r.unknown, ['mystery.bin']);
  // the app's apk list wins over the built-in JS-only list
  assert.deepEqual(classifyFiles(['src/native/a.ts'], { apk: ['src/native/**'], ota: [] }).apk, ['src/native/a.ts']);
  assert.deepEqual(classifyFiles(['src/a.ts']), { apk: [], unknown: [] });
});

test('releaseLists ignores anything that is not a list of strings, and a leading ./ ', () => {
  assert.deepEqual(releaseLists({ expo: { extra: { mobileKit: { release: { apk: ['./modules/**', 5, ''], ota: 'x' } } } } }), { apk: ['modules/**'], ota: [] });
  assert.deepEqual(releaseLists({}), { apk: [], ota: [] });
});

test('fileReasons names the files and tells the developer what to do about unknown ones', () => {
  assert.deepEqual(fileReasons({ apk: [], unknown: [] }), []);
  const out = fileReasons({ apk: ['patches/a'], unknown: ['x.bin'] });
  assert.match(out[0], /need an APK changed \(patches\/a\)/);
  assert.match(out[1], /x\.bin is not in the release lists.*release\.ota/);
});

/* ───────────── the native surface ───────────── */

function pkgIn(root, name, files) {
  for (const [f, body] of Object.entries(files)) {
    const p = join(root, 'node_modules', name, f);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, body);
  }
}
function app(deps = ['expo-camera', 'zustand', 'lottie-react-native', '@upande/mobile-kit']) {
  const root = mkdtempSync(join(tmpdir(), 'kit-surface-'));
  pkgIn(root, 'expo-camera', { 'package.json': '{"version":"1.0.0"}', 'android/build.gradle': '' });
  pkgIn(root, 'zustand', { 'package.json': '{"version":"5.0.0"}', 'index.js': '' });
  // a library no name pattern would ever catch, with native code
  pkgIn(root, 'lottie-react-native', { 'package.json': '{"version":"7.0.0"}', 'ios/Lottie.m': '' });
  pkgIn(root, '@upande/mobile-kit', { 'package.json': '{"version":"0.18.0"}', 'app.plugin.js': 'a', 'shared/native-modules.json': '[]', 'plugins/x.js': 'x' });
  const pkg = { dependencies: Object.fromEntries(deps.map((d) => [d, '*'])) };
  return { root, pkg, cfg: { expo: { name: 'A', plugins: ['@upande/mobile-kit'] } } };
}

test('surface: only packages with native code count, whatever they are called', () => {
  const a = app();
  const s = nativeSurface(a.root, a.pkg, a.cfg);
  assert.deepEqual(Object.keys(s.parts).sort(), ['@upande/mobile-kit (native modules and plugins)', 'app.json (native fields)', 'expo-camera', 'lottie-react-native']);
});

test('surface: a JS-only library or a kit bump that changes no native file leaves it unchanged', () => {
  const a = app();
  const before = nativeSurface(a.root, a.pkg, a.cfg);
  pkgIn(a.root, 'zustand', { 'package.json': '{"version":"5.1.0"}' });
  pkgIn(a.root, '@upande/mobile-kit', { 'package.json': '{"version":"0.18.1"}' });
  assert.deepEqual(surfaceDiff(before, nativeSurface(a.root, a.pkg, a.cfg)), []);
});

test('surface: a kit release that adds a native module, a native library bump and a plugin edit are all caught', () => {
  const a = app();
  const before = nativeSurface(a.root, a.pkg, a.cfg);
  pkgIn(a.root, '@upande/mobile-kit', { 'shared/native-modules.json': '[{"pkg":"expo-sensors"}]' });
  pkgIn(a.root, 'lottie-react-native', { 'package.json': '{"version":"7.1.0"}' });
  const out = surfaceDiff(before, nativeSurface(a.root, a.pkg, { expo: { ...a.cfg.expo, plugins: ['@upande/mobile-kit', 'x'] } })).join(' | ');
  assert.match(out, /changed since the last APK: .*@upande\/mobile-kit.*app\.json.*lottie-react-native/);
  // and a library that appears
  pkgIn(a.root, 'react-native-newlib', { 'package.json': '{"version":"1.0.0"}', 'android/x': '' });
  const more = surfaceDiff(before, nativeSurface(a.root, { dependencies: { ...a.pkg.dependencies, 'react-native-newlib': '*' } }, a.cfg));
  assert.match(more.join(' '), /added since the last APK: react-native-newlib/);
});

test('surface: no node_modules means no opinion, not a guess', () => {
  assert.equal(nativeSurface(mkdtempSync(join(tmpdir(), 'kit-empty-')), { dependencies: {} }, {}), null);
});

/* ───────────── the version command, end to end ───────────── */

function project() {
  const a = app();
  const git = (...x) => execFileSync('git', x, { cwd: a.root, stdio: 'ignore' });
  git('init', '-q');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 't');
  writeFileSync(join(a.root, '.gitignore'), 'node_modules\n');
  writeFileSync(join(a.root, 'app.json'), JSON.stringify({ expo: { name: 'A', version: '1.2.7', runtimeVersion: '1.2', plugins: ['@upande/mobile-kit'] } }));
  writeFileSync(join(a.root, 'package.json'), JSON.stringify({ name: 'a', version: '1.2.7', dependencies: a.pkg.dependencies }));
  git('add', '-A');
  git('commit', '-qm', 'chore: init');
  git('tag', 'v1.2.7');
  const commit = (subject, file = 'src/a.ts') => {
    mkdirSync(join(a.root, dirname(file)), { recursive: true });
    writeFileSync(join(a.root, file), String(Math.random()));
    git('add', '-A');
    git('commit', '-qm', subject);
  };
  const plan = (...args) => JSON.parse(version(['--json', ...args], a.root));
  const apply = (...args) => version(['--apply', ...args], a.root);
  const cfg = () => JSON.parse(readFileSync(join(a.root, 'app.json'), 'utf8'));
  return { ...a, git, commit, plan, apply, cfg };
}

test('a JS-only change is an OTA, and the first release records the native baseline without forcing anything', () => {
  const p = project();
  p.commit('fix: thing');
  const j = p.plan();
  assert.equal(j.release, 'ota');
  assert.equal(j.version, '1.2.8');
  p.apply();
  const mk = p.cfg().expo.extra.mobileKit;
  assert.ok(mk.nativeBaseline.hash);
  assert.equal(mk.apkTag, undefined);
});

test('a kit bump that adds a native module needs an APK on a NEW runtime, with no marker and no name pattern', () => {
  const p = project();
  p.commit('fix: first');
  p.apply();
  p.git('add', '-A');
  p.git('commit', '-qm', 'chore(release): 1.2.8 [skip ci]');
  p.git('tag', 'v1.2.8');
  p.commit('chore: update @upande/mobile-kit');
  pkgIn(p.root, '@upande/mobile-kit', { 'shared/native-modules.json': '[{"pkg":"expo-sensors"}]' });
  const j = p.plan();
  assert.equal(j.release, 'apk');
  assert.equal(j.version, '1.3.0');
  assert.equal(j.runtimeVersion, '1.3');
  assert.match(j.reason, /native code changed since the last APK: @upande\/mobile-kit/);
});

test('a native change that once went out as an OTA is still caught by the next release (the baseline is the last APK)', () => {
  const p = project();
  p.commit('fix: first');
  p.apply();
  p.git('add', '-A');
  p.git('commit', '-qm', 'chore(release): 1.2.8 [skip ci]');
  p.git('tag', 'v1.2.8');
  // someone ships a native change under [ota]
  p.commit('feat: new lib [ota]');
  pkgIn(p.root, 'lottie-react-native', { 'package.json': '{"version":"8.0.0"}' });
  assert.equal(p.plan().release, 'ota', 'the newest commit asked for an OTA');
  p.apply();
  p.git('add', '-A');
  p.git('commit', '-qm', 'chore(release): 1.2.9 [skip ci]');
  p.git('tag', 'v1.2.9');
  // a later, innocent release must still see the debt
  p.commit('fix: something else');
  const j = p.plan();
  assert.equal(j.release, 'apk');
  assert.match(j.reason, /lottie-react-native/);
});

test('an unlisted file builds an APK and names the file; listing it under release.ota makes it an OTA', () => {
  const p = project();
  p.commit('feat: a model file', 'assets/model.bin');
  const j = p.plan();
  assert.equal(j.release, 'apk');
  assert.match(j.reason, /assets\/model\.bin is not in the release lists/);
  const cfg = p.cfg();
  cfg.expo.extra = { mobileKit: { release: { ota: ['assets/**'] } } };
  writeFileSync(join(p.root, 'app.json'), JSON.stringify(cfg));
  assert.equal(p.plan().release, 'ota');
});

test('a file in the apk list needs an APK even though src/** is JS-only', () => {
  const p = project();
  const cfg = p.cfg();
  cfg.expo.extra = { mobileKit: { release: { apk: ['src/native/**'] } } };
  writeFileSync(join(p.root, 'app.json'), JSON.stringify(cfg));
  p.git('add', '-A');
  p.git('commit', '-qm', 'chore: config');
  p.commit('feat: native glue', 'src/native/Cam.ts');
  const j = p.plan();
  assert.equal(j.release, 'apk');
  assert.match(j.reason, /files that need an APK changed \(src\/native\/Cam\.ts\)/);
});

test('an APK release saves the new baseline and its tag, so the next release compares with it', () => {
  const p = project();
  p.commit('fix: first');
  p.apply();
  p.git('add', '-A');
  p.git('commit', '-qm', 'chore(release): 1.2.8 [skip ci]');
  p.git('tag', 'v1.2.8');
  pkgIn(p.root, 'expo-camera', { 'package.json': '{"version":"2.0.0"}' });
  p.commit('chore: bump camera');
  assert.equal(p.plan().release, 'apk');
  p.apply();
  const mk = p.cfg().expo.extra.mobileKit;
  assert.equal(mk.apkTag, 'v1.3.0');
  assert.equal(p.cfg().expo.runtimeVersion, '1.3');
  p.git('add', '-A');
  p.git('commit', '-qm', 'chore(release): 1.3.0 [skip ci]');
  p.git('tag', 'v1.3.0');
  p.commit('fix: after the apk');
  assert.equal(p.plan().release, 'ota');
});

/* ───────────── app.json carries every setting, with a comment ───────────── */

import { ensureMobileKitConfig } from '../../cli/release-rules.mjs';

test('ensureMobileKitConfig adds the release lists, the offsets and a comment, keeps what is there, and is idempotent', () => {
  const cfg = { expo: { name: 'A', extra: { otaBaseUrl: 'x', mobileKit: { sites: { production: 'https://s' }, versionCodeBase: 100000, release: { ota: ['assets/**'] } } } } };
  assert.equal(ensureMobileKitConfig(cfg), true);
  const mk = cfg.expo.extra.mobileKit;
  assert.match(mk._help, /live here/);
  assert.match(mk.release._help, /APK or OTA/);
  assert.deepEqual(mk.release.apk, []);
  assert.deepEqual(mk.release.ota, ['assets/**']);
  assert.equal(mk.versionCodeBase, 100000);
  assert.equal(mk.runtimeMajorBase, 0);
  assert.deepEqual(mk.sites, { production: 'https://s' });
  assert.equal(cfg.expo.extra.otaBaseUrl, 'x');
  assert.equal(ensureMobileKitConfig(cfg), false);
  assert.equal(ensureMobileKitConfig({}), false);
});

test('an APK release through `version --apply` writes the block and still saves the baseline', () => {
  const p = project();
  p.commit('fix: first');
  p.apply();
  const mk = p.cfg().expo.extra.mobileKit;
  assert.ok(mk.release && Array.isArray(mk.release.apk));
  assert.ok(mk.nativeBaseline.hash);
  assert.deepEqual(releaseLists(p.cfg()), { apk: [], ota: [] });
});
