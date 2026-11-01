import {
  configureMobileKit,
  defaultInstanceKey,
  DEFAULT_ENDPOINTS,
  getConfig,
  isConfigured,
  resetMobileKit,
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
