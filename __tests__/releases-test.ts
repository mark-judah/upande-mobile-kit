import { KitKeys } from '../src/config';
import { setup, store } from './helpers';

jest.mock('expo-updates', () => ({ manifest: null, runtimeVersion: '101.2', isEmbeddedLaunch: true }));
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { version: '1.2.3', runtimeVersion: '101.2' }, nativeAppVersion: '1.2.0', nativeBuildVersion: '12' },
}));

import {
  autoCheckForApk,
  checkForApk,
  compareVersions,
  formatBytes,
  releasesPageUrl,
  summarizeReleases,
  toApkRelease,
  UpdateCheckError,
  type GithubRelease,
} from '../src/updates/releases';

const apk = (name: string, size = 50 * 1024 * 1024) => ({ name, browser_download_url: `https://example.com/${name}`, size });
const rel = (tag: string, assets: GithubRelease['assets'] = [], extra: Partial<GithubRelease> = {}): GithubRelease => ({
  tag_name: tag,
  html_url: `https://example.com/r/${tag}`,
  assets,
  ...extra,
});

describe('compareVersions', () => {
  it.each([
    ['1.2.3', '1.2.2', 1],
    ['1.2.3', '1.2.3', 0],
    ['1.2.3', '1.10.0', -1],
    ['v2.0.0', '1.99.99', 1],
    ['1.1', '1.1.0', 0],
    ['1.2.3-beta', '1.2.3', 0],
    ['', '0.0.1', -1],
  ])('%s vs %s → %i', (a, b, want) => {
    expect(compareVersions(a, b)).toBe(want);
  });
});

describe('formatBytes', () => {
  it('formats megabytes and rejects junk', () => {
    expect(formatBytes(12.34 * 1024 * 1024)).toBe('12.3 MB');
    expect(formatBytes(0)).toBeNull();
    expect(formatBytes(null)).toBeNull();
    expect(formatBytes(NaN)).toBeNull();
  });
});

describe('summarizeReleases', () => {
  it('finds the newest APK even when newer releases are OTA-only', () => {
    const list = [rel('v1.2.5'), rel('v1.2.4'), rel('v1.2.0', [apk('app_v1.2.0.apk')])];
    const r = summarizeReleases(list, '1.1.0');
    expect(r.latestVersion).toBe('1.2.5');
    expect(r.apk?.version).toBe('1.2.0');
    expect(r.available).toBe(true);
  });

  it('is not available when the installed APK is current', () => {
    const r = summarizeReleases([rel('v1.2.5'), rel('v1.2.0', [apk('a.apk')])], '1.2.0');
    expect(r.available).toBe(false);
    expect(r.apk?.version).toBe('1.2.0');
  });

  it('sorts by version, not by the order GitHub lists them', () => {
    const r = summarizeReleases([rel('v1.0.9', [apk('a.apk')]), rel('v1.10.0', [apk('b.apk')])], '1.0.0');
    expect(r.apk?.version).toBe('1.10.0');
  });

  it('ignores drafts and prereleases', () => {
    const r = summarizeReleases(
      [rel('v9.0.0', [apk('x.apk')], { draft: true }), rel('v8.0.0', [apk('y.apk')], { prerelease: true }), rel('v1.0.0', [apk('z.apk')])],
      '0.9.0',
    );
    expect(r.apk?.version).toBe('1.0.0');
  });

  it('reports no APK when none of the releases carries one', () => {
    const r = summarizeReleases([rel('v1.0.1')], '1.0.0');
    expect(r.apk).toBeNull();
    expect(r.available).toBe(false);
  });

  it('throws no_releases on an empty list', () => {
    try {
      summarizeReleases([], '1.0.0');
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(UpdateCheckError);
      expect((e as UpdateCheckError).kind).toBe('no_releases');
    }
  });
});

describe('toApkRelease', () => {
  it('prefers the versioned asset over the fixed-name copy', () => {
    const r = toApkRelease(rel('v1.3.0', [apk('test_app.apk'), apk('test_app_v1.3.0.apk')]));
    expect(r?.assetName).toBe('test_app_v1.3.0.apk');
  });
  it('falls back to the fixed-name asset', () => {
    expect(toApkRelease(rel('v1.3.0', [apk('test_app.apk')]))?.assetName).toBe('test_app.apk');
  });
  it('is null without an apk asset or a tag', () => {
    expect(toApkRelease(rel('v1.3.0', [{ name: 'notes.txt', browser_download_url: 'https://example.com/n' }]))).toBeNull();
    expect(toApkRelease(rel('', [apk('a.apk')]))).toBeNull();
  });
});

describe('checking GitHub', () => {
  const realFetch = globalThis.fetch;
  const respond = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    jest.fn().mockResolvedValue({
      status,
      ok: status >= 200 && status < 300,
      headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
      json: async () => body,
    });

  beforeEach(() => setup());
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('builds the URLs from the configured repo', async () => {
    const f = respond(200, [rel('v1.2.0', [apk('a.apk')])]);
    globalThis.fetch = f as never;
    await checkForApk('1.0.0');
    expect(f.mock.calls[0][0]).toContain('repos/acme/test-app/releases');
    expect(releasesPageUrl()).toBe('https://github.com/acme/test-app/releases');
  });

  it.each([
    [429, {}, 'rate_limited'],
    [403, { 'x-ratelimit-remaining': '0' }, 'rate_limited'],
    [404, {}, 'no_releases'],
    [500, {}, 'failed'],
  ])('maps HTTP %i to %s', async (status, headers, kind) => {
    globalThis.fetch = respond(status, null, headers as Record<string, string>) as never;
    await expect(checkForApk('1.0.0')).rejects.toMatchObject({ kind });
  });

  it('maps a network failure to offline', async () => {
    globalThis.fetch = jest.fn().mockRejectedValue(new Error('down')) as never;
    await expect(checkForApk('1.0.0')).rejects.toMatchObject({ kind: 'offline' });
  });

  it('autoCheck asks every 15 minutes and serves the cached verdict in between', async () => {
    const f = respond(200, [rel('v1.2.0', [apk('a.apk')])], { etag: '"v1"' });
    globalThis.fetch = f as never;
    const first = await autoCheckForApk('1.0.0');
    const second = await autoCheckForApk('1.0.0');
    expect(first?.available).toBe(true);
    expect(second).toEqual(first);
    expect(f).toHaveBeenCalledTimes(1);

    // 16 minutes later it asks again, with the last ETag so an unchanged answer costs nothing
    const cached = JSON.parse(store.get(KitKeys.apkUpdateCheck)!);
    cached.at = Date.now() - 16 * 60 * 1000;
    store.set(KitKeys.apkUpdateCheck, JSON.stringify(cached));
    await autoCheckForApk('1.0.0');
    expect(f).toHaveBeenCalledTimes(2);
    expect((f.mock.calls[1][1] as { headers: Record<string, string> }).headers['If-None-Match']).toBe('"v1"');
  });

  it('a 304 keeps the cached verdict and renews its time', async () => {
    globalThis.fetch = respond(200, [rel('v1.2.0', [apk('a.apk')])], { etag: '"v1"' }) as never;
    const first = await checkForApk('1.0.0');
    const before = JSON.parse(store.get(KitKeys.apkUpdateCheck)!).at;
    await new Promise((r) => setTimeout(r, 5));
    globalThis.fetch = respond(304, null) as never;
    const again = await checkForApk('1.0.0');
    expect(again).toEqual(first);
    const kept = JSON.parse(store.get(KitKeys.apkUpdateCheck)!);
    expect(kept.at).toBeGreaterThan(before);
    expect(kept.etag).toBe('"v1"');
  });

  it('a new release changes the verdict even though an ETag was stored', async () => {
    globalThis.fetch = respond(200, [rel('v1.1.0', [apk('a.apk')])], { etag: '"v1"' }) as never;
    await checkForApk('1.0.0');
    globalThis.fetch = respond(200, [rel('v1.3.0', [apk('b.apk')]), rel('v1.1.0', [apk('a.apk')])], { etag: '"v2"' }) as never;
    const next = await checkForApk('1.0.0');
    expect(next.apk?.version).toBe('1.3.0');
    expect(JSON.parse(store.get(KitKeys.apkUpdateCheck)!).etag).toBe('"v2"');
  });

  it('a failed background check serves the old verdict and waits for the next interval', async () => {
    const f1 = respond(200, [rel('v1.2.0', [apk('a.apk')])]);
    globalThis.fetch = f1 as never;
    const first = await autoCheckForApk('1.0.0');
    const cached = JSON.parse(store.get(KitKeys.apkUpdateCheck)!);
    cached.at = Date.now() - 20 * 60 * 1000;
    store.set(KitKeys.apkUpdateCheck, JSON.stringify(cached));
    const failing = jest.fn().mockRejectedValue(new Error('down'));
    globalThis.fetch = failing as never;
    expect(await autoCheckForApk('1.0.0')).toEqual(first);
    expect(await autoCheckForApk('1.0.0')).toEqual(first);
    expect(failing).toHaveBeenCalledTimes(1);
  });

  it('a verdict for another build is not reused', async () => {
    const f = respond(200, [rel('v1.2.0', [apk('a.apk')])]);
    globalThis.fetch = f as never;
    await autoCheckForApk('1.0.0');
    const after = await autoCheckForApk('1.2.0'); // updated since
    expect(after?.available).toBe(false);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('a cache stamped in the future counts as stale', async () => {
    const f = respond(200, [rel('v1.2.0', [apk('a.apk')])]);
    globalThis.fetch = f as never;
    await autoCheckForApk('1.0.0');
    const cached = JSON.parse(store.get(KitKeys.apkUpdateCheck)!);
    cached.at = Date.now() + 3 * 24 * 3600 * 1000;
    store.set(KitKeys.apkUpdateCheck, JSON.stringify(cached));
    await autoCheckForApk('1.0.0');
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('falls back to the last verdict when the check fails', async () => {
    globalThis.fetch = respond(200, [rel('v1.2.0', [apk('a.apk')])]) as never;
    await autoCheckForApk('1.0.0');
    const cached = JSON.parse(store.get(KitKeys.apkUpdateCheck)!);
    cached.at = 0;
    store.set(KitKeys.apkUpdateCheck, JSON.stringify(cached));
    globalThis.fetch = jest.fn().mockRejectedValue(new Error('down')) as never;
    expect((await autoCheckForApk('1.0.0'))?.available).toBe(true);
  });

  it('never throws from the background check', async () => {
    globalThis.fetch = jest.fn().mockRejectedValue(new Error('down')) as never;
    await expect(autoCheckForApk('1.0.0')).resolves.toBeNull();
  });
});
