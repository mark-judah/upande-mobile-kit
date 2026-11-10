/**
 * `upande-mobile-kit version` — odometer versioning for an Expo app, run from
 * the app's root (the folder with app.json).
 *
 *   upande-mobile-kit version                 # print the next version (dry run)
 *   upande-mobile-kit version --json          # machine-readable, for CI outputs
 *   upande-mobile-kit version --apply         # write app.json + package.json
 *   upande-mobile-kit version --bump minor    # skip ahead to the next minor/major (auto|patch|minor|major)
 *   upande-mobile-kit version --apk           # build an APK for this release too (same runtime)
 *   upande-mobile-kit version --set 1.0.0     # start a numbering line at a version
 *   upande-mobile-kit version --keep-version --notes   # release notes for the current version
 *
 * app.json -> expo.version is the single source of truth; package.json is kept
 * in sync. Optional offsets live in app.json -> expo.extra.mobileKit
 * ({ versionCodeBase, runtimeMajorBase }) — see version-lib.mjs.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { classifyFiles, fileReasons, nativeSurface, releaseLists, surfaceDiff } from './release-rules.mjs';
import {
  decideRelease,
  nativeChanges,
  nextVersion,
  offsetsFrom,
  parseCommit,
  parseVersion,
  releaseKind,
  releaseNotes,
  releaseReason,
  runtimeVersionFor,
  versionCodeFor,
} from './version-lib.mjs';

export function run(argv, root = process.cwd()) {
  const appJsonPath = resolve(root, 'app.json');
  const pkgJsonPath = resolve(root, 'package.json');
  const hasFlag = (name) => argv.includes(`--${name}`);
  const flagValue = (name) => {
    const i = argv.indexOf(`--${name}`);
    return i === -1 ? undefined : argv[i + 1];
  };

  const git = (...args) => {
    try {
      // stderr is swallowed: `git describe` on a repo with no tags is an
      // expected state (the first release), not something worth printing.
      return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch {
      return '';
    }
  };
  const lastTag = () => git('describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*') || null;
  const commitsSince = (tag) => {
    const raw = git('log', tag ? `${tag}..HEAD` : 'HEAD', '--no-merges', '--format=%H%x1f%s%x1f%b%x1e');
    if (!raw) return [];
    return raw
      .split('\x1e')
      .map((r) => r.trim())
      .filter(Boolean)
      .map((r) => {
        const [hash, subject, body] = r.split('\x1f');
        return { hash, subject: subject ?? '', body: body ?? '' };
      });
  };

  const appConfig = JSON.parse(readFileSync(appJsonPath, 'utf8'));
  const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
  const offsets = offsetsFrom(appConfig);

  const currentVersion = appConfig.expo.version;
  const tag = lastTag();
  const commits = commitsSince(tag).map(parseCommit);

  // The Expo SDK the installed APKs of this runtime were built with. A JS bundle
  // from another SDK crashes on them, so a new SDK can never go out over the air:
  // a patch bump is promoted to a minor one (new runtime, new APK).
  const expoSdk = Number(String(pkg.dependencies?.expo ?? '').replace(/^[^\d]*/, '').split('.')[0]);
  const runtimeSdk = appConfig.expo.extra?.runtimeSdk;
  const sdkChanged = Number.isFinite(expoSdk) && runtimeSdk != null && runtimeSdk !== expoSdk;
  // Native changes since the last release: a JS bundle cannot carry them, so they build an APK without a marker.
  const showAt = (file) => {
    if (!tag) return null;
    const raw = git('show', `${tag}:${file}`);
    try {
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  };
  const nativeFiles = tag ? git('diff', '--name-only', tag, 'HEAD', '--', 'android', 'ios').split('\n').filter(Boolean) : [];
  // The rules that need no marker: what the files changed since the LAST APK say, and whether the native surface (native
  // dependencies, the kit's plugins, patches, native app.json fields) still equals the one recorded at that APK. Compared
  // with the last APK rather than the last release, so a native change that once went out as an OTA is not forgotten.
  const mk = appConfig.expo.extra?.mobileKit ?? {};
  const apkTag = mk.apkTag && git('rev-parse', '--verify', '--quiet', `refs/tags/${mk.apkTag}`) ? mk.apkTag : tag;
  const sinceApk = apkTag ? git('diff', '--name-only', apkTag, 'HEAD').split('\n').filter(Boolean) : [];
  const surface = nativeSurface(root, pkg, appConfig);
  // Without node_modules (no surface to read) the older name-based check stands in for it.
  const nativeChanged =
    tag && !surface
      ? nativeChanges({ before: { pkg: showAt('package.json'), app: showAt('app.json') }, after: { pkg, app: appConfig }, nativeFiles })
      : [];
  nativeChanged.push(...fileReasons(classifyFiles(sinceApk, releaseLists(appConfig))));
  if (surface && mk.nativeBaseline) nativeChanged.push(...surfaceDiff(mk.nativeBaseline, surface));
  const setTo = flagValue('set');
  if (setTo) parseVersion(setTo);
  const decision = decideRelease({
    bumpFlag: flagValue('bump'),
    setTo,
    apkFlag: hasFlag('apk'),
    commits,
    sdkChanged,
    nativeChanged,
    currentRuntime: appConfig.expo.runtimeVersion,
    offsets,
    currentVersion,
  });
  const { bump, forceApk } = decision;
  const version = hasFlag('keep-version') ? currentVersion : setTo || nextVersion(currentVersion, bump);
  const versionCode = versionCodeFor(version, offsets);
  const runtimeVersion = runtimeVersionFor(version, offsets);
  const kind = releaseKind(appConfig.expo.runtimeVersion, version, offsets, forceApk);
  const reason = releaseReason({ kind, runtime: runtimeVersion, currentRuntime: appConfig.expo.runtimeVersion, decision });

  if (hasFlag('apply')) {
    appConfig.expo.version = version;
    appConfig.expo.android = { ...appConfig.expo.android, versionCode };
    // expo-updates refuses a bundle whose runtime does not match the installed
    // build, so this is what keeps a 1.1.x update off a 1.0.x APK.
    appConfig.expo.runtimeVersion = runtimeVersion;
    if (Number.isFinite(expoSdk)) appConfig.expo.extra = { ...appConfig.expo.extra, runtimeSdk: expoSdk };
    // Remember the native surface the APK carries. It is saved by every APK release, and once by the first release that has
    // none (the installed APK is assumed to match), so later releases are compared with a real baseline.
    if (surface && (kind === 'apk' || !mk.nativeBaseline)) {
      const next = { ...mk, nativeBaseline: surface };
      if (kind === 'apk') next.apkTag = `v${version}`;
      appConfig.expo.extra = { ...appConfig.expo.extra, mobileKit: next };
    }
    // A static-hosting update URL carries the runtime in its path, so it moves with it.
    const updates = appConfig.expo.updates;
    if (updates?.url?.includes('/ota/android/')) {
      updates.url = updates.url.replace(/\/ota\/android\/[^/]+\/manifest\.json$/, `/ota/android/${runtimeVersion}/manifest.json`);
    }
    writeFileSync(appJsonPath, `${JSON.stringify(appConfig, null, 2)}\n`);
    pkg.version = version;
    writeFileSync(pkgJsonPath, `${JSON.stringify(pkg, null, 2)}\n`);
  }

  if (hasFlag('notes')) return releaseNotes(version, commits, tag, process.env.GITHUB_REPOSITORY);
  if (hasFlag('json')) {
    return `${JSON.stringify(
      {
        current: currentVersion,
        version,
        versionCode,
        runtimeVersion,
        currentRuntimeVersion: appConfig.expo.runtimeVersion,
        release: kind,
        reason,
        forceApk,
        bump,
        tag: `v${version}`,
        previousTag: tag,
        commitCount: commits.length,
        breaking: commits.filter((c) => c.breaking).length,
      },
      null,
      2,
    )}\n`;
  }
  return (
    `${currentVersion} -> ${version} (${bump}, versionCode ${versionCode}, ` +
    `${commits.length} commit${commits.length === 1 ? '' : 's'} since ${tag ?? 'the beginning'})\n` +
    `release: ${kind === 'apk' ? 'APK' : 'OTA'} - ${reason}\n`
  );
}
