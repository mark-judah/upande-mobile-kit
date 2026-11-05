import { setup } from './helpers';

// Only these native modules "exist" in this build.
const present = new Set(['ExpoDevice', 'ExpoNetwork', 'FileSystem']);
jest.mock('expo', () => ({
  ...jest.requireActual('expo'),
  requireOptionalNativeModule: (n: string) => (mockPresent.has(n) ? {} : null),
}));
const mockPresent = present;
jest.mock('expo-device', () => ({ modelName: 'Pixel 7', brand: 'Google', osVersion: '14', isDevice: true }), { virtual: true });
jest.mock('expo-network', () => ({ getNetworkStateAsync: async () => ({ type: 'WIFI', isConnected: true }), NetworkStateType: {} }), { virtual: true });
jest.mock('expo-file-system', () => ({ Paths: { availableDiskSpace: 5e9, totalDiskSpace: 6.4e10 } }));
jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() }), { virtual: true });

import {
  classify,
  describeMissing,
  FIX_COMMAND,
  isPackageNotFound,
  missingAdvice,
  missingModuleNames,
  missingModules,
  missingSummary,
  OPTIONAL_MODULES,
} from '../src/modules';
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

describe('what is missing and why (the shared list, the probes, the words)', () => {
  const lib = require('../shared/native-modules.cjs');

  it('reads the same list the CLI and the config plugin read, and agrees on the fix command', () => {
    expect(FIX_COMMAND).toBe(lib.FIX_COMMAND);
    expect(lib.NAMES).toHaveLength(10);
    expect(OPTIONAL_MODULES.map((m) => m.pkg).sort()).toEqual(lib.MODULES.filter((m: { runtime: boolean }) => m.runtime).map((m: { pkg: string }) => m.pkg).sort());
  });

  it('probes the native name expo-file-system really registers (FileSystem), not a guessed one', () => {
    const fs = OPTIONAL_MODULES.find((m) => m.pkg === 'expo-file-system');
    expect(fs?.native).toContain('FileSystem');
    expect(fs?.native).not.toContain('ExpoFileSystem');
    // present: the SDK's real name answers, so it is NOT reported missing
    expect(missingModuleNames()).not.toContain('expo-file-system');
  });

  it('tells "package not installed" from "installed but not in this binary"', () => {
    const battery = OPTIONAL_MODULES.find((m) => m.pkg === 'expo-battery')!;
    const async = OPTIONAL_MODULES.find((m) => m.pkg === '@react-native-async-storage/async-storage')!;
    expect(classify(battery, { nativeSeen: true, loaded: true })).toBe('present');
    expect(classify(battery, { nativeSeen: false, loaded: true })).toBe('rebuild');
    expect(classify(battery, { nativeSeen: false, loaded: false, loadError: new Error('Cannot find native module \'ExpoBattery\'') })).toBe('rebuild');
    expect(classify(battery, { nativeSeen: false, loaded: false, loadError: new Error('Requiring unknown module "12". If you are sure the module exists...') })).toBe('not-installed');
    expect(classify(battery, { nativeSeen: false, loaded: false, loadError: new Error("Cannot find module 'expo-battery'") })).toBe('not-installed');
    expect(classify(async, { nativeSeen: false, loaded: true, loadedValue: { getItem() {} } })).toBe('present');
    expect(classify(async, { nativeSeen: false, loaded: true, loadedValue: {} })).toBe('rebuild');
    expect(classify(async, { nativeSeen: false, loaded: false, loadError: new Error('Unable to resolve module') })).toBe('not-installed');
    expect(isPackageNotFound('weird failure')).toBe(false);
  });

  it('says the exact command for a missing package and "rebuild required" for a missing native side', () => {
    const rebuild = { pkg: 'expo-battery', native: ['ExpoBattery'], disables: 'Battery info unavailable', state: 'rebuild' as const };
    const gone = { pkg: 'expo-device', native: ['ExpoDevice'], disables: 'Device model and memory unavailable', state: 'not-installed' as const };
    expect(describeMissing(rebuild)).toBe('Battery info unavailable: rebuild required');
    expect(describeMissing(gone)).toBe('Device model and memory unavailable: not installed, run npx upande-mobile-kit fix');
    expect(missingAdvice([rebuild])).toContain('rebuild required');
    expect(missingAdvice([rebuild])).not.toContain('npx upande-mobile-kit fix');
    expect(missingAdvice([gone])).toContain('npx upande-mobile-kit fix');
    const both = missingAdvice([rebuild, gone]);
    expect(both).toContain('"not installed"');
    expect(both).toContain('"rebuild required"');
  });

  it('summarises everything missing in one line with the command, or says nothing', () => {
    expect(missingSummary([])).toBeNull();
    const line = missingSummary([
      { pkg: 'expo-battery', native: ['ExpoBattery'], disables: 'x', state: 'rebuild' },
      { pkg: 'expo-device', native: ['ExpoDevice'], disables: 'y', state: 'not-installed' },
    ])!;
    expect(line).toContain('2 native modules unavailable');
    expect(line).toContain('expo-battery (rebuild required)');
    expect(line).toContain('expo-device (not installed)');
    expect(line).toContain('npx upande-mobile-kit fix');
    expect(line.split('\n')).toHaveLength(1);
  });

  it('every missing module carries its state', () => {
    for (const m of missingModules()) expect(['rebuild', 'not-installed']).toContain(m.state);
  });
});
