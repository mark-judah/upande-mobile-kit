import { KitKeys } from '../src/config';
import { apiMock, setup, store } from './helpers';

jest.mock('expo-updates', () => ({ manifest: null, runtimeVersion: '101.2', isEmbeddedLaunch: true }));
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { version: '1.2.3', runtimeVersion: '101.2' }, nativeAppVersion: '1.2.0', nativeBuildVersion: '12' },
}));
let mockKey: string | null = null;
jest.mock('../src/devices/device-key', () => ({ androidId: () => mockKey }));

// The probes behind the device snapshot: native modules do not exist in jest, so they are scripted here.
const mockDevice = {
  collect: jest.fn(),
  peek: jest.fn(),
  name: 'OnePlus Nord CE5' as string | undefined,
};
jest.mock('../src/monitor/device', () => ({
  readStaticFacts: () => ({ device_name: mockDevice.name }),
  collectDeviceFacts: () => mockDevice.collect(),
  peekDeviceFacts: () => mockDevice.peek(),
}));

import {
  collectHealth,
  getInstallId,
  getRegisteredRowId,
  reportInstall,
  resetReportState,
  shouldSkipReport,
  waitForLaunchRegistration,
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

describe('the device snapshot on a report', () => {
  const FULL = {
    platform: 'android', os_version: '16', os_build: 'CPH2719_16.0.5.1300(EX01)', brand: 'OnePlus', model: 'CPH2719',
    device_name: 'OnePlus Nord CE5', battery_level: 0.82, battery_state: 'unplugged', low_power_mode: false,
    storage_free_bytes: 169265586176, storage_total_bytes: 237554860032, memory_total_bytes: 7837360128,
    network_type: 'cellular', is_connected: true, locale: 'en-KE', timezone: 'Africa/Nairobi',
    screen: { width: 360, height: 797, scale: 3, font_scale: 1 }, js_engine: 'hermes', build_type: 'dev',
    missing_modules: ['expo-file-system'], device_key: 'raw-android-id', install_id: 'abc',
  };

  beforeEach(() => {
    setup();
    resetReportState();
    mockKey = null;
    mockDevice.name = 'OnePlus Nord CE5';
    mockDevice.collect.mockReset().mockResolvedValue(FULL);
    mockDevice.peek.mockReset().mockReturnValue({ platform: 'android', model: 'CPH2719' });
  });

  it('sends device_info with battery, storage, memory, network ... and the device name', async () => {
    await reportInstall({ reason: 'login', user: 'a@x' });
    const data = apiMock.mock.calls[0][0].data;
    expect(data.device_name).toBe('OnePlus Nord CE5');
    expect(typeof data.device_info).toBe('string');
    const info = JSON.parse(data.device_info);
    expect(info).toMatchObject({
      battery_level: 0.82, battery_state: 'unplugged', storage_free_bytes: 169265586176, storage_total_bytes: 237554860032,
      memory_total_bytes: 7837360128, network_type: 'cellular', locale: 'en-KE', timezone: 'Africa/Nairobi',
      screen: { width: 360, height: 797, scale: 3, font_scale: 1 }, js_engine: 'hermes', build_type: 'dev',
      os_build: 'CPH2719_16.0.5.1300(EX01)', missing_modules: ['expo-file-system'],
    });
  });

  it('keeps the hardware key and install id out of the snapshot (they travel as their own fields)', async () => {
    mockKey = 'raw-android-id';
    await reportInstall({ reason: 'login', user: 'a@x' });
    const data = apiMock.mock.calls[0][0].data;
    expect(data.device_key).toBe('raw-android-id');
    expect(data.device_info).not.toContain('raw-android-id');
    expect(JSON.parse(data.device_info)).not.toHaveProperty('install_id');
  });

  it('sends null for the device name only when nothing can say it', async () => {
    mockDevice.name = undefined;
    await reportInstall({ reason: 'login', user: 'a@x' });
    expect(apiMock.mock.calls[0][0].data.device_name).toBeNull();
  });

  it('does not wait on slow probes: after a second it sends what is already known', async () => {
    jest.useFakeTimers();
    try {
      mockDevice.collect.mockReturnValue(new Promise(() => {})); // never answers
      const pending = reportInstall({ reason: 'login', user: 'a@x' });
      await jest.advanceTimersByTimeAsync(1100);
      await pending;
      const info = JSON.parse(apiMock.mock.calls[0][0].data.device_info);
      expect(info).toEqual({ platform: 'android', model: 'CPH2719' });
    } finally {
      jest.useRealTimers();
    }
  });

  it('still reports when the probes throw', async () => {
    mockDevice.collect.mockRejectedValue(new Error('no battery'));
    await reportInstall({ reason: 'login', user: 'a@x' });
    expect(apiMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(apiMock.mock.calls[0][0].data.device_info)).toMatchObject({ platform: 'android' });
    mockDevice.peek.mockImplementation(() => {
      throw new Error('boom');
    });
    expect(await collectHealth()).toBeUndefined();
  });

  it('a report stored by an older kit (no health mark) is re-sent on the next launch, once', async () => {
    const opts = { user: 'a@x', instanceUrl: 'https://site-one.example.com' };
    const server = 'site-one.example.com';
    store.set(`${KitKeys.lastReport}:${server}`, String(Date.now() - 60_000));
    store.set(`${KitKeys.lastUser}:${server}`, 'a@x');
    store.set(`${KitKeys.lastVersion}:${server}`, '1.2.3|101.2'); // what 0.5.x stored
    await reportInstall({ ...opts, reason: 'launch' });
    expect(apiMock).toHaveBeenCalledTimes(1);
    expect(store.get(`${KitKeys.lastVersion}:${server}`)).toBe('1.2.3|101.2|h1');
    resetReportState();
    await reportInstall({ ...opts, reason: 'launch' }); // now inside the hour with the mark: skipped
    expect(apiMock).toHaveBeenCalledTimes(1);
  });
});

describe('waitForLaunchRegistration', () => {
  beforeEach(() => {
    setup();
    resetReportState();
    mockDevice.collect.mockReset().mockResolvedValue({ platform: 'android' });
    mockDevice.peek.mockReset().mockReturnValue({ platform: 'android' });
  });

  it('resolves at once when no launch report is running', async () => {
    await expect(waitForLaunchRegistration()).resolves.toBeUndefined();
  });

  it('waits for the launch report, then resolves', async () => {
    let finish: (v: unknown) => void = () => {};
    apiMock.mockImplementation(() => new Promise((r) => { finish = r; }));
    const report = reportInstall({ reason: 'launch', user: 'a@x' });
    let waited = false;
    const gate = waitForLaunchRegistration().then(() => { waited = true; });
    await new Promise((r) => setTimeout(r, 20));
    expect(waited).toBe(false);
    finish({ message: { install_id: 'row-1' } });
    await report;
    await gate;
    expect(waited).toBe(true);
    await expect(waitForLaunchRegistration()).resolves.toBeUndefined(); // finished: nothing left to wait for
  });

  it('gives up after the timeout when the report hangs', async () => {
    apiMock.mockImplementation(() => new Promise(() => {}));
    void reportInstall({ reason: 'launch', user: 'a@x' });
    const started = Date.now();
    await waitForLaunchRegistration(60);
    expect(Date.now() - started).toBeGreaterThanOrEqual(50);
  });

  it('a failed launch report also releases the wait', async () => {
    apiMock.mockRejectedValue(new Error('offline'));
    await reportInstall({ reason: 'launch', user: 'a@x' });
    await expect(waitForLaunchRegistration(50)).resolves.toBeUndefined();
  });
});
