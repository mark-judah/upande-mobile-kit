let mockPlatform = 'android';
jest.mock('react-native', () => ({
  Linking: { openURL: jest.fn(), openSettings: jest.fn() },
  get Platform() {
    return { OS: mockPlatform };
  },
}));
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { android: { package: 'com.example.app' } } } }));
let mockHasLauncher = false;
jest.mock('expo', () => ({ requireOptionalNativeModule: () => (mockHasLauncher ? {} : null) }));
jest.mock('expo-intent-launcher', () => ({ startActivityAsync: jest.fn() }), { virtual: true });
const mockSize = jest.fn();
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///files/',
  cacheDirectory: 'file:///cache/',
  getInfoAsync: (...a: unknown[]) => mockSize(...a),
}));

function load() {
  let mod: typeof import('../src/updates/install-apk') | undefined;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = require('../src/updates/install-apk');
  });
  return mod!;
}

beforeEach(() => {
  mockPlatform = 'android';
  mockHasLauncher = false;
  mockSize.mockReset();
});

describe('canInstallInApp (can this build open the installer?)', () => {
  it('is false on a build without the intent launcher native module (older APK)', () => {
    expect(load().canInstallInApp()).toBe(false);
  });
  it('is true on Android with the launcher', () => {
    mockHasLauncher = true;
    expect(load().canInstallInApp()).toBe(true);
  });
  it('is false off Android even with the launcher', () => {
    mockHasLauncher = true;
    mockPlatform = 'ios';
    expect(load().canInstallInApp()).toBe(false);
  });
});

describe('findDownloadedApk (is the APK already fully on disk?)', () => {
  const url = 'https://example.com/app_v1.3.0.apk';

  it('trusts a file only when its size matches the release exactly', async () => {
    mockSize.mockResolvedValue({ exists: true, isDirectory: false, size: 1000 });
    expect(await load().findDownloadedApk(url, { fileName: 'app_v1.3.0.apk', expectedBytes: 1000 })).toBe('file:///files/app_v1.3.0.apk');
  });
  it('rejects a partial download', async () => {
    mockSize.mockResolvedValue({ exists: true, isDirectory: false, size: 400 });
    expect(await load().findDownloadedApk(url, { fileName: 'a.apk', expectedBytes: 1000 })).toBeNull();
  });
  it('is null when the release size is unknown (a partial file would look whole)', async () => {
    mockSize.mockResolvedValue({ exists: true, isDirectory: false, size: 1000 });
    expect(await load().findDownloadedApk(url, { fileName: 'a.apk' })).toBeNull();
  });
  it('is null when the file is missing or the check throws', async () => {
    mockSize.mockResolvedValue({ exists: false });
    expect(await load().findDownloadedApk(url, { expectedBytes: 1000 })).toBeNull();
    mockSize.mockRejectedValue(new Error('io'));
    expect(await load().findDownloadedApk(url, { expectedBytes: 1000 })).toBeNull();
  });
  it('is null off Android', async () => {
    mockPlatform = 'ios';
    expect(await load().findDownloadedApk(url, { expectedBytes: 1000 })).toBeNull();
  });
});

describe('downloadApk guards', () => {
  it('refuses off Android and without a link, with an InstallError', async () => {
    mockPlatform = 'ios';
    const m = load();
    await expect(m.downloadApk('https://example.com/a.apk')).rejects.toBeInstanceOf(m.InstallError);
    mockPlatform = 'android';
    const m2 = load();
    await expect(m2.downloadApk('')).rejects.toBeInstanceOf(m2.InstallError);
  });
});
