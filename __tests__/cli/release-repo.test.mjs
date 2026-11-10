import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { WORKFLOW_REF } from '../../cli/constants.mjs';
import { check } from '../../cli/doctor.mjs';
import { run as realInit } from '../../cli/init.mjs';
import { probeReleaseRepo } from '../../cli/site-checks.mjs';
import { verify } from '../../cli/verify.mjs';
import { run as version } from '../../cli/version.mjs';
import { normaliseTagPrefix, previousTagPatterns, releaseNotes, sourceTag, tagPrefixFor } from '../../cli/version-lib.mjs';
import { loadSaved, main } from '../../cli/wizard.mjs';
import { parseCaller, releaseRepoChecks, renderCaller, withReleaseRepo } from '../../cli/workflow.mjs';

const ROOT = join(import.meta.dirname, '../..');
const yaml = await import('yaml').then((m) => m.default ?? m).catch(() => null); // dev-only parser: the parse tests skip without it
// Tests never run a real `expo install` or bench command.
const init = (argv, root, opts = {}) => realInit(argv, root, { exec: () => {}, ...opts });

/* ───────────── tags: pure helpers ───────────── */

test('tag prefix: a branch names the tags, a given prefix is normalised, junk is refused', () => {
  assert.equal(tagPrefixFor('mutara-frappe16'), 'mutara-frappe16/');
  assert.equal(tagPrefixFor('release/kaitet'), 'release/kaitet/');
  assert.equal(tagPrefixFor(''), '');
  assert.equal(normaliseTagPrefix('kaitet'), 'kaitet/');
  assert.equal(normaliseTagPrefix('kaitet//'), 'kaitet/');
  assert.equal(normaliseTagPrefix(''), '');
  assert.equal(normaliseTagPrefix(undefined), '');
  for (const bad of ['a b', 'a..b', 'x*', 'x?', 'x[1]', '/x', 'a:b']) assert.throws(() => normaliseTagPrefix(bad), /Not a usable tag prefix/, bad);
  assert.equal(sourceTag('1.2.3'), 'v1.2.3');
  assert.equal(sourceTag('1.2.3', 'kaitet/'), 'kaitet/v1.2.3');
  // this branch's own tags first, then the plain tags from before the switch; no prefix is exactly the old lookup
  assert.deepEqual(previousTagPatterns('kaitet/'), ['kaitet/v[0-9]*', 'v[0-9]*']);
  assert.deepEqual(previousTagPatterns(''), ['v[0-9]*']);
});

test('release notes: no link into the (private) source repo when the tags are namespaced', () => {
  assert.match(releaseNotes('1.2.4', [], 'v1.2.3', 'acme/app'), /compare\/v1\.2\.3\.\.\.v1\.2\.4/);
  assert.doesNotMatch(releaseNotes('1.2.4', [], 'kaitet/v1.2.3', 'acme/app', { tagPrefix: 'kaitet/' }), /Full changelog/);
});

/* ───────────── tags: `version` in a repo with two client branches ───────────── */

const CALLER_BODY = (branch, releaseRepo) => renderCaller({ appName: 'T', apkName: 't', branch, releaseRepo });

function clientRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'kit-relrepo-'));
  const git = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 't');
  const app = { expo: { name: 'T', version: '1.0.0', runtimeVersion: '1.0', android: { package: 'com.example.t' }, extra: { mobileKit: { release: { ota: ['*.txt'] } } } } };
  writeFileSync(join(dir, 'app.json'), JSON.stringify(app));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 't', version: '1.0.0', dependencies: { expo: '~54.0.0' } }));
  writeFileSync(join(dir, '.gitignore'), 'node_modules\n');
  mkdirSync(join(dir, 'node_modules')); // an (empty) install: the native surface can be recorded
  git('add', '.');
  git('commit', '-q', '-m', 'feat: first');
  git('tag', 'v1.0.0'); // released from main before anyone used a release repo
  const commit = (file, msg) => {
    writeFileSync(join(dir, file), msg);
    git('add', '.');
    git('commit', '-q', '-m', msg);
  };
  return { dir, git, commit };
}

test('version: each branch finds its OWN previous tag, never another branch\'s, and falls back to the plain v* tags', () => {
  const { dir, git, commit } = clientRepo();
  // kaitet and mutara branch off main; both have released since, at the same version number
  git('checkout', '-q', '-b', 'kaitet');
  commit('k.txt', 'fix: kaitet one');
  git('tag', 'kaitet/v1.0.1');
  git('checkout', '-q', 'main');
  git('checkout', '-q', '-b', 'mutara');
  // before its first namespaced release: the plain tag from main is the previous release
  let plan = JSON.parse(version(['--json', '--tag-prefix', 'mutara/'], dir));
  assert.equal(plan.previousTag, 'v1.0.0');
  assert.equal(plan.tag, 'mutara/v1.0.1');
  assert.equal(plan.releaseTag, 'v1.0.1');
  commit('m.txt', 'fix: mutara one');
  git('tag', 'mutara/v1.0.1');
  commit('m2.txt', 'fix: mutara two');
  // kaitet's work reaches mutara through a merge, with a NEWER tag on it: still not mutara's previous release
  git('checkout', '-q', 'kaitet');
  commit('k2.txt', 'fix: kaitet two');
  git('tag', 'kaitet/v1.0.2');
  git('checkout', '-q', 'mutara');
  git('merge', '-q', '--no-edit', 'kaitet');
  plan = JSON.parse(version(['--json', '--tag-prefix', 'mutara/'], dir));
  assert.equal(plan.previousTag, 'mutara/v1.0.1');
  assert.equal(plan.tag, `mutara/v${plan.version}`);
  assert.equal(plan.releaseTag, `v${plan.version}`);
  assert.equal(plan.tagPrefix, 'mutara/');
  // the commits counted are the ones since mutara's own release (merge commits are skipped)
  const notes = version(['--keep-version', '--notes', '--tag-prefix', 'mutara/'], dir);
  assert.match(notes, /mutara two/);
  assert.match(notes, /kaitet two/);
  assert.doesNotMatch(notes, /mutara one/);
  // without a prefix nothing changes: the nearest v* tag, plain tags
  const plain = JSON.parse(version(['--json'], dir));
  assert.equal(plain.previousTag, 'v1.0.0');
  assert.equal(plain.tag, 'v1.0.1');
  assert.equal(plain.releaseTag, 'v1.0.1');
  assert.equal(plain.tagPrefix, '');
});

test('version: the prefix comes from the caller workflow when it names a release repo; --tag-prefix "" overrides it', () => {
  const { dir, git, commit } = clientRepo();
  git('checkout', '-q', '-b', 'kaitet');
  mkdirSync(join(dir, '.github/workflows'), { recursive: true });
  writeFileSync(join(dir, '.github/workflows/release.yml'), CALLER_BODY('kaitet', 'acme/app-kaitet-releases'));
  commit('k.txt', 'fix: one');
  git('tag', 'kaitet/v1.0.1');
  commit('k2.txt', 'fix: two');
  const plan = JSON.parse(version(['--json'], dir));
  assert.equal(plan.tag, 'kaitet/v1.0.1'); // app.json still says 1.0.0: the workflow commits the bump
  assert.equal(plan.previousTag, 'kaitet/v1.0.1');
  assert.equal(plan.commitCount, 1);
  assert.match(version([], dir), /tags: kaitet\/v1\.0\.1 in this repo, v1\.0\.1 in the release repository/);
  assert.equal(JSON.parse(version(['--json', '--tag-prefix', ''], dir)).tag, 'v1.0.1');
  // a caller without release-repo: plain tags, and no extra line in the preview
  writeFileSync(join(dir, '.github/workflows/release.yml'), CALLER_BODY('kaitet', ''));
  assert.equal(JSON.parse(version(['--json'], dir)).tag, 'v1.0.1');
  assert.doesNotMatch(version([], dir), /tags:/);
});

test('version --apply records the namespaced tag as apkTag, and the next release compares with it', () => {
  const { dir, git, commit } = clientRepo();
  git('checkout', '-q', '-b', 'kaitet');
  version(['--apply', '--bump', 'minor', '--tag-prefix', 'kaitet/'], dir);
  const mk = JSON.parse(readFileSync(join(dir, 'app.json'), 'utf8')).expo.extra.mobileKit;
  assert.equal(mk.apkTag, 'kaitet/v1.1.0');
  git('add', '.');
  git('commit', '-q', '-m', 'chore(release): 1.1.0 [skip ci]');
  git('tag', 'kaitet/v1.1.0');
  commit('k.txt', 'fix: one');
  const plan = JSON.parse(version(['--json', '--tag-prefix', 'kaitet/'], dir));
  assert.equal(plan.previousTag, 'kaitet/v1.1.0');
  assert.equal(plan.release, 'ota', plan.reason); // k.txt is listed as OTA-safe; nothing native moved since kaitet/v1.1.0
});

/* ───────────── the caller template ───────────── */

test('caller: release-repo is a comment until set; set, it is a real input that parses and round-trips', () => {
  const plain = renderCaller({ appName: 'My App', apkName: 'my_app', branch: 'mutara' });
  assert.match(plain, /^ {6}# release-repo: /m);
  assert.doesNotMatch(plain, /^ {6}release-repo:/m);
  assert.equal(parseCaller(plain).releaseRepo, null);
  const set = renderCaller({ appName: 'My App', apkName: 'my_app', branch: 'mutara', releaseRepo: 'acme/app-mutara-releases' });
  assert.match(set, /^ {6}release-repo: acme\/app-mutara-releases$/m);
  assert.doesNotMatch(set, /__[A-Z_]+__/);
  const c = parseCaller(set);
  assert.deepEqual([c.releaseRepo, c.branch, c.ref, c.appName], ['acme/app-mutara-releases', 'mutara', WORKFLOW_REF, 'My App']);
  assert.throws(() => renderCaller({ appName: 'A', apkName: 'a', releaseRepo: 'not a repo' }), /owner\/repo/);
  if (yaml) {
    assert.equal(yaml.parse(set).jobs.release.with['release-repo'], 'acme/app-mutara-releases');
    assert.equal(yaml.parse(plain).jobs.release.with['release-repo'], undefined);
    assert.equal(yaml.parse(set).jobs.release.secrets, 'inherit'); // RELEASE_REPO_TOKEN reaches the reusable workflow
  }
});

test('withReleaseRepo sets, replaces and removes the line, and refuses the old one-line form', () => {
  const plain = renderCaller({ appName: 'A', apkName: 'a' });
  const set = withReleaseRepo(plain, 'acme/a-releases');
  assert.equal(parseCaller(set).releaseRepo, 'acme/a-releases');
  assert.equal(parseCaller(withReleaseRepo(set, 'acme/other')).releaseRepo, 'acme/other');
  const removed = withReleaseRepo(set, '');
  assert.equal(parseCaller(removed).releaseRepo, null);
  assert.equal(withReleaseRepo(plain, ''), plain);
  // a caller written before the comment existed: the line goes after build_apk, same indent
  const older = plain.replace(/^ *# release-repo:.*\n/m, '');
  assert.match(withReleaseRepo(older, 'acme/a-releases'), /build_apk: .*\n {6}release-repo: acme\/a-releases\n/);
  assert.equal(withReleaseRepo('with: { app-name: "A", apk-name: a }\n', 'acme/a-releases'), null);
});

/* ───────────── the reusable workflow ───────────── */

const reusable = readFileSync(join(ROOT, '.github/workflows/release.yml'), 'utf8');

test('reusable workflow: release-repo input and RELEASE_REPO_TOKEN are optional; empty keeps today\'s behaviour', { skip: !yaml }, () => {
  const w = yaml.parse(reusable);
  const input = w.on.workflow_call.inputs['release-repo'];
  assert.deepEqual([input.type, input.required, input.default], ['string', false, '']);
  assert.equal(w.on.workflow_call.secrets.RELEASE_REPO_TOKEN.required, false);
  const steps = w.jobs.release.steps;
  const byName = (n) => steps.find((s) => s.name === n);
  // checked right after checkout, before anything is built
  assert.equal(steps.findIndex((s) => s.name === 'Check the release repository'), 1);
  // Pages: the own gh-pages without a release repo, the release repo's with one
  const own = byName('Publish the JS update to GitHub Pages');
  assert.equal(own.if, "steps.dest.outputs.external != 'true'");
  assert.equal(own.with.github_token, '${{ secrets.GITHUB_TOKEN }}');
  const ext = byName("Publish the JS update to the release repository's GitHub Pages");
  assert.equal(ext.if, "steps.dest.outputs.external == 'true'");
  assert.equal(ext.with.personal_token, '${{ secrets.RELEASE_REPO_TOKEN }}');
  assert.equal(ext.with.external_repository, '${{ steps.dest.outputs.repo }}');
  assert.equal(ext.with.keep_files, true);
  // the Releases go to the destination repo, with the plain tag, and the commit only when it lives there
  for (const n of ['Publish GitHub Release (APK)', 'Publish GitHub Release (OTA)']) {
    const s = byName(n);
    assert.equal(s.with.repository, '${{ steps.dest.outputs.repo }}', n);
    assert.equal(s.with.token, "${{ steps.dest.outputs.external == 'true' && secrets.RELEASE_REPO_TOKEN || github.token }}", n);
    assert.equal(s.with.tag_name, '${{ steps.version.outputs.release_tag }}', n);
    assert.equal(s.with.target_commitish, "${{ steps.dest.outputs.external != 'true' && steps.bump.outputs.sha || '' }}", n);
  }
});

test('reusable workflow: fails early without a usable token, namespaces the source tag, and links the release repo', () => {
  const step = reusable.slice(reusable.indexOf('- name: Check the release repository'), reusable.indexOf('- uses: actions/setup-node'));
  assert.match(step, /if \[ -z "\$RELEASE_REPO" \]; then\n.*echo "repo=\$GITHUB_REPOSITORY"; echo "external=false"; echo "tag_prefix="/);
  assert.match(step, /RELEASE_REPO_TOKEN is not set/);
  assert.match(step, /cannot see \$RELEASE_REPO/);
  assert.match(step, /push --dry-run/);
  assert.match(step, /cannot write to \$RELEASE_REPO/);
  assert.match(step, /::add-mask::/);
  assert.match(step, /echo "tag_prefix=\$BRANCH\/"/);
  assert.doesNotMatch(step, /set -x/);
  // the CLI gets the prefix both for the plan and for the notes
  assert.match(reusable, /to\+=\(--tag-prefix "\$TAG_PREFIX"\)/);
  assert.match(reusable, /--keep-version --notes --tag-prefix "\$TAG_PREFIX"/);
  assert.match(reusable, /echo "release_tag=\$\(jq -r '\.releaseTag \/\/ \.tag' version\.json\)"/);
  // the namespaced tag is pushed here, and created through the API when the push is refused
  assert.match(reusable, /git tag -a "\$\{\{ steps\.version\.outputs\.tag \}\}"/);
  assert.match(reusable, /gh api "repos\/\$GITHUB_REPOSITORY\/git\/refs" -f ref="refs\/tags\/\$TAG"/);
  // the bump commit still goes to this branch
  assert.match(reusable, /git push origin HEAD:\$\{\{ github\.ref_name \}\}/);
  // summary links use the destination repo and the plain tag
  const summary = reusable.slice(reusable.indexOf('- name: Job summary'));
  assert.match(summary, /https:\/\/github\.com\/\$REPO\/releases\/tag\/\$RELEASE_TAG/);
  assert.match(summary, /https:\/\/github\.com\/\$REPO\/releases\/download\/\$RELEASE_TAG\//);
  assert.doesNotMatch(summary, /github\.repository/);
});

/* ───────────── init ───────────── */

function app({ origin = 'https://github.com/acme/scp.git', branch = 'mutara' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'kit-relinit-'));
  writeFileSync(join(dir, 'app.json'), JSON.stringify({ expo: { name: 'SCP', version: '1.0.0', android: { package: 'com.example.scp' } } }));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'scp', dependencies: {} }));
  const git = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' });
  git('init', '-q', '-b', branch);
  if (origin) git('remote', 'add', 'origin', origin);
  git('-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init'); // so the branch is detected
  return dir;
}

const read = (dir, f) => readFileSync(join(dir, f), 'utf8');

test('init --release-repo: phones, server and workflow all point at the release repo; the source stays the source', () => {
  const dir = app();
  const out = init(['--site', 'https://erp.example.com', '--release-repo', 'acme/scp-mutara-releases', '--no-install'], dir);
  assert.match(read(dir, 'src/mobile-kit.ts'), /githubRepo: 'acme\/scp-mutara-releases'/);
  assert.equal(JSON.parse(read(dir, 'app.json')).expo.extra.otaBaseUrl, 'https://acme.github.io/scp-mutara-releases/ota');
  const c = parseCaller(read(dir, '.github/workflows/release.yml'));
  assert.deepEqual([c.releaseRepo, c.branch], ['acme/scp-mutara-releases', 'mutara']);
  assert.match(out, /"github_repo":"acme\/scp-mutara-releases","ota_base_url":"https:\/\/acme\.github\.io\/scp-mutara-releases\/ota"/);
  assert.match(out, /Enable GitHub Pages for the gh-pages branch of acme\/scp-mutara-releases/);
  assert.match(out, /Create acme\/scp-mutara-releases as a PUBLIC repository/);
  assert.match(out, /Contents: read and write on acme\/scp-mutara-releases only, and save it in acme\/scp as the\n\s+Actions secret RELEASE_REPO_TOKEN/);
  // and without the flag, exactly as before
  const plain = app();
  const out2 = init(['--site', 'https://erp.example.com', '--no-install'], plain);
  assert.match(read(plain, 'src/mobile-kit.ts'), /githubRepo: 'acme\/scp'/);
  assert.equal(JSON.parse(read(plain, 'app.json')).expo.extra.otaBaseUrl, 'https://acme.github.io/scp/ota');
  assert.equal(parseCaller(read(plain, '.github/workflows/release.yml')).releaseRepo, null);
  assert.doesNotMatch(out2, /RELEASE_REPO_TOKEN/);
});

test('init --release-repo refuses junk and the source repo itself', () => {
  assert.throws(() => init(['--release-repo', 'nope', '--no-install'], app()), /--release-repo must look like owner\/repo/);
  assert.throws(() => init(['--release-repo', 'ACME/scp', '--no-install'], app()), /different repo from the source repo/);
});

test('init --release-repo on an app that is already set up moves githubRepo, otaBaseUrl and the workflow; re-runs keep it', () => {
  const dir = app();
  init(['--site', 'https://erp.example.com', '--no-install'], dir);
  const out = init(['--release-repo', 'acme/scp-mutara-releases', '--no-install'], dir);
  assert.match(out, /edit   src\/mobile-kit\.ts \(githubRepo is now acme\/scp-mutara-releases, the release repository\)/);
  assert.match(out, /edit   \.github\/workflows\/release\.yml \(release-repo: acme\/scp-mutara-releases\)/);
  assert.match(read(dir, 'src/mobile-kit.ts'), /githubRepo: 'acme\/scp-mutara-releases'/);
  assert.equal(JSON.parse(read(dir, 'app.json')).expo.extra.otaBaseUrl, 'https://acme.github.io/scp-mutara-releases/ota');
  assert.equal(parseCaller(read(dir, '.github/workflows/release.yml')).releaseRepo, 'acme/scp-mutara-releases');
  // a later plain re-run (even --force) keeps the release repo the workflow names
  init(['--force', '--no-install'], dir);
  assert.match(read(dir, 'src/mobile-kit.ts'), /githubRepo: 'acme\/scp-mutara-releases'/);
  assert.equal(parseCaller(read(dir, '.github/workflows/release.yml')).releaseRepo, 'acme/scp-mutara-releases');
  // --release-repo '' goes back to publishing from the source repo
  init(['--release-repo', '', '--no-install'], dir);
  assert.match(read(dir, 'src/mobile-kit.ts'), /githubRepo: 'acme\/scp'/);
  assert.equal(parseCaller(read(dir, '.github/workflows/release.yml')).releaseRepo, null);
  assert.equal(JSON.parse(read(dir, 'app.json')).expo.extra.otaBaseUrl, 'https://acme.github.io/scp/ota');
});

test('init --update-workflow keeps an existing release-repo, and --release-repo changes it', () => {
  const dir = app();
  mkdirSync(join(dir, '.github/workflows'), { recursive: true });
  const old = renderCaller({ ref: 'v0.17.0', appName: 'SCP', apkName: 'scp', branch: 'mutara', releaseRepo: 'acme/scp-mutara-releases' });
  writeFileSync(join(dir, '.github/workflows/release.yml'), old);
  const out = init(['--update-workflow', '--no-backup'], dir);
  assert.match(out, /kept: app-name "SCP", apk-name scp, branch mutara, release-repo acme\/scp-mutara-releases/);
  const c = parseCaller(read(dir, '.github/workflows/release.yml'));
  assert.deepEqual([c.ref, c.releaseRepo], [WORKFLOW_REF, 'acme/scp-mutara-releases']);
  init(['--update-workflow', '--no-backup', '--release-repo', 'acme/other-releases'], dir);
  assert.equal(parseCaller(read(dir, '.github/workflows/release.yml')).releaseRepo, 'acme/other-releases');
  assert.throws(() => init(['--update-workflow', '--release-repo', 'bad'], dir), /owner\/repo/);
});

/* ───────────── the wizard ───────────── */

function scripted(answers = [], { interactive = true } = {}) {
  const asked = [];
  const next = () => answers.shift();
  return {
    interactive,
    asked,
    say: () => {},
    ask: async (q, def = '') => {
      asked.push(q);
      const a = next();
      return a === undefined || a === '' ? def : a;
    },
    confirm: async (q, def = true) => {
      asked.push(q);
      const a = next();
      return a === undefined ? def : a;
    },
    choose: async (q, options, def = 0) => {
      asked.push(q);
      return options[def].value;
    },
    exec: () => {},
  };
}
const doctor = async () => ({ text: '✓ fine\n', ok: true });

async function withHome(fn) {
  const old = process.env.HOME;
  process.env.HOME = mkdtempSync(join(tmpdir(), 'kit-home-'));
  try {
    return await fn();
  } finally {
    process.env.HOME = old;
  }
}

const committed = (branch) => app({ branch });

test('wizard: on a client branch it asks for the release repo, validates it, and remembers it', () =>
  withHome(async () => {
    const dir = committed('mutara');
    // production, dev, release repo (bad, the source itself, then good), install backend?, auth file, apply?
    const io = scripted(['https://prod.example.com', '', 'nope', 'acme/scp', 'acme/scp-mutara-releases', false, '', true]);
    const out = await main(['--no-install'], dir, { io, doctor });
    assert.equal(io.asked.filter((q) => q.startsWith('Separate PUBLIC repo for the releases')).length, 3);
    assert.match(read(dir, 'src/mobile-kit.ts'), /githubRepo: 'acme\/scp-mutara-releases'/);
    assert.equal(parseCaller(read(dir, '.github/workflows/release.yml')).releaseRepo, 'acme/scp-mutara-releases');
    assert.equal(loadSaved(dir).releaseRepo, 'acme/scp-mutara-releases');
    assert.match(out, /RELEASE_REPO_TOKEN/);
    // --yes on the next run uses the remembered answer without asking
    const again = scripted([], { interactive: false });
    await main(['--yes', '--no-install'], dir, { io: again, doctor });
    assert.deepEqual(again.asked, []);
    assert.equal(parseCaller(read(dir, '.github/workflows/release.yml')).releaseRepo, 'acme/scp-mutara-releases');
  }));

test('wizard: on main nothing new is asked (the flag still works)', () =>
  withHome(async () => {
    const dir = committed('main');
    const io = scripted(['https://prod.example.com', '', false, '', true]);
    await main(['--no-install'], dir, { io, doctor });
    assert.ok(!io.asked.some((q) => /releases/.test(q)), io.asked.join('\n'));
    assert.equal(parseCaller(read(dir, '.github/workflows/release.yml')).releaseRepo, null);
    const flagged = committed('main');
    await main(['--yes', '--no-install', '--site', 'https://prod.example.com', '--release-repo', 'acme/scp-releases'], flagged, { io: scripted([], { interactive: false }), doctor });
    assert.match(read(flagged, 'src/mobile-kit.ts'), /githubRepo: 'acme\/scp-releases'/);
    assert.equal(loadSaved(flagged).releaseRepo, 'acme/scp-releases');
  }));

/* ───────────── doctor and verify ───────────── */

test('doctor and verify warn when githubRepo or otaBaseUrl disagree with the release repo, and when it is missing from the caller', async () => {
  const dir = app();
  init(['--site', 'https://erp.example.com', '--release-repo', 'acme/scp-mutara-releases', '--no-install'], dir);
  assert.deepEqual(releaseRepoChecks(dir).map((c) => c.level), ['ok']);
  assert.match(releaseRepoChecks(dir)[0].msg, /published to acme\/scp-mutara-releases; tags in this repo are mutara\/v<version>/);
  // phones still pointed at the source repo
  writeFileSync(join(dir, 'src/mobile-kit.ts'), read(dir, 'src/mobile-kit.ts').replace("githubRepo: 'acme/scp-mutara-releases'", "githubRepo: 'acme/scp'"));
  const app1 = JSON.parse(read(dir, 'app.json'));
  app1.expo.extra.otaBaseUrl = 'https://acme.github.io/scp/ota';
  writeFileSync(join(dir, 'app.json'), JSON.stringify(app1));
  const checks = releaseRepoChecks(dir);
  assert.ok(checks.some((c) => c.level === 'warn' && /githubRepo 'acme\/scp', but the release workflow publishes to acme\/scp-mutara-releases/.test(c.msg) && /githubRepo: 'acme\/scp-mutara-releases'/.test(c.fix)));
  assert.ok(checks.some((c) => c.level === 'warn' && /otaBaseUrl is https:\/\/acme\.github\.io\/scp\/ota/.test(c.msg)));
  const d = await check(dir, {});
  assert.ok(d.some((r) => r.level === 'warn' && /phones look for APKs in the wrong place — fix:/.test(r.msg)));
  // githubRepo names another repo but the workflow has no release-repo: releases land where phones do not look
  const other = app();
  init(['--site', 'https://erp.example.com', '--no-install'], other);
  writeFileSync(join(other, 'src/mobile-kit.ts'), read(other, 'src/mobile-kit.ts').replace("githubRepo: 'acme/scp'", "githubRepo: 'acme/scp-releases'"));
  const w = releaseRepoChecks(other);
  assert.equal(w.length, 1);
  assert.match(w[0].msg, /has no release-repo, so releases land in acme\/scp/);
  assert.match(w[0].fix, /init --update-workflow --release-repo acme\/scp-releases/);
  // the usual single-repo app: nothing to say
  const usual = app();
  init(['--site', 'https://erp.example.com', '--no-install'], usual);
  assert.deepEqual(releaseRepoChecks(usual), []);
});

const res = (status, body = null) => ({ status, ok: status >= 200 && status < 300, json: async () => body, headers: new Map() });

test('probeReleaseRepo reads the release repo like a phone: public, releases with an APK, the manifest on Pages', async () => {
  const expo = { runtimeVersion: '1.3', extra: { otaBaseUrl: 'https://acme.github.io/scp-mutara-releases/ota' } };
  const seen = [];
  const good = async (url) => {
    seen.push(url);
    if (url.startsWith('https://api.github.com/')) return res(200, [{ tag_name: 'v1.3.1', assets: [] }, { tag_name: 'v1.3.0', assets: [{ name: 'scp_v1.3.0.apk' }] }]);
    return res(200);
  };
  const ok = await probeReleaseRepo('acme/scp-mutara-releases', expo, good);
  assert.deepEqual(ok.map((r) => r.level), ['ok', 'ok']);
  assert.match(ok[0].msg, /2 release\(s\); the newest APK is v1\.3\.0/);
  assert.deepEqual(seen, ['https://api.github.com/repos/acme/scp-mutara-releases/releases?per_page=30', 'https://acme.github.io/scp-mutara-releases/ota/android/1.3/manifest.json']);
  const missing = await probeReleaseRepo('acme/scp-mutara-releases', expo, async (url) => (url.includes('api.github.com') ? res(404) : res(404)));
  assert.equal(missing[0].level, 'fail');
  assert.match(missing[0].msg, /does not exist or is private/);
  assert.match(missing[1].msg, /GitHub Pages is off/);
  const empty = await probeReleaseRepo('acme/r', expo, async (url) => (url.includes('api.github.com') ? res(200, []) : res(200)));
  assert.match(empty[0].msg, /no releases yet/);
  const offline = await probeReleaseRepo('acme/r', expo, async () => {
    throw new Error('offline');
  });
  assert.deepEqual(offline.map((r) => r.level), ['warn', 'warn']);
});

test('verify probes the release repo only when the workflow names one', async () => {
  const dir = app();
  init(['--site', 'https://erp.example.com', '--release-repo', 'acme/scp-mutara-releases', '--no-install'], dir);
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(String(url));
    return res(404);
  };
  const v = await verify(dir, { fetchImpl });
  assert.ok(urls.includes('https://api.github.com/repos/acme/scp-mutara-releases/releases?per_page=30'));
  assert.ok(v.some((r) => r.level === 'fail' && /release repository acme\/scp-mutara-releases does not exist or is private/.test(r.msg)));
  const usual = app();
  init(['--site', 'https://erp.example.com', '--no-install'], usual);
  urls.length = 0;
  await verify(usual, { fetchImpl });
  assert.ok(!urls.some((u) => u.includes('api.github.com')), urls.join('\n'));
});
