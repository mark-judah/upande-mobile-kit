import { configureMobileKit, resetMobileKit, getConfig, KitKeys } from '../src/config';
import { mayAutoDownload } from '../src/updates/network';
import { getAutoDownloadMode, setAutoDownloadMode } from '../src/updates/preferences';
import { createFetchApi } from '../src/defaults';
import { setup, store } from './helpers';

describe('mayAutoDownload', () => {
  const table: [Parameters<typeof mayAutoDownload>[0], Parameters<typeof mayAutoDownload>[1], boolean][] = [
    ['wifi', 'wifi', true],
    ['wifi', 'cellular', false],
    ['wifi', 'unknown', false],
    ['wifi', 'none', false],
    ['always', 'wifi', true],
    ['always', 'cellular', true],
    ['always', 'unknown', true],
    ['always', 'none', false],
    ['never', 'wifi', false],
    ['never', 'cellular', false],
  ];
  it.each(table)('%s on %s -> %s', (mode, net, expected) => {
    expect(mayAutoDownload(mode, net)).toBe(expected);
  });
});

describe('auto-download preference', () => {
  it('defaults to Wi-Fi only', async () => {
    setup();
    expect(await getAutoDownloadMode()).toBe('wifi');
  });

  it('takes the default from the app config', async () => {
    setup({ apk: { autoDownload: 'never' } });
    expect(await getAutoDownloadMode()).toBe('never');
  });

  it("the person's stored choice wins, and bad values are ignored", async () => {
    setup({ apk: { autoDownload: 'never' } });
    await setAutoDownloadMode('always');
    expect(store.get(KitKeys.apkAutoDownload)).toBe('always');
    expect(await getAutoDownloadMode()).toBe('always');
    store.set(KitKeys.apkAutoDownload, 'sometimes');
    expect(await getAutoDownloadMode()).toBe('never');
  });
});

describe('standalone defaults', () => {
  afterEach(() => resetMobileKit());

  it('configures with only a name, a repo and a site', () => {
    configureMobileKit({ appName: 'My App', githubRepo: 'acme/my-app', site: 'https://erp.example.com' });
    const cfg = getConfig();
    expect(typeof cfg.api).toBe('function');
    expect(typeof cfg.storage.get).toBe('function');
    expect(cfg.endpoints.registerInstall).toBe('/api/method/upande_mobile.api.register_install');
  });

  it('the built-in storage works (memory when AsyncStorage is absent)', async () => {
    configureMobileKit({ appName: 'My App', githubRepo: 'acme/my-app' });
    const { storage } = getConfig();
    await storage.set('k', 'v');
    expect(await storage.get('k')).toBe('v');
    await storage.remove('k');
    expect(await storage.get('k')).toBeNull();
  });

  it('the built-in client calls the site with query, body and extra headers, and surfaces the server message', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const real = globalThis.fetch;
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return url.includes('bad')
        ? { ok: false, status: 403, json: async () => ({ message: 'Not permitted' }) }
        : { ok: true, status: 200, json: async () => ({ message: 'ok' }) };
    }) as never;
    try {
      const api = createFetchApi('https://erp.example.com/', async () => ({ Authorization: 'token a:b' }));
      expect(await api({ method: 'GET', url: '/api/method/x', params: { a: 1, b: 'two words', c: undefined } })).toEqual({ message: 'ok' });
      expect(calls[0].url).toBe('https://erp.example.com/api/method/x?a=1&b=two%20words');
      expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('token a:b');
      await api({ method: 'POST', url: '/api/method/y', data: { n: 1 } });
      expect(calls[1].init.body).toBe('{"n":1}');
      await expect(api({ method: 'GET', url: '/bad' })).rejects.toThrow('Not permitted');
      await expect(createFetchApi(undefined)({ method: 'GET', url: '/x' })).rejects.toThrow(/pass `site`/);
    } finally {
      globalThis.fetch = real;
    }
  });
});
