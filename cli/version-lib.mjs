/**
 * Odometer versioning, as pure functions.
 *
 * Every merge to the release branch advances the version by exactly one step.
 * The digits roll over like an odometer with fixed limits:
 *
 *   patch (z) counts 0..99  — 1.0.99 + 1 -> 1.1.0
 *   minor (y) counts 0..49  — 1.49.99 + 1 -> 2.0.0
 *   major (x) is unbounded
 *
 * Because the limits are fixed, a version maps one-to-one onto a plain counter,
 * which is exactly what Android's versionCode wants:
 *
 *   versionCode = base + (major * 50 + minor) * 100 + patch
 *
 * so versionCode is dense, strictly increasing and needs no external state.
 * A patch release keeps its runtime (major.minor) and ships over the air; a new
 * minor or major moves the runtime and needs a fresh APK.
 */

export const PATCH_LIMIT = 100;
export const MINOR_LIMIT = 50;

export function parseVersion(version) {
  const parts = String(version).split('.').map((n) => parseInt(n, 10));
  if (parts.length !== 3 || parts.some((n) => !Number.isInteger(n) || n < 0)) {
    throw new Error(`Not a valid x.y.z version: ${version}`);
  }
  const [major, minor, patch] = parts;
  if (minor >= MINOR_LIMIT) throw new Error(`Minor ${minor} in ${version} is out of range (max ${MINOR_LIMIT - 1}).`);
  if (patch >= PATCH_LIMIT) throw new Error(`Patch ${patch} in ${version} is out of range (max ${PATCH_LIMIT - 1}).`);
  return { major, minor, patch };
}

/**
 * One odometer step. `bump` normally stays 'patch' — one merge, one release.
 * 'minor' / 'major' skip the remaining digits for a round number.
 */
export function nextVersion(current, bump = 'patch') {
  let { major, minor, patch } = parseVersion(current);
  if (bump === 'major') return `${major + 1}.0.0`;
  if (bump === 'minor') {
    minor += 1;
    patch = 0;
  } else {
    patch += 1;
  }
  if (patch >= PATCH_LIMIT) {
    patch = 0;
    minor += 1;
  }
  if (minor >= MINOR_LIMIT) {
    minor = 0;
    major += 1;
  }
  return `${major}.${minor}.${patch}`;
}

/**
 * Offsets that keep a new numbering line apart from an older one that reused
 * the same x.y.z: `versionCodeBase` makes the new APK install OVER the old
 * (Android refuses a lower versionCode), `runtimeMajorBase` keeps a JS update
 * from reaching a phone whose native code differs. Both default to 0.
 */
export function offsetsFrom(appJson) {
  const o = appJson?.expo?.extra?.mobileKit ?? {};
  return {
    versionCodeBase: Number.isInteger(o.versionCodeBase) ? o.versionCodeBase : 0,
    runtimeMajorBase: Number.isInteger(o.runtimeMajorBase) ? o.runtimeMajorBase : 0,
  };
}

export function runtimeVersionFor(version, { runtimeMajorBase = 0 } = {}) {
  const { major, minor } = parseVersion(version);
  return `${runtimeMajorBase + major}.${minor}`;
}

export function versionCodeFor(version, { versionCodeBase = 0 } = {}) {
  const { major, minor, patch } = parseVersion(version);
  return versionCodeBase + (major * MINOR_LIMIT + minor) * PATCH_LIMIT + patch;
}

/** 'ota' when the new version stays on the runtime the installed APKs have; otherwise 'apk'. */
export function releaseKind(currentRuntime, version, offsets) {
  return currentRuntime === runtimeVersionFor(version, offsets) ? 'ota' : 'apk';
}

const HEADER = /^(?<type>[a-z]+)(?:\((?<scope>[^)]+)\))?(?<breaking>!)?:\s*(?<description>.+)$/i;

export function parseCommit(commit) {
  const match = HEADER.exec(commit.subject);
  const breaking = Boolean(match?.groups?.breaking) || /^BREAKING[ -]CHANGE:/m.test(commit.body ?? '');
  return {
    ...commit,
    type: match?.groups?.type?.toLowerCase() ?? null,
    scope: match?.groups?.scope ?? null,
    description: match?.groups?.description ?? commit.subject,
    breaking,
  };
}

export const SECTIONS = [
  ['feat', 'Features'],
  ['fix', 'Bug Fixes'],
  ['perf', 'Performance'],
  ['refactor', 'Refactoring'],
  ['docs', 'Documentation'],
  ['build', 'Build System'],
  ['ci', 'CI'],
  ['chore', 'Chores'],
];

export function releaseNotes(version, commits, tag, repo) {
  const line = (c) => `- ${c.scope ? `**${c.scope}:** ` : ''}${c.description} (${c.hash.slice(0, 7)})`;
  const out = [`## v${version}`, ''];
  const breaking = commits.filter((c) => c.breaking);
  if (breaking.length) out.push('### ⚠ BREAKING CHANGES', '', ...breaking.map(line), '');
  for (const [type, heading] of SECTIONS) {
    const matching = commits.filter((c) => c.type === type && !c.breaking);
    if (matching.length) out.push(`### ${heading}`, '', ...matching.map(line), '');
  }
  const other = commits.filter((c) => !c.breaking && !SECTIONS.some(([type]) => type === c.type));
  if (other.length) out.push('### Other', '', ...other.map(line), '');
  if (commits.length === 0) out.push('_No commits since the previous release._', '');
  if (repo && tag) out.push(`**Full changelog:** https://github.com/${repo}/compare/${tag}...v${version}`, '');
  return out.join('\n');
}
