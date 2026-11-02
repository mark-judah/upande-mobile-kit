/* eslint-disable @typescript-eslint/no-require-imports -- the plugin files are plain CommonJS */
const lib = require('../plugins/cleartext-lib');
const withCleartext = require('../plugins/withCleartext');
const withKit = require('../app.plugin.js');

const { collectSites, analyze, applyAndroidCleartext, applyIosAts, isLocalHost } = lib;

let warn: jest.SpyInstance;
beforeEach(() => {
  warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => warn.mockRestore());

const manifest = () => ({ manifest: { application: [{ $: { 'android:name': '.MainApplication' } }] } });

describe('collectSites', () => {
  it('reads plugin props and extra.mobileKit.sites', () => {
    const sites = collectSites(
      { extra: { mobileKit: { sites: { production: 'https://p.example.com', development: 'http://192.168.1.5:8000' } } }, updates: { url: 'https://p.example.com/m' } },
      { devSite: 'http://localhost:8000', manifestUrl: 'https://p.example.com/manifest' },
    );
    const urls = sites.map((s: { label: string; url: string }) => `${s.label}=${s.url}`);
    expect(urls).toEqual(expect.arrayContaining([
      'development=http://localhost:8000',
      'updates=https://p.example.com/manifest',
      'production=https://p.example.com',
      'development=http://192.168.1.5:8000',
      'updates=https://p.example.com/m',
    ]));
  });
  it('accepts a plain string as the production site and ignores junk', () => {
    expect(collectSites({}, { sites: 'https://a.example.com' })).toEqual([{ label: 'production', url: 'https://a.example.com' }]);
    expect(collectSites({}, undefined)).toEqual([]);
    expect(collectSites({ extra: {} }, { site: 42 })).toEqual([]);
  });
});

describe('analyze', () => {
  it('finds http sites, classifies local/IP, and stays empty for https only', () => {
    const a = analyze([
      { label: 'production', url: 'https://p.example.com' },
      { label: 'development', url: 'http://192.168.1.5:8000' },
      { label: 'development', url: 'http://dev.example.com' },
    ]);
    expect(a.http.map((s: { host: string; ip: boolean; lan: boolean }) => [s.host, s.ip, s.lan])).toEqual([
      ['192.168.1.5', true, true],
      ['dev.example.com', false, false],
    ]);
    expect(a.productionHttp).toBe(false);
    expect(a.warnings).toEqual([]);
    expect(a.notes[0]).toContain('usesCleartextTraffic');
    expect(analyze([{ label: 'production', url: 'https://p.example.com' }]).http).toEqual([]);
  });
  it('warns loudly about a plain-http production site', () => {
    const a = analyze([{ label: 'production', url: 'http://p.example.com' }]);
    expect(a.productionHttp).toBe(true);
    expect(a.warnings[0]).toMatch(/LOUD WARNING.*production.*clear text/);
    // the expo-updates feed counts as production traffic too
    expect(analyze([{ label: 'updates', url: 'http://p.example.com/m' }]).productionHttp).toBe(true);
  });
  it('warns that .local hostnames do not resolve from phones and says what to do', () => {
    const a = analyze([{ label: 'development', url: 'http://mybench.local:8000' }]);
    expect(a.warnings[0]).toMatch(/mDNS.*cannot resolve.*LAN IP.*default site/s);
    expect(a.http[0].lan).toBe(true);
  });
  it('isLocalHost covers loopback, private ranges, emulator alias and .local', () => {
    for (const h of ['localhost', 'x.local', '127.0.0.1', '10.0.2.2', '192.168.0.4', '172.16.0.1', '172.31.9.9', '169.254.1.1', '::1']) expect(isLocalHost(h)).toBe(true);
    for (const h of ['example.com', '8.8.8.8', '172.32.0.1', '11.0.0.1']) expect(isLocalHost(h)).toBe(false);
  });
});

describe('platform transforms', () => {
  it('sets usesCleartextTraffic on <application>, keeping its other attributes', () => {
    const m = applyAndroidCleartext(manifest());
    expect(m.manifest.application[0].$).toEqual({ 'android:name': '.MainApplication', 'android:usesCleartextTraffic': 'true' });
    expect(applyAndroidCleartext({ manifest: {} })).toEqual({ manifest: {} }); // no <application>: untouched
  });
  it('adds an ATS exception for a named host only, never NSAllowsArbitraryLoads', () => {
    const plist = applyIosAts({ CFBundleName: 'x' }, [{ host: 'dev.example.com', ip: false, lan: false }]);
    expect(plist.NSAppTransportSecurity).toEqual({
      NSExceptionDomains: { 'dev.example.com': { NSExceptionAllowsInsecureHTTPLoads: true, NSIncludesSubdomains: false } },
    });
    expect(plist.NSAppTransportSecurity.NSAllowsArbitraryLoads).toBeUndefined();
  });
  it('uses NSAllowsLocalNetworking (no per-domain entry) for IPs and local hosts', () => {
    const plist = applyIosAts({}, [{ host: '192.168.1.5', ip: true, lan: true }, { host: 'localhost', ip: false, lan: true }]);
    expect(plist.NSAppTransportSecurity).toEqual({ NSAllowsLocalNetworking: true });
  });
  it('merges with an existing ATS block', () => {
    const plist = applyIosAts(
      { NSAppTransportSecurity: { NSExceptionDomains: { 'keep.example.com': { NSExceptionAllowsInsecureHTTPLoads: true } } } },
      [{ host: 'dev.example.com', ip: false, lan: false }],
    );
    expect(Object.keys(plist.NSAppTransportSecurity.NSExceptionDomains).sort()).toEqual(['dev.example.com', 'keep.example.com']);
  });
});

describe('withCleartext (the plugin)', () => {
  const mods = (c: { mods?: Record<string, Record<string, unknown>> }) => [Object.keys(c.mods?.android ?? {}), Object.keys(c.mods?.ios ?? {})];

  it('registers the Android and iOS mods when a site is http, and says so', () => {
    const c = withCleartext({ name: 'x', extra: { mobileKit: { sites: { production: 'https://p.example.com', development: 'http://192.168.1.5:8000' } } } }, {});
    expect(mods(c)).toEqual([['manifest'], ['infoPlist']]);
    expect(String(warn.mock.calls.flat().join('\n'))).toContain('usesCleartextTraffic');
  });
  it('registers nothing when every site is https', () => {
    const c = withCleartext({ name: 'y', extra: { mobileKit: { sites: { production: 'https://p.example.com' } } } }, {});
    expect(mods(c)).toEqual([[], []]);
  });
  it('cleartext: false opts out of the changes but says what will be blocked', () => {
    const c = withCleartext({ name: 'z' }, { sites: { production: 'https://p.example.com', development: 'http://10.0.0.7:8000' }, cleartext: false });
    expect(mods(c)).toEqual([[], []]);
    expect(String(warn.mock.calls.flat().join('\n'))).toContain('will be blocked');
  });
  it('the combined plugin wires it in and still applies the updates URL', () => {
    const c = withKit({ name: 'w', runtimeVersion: '1.0' }, { manifestUrl: 'http://10.0.0.7:8000/m?app=A', sites: { development: 'http://10.0.0.7:8000' }, strict: false });
    expect(c.updates.url).toBe('http://10.0.0.7:8000/m?app=A');
    expect(c.mods.android.manifest).toBeDefined();
    expect(c.mods.ios.infoPlist).toBeDefined();
  });
});
