import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { KIT_VERSION, WORKFLOW_REF } from '../../cli/constants.mjs';
import { check } from '../../cli/doctor.mjs';
import { run as realInit } from '../../cli/init.mjs';
import { verify } from '../../cli/verify.mjs';
import { run as version } from '../../cli/version.mjs';
import { decideRelease, releaseKind, scanMarkers } from '../../cli/version-lib.mjs';
import { parseCaller, renderCaller, updateWorkflow, workflowChecks } from '../../cli/workflow.mjs';

const ROOT = join(import.meta.dirname, '../..');
const yaml = await import('yaml').then((m) => m.default ?? m).catch(() => null); // dev-only parser: the parse tests skip without it

/* ───────────── markers and the decision ───────────── */

const c = (hash, subject, body = '') => ({ hash: hash.padEnd(40, '0'), subject, body });

test('scanMarkers: tokens, case, body, and only whole bracketed tokens count', () => {
  assert.equal(scanMarkers([c('aaaaaaa', 'fix: x [apk]')]).apk, 'aaaaaaa');
  assert.equal(scanMarkers([c('bbbbbbb', 'fix: x [build-apk]')]).apk, 'bbbbbbb');
  assert.equal(scanMarkers([c('ccccccc', 'fix: x [APK]')]).apk, 'ccccccc'); // any case
  assert.equal(scanMarkers([c('ddddddd', 'fix: x', 'details\n\n[native]')]).native, 'ddddddd'); // in the body
  assert.equal(scanMarkers([c('eeeeeee', 'fix: x [runtime]')]).native, 'eeeeeee');
  assert.equal(scanMarkers([c('fffffff', 'feat!: x [major]')]).major, 'fffffff');
  const none = scanMarkers([c('1111111', 'fix: apk stuff'), c('2222222', 'fix: [apkish] [apk-x] (apk)')]);
  assert.deepEqual(none, { apk: null, native: null, major: null, otaCancelled: false });
});

test('scanMarkers: [ota] cancels [apk] only from the NEWEST commit (list is newest first)', () => {
  assert.equal(scanMarkers([c('new0000', 'fix: b [ota]'), c('old0000', 'fix: a [apk]')]).apk, null);
  assert.equal(scanMarkers([c('new0000', 'fix: b [skip-apk]'), c('old0000', 'fix: a [apk]')]).apk, null);
  assert.equal(scanMarkers([c('new0000', 'fix: b [apk] [ota]')]).apk, null); // contradictory: [ota] wins
  assert.equal(scanMarkers([c('new0000', 'fix: b [apk]'), c('old0000', 'fix: a [ota]')]).apk, 'new0000'); // an older [ota] does nothing
  assert.equal(scanMarkers([c('mid0000', 'fix: m'), c('new0000', 'fix: b'), c('old0000', 'fix: a [ota]')]).otaCancelled, false);
  // [ota] does not cancel a native/major request
  const m = scanMarkers([c('new0000', 'fix: b [ota]'), c('old0000', 'feat: a [native]')]);
  assert.equal(m.native, 'old0000');
});

const base = { commits: [], sdkChanged: false, currentRuntime: '1.2', offsets: {}, currentVersion: '1.2.7' };

test('decideRelease: precedence, explicit flags win over markers', () => {
  const d = (o) => decideRelease({ ...base, ...o });
  assert.equal(d({}).bump, 'patch');
  assert.equal(d({ commits: [c('abc1234', 'feat: x [native]')] }).bump, 'minor');
  assert.equal(d({ commits: [c('abc1234', 'feat: x [major]'), c('def1234', 'feat: y [native]')] }).bump, 'major');
  assert.equal(d({ bumpFlag: 'auto', commits: [c('abc1234', 'x [native]')] }).bump, 'minor');
  assert.equal(d({ bumpFlag: 'patch', commits: [c('abc1234', 'x [native]')] }).bump, 'minor'); // patch = unspecified
  assert.equal(d({ bumpFlag: 'minor', commits: [c('abc1234', 'x [ota]')] }).bump, 'minor');
  assert.equal(d({ bumpFlag: 'major', commits: [c('abc1234', 'x [native]')] }).bump, 'major');
  assert.equal(d({ setTo: '3.0.0', commits: [c('abc1234', 'x [native]')] }).bump, 'patch'); // --set decides the version itself
  assert.equal(d({ sdkChanged: true }).bump, 'minor');
  assert.equal(d({ apkFlag: true }).forceApk, true);
  assert.equal(d({ commits: [c('abc1234', 'x [apk]')] }).forceApk, true);
  assert.throws(() => d({ bumpFlag: 'huge' }), /--bump must be/);
});

test('releaseKind: forceApk and unknown (non-string) runtimes', () => {
  assert.equal(releaseKind('1.2', '1.2.8', {}), 'ota');
  assert.equal(releaseKind('1.2', '1.2.8', {}, true), 'apk');
  assert.equal(releaseKind('1.2', '1.3.0', {}), 'apk');
  assert.equal(releaseKind({ policy: 'appVersion' }, '1.2.8', {}), 'apk'); // never equal to "1.2"
  assert.equal(releaseKind(undefined, '1.2.8', {}), 'apk');
});

/* ───────────── the version command in real git repos ───────────── */

function repo(expo = {}, pkgExtra = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'kit-rel-'));
  const git = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' });
  git('init', '-q');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 't');
  writeFileSync(join(dir, 'app.json'), JSON.stringify({ expo: { name: 'A', version: '1.2.7', runtimeVersion: '1.2', ...expo } }));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'a', version: '1.2.7', dependencies: {}, ...pkgExtra }));
  git('add', '-A');
  git('commit', '-qm', 'chore: init');
  git('tag', 'v1.2.7');
  const commit = (subject, body = '') => {
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src', `f${Math.random()}.ts`), 'x');
    git('add', '-A');
    git('commit', '-qm', body ? `${subject}\n\n${body}` : subject);
  };
  return { dir, commit };
}
const json = (dir, ...args) => JSON.parse(version(['--json', ...args], dir));

test('version: a plain fix is a patch OTA, and says why', () => {
  const r = repo();
  r.commit('fix: thing');
  const j = json(r.dir);
  assert.equal(j.version, '1.2.8');
  assert.equal(j.release, 'ota');
  assert.equal(j.forceApk, false);
  assert.match(j.reason, /keeps runtime 1\.2.*no APK/);
  assert.match(version([], r.dir), /release: OTA - .*no APK/);
});

test('version: [apk] attaches an APK on the SAME runtime (patch version)', () => {
  const r = repo();
  r.commit('fix: a');
  r.commit('fix: b [apk]');
  const j = json(r.dir);
  assert.deepEqual([j.version, j.runtimeVersion, j.release, j.forceApk], ['1.2.8', '1.2', 'apk', true]);
  assert.match(j.reason, /commit [0-9a-f]{7} contains \[apk\]/);
  assert.match(version([], r.dir), /release: APK - commit [0-9a-f]{7} contains \[apk\]/);
});

test('version: [native] and [runtime] mean a new runtime (minor) and an APK; [major] a major one', () => {
  const a = repo();
  a.commit('feat: camera [native]');
  const ja = json(a.dir);
  assert.deepEqual([ja.version, ja.runtimeVersion, ja.release], ['1.3.0', '1.3', 'apk']);
  assert.match(ja.reason, /\[native\]\/\[runtime\].*runtime changes from 1\.2 to 1\.3/);
  const b = repo();
  b.commit('chore: x', '[runtime]');
  assert.equal(json(b.dir).release, 'apk');
  const m = repo();
  m.commit('feat!: big [major]');
  const jm = json(m.dir);
  assert.deepEqual([jm.version, jm.runtimeVersion, jm.release], ['2.0.0', '2.0', 'apk']);
});

test('version: [ota] in the newest commit cancels an older [apk]; the other way round does not', () => {
  const a = repo();
  a.commit('fix: a [apk]');
  a.commit('fix: b [ota]');
  assert.equal(json(a.dir).release, 'ota');
  const b = repo();
  b.commit('fix: a [ota]');
  b.commit('fix: b [apk]');
  assert.equal(json(b.dir).release, 'apk');
});

test('version: explicit flags win over commit markers', () => {
  const r = repo();
  r.commit('fix: a [ota]');
  const minor = json(r.dir, '--bump', 'minor');
  assert.deepEqual([minor.version, minor.release], ['1.3.0', 'apk']);
  const set = json(r.dir, '--set', '1.2.20');
  assert.deepEqual([set.version, set.release], ['1.2.20', 'ota']);
  const apk = json(r.dir, '--apk');
  assert.deepEqual([apk.version, apk.release, apk.forceApk], ['1.2.8', 'apk', true]);
  assert.match(apk.reason, /--apk/);
  assert.equal(json(r.dir, '--bump', 'auto').release, 'ota'); // accepted explicitly
  assert.throws(() => json(r.dir, '--bump', 'huge'), /--bump must be/);
  const n = repo();
  n.commit('feat: x [native]');
  assert.equal(json(n.dir, '--bump', 'patch').version, '1.3.0'); // patch = unspecified: markers apply
  assert.equal(json(n.dir, '--bump', 'major').version, '2.0.0');
});

test('version: an Expo SDK change still forces a minor (new runtime, APK)', () => {
  const r = repo({ extra: { runtimeSdk: 53 } }, { dependencies: { expo: '~54.0.0' } });
  r.commit('fix: a');
  const j = json(r.dir);
  assert.deepEqual([j.version, j.release], ['1.3.0', 'apk']);
  assert.match(j.reason, /Expo SDK changed/);
});

test('version: a runtimeVersion policy object means this release needs an APK (why 1.2.7 had one)', () => {
  const r = repo({ runtimeVersion: { policy: 'appVersion' } });
  r.commit('fix: a');
  const j = json(r.dir);
  assert.equal(j.release, 'apk');
  assert.match(j.reason, /policy object.*plain x\.y runtime, so it needs an APK/);
  // applying writes the plain string, so the NEXT patch is an OTA
  version(['--apply'], r.dir);
  assert.equal(JSON.parse(readFileSync(join(r.dir, 'app.json'), 'utf8')).expo.runtimeVersion, '1.2');
  execFileSync('git', ['add', '-A'], { cwd: r.dir });
  execFileSync('git', ['commit', '-qm', 'chore(release): 1.2.8 [skip ci]'], { cwd: r.dir });
  execFileSync('git', ['tag', 'v1.2.8'], { cwd: r.dir });
  r.commit('fix: b');
  assert.equal(json(r.dir).release, 'ota');
  // a missing runtimeVersion is the same
  const m = repo({ runtimeVersion: undefined });
  m.commit('fix: a');
  assert.equal(json(m.dir).release, 'apk');
});

/* ───────────── the workflow files ───────────── */

const reusable = readFileSync(join(ROOT, '.github/workflows/release.yml'), 'utf8');
const template = readFileSync(join(ROOT, 'templates/release-caller.yml'), 'utf8');

test('reusable workflow: build_apk input, bump passed through, decision in the summary and the release notes', () => {
  assert.match(reusable, /build_apk:\n\s+description: .*\n\s+required: false\n\s+type: boolean\n\s+default: false/);
  assert.match(reusable, /to\+=\(--apk\)/);
  assert.match(reusable, /--bump "\$\{BUMP:-auto\}"/);
  assert.doesNotMatch(reusable, /\[ "\$bump" = "auto" \] && bump=patch/); // the CLI decides now
  assert.match(reusable, /echo "reason=\$\(jq -r \.reason version\.json\)"/);
  assert.match(reusable, /Release type:\*\* %s \(reason: %s\)/);
  assert.match(reusable, /GITHUB_STEP_SUMMARY/);
  // old callers (no build_apk) keep working: the input is optional with a default
  assert.match(reusable, /build_apk:[\s\S]*required: false/);
  // no untrusted-looking interpolation of inputs straight into the shell
  assert.doesNotMatch(reusable, /bump="\$\{\{ inputs\.bump \}\}"/);
});

test('reusable workflow and caller template parse as YAML', { skip: !yaml }, () => {
  const w = yaml.parse(reusable);
  assert.equal(w.on.workflow_call.inputs.build_apk.type, 'boolean');
  assert.equal(w.on.workflow_call.inputs.build_apk.default, false);
  assert.equal(w.on.workflow_call.inputs.bump.default, 'auto');
  const t = yaml.parse(template);
  assert.deepEqual(Object.keys(t.on.workflow_dispatch.inputs), ['bump', 'set_version', 'build_apk']);
  assert.equal(t.on.workflow_dispatch.inputs.build_apk.type, 'boolean');
  assert.match(t.on.workflow_dispatch.inputs.build_apk.description, /Also build and attach an APK \(same runtime, OTA keeps working\)/);
  assert.equal(t.jobs.release.with.build_apk, '${{ inputs.build_apk || false }}');
  assert.equal(t.jobs.release.with.bump, "${{ inputs.bump || 'auto' }}");
  assert.equal(t.jobs.release.with.set_version, "${{ inputs.set_version || '' }}");
  // the rendered caller parses too, and its call is pinned
  const text = renderCaller({ appName: 'My App', apkName: 'my_app', branch: 'trunk' });
  const r = yaml.parse(text);
  assert.deepEqual(r.on.push.branches, ['trunk']);
  assert.equal(r.jobs.release.uses, `mark-judah/upande-mobile-kit/.github/workflows/release.yml@${WORKFLOW_REF}`);
  assert.equal(r.jobs.release.with['app-name'], 'My App');
});

test('the caller is pinned to the kit version, not a floating tag', () => {
  assert.equal(WORKFLOW_REF, `v${KIT_VERSION}`);
  assert.match(WORKFLOW_REF, /^v\d+\.\d+\.\d+$/);
  const text = renderCaller({ appName: 'My App', apkName: 'my_app' });
  assert.match(text, new RegExp(`release\\.yml@v${KIT_VERSION.replaceAll('.', '\\.')}\\n`));
  assert.doesNotMatch(text, /__[A-Z_]+__/);
});

/* ───────────── init pin, --update-workflow, verify and doctor ───────────── */

const OLD_CALLER = `name: Release

on:
  push:
    branches: [trunk]
    paths-ignore: ['**/*.md', 'docs/**']
  workflow_dispatch:
    inputs:
      bump: { description: auto | patch | minor | major, type: string, default: auto }
      set_version: { description: Exact version (starts a new release line), type: string, default: '' }

concurrency: { group: release, cancel-in-progress: false }
permissions: { contents: write }

jobs:
  release:
    uses: mark-judah/upande-mobile-kit/.github/workflows/release.yml@v0
    with: { app-name: "Demo App", apk-name: demo_app, bump: "\${{ inputs.bump || 'auto' }}", set_version: "\${{ inputs.set_version || '' }}" }
    secrets: inherit
`;

function appWithCaller(text = OLD_CALLER) {
  const dir = mkdtempSync(join(tmpdir(), 'kit-wf-'));
  mkdirSync(join(dir, '.github/workflows'), { recursive: true });
  writeFileSync(join(dir, '.github/workflows/release.yml'), text);
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'a', dependencies: {} }));
  writeFileSync(join(dir, 'app.json'), JSON.stringify({ expo: { name: 'Demo App', version: '1.0.0', runtimeVersion: '1.0' } }));
  return dir;
}

test('init writes a caller pinned to the installed kit version', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kit-initpin-'));
  writeFileSync(join(dir, 'app.json'), JSON.stringify({ expo: { name: 'My App', version: '1.0.0' } }));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'a', dependencies: {} }));
  realInit(['--repo', 'acme/my-app', '--site', 'https://erp.example.com', '--branch', 'trunk', '--no-install'], dir, { exec: () => {} });
  const wf = readFileSync(join(dir, '.github/workflows/release.yml'), 'utf8');
  assert.match(wf, new RegExp(`@v${KIT_VERSION.replaceAll('.', '\\.')}\\n`));
  assert.match(wf, /build_apk:/);
  assert.match(wf, /branches: \[trunk\]/);
});

test('parseCaller reads the old one-line form and the new block form', () => {
  const old = parseCaller(OLD_CALLER);
  assert.deepEqual([old.kitRepo, old.ref, old.appName, old.apkName, old.branch, old.hasBuildApk], ['mark-judah/upande-mobile-kit', 'v0', 'Demo App', 'demo_app', 'trunk', false]);
  const fresh = parseCaller(renderCaller({ appName: 'My App', apkName: 'my_app', branch: 'trunk' }));
  assert.deepEqual([fresh.ref, fresh.appName, fresh.apkName, fresh.branch, fresh.hasBuildApk], [WORKFLOW_REF, 'My App', 'my_app', 'trunk', true]);
});

test('init --update-workflow rewrites only the workflow, keeps the values, backs up, is idempotent', () => {
  const dir = appWithCaller();
  const before = readFileSync(join(dir, 'app.json'), 'utf8');
  const out = realInit(['--update-workflow'], dir, { exec: () => { throw new Error('must not run anything'); } });
  assert.match(out, new RegExp(`@v0 -> @${WORKFLOW_REF}`));
  assert.match(out, /app-name "Demo App", apk-name demo_app, branch trunk/);
  const wf = readFileSync(join(dir, '.github/workflows/release.yml'), 'utf8');
  assert.match(wf, new RegExp(`mark-judah/upande-mobile-kit/\\.github/workflows/release\\.yml@${WORKFLOW_REF.replaceAll('.', '\\.')}\\n`));
  assert.match(wf, /branches: \[trunk\]/);
  assert.match(wf, /build_apk: \$\{\{ inputs\.build_apk \|\| false \}\}/);
  // backup of the OLD file, outside the app folder; gitignored
  const stamps = readdirBackup(dir);
  assert.equal(stamps.length, 1);
  assert.match(readFileSync(join(dir, '.upande-mobile-kit/backup', stamps[0], '.github/workflows/release.yml'), 'utf8'), /release\.yml@v0/);
  assert.match(readFileSync(join(dir, '.gitignore'), 'utf8'), /\.upande-mobile-kit\//);
  // nothing else was touched
  assert.equal(readFileSync(join(dir, 'app.json'), 'utf8'), before);
  assert.equal(existsSync(join(dir, 'src/mobile-kit.ts')), false);
  // second run: already up to date, no new backup
  assert.match(realInit(['--update-workflow'], dir, {}), /already up to date/);
  assert.equal(readdirBackup(dir).length, 1);
  // --no-backup
  const d2 = appWithCaller();
  realInit(['--update-workflow', '--no-backup'], d2, {});
  assert.equal(existsSync(join(d2, '.upande-mobile-kit')), false);
});

function readdirBackup(dir) {
  return execFileSync('ls', [join(dir, '.upande-mobile-kit/backup')], { encoding: 'utf8' }).split('\n').filter(Boolean);
}

test('init --update-workflow needs an existing workflow', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kit-wfnone-'));
  assert.throws(() => updateWorkflow(dir, []), /does not exist/);
});

test('workflowChecks, verify and doctor warn on a floating ref and a missing build_apk input, with the exact fix', async () => {
  const old = appWithCaller();
  const checks = workflowChecks(old);
  assert.equal(checks.filter((x) => x.level === 'warn').length, 2);
  assert.match(checks[0].msg, /floating ref @v0/);
  assert.match(checks[1].msg, /no build_apk input/);
  assert.ok(checks.every((x) => x.fix === 'npx upande-mobile-kit init --update-workflow'));
  const v = await verify(old, {});
  assert.ok(v.some((r) => r.level === 'warn' && /floating ref @v0/.test(r.msg) && r.fix === 'npx upande-mobile-kit init --update-workflow'));
  assert.ok(v.some((r) => r.level === 'warn' && /no build_apk input/.test(r.msg)));
  const d = await check(old, {});
  assert.ok(d.some((r) => r.level === 'warn' && /floating ref @v0/.test(r.msg) && /init --update-workflow/.test(r.msg)));
  // after the update: pinned and with the input, so nothing to warn about
  realInit(['--update-workflow'], old, {});
  const after = workflowChecks(old);
  assert.deepEqual(after.map((x) => x.level), ['ok']);
  assert.ok(!(await verify(old, {})).some((r) => /floating|build_apk|pinned to @v0\.\d/.test(r.msg) && r.level !== 'ok'));
});

test('a caller pinned to an OLDER kit version is flagged, a current one is not', () => {
  const [maj, min, pat] = KIT_VERSION.split('.').map(Number);
  const oldRef = min > 0 ? `v${maj}.${min - 1}.${pat}` : `v${Math.max(0, maj - 1)}.9.9`;
  const dir = appWithCaller(renderCaller({ ref: oldRef, appName: 'X', apkName: 'x' }));
  const w = workflowChecks(dir);
  assert.equal(w[0].level, 'warn');
  assert.match(w[0].msg, new RegExp(`pinned to @${oldRef.replaceAll('.', '\\.')}, the installed kit is v${KIT_VERSION.replaceAll('.', '\\.')}`));
  const cur = appWithCaller(renderCaller({ appName: 'X', apkName: 'x' }));
  assert.deepEqual(workflowChecks(cur).map((x) => x.level), ['ok']);
});

test('no workflow file: no workflow checks (callers report the missing file themselves)', () => {
  assert.deepEqual(workflowChecks(mkdtempSync(join(tmpdir(), 'kit-nowf-'))), []);
});
