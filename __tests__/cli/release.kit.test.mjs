import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { bumpSemver, latestTag, repoSlug, withVersion } from '../../cli/release-lib.mjs';
import { run } from '../../cli/release.mjs';

test('bumps patch, minor, major and accepts a newer explicit version', () => {
  assert.equal(bumpSemver('0.10.0'), '0.10.1');
  assert.equal(bumpSemver('0.10.3', 'minor'), '0.11.0');
  assert.equal(bumpSemver('0.10.3', 'major'), '1.0.0');
  assert.equal(bumpSemver('0.10.3', '0.12.0'), '0.12.0');
  assert.throws(() => bumpSemver('0.10.3', '0.10.3'), /not newer/);
  assert.throws(() => bumpSemver('0.10.3', '0.9.0'), /not newer/);
  assert.throws(() => bumpSemver('1.0', 'patch'), /x\.y\.z/);
});

test('finds the newest tag by number, not by text', () => {
  assert.equal(latestTag(['v0.9.0', 'v0.10.0', 'v0.2.0', 'v0', 'junk']), '0.10.0');
  assert.equal(latestTag([]), null);
});

test('changes only the version line and keeps the rest of the file', () => {
  const text = '{\n  "name": "@upande/mobile-kit",\n  "version": "0.9.0",\n  "dependencies": { "x": "1.0.0" }\n}\n';
  assert.equal(withVersion(text, '0.10.0'), text.replace('0.9.0', '0.10.0'));
  assert.throws(() => withVersion('{}', '1.0.0'), /no "version"/);
});

test('reads the owner/repo from the repository url', () => {
  assert.equal(repoSlug({ repository: { url: 'git+https://github.com/mark-judah/upande-mobile-kit.git' } }), 'mark-judah/upande-mobile-kit');
  assert.equal(repoSlug({}), null);
});

function repo({ name = '@upande/mobile-kit', version = '0.9.0', branch = 'main' } = {}) {
  const d = mkdtempSync(join(tmpdir(), 'kit-rel-'));
  const git = (...a) => execFileSync('git', a, { cwd: d, encoding: 'utf8' });
  git('init', '-q', '-b', branch);
  git('config', 'user.email', 'dev@upande.com');
  git('config', 'user.name', 'dev');
  writeFileSync(join(d, 'package.json'), JSON.stringify({ name, version, repository: { url: 'git+https://github.com/o/r.git' } }, null, 2) + '\n');
  git('add', '.');
  git('commit', '-q', '-m', 'init');
  return { d, git };
}

test('commits the version and creates the annotated tag, without pushing', () => {
  const { d, git } = repo();
  const out = run(['minor', '--skip-checks'], { cwd: d });
  assert.equal(JSON.parse(readFileSync(join(d, 'package.json'), 'utf8')).version, '0.10.0');
  assert.equal(git('tag', '--list').trim(), 'v0.10.0');
  assert.equal(git('log', '-1', '--format=%s').trim(), 'chore(release): 0.10.0');
  assert.equal(git('status', '--porcelain').trim(), '');
  assert.match(out, /Not pushed/);
  assert.match(out, /npm install github:o\/r#v0\.10\.0/);
});

test('a dry run changes nothing', () => {
  const { d, git } = repo();
  const out = run(['--dry-run'], { cwd: d });
  assert.match(out, /0\.9\.0 -> 0\.9\.1/);
  assert.equal(git('tag', '--list').trim(), '');
  assert.equal(JSON.parse(readFileSync(join(d, 'package.json'), 'utf8')).version, '0.9.0');
});

test('refuses a dirty tree, another branch, an existing tag and a non-kit package', () => {
  const dirty = repo();
  writeFileSync(join(dirty.d, 'x.txt'), 'x');
  assert.throws(() => run(['--skip-checks'], { cwd: dirty.d }), /uncommitted/);

  const other = repo({ branch: 'work' });
  assert.throws(() => run(['--skip-checks'], { cwd: other.d }), /not main/);
  assert.match(run(['--skip-checks', '--allow-branch', '--dry-run'], { cwd: other.d }), /Dry run/);

  const tagged = repo();
  tagged.git('tag', 'v0.9.1');
  assert.throws(() => run(['--skip-checks'], { cwd: tagged.d }), /already exists/);

  const app = repo({ name: 'some-app' });
  assert.throws(() => run(['--skip-checks'], { cwd: app.d }), /releases the kit itself/);
});

test('stops before changing anything when a check fails, and runs the three checks in order', () => {
  const { d, git } = repo();
  const calls = [];
  const exec = (cmd, args, cwd) => {
    if (cmd === 'npm') {
      calls.push(args[2]);
      if (args[2] === 'test') throw Object.assign(new Error('fail'), { stdout: '3 failed', stderr: '' });
      return '';
    }
    return execFileSync(cmd, args, { cwd, encoding: 'utf8' });
  };
  assert.throws(() => run([], { cwd: d, exec }), /test failed, nothing was changed/);
  assert.deepEqual(calls, ['typecheck', 'test']);
  assert.equal(git('tag', '--list').trim(), '');
  assert.equal(JSON.parse(readFileSync(join(d, 'package.json'), 'utf8')).version, '0.9.0');
});

test('pushes the branch and the tag only with --push, never forced', () => {
  const { d } = repo();
  const pushes = [];
  const exec = (cmd, args, cwd) => {
    if (cmd === 'git' && args[0] === 'push') {
      pushes.push(args.join(' '));
      return '';
    }
    return execFileSync(cmd, args, { cwd, encoding: 'utf8' });
  };
  run(['--skip-checks', '--push'], { cwd: d, exec });
  assert.deepEqual(pushes, ['push origin main', 'push origin v0.9.1']);
});

test('lists the tags', () => {
  const { d, git } = repo();
  git('tag', 'v0.2.0');
  git('tag', 'v0.10.0');
  assert.match(run(['--list'], { cwd: d }), /Latest: v0\.10\.0/);
});
