import { setup } from './helpers';

// Only these native modules "exist" in this build.
const present = new Set(['ExpoDevice', 'ExpoNetwork', 'ExpoFileSystem']);
jest.mock('expo', () => ({
  ...jest.requireActual('expo'),
  requireOptionalNativeModule: (n: string) => (mockPresent.has(n) ? {} : null),
}));
const mockPresent = present;
jest.mock('expo-device', () => ({ modelName: 'Pixel 7', brand: 'Google', osVersion: '14', isDevice: true }), { virtual: true });
jest.mock('expo-network', () => ({ getNetworkStateAsync: async () => ({ type: 'WIFI', isConnected: true }), NetworkStateType: {} }), { virtual: true });
jest.mock('expo-file-system', () => ({ Paths: { availableDiskSpace: 5e9, totalDiskSpace: 6.4e10 } }));
jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() }), { virtual: true });

import { missingModuleNames, missingModules, OPTIONAL_MODULES } from '../src/modules';
import { collectDeviceFacts, peekDeviceFacts, resetDeviceCache } from '../src/monitor/device';

beforeEach(() => {
  setup();
  resetDeviceCache();
});

describe('missing optional native modules', () => {
  it('lists exactly the ones this build lacks, each with what it disables', () => {
    const names = missingModuleNames();
    expect(names.sort()).toEqual(['expo-battery', 'expo-intent-launcher', 'expo-local-authentication', 'expo-localization']);
    const battery = missingModules().find((m) => m.pkg === 'expo-battery');
    expect(battery?.disables).toBe('Battery info unavailable');
    expect(OPTIONAL_MODULES.every((m) => m.disables.length > 0)).toBe(true);
  });

  it('can leave out packages the app does not use (host-owned biometric)', () => {
    expect(missingModuleNames(['expo-local-authentication'])).not.toContain('expo-local-authentication');
  });

  it('reports a JS-only module (AsyncStorage) as present when it loads, absent when it does not', () => {
    expect(missingModuleNames()).not.toContain('@react-native-async-storage/async-storage');
  });

  it('is empty when everything is present', () => {
    ['ExpoBattery', 'ExpoIntentLauncher', 'ExpoLocalAuthentication', 'ExpoLocalization'].forEach((n) => present.add(n));
    try {
      expect(missingModuleNames()).toEqual([]);
    } finally {
      ['ExpoBattery', 'ExpoIntentLauncher', 'ExpoLocalAuthentication', 'ExpoLocalization'].forEach((n) => present.delete(n));
    }
  });
});

describe('crash report device facts', () => {
  it('carry missing_modules so IT can tell a rebuild is needed', async () => {
    const facts = await collectDeviceFacts();
    expect(facts.missing_modules?.slice().sort()).toEqual(['expo-battery', 'expo-intent-launcher', 'expo-local-authentication', 'expo-localization']);
    expect(peekDeviceFacts().missing_modules).toEqual(facts.missing_modules);
  });

  it('omit it when the host owns the lock and nothing else is missing', async () => {
    setup({ biometric: 'host' });
    resetDeviceCache();
    const facts = await collectDeviceFacts();
    expect(facts.missing_modules).not.toContain('expo-local-authentication');
  });
});
