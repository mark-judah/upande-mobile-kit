import { setup } from './helpers';

jest.mock('expo', () => ({
  ...jest.requireActual('expo'),
  requireOptionalNativeModule: (n: string) => (['ExpoDevice', 'ExpoBattery', 'ExpoNetwork'].includes(n) ? {} : null),
}));
jest.mock('expo-device', () => ({ modelName: 'Pixel 7', brand: 'Google', osVersion: '14', osBuildId: 'AP1A', deviceName: "Ann's phone", isDevice: true, totalMemory: 8e9 }), { virtual: true });
const mockLevel = jest.fn(async () => 0.42);
jest.mock('expo-battery', () => ({
  getBatteryLevelAsync: () => mockLevel(), getBatteryStateAsync: async () => 1, isLowPowerModeEnabledAsync: async () => true, BatteryState: { 1: 'UNPLUGGED' },
}), { virtual: true });
jest.mock('expo-network', () => ({
  getNetworkStateAsync: async () => ({ type: 'WIFI', isConnected: true, isInternetReachable: true }), NetworkStateType: { WIFI: 'WIFI' },
}), { virtual: true });
jest.mock('expo-file-system', () => ({ Paths: { availableDiskSpace: 5e9, totalDiskSpace: 6.4e10 } }));

import { collectDeviceFacts, peekDeviceFacts, resetDeviceCache } from '../src/monitor/device';

beforeEach(() => {
  setup();
  resetDeviceCache();
  mockLevel.mockClear();
});

describe('device facts', () => {
  it('collects static and dynamic facts from whatever modules exist', async () => {
    const f = await collectDeviceFacts();
    expect(f).toMatchObject({
      model: 'Pixel 7', brand: 'Google', os_version: '14', os_build: 'AP1A', device_name: "Ann's phone", is_physical_device: true,
      memory_total_bytes: 8e9, battery_level: 0.42, battery_state: 'unplugged', low_power_mode: true,
      network_type: 'wifi', is_connected: true, is_internet_reachable: true, storage_free_bytes: 5e9, storage_total_bytes: 6.4e10,
    });
    expect(f.screen).toBeDefined();
    expect(f.locale).toBeTruthy();
    expect(f.install_id).toBeTruthy();
  });

  it('caches the dynamic read for 30 s', async () => {
    const t = 1_000_000;
    await collectDeviceFacts(t);
    await collectDeviceFacts(t + 10_000);
    expect(mockLevel).toHaveBeenCalledTimes(1);
    await collectDeviceFacts(t + 31_000);
    expect(mockLevel).toHaveBeenCalledTimes(2);
  });

  it('leaves a field out when its probe hangs, instead of waiting for it', async () => {
    mockLevel.mockImplementation(() => new Promise<number>(() => {}));
    const started = Date.now();
    const f = await collectDeviceFacts();
    expect(Date.now() - started).toBeLessThan(2500);
    expect(f.battery_level).toBeUndefined();
    expect(f.model).toBe('Pixel 7');
    mockLevel.mockImplementation(async () => 0.42);
  });

  it('peek returns what is known without any async work', async () => {
    await collectDeviceFacts();
    expect(peekDeviceFacts().battery_level).toBe(0.42);
  });
});
