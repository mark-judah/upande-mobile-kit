/**
 * Releasing the kit itself, as pure functions. The kit is installed from GitHub by tag, so a release is: a version in
 * package.json, a commit, and a tag named exactly `v<version>` (the workflow `init` writes into apps is pinned to it).
 */

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

export function parseSemver(v) {
  const m = SEMVER.exec(String(v).trim());
  if (!m) throw new Error(`Not an x.y.z version: ${v}`);
  return { major: +m[1], minor: +m[2], patch: +m[3] };
}

/** `patch` | `minor` | `major` | an explicit `x.y.z` (which must be newer). */
export function bumpSemver(current, what = 'patch') {
  const cur = parseSemver(current);
  let next;
  if (what === 'patch') next = { ...cur, patch: cur.patch + 1 };
  else if (what === 'minor') next = { major: cur.major, minor: cur.minor + 1, patch: 0 };
  else if (what === 'major') next = { major: cur.major + 1, minor: 0, patch: 0 };
  else {
    next = parseSemver(what);
    if (compareSemver(`${next.major}.${next.minor}.${next.patch}`, current) <= 0) {
      throw new Error(`${what} is not newer than the current version ${current}.`);
    }
  }
  return `${next.major}.${next.minor}.${next.patch}`;
}

export function compareSemver(a, b) {
  const x = parseSemver(a);
  const y = parseSemver(b);
  return x.major - y.major || x.minor - y.minor || x.patch - y.patch;
}

/** The newest `vX.Y.Z` among tag names, or null. */
export function latestTag(tags) {
  const versions = tags.map((t) => /^v(\d+\.\d+\.\d+)$/.exec(t.trim())?.[1]).filter(Boolean);
  return versions.sort(compareSemver).pop() ?? null;
}

/** Replaces the top-level "version" in package.json text without reformatting the file. */
export function withVersion(packageJsonText, version) {
  const re = /^(\s*"version"\s*:\s*")[^"]*(")/m;
  if (!re.test(packageJsonText)) throw new Error('package.json has no "version" field.');
  return packageJsonText.replace(re, `$1${version}$2`);
}

/** `owner/repo` from the package.json repository URL, for the install line printed at the end. */
export function repoSlug(pkg) {
  const url = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url ?? '';
  return /github\.com[:/]([^/]+\/[^/.]+)(?:\.git)?$/.exec(url)?.[1] ?? null;
}
