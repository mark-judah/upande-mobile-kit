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

/**
 * 'ota' when the new version stays on the runtime the installed APKs have; otherwise 'apk'.
 * `forceApk` (the `--apk` flag, or an `[apk]` marker in a commit) builds an APK for this release even
 * though the runtime stays the same. A `currentRuntime` that is not a plain string (an Expo policy object, or
 * nothing at all) is unknown, so it never equals the new runtime and the release is an APK.
 */
export function releaseKind(currentRuntime, version, offsets, forceApk = false) {
  if (forceApk) return 'apk';
  return currentRuntime === runtimeVersionFor(version, offsets) ? 'ota' : 'apk';
}

/**
 * Markers a commit message can carry (subject or body, any case, square brackets, whole token):
 *
 *   [apk] / [build-apk]     attach an APK to THIS release; the version is a normal patch and the runtime is unchanged
 *   [native] / [runtime]    native code changed: minor bump = new runtime, and an APK
 *   [major]                 major bump = new runtime, and an APK
 *   [ota] / [skip-apk]      in the NEWEST commit only: cancels any [apk] marker of the release range (including its own)
 *
 * Commits are newest first (git log order). Returns the short hash of the newest commit that carries each marker.
 */
const MARKER = /\[(apk|build-apk|native|runtime|major|ota|skip-apk)\]/gi;
export function scanMarkers(commits) {
  const found = { apk: null, native: null, major: null, otaCancelled: false };
  commits.forEach((c, i) => {
    const tokens = new Set([...`${c.subject ?? ''}\n${c.body ?? ''}`.matchAll(MARKER)].map((m) => m[1].toLowerCase()));
    const short = String(c.hash ?? '').slice(0, 7);
    if ((tokens.has('apk') || tokens.has('build-apk')) && !found.apk) found.apk = short;
    if ((tokens.has('native') || tokens.has('runtime')) && !found.native) found.native = short;
    if (tokens.has('major') && !found.major) found.major = short;
    if (i === 0 && (tokens.has('ota') || tokens.has('skip-apk'))) found.otaCancelled = true;
  });
  if (found.otaCancelled) found.apk = null;
  return found;
}

/**
 * One decision, with the reason in words. `bumpFlag` is what was asked for (`auto`, `patch`, `minor`, `major` or
 * nothing); an explicit minor/major or a `--set` version always wins over commit markers.
 */
export function decideRelease({ bumpFlag, setTo, apkFlag, commits, sdkChanged, currentRuntime, offsets, currentVersion }) {
  const asked = bumpFlag ?? 'auto';
  if (!['auto', 'patch', 'minor', 'major'].includes(asked)) throw new Error(`--bump must be auto, patch, minor or major (got "${asked}").`);
  const marks = scanMarkers(commits);
  const why = [];
  let bump = 'patch';
  if (setTo) {
    why.push(`--set ${setTo}`);
  } else if (asked === 'minor' || asked === 'major') {
    bump = asked;
    why.push(`--bump ${asked}`);
  } else if (marks.major) {
    bump = 'major';
    why.push(`commit ${marks.major} contains [major]`);
  } else if (marks.native) {
    bump = 'minor';
    why.push(`commit ${marks.native} contains [native]/[runtime]`);
  } else if (sdkChanged) {
    bump = 'minor';
    why.push('the Expo SDK changed, and a bundle from another SDK cannot go over the air');
  }
  const forceApk = Boolean(apkFlag || marks.apk);
  if (apkFlag) why.push('--apk');
  else if (marks.apk) why.push(`commit ${marks.apk} contains [apk]`);
  if (marks.otaCancelled && !setTo && asked !== 'minor' && asked !== 'major') why.push('newest commit has [ota]: no APK was requested by markers');
  const policyRuntime = typeof currentRuntime !== 'string';
  return { bump, forceApk, why, marks, policyRuntime, asked, currentVersion, offsets };
}

/** The sentence `version` prints and `--json` carries as `reason`. */
export function releaseReason({ kind, runtime, currentRuntime, decision }) {
  const parts = [...decision.why];
  if (decision.policyRuntime) {
    parts.push('runtimeVersion in app.json was a policy object (or missing); this release sets a plain x.y runtime, so it needs an APK');
  } else if (kind === 'apk' && currentRuntime !== runtime) {
    parts.push(`the runtime changes from ${currentRuntime} to ${runtime}`);
  } else if (kind === 'apk') {
    parts.push(`an APK is built on the unchanged runtime ${runtime}; the OTA bundle is published too`);
  } else {
    parts.push(`a patch release keeps runtime ${runtime}, so it ships over the air (no APK)`);
  }
  return parts.join('; ');
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

/**
 * User-facing notes: lines in a commit body that start with `Note:` or `What's new:`. They are written for the
 * people who use the app (the release notes show them first, and the in-app "What's new" shows only them by default).
 */
export function userNotes(commit) {
  const out = [];
  for (const line of String(commit.body ?? '').split(/\r?\n/)) {
    const m = /^\s*(?:notes?|what['\u2019]?s new)\s*:\s*(.+?)\s*$/i.exec(line);
    if (m && m[1]) out.push(m[1]);
  }
  return out;
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
  const notes = commits.flatMap(userNotes);
  if (notes.length) out.push("### What's new", '', ...notes.map((n) => `- ${n}`), '');
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
