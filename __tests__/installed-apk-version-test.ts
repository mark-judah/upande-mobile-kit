const mockProbe = jest.fn();
jest.mock('../src/native-probe', () => ({ hasNativeModule: (n: string) => mockProbe(n) }));
jest.mock('expo-application', () => ({ nativeApplicationVersion: '1.2.10', nativeBuildVersion: '5210' }), { virtual: true });
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { version: '1.2.17' } } }));
jest.mock('expo-updates', () => ({ manifest: { extra: { expoClient: { version: '1.2.17' } } } }));

describe('installed APK version', () => {
  beforeEach(() => jest.resetModules());

  it('is the APK own version, not the OTA bundle version', () => {
    mockProbe.mockReturnValue(true);
    const v = require('../src/version');
    expect(v.APP_VERSION).toBe('1.2.17');
    expect(v.INSTALLED_APK_VERSION).toBe('1.2.10');
    expect(v.INSTALLED_APK_BUILD).toBe('5210');
    expect(v.INSTALLED_APK_KNOWN).toBe(true);
  });
  it('falls back to the running version, and says it is unknown, when the module is missing', () => {
    mockProbe.mockReturnValue(false);
    const v = require('../src/version');
    expect(v.INSTALLED_APK_VERSION).toBe('1.2.17');
    expect(v.INSTALLED_APK_KNOWN).toBe(false);
  });
});
