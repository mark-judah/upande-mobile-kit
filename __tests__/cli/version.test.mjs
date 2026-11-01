import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  nextVersion,
  offsetsFrom,
  parseCommit,
  parseVersion,
  releaseKind,
  releaseNotes,
  runtimeVersionFor,
  versionCodeFor,
} from '../../cli/version-lib.mjs';
import { run } from '../../cli/version.mjs';

test('odometer: patch counts 0..99 then rolls the minor', () => {
  assert.equal(nextVersion('1.0.0'), '1.0.1');
  assert.equal(nextVersion('1.0.98'), '1.0.99');
  assert.equal(nextVersion('1.0.99'), '1.1.0');
});

test('odometer: minor counts 0..49 then rolls the major', () => {
  assert.equal(nextVersion('1.49.99'), '2.0.0');
  assert.equal(nextVersion('1.48.99'), '1.49.0');
});

test('bump minor / major skip to a round number', () => {
  assert.equal(nextVersion('1.2.7', 'minor'), '1.3.0');
  assert.equal(nextVersion('1.49.7', 'minor'), '2.0.0');
  assert.equal(nextVersion('1.2.7', 'major'), '2.0.0');
});

test('parseVersion rejects junk and out-of-range digits', () => {
  assert.throws(() => parseVersion('1.2'), /Not a valid/);
  assert.throws(() => parseVersion('a.b.c'), /Not a valid/);
  assert.throws(() => parseVersion('1.50.0'), /out of range/);
  assert.throws(() => parseVersion('1.0.100'), /out of range/);
  assert.deepEqual(parseVersion('3.4.5'), { major: 3, minor: 4, patch: 5 });
});

test('versionCode is dense and strictly increasing across rollovers', () => {
  let v = '1.0.0';
  let prev = versionCodeFor(v);
  for (let i = 0; i < 12000; i += 1) {
    v = nextVersion(v);
    const code = versionCodeFor(v);
    assert.equal(code, prev + 1, `${v} should be one more than its predecessor`);
    prev = code;
  }
});

test('versionCode and runtime honour the offsets', () => {
  assert.equal(versionCodeFor('1.2.3'), (1 * 50 + 2) * 100 + 3);
  assert.equal(versionCodeFor('1.2.3', { versionCodeBase: 100000 }), 100000 + 5203);
  assert.equal(runtimeVersionFor('1.2.3'), '1.2');
  assert.equal(runtimeVersionFor('1.2.3', { runtimeMajorBase: 100 }), '101.2');
});

test('offsetsFrom reads app.json extra.mobileKit and defaults to zero', () => {
  assert.deepEqual(offsetsFrom({}), { versionCodeBase: 0, runtimeMajorBase: 0 });
  assert.deepEqual(offsetsFrom({ expo: { extra: { mobileKit: { versionCodeBase: 100000, runtimeMajorBase: 100 } } } }), {
    versionCodeBase: 100000,
    runtimeMajorBase: 100,
  });
});

test('a patch stays an OTA release, a new minor needs an APK', () => {
  assert.equal(releaseKind('1.2', '1.2.4', {}), 'ota');
  assert.equal(releaseKind('1.2', '1.3.0', {}), 'apk');
  assert.equal(releaseKind('101.2', '1.2.4', { runtimeMajorBase: 100 }), 'ota');
  // a runtime still on an old shape (not a major.minor string) always needs an APK
  assert.equal(releaseKind(undefined, '1.2.4', {}), 'apk');
});

test('commit parsing and release notes', () => {
  const c = [
    { hash: 'aaaaaaa1', subject: 'feat(ui): add thing', body: '' },
    { hash: 'bbbbbbb2', subject: 'fix: crash on open', body: '' },
    { hash: 'ccccccc3', subject: 'refactor!: drop api', body: '' },
    { hash: 'ddddddd4', subject: 'tidy up', body: 'BREAKING CHANGE: x' },
    { hash: 'eeeeeee5', subject: 'whatever', body: '' },
  ].map(parseCommit);
  assert.equal(c[0].scope, 'ui');
  assert.equal(c[2].breaking, true);
  assert.equal(c[3].breaking, true);
  const notes = releaseNotes('1.2.4', c, 'v1.2.3', 'acme/app');
  assert.match(notes, /## v1\.2\.4/);
  assert.match(notes, /BREAKING CHANGES/);
  assert.match(notes, /### Features[\s\S]*\*\*ui:\*\* add thing \(aaaaaaa\)/);
  assert.match(notes, /### Bug Fixes/);
  assert.match(notes, /### Other/);
  assert.match(notes, /compare\/v1\.2\.3\.\.\.v1\.2\.4/);
  assert.match(releaseNotes('1.0.0', [], null, undefined), /No commits since/);
});

// ── the script, end to end, in a throwaway git repo ───────────────────────────

function repo({ version = '1.2.3', runtimeVersion = '1.2', expo = '~54.0.0', extra = {}, updates } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'kit-version-'));
  const git = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' });
  git('init', '-q');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 't');
  writeFileSync(
    join(dir, 'app.json'),
    JSON.stringify({ expo: { name: 'T', version, runtimeVersion, android: { package: 'com.example.t' }, extra, ...(updates ? { updates } : {}) } }),
  );
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 't', version, dependencies: { expo } }));
  git('add', '.');
  git('commit', '-q', '-m', 'feat: first');
  return { dir, git };
}

test('version --json plans a patch as an OTA release', () => {
  const { dir } = repo();
  const plan = JSON.parse(run(['--json'], dir));
  assert.equal(plan.version, '1.2.4');
  assert.equal(plan.release, 'ota');
  assert.equal(plan.runtimeVersion, '1.2');
  assert.equal(plan.tag, 'v1.2.4');
  assert.equal(plan.commitCount, 1);
});

test('version --json plans a bump to a new minor as an APK release', () => {
  const { dir } = repo();
  const plan = JSON.parse(run(['--json', '--bump', 'minor'], dir));
  assert.equal(plan.version, '1.3.0');
  assert.equal(plan.release, 'apk');
  assert.equal(plan.runtimeVersion, '1.3');
});

test('version --apply writes app.json and package.json and moves the update URL with the runtime', () => {
  const { dir } = repo({
    version: '1.2.99',
    runtimeVersion: '1.2',
    updates: { enabled: true, url: 'https://example.com/ota/android/1.2/manifest.json' },
  });
  run(['--apply'], dir);
  const app = JSON.parse(readFileSync(join(dir, 'app.json'), 'utf8')).expo;
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  assert.equal(app.version, '1.3.0');
  assert.equal(pkg.version, '1.3.0');
  assert.equal(app.runtimeVersion, '1.3');
  assert.equal(app.android.versionCode, versionCodeFor('1.3.0'));
  assert.equal(app.updates.url, 'https://example.com/ota/android/1.3/manifest.json');
  assert.equal(app.extra.runtimeSdk, 54);
});

test('version --apply leaves an update URL without a runtime folder alone', () => {
  const { dir } = repo({ updates: { enabled: true, url: 'https://example.com/api/method/x.manifest?app=T' } });
  run(['--apply'], dir);
  assert.equal(JSON.parse(readFileSync(join(dir, 'app.json'), 'utf8')).expo.updates.url, 'https://example.com/api/method/x.manifest?app=T');
});

test('a new Expo SDK promotes a patch to a minor so it ships as an APK', () => {
  const { dir } = repo({ expo: '~55.0.0', extra: { runtimeSdk: 54 } });
  const plan = JSON.parse(run(['--json'], dir));
  assert.equal(plan.bump, 'minor');
  assert.equal(plan.version, '1.3.0');
  assert.equal(plan.release, 'apk');
});

test('--set starts a numbering line, offsets keep it apart from the old one', () => {
  const { dir } = repo({ extra: { mobileKit: { versionCodeBase: 100000, runtimeMajorBase: 100 } } });
  const plan = JSON.parse(run(['--json', '--set', '1.0.0'], dir));
  assert.equal(plan.version, '1.0.0');
  assert.equal(plan.runtimeVersion, '101.0');
  assert.equal(plan.versionCode, 100000 + 5000);
  assert.throws(() => run(['--set', '1.0'], dir), /Not a valid/);
});

test('--keep-version --notes describes commits since the last tag', () => {
  const { dir, git } = repo();
  git('tag', 'v1.2.3');
  writeFileSync(join(dir, 'x.txt'), 'x');
  git('add', '.');
  git('commit', '-q', '-m', 'fix(core): stop the crash');
  const notes = run(['--keep-version', '--notes'], dir);
  assert.match(notes, /## v1\.2\.3/);
  assert.match(notes, /\*\*core:\*\* stop the crash/);
  assert.doesNotMatch(notes, /first/);
});

test('dry run prints a summary line and changes nothing', () => {
  const { dir } = repo();
  const line = run([], dir);
  assert.match(line, /^1\.2\.3 -> 1\.2\.4 \(patch, versionCode \d+, 1 commit since the beginning\)/);
  assert.equal(JSON.parse(readFileSync(join(dir, 'app.json'), 'utf8')).expo.version, '1.2.3');
});
