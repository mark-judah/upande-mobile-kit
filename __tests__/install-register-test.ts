import { KitKeys } from '../src/config';
import { apiMock, setup, store } from './helpers';

jest.mock('expo-updates', () => ({ manifest: null, runtimeVersion: '101.2', isEmbeddedLaunch: true }));
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { version: '1.2.3', runtimeVersion: '101.2' }, nativeAppVersion: '1.2.0', nativeBuildVersion: '12' },
}));
let mockKey: string | null = null;
jest.mock('../src/devices/device-key', () => ({ androidId: () => mockKey }));

import {
  getInstallId,
  getRegisteredRowId,
  reportInstall,
  resetReportState,
  shouldSkipReport,
} from '../src/devices/install-register';

const MIN = 60 * 1000;
const base = {
  reason: 'launch' as const,
  account: 'a@x',
  lastUser: 'a@x',
  lastVersion: 'v1',
  versionKey: 'v1',
  last: 1_000_000,
  now: 1_000_000 + 10 * MIN,
};

describe('shouldSkipReport (throttle rules)', () => {
  it('skips a repeat launch inside the hour', () => {
    expect(shouldSkipReport(base)).toBe(true);
  });
  it('reports a launch after the hour', () => {
    expect(shouldSkipReport({ ...base, now: base.last + 61 * MIN })).toBe(false);
  });
  it('foreground uses a 15 minute interval', () => {
    expect(shouldSkipReport({ ...base, reason: 'foreground', now: base.last + 10 * MIN })).toBe(true);
    expect(shouldSkipReport({ ...base, reason: 'foreground', now: base.last + 16 * MIN })).toBe(false);
  });
  it('never skips a login', () => {
    expect(shouldSkipReport({ ...base, reason: 'login' })).toBe(false);
  });
  it('a changed version (an OTA applied) reports at once', () => {
    expect(shouldSkipReport({ ...base, versionKey: 'v2' })).toBe(false);
  });
  it('a different account reports at once', () => {
    expect(shouldSkipReport({ ...base, account: 'b@x' })).toBe(false);
  });
  it('first ever report (no stamp) is due', () => {
    expect(shouldSkipReport({ ...base, last: 0 })).toBe(false);
  });
  it('a stamp in the future (clock moved back) is due', () => {
    expect(shouldSkipReport({ ...base, last: base.now + MIN })).toBe(false);
  });
  it('an unknown account does not count as a change', () => {
    expect(shouldSkipReport({ ...base, account: null })).toBe(true);
  });
});

describe('reportInstall', () => {
  beforeEach(() => {
    setup();
    resetReportState();
    mockKey = null;
  });

  it('posts the device facts to the configured endpoint under the configured app name', async () => {
    mockKey = 'android-id-1';
    await reportInstall({ reason: 'login', user: 'a@x', instanceUrl: 'https://site-one.example.com' });
    expect(apiMock).toHaveBeenCalledTimes(1);
    const req = apiMock.mock.calls[0][0];
    expect(req.method).toBe('POST');
    expect(req.url).toBe('/api/method/upande_mobile.api.register_install');
    expect(req.data).toMatchObject({
      app: 'Test App',
      reason: 'login',
      app_version: '1.2.3',
      runtime_version: '101.2',
      device_key: 'android-id-1',
    });
    expect(req.data.install_id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('launches once per process, then throttles foreground reports', async () => {
    const opts = { user: 'a@x', instanceUrl: 'https://site-one.example.com' };
    await reportInstall({ ...opts, reason: 'launch' });
    await reportInstall({ ...opts, reason: 'launch' });
    expect(apiMock).toHaveBeenCalledTimes(1);
    await reportInstall({ ...opts, reason: 'foreground' }); // inside the stored 1h window, same version
    expect(apiMock).toHaveBeenCalledTimes(1);
  });

  it('a failed send is not recorded, so the next launch retries', async () => {
    apiMock.mockRejectedValueOnce(new Error('offline'));
    const opts = { user: 'a@x', instanceUrl: 'https://site-one.example.com' };
    expect(await reportInstall({ ...opts, reason: 'launch' })).toBeNull();
    resetReportState();
    await reportInstall({ ...opts, reason: 'launch' });
    expect(apiMock).toHaveBeenCalledTimes(2);
  });

  it('throttles per server: a report to one says nothing about another', async () => {
    await reportInstall({ reason: 'login', user: 'a@x', instanceUrl: 'https://one.example.com' });
    resetReportState();
    await reportInstall({ reason: 'launch', user: 'a@x', instanceUrl: 'https://two.example.com' });
    expect(apiMock).toHaveBeenCalledTimes(2);
  });

  it('keeps the install id across calls and the server row id per server', async () => {
    const url = 'https://site-one.example.com';
    const id = await getInstallId();
    await reportInstall({ reason: 'login', user: 'a@x', instanceUrl: url });
    expect(await getInstallId()).toBe(id);
    expect(await getRegisteredRowId(url)).toBe('row-1');
    expect(await getRegisteredRowId('https://other.example.com')).toBeNull();
    expect(store.get(KitKeys.installId)).toBe(id);
  });

  it('never rejects, even when storage is broken', async () => {
    setup({ storage: { get: async () => { throw new Error('boom'); }, set: async () => { throw new Error('boom'); }, remove: async () => {} } });
    resetReportState();
    await expect(reportInstall({ reason: 'login', user: 'a@x' })).resolves.toBeNull();
  });

  it('uses the host-supplied device key when given', async () => {
    setup({ deviceKey: () => 'host-key' });
    resetReportState();
    mockKey = 'android-id';
    await reportInstall({ reason: 'login', user: 'a@x' });
    expect(apiMock.mock.calls[0][0].data.device_key).toBe('host-key');
  });
});
