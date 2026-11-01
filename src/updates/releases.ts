import { getConfig, KitKeys } from '../config';
import { INSTALLED_APK_VERSION } from '../version';

/**
 * Finding a newer APK on GitHub Releases.
 *
 * Two channels ship an app, and this file only cares about one of them:
 *
 *   - OTA (expo-updates) carries JS-only patches to the runtime already
 *     installed. expo-updates handles that on its own and the Settings "Check
 *     for updates" button drives it — nothing here touches it.
 *   - An APK carries a new runtime (native code moved). The release workflow
 *     attaches it to the GitHub Release as an `.apk` asset.
 *
 * Patch releases are published as OTA-only GitHub Releases with no asset, so
 * "the latest release" is often not something that can be downloaded. The
 * question asked here is therefore narrower: what is the newest release that
 * carries an APK, and is it newer than what is running?
 *
 * Plain fetch, not the Frappe client: no session headers should reach GitHub,
 * and this must work when the Frappe site is unreachable.
 */

export const releasesPageUrl = () => `https://github.com/${getConfig().githubRepo}/releases`;
const releasesApi = () => `https://api.github.com/repos/${getConfig().githubRepo}/releases?per_page=100`;
const TIMEOUT_MS = 15000;

/** One automatic check per device per day — unauthenticated GitHub calls are
 *  limited to 60/hour per IP, and a site's phones often share one NAT address. */
export const AUTO_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

export type ApkRelease = {
  version: string;
  notes: string;
  pageUrl: string;
  downloadUrl: string;
  assetName: string;
  sizeBytes: number | null;
};

export type ApkCheck = {
  current: string;
  /** Newest release of any kind (OTA or APK), for display. */
  latestVersion: string | null;
  /** Newest release that has an APK attached, or null when none does. */
  apk: ApkRelease | null;
  /** True when `apk` is newer than the running version. */
  available: boolean;
};

export type UpdateErrorKind = 'offline' | 'timeout' | 'rate_limited' | 'no_releases' | 'failed';

export class UpdateCheckError extends Error {
  kind: UpdateErrorKind;
  constructor(kind: UpdateErrorKind, message: string) {
    super(message);
    this.name = 'UpdateCheckError';
    this.kind = kind;
  }
}

/** 1 when `a` is newer, -1 when older, 0 when equal. Ignores a leading `v`
 *  and any pre-release suffix; pads so `1.1` equals `1.1.0`. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) =>
    String(v ?? '')
      .trim()
      .replace(/^v/i, '')
      .split('-')[0]
      .split('.')
      .map((n) => parseInt(n, 10) || 0);
  const left = parse(a);
  const right = parse(b);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const l = left[i] ?? 0;
    const r = right[i] ?? 0;
    if (l !== r) return l > r ? 1 : -1;
  }
  return 0;
}

/** Byte count as "12.3 MB", or null when unknown. */
export function formatBytes(bytes: number | null | undefined): string | null {
  if (!bytes || !Number.isFinite(bytes) || bytes <= 0) return null;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export type GithubRelease = {
  tag_name?: string;
  body?: string;
  html_url?: string;
  draft?: boolean;
  prerelease?: boolean;
  assets?: { name?: string; browser_download_url?: string; size?: number }[];
};

async function fetchReleases(): Promise<GithubRelease[]> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(releasesApi(), {
      headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
      signal: controller.signal,
    });
  } catch {
    throw timedOut
      ? new UpdateCheckError('timeout', 'The update page did not respond in time. Try again in a moment.')
      : new UpdateCheckError('offline', "Couldn't reach the update page. Try again in a moment.");
  } finally {
    clearTimeout(timer);
  }

  // GitHub answers an exhausted quota with 403/429 and a zeroed remaining header.
  if (res.status === 429 || (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0')) {
    throw new UpdateCheckError(
      'rate_limited',
      'GitHub is rate limiting this network. Try again later, or open the releases page.',
    );
  }
  if (res.status === 404) throw new UpdateCheckError('no_releases', 'No release has been published yet.');
  if (!res.ok) {
    if (__DEV__) console.warn(`[update] releases page answered ${res.status}`);
    throw new UpdateCheckError('failed', "The update page isn't available right now. Try again later.");
  }

  try {
    const json = await res.json();
    return Array.isArray(json) ? json : [];
  } catch {
    throw new UpdateCheckError('failed', "Couldn't read the update information. Try again later.");
  }
}

/** The release as an ApkRelease, or null when it carries no APK. */
export function toApkRelease(r: GithubRelease): ApkRelease | null {
  const assets = (r.assets ?? []).filter(
    (a) => typeof a?.name === 'string' && a.name.toLowerCase().endsWith('.apk') && a.browser_download_url,
  );
  // A release may carry the same APK twice (versioned name + a fixed "latest" name);
  // the versioned one is the one worth keeping on disk, so prefer it.
  const asset = assets.find((a) => /\d+\.\d+/.test(a.name as string)) ?? assets[0];
  const version = String(r.tag_name ?? '').replace(/^v/i, '');
  if (!asset || !version) return null;
  return {
    version,
    notes: typeof r.body === 'string' ? r.body.trim() : '',
    pageUrl: r.html_url || releasesPageUrl(),
    downloadUrl: asset.browser_download_url as string,
    assetName: asset.name as string,
    sizeBytes: asset.size ?? null,
  };
}

/** Reduces a release list to the verdict for `current`. Pure. */
export function summarizeReleases(list: GithubRelease[], current: string): ApkCheck {
  const releases = list.filter((r) => !r.draft && !r.prerelease && r.tag_name);
  if (releases.length === 0) {
    throw new UpdateCheckError('no_releases', 'No release has been published yet.');
  }
  // Sorted by version rather than trusting GitHub's order, which is by date.
  const sorted = [...releases].sort((a, b) => compareVersions(String(b.tag_name), String(a.tag_name)));
  const latestVersion = String(sorted[0].tag_name).replace(/^v/i, '');
  const apk = sorted.map(toApkRelease).find((r): r is ApkRelease => r !== null) ?? null;
  return { current, latestVersion, apk, available: !!apk && compareVersions(apk.version, current) > 0 };
}

/** Ask GitHub now. Throws UpdateCheckError; caches a successful result. */
export async function checkForApk(current: string = INSTALLED_APK_VERSION): Promise<ApkCheck> {
  const result = summarizeReleases(await fetchReleases(), current);
  await getConfig()
    .storage.set(KitKeys.apkUpdateCheck, JSON.stringify({ at: Date.now(), repo: getConfig().githubRepo, result }))
    .catch(() => {});
  return result;
}

/**
 * Check at most once a day, otherwise return the cached verdict. Never throws:
 * a background check that fails leaves the UI as it was.
 */
export async function autoCheckForApk(current: string = INSTALLED_APK_VERSION): Promise<ApkCheck | null> {
  const { storage, githubRepo } = getConfig();
  let cached: { at: number; repo?: string; result: ApkCheck } | null = null;
  try {
    const raw = await storage.get(KitKeys.apkUpdateCheck);
    if (raw) cached = JSON.parse(raw);
  } catch {
    cached = null;
  }
  // A verdict is only meaningful for the build and repo that produced it — after
  // an update it would still claim one is available.
  const usable = !!cached?.result && cached.result.current === current && cached.repo === githubRepo;
  // A stamp in the future (clock moved back) counts as stale.
  const age = cached ? Date.now() - cached.at : Infinity;
  if (usable && cached && age >= 0 && age < AUTO_CHECK_INTERVAL_MS) return cached.result;

  try {
    return await checkForApk(current);
  } catch {
    return usable && cached ? cached.result : null;
  }
}
