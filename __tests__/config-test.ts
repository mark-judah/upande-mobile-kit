import {
  configureMobileKit,
  defaultInstanceKey,
  DEFAULT_ENDPOINTS,
  getConfig,
  isConfigured,
  resetMobileKit,
  resolveSite,
} from '../src/config';
import { setup } from './helpers';

const base = {
  appName: 'A',
  githubRepo: 'o/r',
  api: (async () => ({})) as never,
  storage: { get: async () => null, set: async () => {}, remove: async () => {} },
  useAuth: () => ({}) as never,
};

describe('configureMobileKit', () => {
  beforeEach(() => resetMobileKit());

  it('throws a helpful error before it is configured', () => {
    expect(isConfigured()).toBe(false);
    expect(() => getConfig()).toThrow(/configureMobileKit/);
  });

  it('requires an app name and an owner/repo', () => {
    expect(() => configureMobileKit({ ...base, appName: '' })).toThrow(/appName/);
    expect(() => configureMobileKit({ ...base, githubRepo: 'not-a-repo' })).toThrow(/owner\/repo/);
    expect(() => configureMobileKit({ ...base, githubRepo: 'https://github.com/o/r' })).toThrow(/owner\/repo/);
  });

  it('merges theme and endpoint overrides onto the defaults', () => {
    configureMobileKit({ ...base, theme: { primary: '#123456' }, endpoints: { installs: '/custom' } });
    const c = getConfig();
    expect(c.theme.primary).toBe('#123456');
    expect(c.theme.danger).toBeTruthy();
    expect(c.endpoints.installs).toBe('/custom');
    expect(c.endpoints.registerInstall).toBe(DEFAULT_ENDPOINTS.registerInstall);
  });

  it('defaults endpoints to the upande_mobile app', () => {
    expect(DEFAULT_ENDPOINTS.registerInstall).toBe('/api/method/upande_mobile.api.register_install');
    expect(DEFAULT_ENDPOINTS.installs).toBe('/api/method/upande_mobile.api.installs');
  });

  it('normalises instance urls', () => {
    expect(defaultInstanceKey('HTTPS://Site.Example.com/')).toBe('site.example.com');
    expect(defaultInstanceKey(null)).toBe('');
  });

  it('setup helper configures the kit', () => {
    setup();
    expect(getConfig().appName).toBe('Test App');
  });
});

describe('resolveSite', () => {
  const both = { production: 'https://prod.example.com/', development: 'http://192.168.1.10:8000' };
  test('a plain string is used as is (trailing slash dropped) in every environment', () => {
    expect(resolveSite('https://a.example.com/', undefined, true).site).toBe('https://a.example.com');
    expect(resolveSite('https://a.example.com', undefined, false).site).toBe('https://a.example.com');
  });
  test('dev builds use development, release builds production', () => {
    expect(resolveSite(both, undefined, true)).toEqual({ site: 'http://192.168.1.10:8000', environment: 'development' });
    expect(resolveSite(both, undefined, false)).toEqual({ site: 'https://prod.example.com', environment: 'production' });
  });
  test('an explicit environment wins over __DEV__', () => {
    expect(resolveSite(both, 'production', true).site).toBe('https://prod.example.com');
    expect(resolveSite(both, 'development', false).site).toBe('http://192.168.1.10:8000');
  });
  test('no development site falls back to production; no site at all is undefined', () => {
    expect(resolveSite({ production: 'https://p.example.com' }, undefined, true).site).toBe('https://p.example.com');
    expect(resolveSite(undefined, undefined, true).site).toBeUndefined();
  });
  test('configureMobileKit stores the resolved site and environment', () => {
    configureMobileKit({ ...base, site: both, environment: 'development' });
    expect(getConfig().site).toBe('http://192.168.1.10:8000');
    expect(getConfig().environment).toBe('development');
    resetMobileKit();
  });
});
