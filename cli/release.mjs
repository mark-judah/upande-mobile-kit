/**
 * `upande-mobile-kit release` — cut a release of the KIT itself. Run it inside a checkout of the kit repository.
 *
 *   upande-mobile-kit release                 # next patch: checks, version commit, tag (nothing leaves your machine)
 *   upande-mobile-kit release minor           # or: patch | minor | major | 1.4.0
 *   upande-mobile-kit release --push          # also push the branch and the tag
 *   upande-mobile-kit release --dry-run       # show what would happen, change nothing
 *   upande-mobile-kit release --skip-checks   # skip typecheck / tests / check:pack
 *   upande-mobile-kit release --list          # the tags that exist
 *
 * The tag is always `v<version>`: apps install the kit by that tag and the workflow `init` writes is pinned to it.
 * An existing tag is never moved or replaced.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { bumpSemver, latestTag, repoSlug, withVersion } from './release-lib.mjs';

const KIT_NAME = '@upande/mobile-kit';

const realExec = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

export function run(argv, { cwd = process.cwd(), exec = realExec, read = readFileSync, write = writeFileSync } = {}) {
  const flags = new Set(argv.filter((a) => a.startsWith('--')));
  const what = argv.find((a) => !a.startsWith('--')) ?? 'patch';
  const dry = flags.has('--dry-run');
  const out = [];
  const say = (s) => out.push(s);
  const git = (...args) => exec('git', args, cwd).trim();

  const pkgPath = join(cwd, 'package.json');
  let text;
  try {
    text = read(pkgPath, 'utf8');
  } catch {
    throw new Error('No package.json here. Run this inside a checkout of the mobile-kit repository.');
  }
  const pkg = JSON.parse(text);
  if (pkg.name !== KIT_NAME) {
    throw new Error(`This releases the kit itself (${KIT_NAME}), but package.json is "${pkg.name}". To version an app use "upande-mobile-kit version".`);
  }

  if (flags.has('--list')) {
    const tags = git('tag', '--list', 'v*').split('\n').filter(Boolean);
    say(`Latest: ${latestTag(tags) ? `v${latestTag(tags)}` : 'none'}\nAll: ${tags.join(' ') || 'none'}\n`);
    return out.join('');
  }

  const current = pkg.version;
  const next = bumpSemver(current, what);
  const tag = `v${next}`;
  const branch = git('rev-parse', '--abbrev-ref', 'HEAD');

  const problems = [];
  if (git('status', '--porcelain')) problems.push('The working tree has uncommitted changes. Commit or stash them first.');
  if (branch !== 'main' && !flags.has('--allow-branch')) problems.push(`You are on "${branch}", not main. Switch to main (or pass --allow-branch).`);
  if (git('tag', '--list', tag)) problems.push(`The tag ${tag} already exists. Tags are never moved; pick another version.`);
  const seen = latestTag(git('tag', '--list', 'v*').split('\n').filter(Boolean));
  if (seen && seen !== current) say(`Note: the newest tag is v${seen} but package.json says ${current}.\n`);
  if (problems.length) {
    throw new Error(`Not ready to release ${tag}:\n  - ${problems.join('\n  - ')}`);
  }

  say(`Releasing ${KIT_NAME}: ${current} -> ${next} (tag ${tag}, branch ${branch})\n`);
  if (dry) {
    say('Dry run. Would:\n');
    if (!flags.has('--skip-checks')) say('  1. run typecheck, tests and check:pack\n');
    say(`  - set "version" to ${next} in package.json and commit "chore(release): ${next}"\n  - create the tag ${tag}\n`);
    say(flags.has('--push') ? `  - push ${branch} and ${tag} to origin\n` : '  - (not push: add --push)\n');
    return out.join('');
  }

  if (!flags.has('--skip-checks')) {
    for (const script of ['typecheck', 'test', 'check:pack']) {
      say(`Running ${script}...\n`);
      try {
        exec('npm', ['run', '--silent', script], cwd);
      } catch (err) {
        throw new Error(`${script} failed, nothing was changed:\n${String(err.stdout ?? '').split('\n').slice(-15).join('\n')}${err.stderr ?? ''}`);
      }
    }
  }

  write(pkgPath, withVersion(text, next));
  git('add', 'package.json');
  git('commit', '-m', `chore(release): ${next}`);
  git('tag', '-a', tag, '-m', `Release ${next}`);
  say(`Committed and tagged ${tag}.\n`);

  if (flags.has('--push')) {
    git('push', 'origin', branch);
    git('push', 'origin', tag);
    say(`Pushed ${branch} and ${tag}.\n`);
  } else {
    say(`Not pushed. When ready:\n  git push origin ${branch} && git push origin ${tag}\n`);
  }
  const slug = repoSlug(pkg);
  if (slug) say(`Apps install it with:\n  npm install github:${slug}#${tag}\n`);
  return out.join('');
}
