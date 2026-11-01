import { CONFIG_GAP_MESSAGES, configureMobileKit, getConfig, getConfigGaps, resetMobileKit } from '../src/config';

const full = {
  appName: 'A',
  githubRepo: 'o/r',
  api: (async () => ({})) as never,
  storage: { get: async () => null, set: async () => {}, remove: async () => {} },
  useAuth: () => ({}) as never,
};

let warn: jest.SpyInstance;
beforeEach(() => {
  resetMobileKit();
  warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => warn.mockRestore());

describe('config gaps (useAuth / api / storage not wired)', () => {
  it('is silent and reports no gaps when the host passes everything', () => {
    configureMobileKit(full);
    expect(getConfigGaps()).toEqual([]);
    expect(getConfig().standIns).toEqual({ useAuth: false, api: false, storage: false });
    expect(warn).not.toHaveBeenCalled();
  });

  it('names each stand-in in use and warns once in development', () => {
    configureMobileKit({ appName: 'A', githubRepo: 'o/r', site: 'https://s.example.com' });
    expect(getConfigGaps().sort()).toEqual(['api', 'storage', 'useAuth']);
    expect(getConfig().standIns).toEqual({ useAuth: true, api: true, storage: true });
    expect(warn).toHaveBeenCalledTimes(1);
    const text = String(warn.mock.calls[0][0]);
    expect(text).toContain('useAuth not configured — device register and sign-out are not connected to your session.');
    expect(text).toContain(CONFIG_GAP_MESSAGES.api);
    expect(text).toContain(CONFIG_GAP_MESSAGES.storage);
    // configuring again does not repeat it
    configureMobileKit({ appName: 'A', githubRepo: 'o/r', site: 'https://s.example.com' });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('reports only the missing piece', () => {
    configureMobileKit({ ...full, useAuth: undefined });
    expect(getConfigGaps()).toEqual(['useAuth']);
    expect(String(warn.mock.calls[0][0])).not.toContain('api not configured');
  });

  it('does not warn outside development, but still exposes the gaps', () => {
    const g = globalThis as { __DEV__?: boolean };
    const was = g.__DEV__;
    g.__DEV__ = false;
    try {
      configureMobileKit({ appName: 'A', githubRepo: 'o/r' });
      expect(warn).not.toHaveBeenCalled();
      expect(getConfigGaps()).toContain('useAuth');
    } finally {
      g.__DEV__ = was;
    }
  });

  it('getConfigGaps is empty before the kit is configured', () => {
    expect(getConfigGaps()).toEqual([]);
  });
});

describe('new config keys pass through', () => {
  it('keeps settingsRoute, devicesRoute, biometric and foregroundReportMinMs on the resolved config', () => {
    configureMobileKit({ ...full, settingsRoute: '/kit-settings', devicesRoute: '/kit-devices', biometric: 'host', foregroundReportMinMs: 5000 });
    expect(getConfig()).toMatchObject({ settingsRoute: '/kit-settings', devicesRoute: '/kit-devices', biometric: 'host', foregroundReportMinMs: 5000 });
  });
});
