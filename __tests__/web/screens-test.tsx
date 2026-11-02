import { renderToString } from 'react-dom/server';
import { apiMock, auth, setup } from '../helpers';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn() },
  Redirect: ({ href }: { href: string }) => `REDIRECT:${href}`,
  usePathname: () => '/mobile-kit/settings',
}));
jest.mock('expo-updates', () => ({
  manifest: null,
  runtimeVersion: '101.2',
  isEmbeddedLaunch: false,
  updateId: 'abcdef1234567890',
  channel: 'production',
  createdAt: new Date('2026-10-30T10:00:00Z'),
  isEnabled: false,
  useUpdates: () => ({ isUpdatePending: false }),
  checkForUpdateAsync: jest.fn(),
  fetchUpdateAsync: jest.fn(),
  reloadAsync: jest.fn(),
}));
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { version: '1.2.3', runtimeVersion: '101.2' }, nativeAppVersion: '1.2.0', nativeBuildVersion: '12' },
}));
jest.mock('expo-file-system/legacy', () => ({ documentDirectory: 'file:///f/', getInfoAsync: jest.fn() }));
// Which native modules this "build" has: none by default; a test can flip them all on.
const nativeFlags = { all: false };
jest.mock('expo', () => ({ requireOptionalNativeModule: () => (nativeFlags.all ? {} : null) }));
// JS side installed, native side absent from this binary -> "rebuild required"
jest.mock('expo-battery', () => ({}), { virtual: true });
jest.mock('expo-localization', () => ({}), { virtual: true });
jest.mock('expo-intent-launcher', () => ({}), { virtual: true });
jest.mock('expo-local-authentication', () => ({}), { virtual: true });
jest.mock('expo-network', () => ({}), { virtual: true });
jest.mock('expo-file-system', () => ({}), { virtual: true });
// not installed at all -> "run npx upande-mobile-kit fix"
jest.mock(
  'expo-device',
  () => {
    throw new Error("Cannot find module 'expo-device'");
  },
  { virtual: true },
);
jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() }), { virtual: true });

import { SettingsScreen } from '../../src/screens/SettingsScreen';
import { DevicesScreen } from '../../src/screens/DevicesScreen';
import { MobileKitProvider } from '../../src/MobileKitProvider';

beforeEach(() => {
  setup();
  auth.isSystemManager = true;
  nativeFlags.all = false;
});

describe('SettingsScreen (server render)', () => {
  it('shows the app, versions, update code line, security and session sections', () => {
    const html = renderToString(
      <MobileKitProvider>
        <SettingsScreen />
      </MobileKitProvider>,
    );
    expect(html).toContain('Settings');
    expect(html).toContain('Test App');
    expect(html).toContain('Test User');
    expect(html).toContain('test@example.com');
    expect(html).toContain('Biometric unlock');
    expect(html).toContain('Send crash reports');
    expect(html).toContain('v1.2.3'); // installed
    expect(html).toContain('OTA abcdef12'); // code line
    expect(html).toContain('Check for updates');
    expect(html).toContain('Devices'); // System Manager link
    expect(html).toContain('Sign out');
    expect(html).toContain('Forget this device');
  });

  it('hides the Devices link from non-managers and renders host extras', () => {
    auth.isSystemManager = false;
    const html = renderToString(<SettingsScreen extraSections={<span>EXTRA-SECTION</span>} />);
    expect(html).not.toContain('>Devices<');
    expect(html).toContain('EXTRA-SECTION');
  });

  it('uses a host-supplied Screen/Card instead of the defaults', () => {
    setup({
      ui: {
        Screen: ({ title, children }) => <main data-host-screen>{`HOST:${title}`}{children}</main>,
      },
    });
    const html = renderToString(<SettingsScreen />);
    expect(html).toContain('HOST:Settings');
  });
});

describe('crash report row', () => {
  it('can be hidden, or switched off with the whole monitor', () => {
    setup({ monitor: { showToggle: false } });
    expect(renderToString(<SettingsScreen />)).not.toContain('Send crash reports');
    setup({ monitor: { enabled: false } });
    expect(renderToString(<SettingsScreen />)).not.toContain('Send crash reports');
  });
  it('offers the test button only when asked', () => {
    setup({ monitor: { showTestActions: true } });
    expect(renderToString(<SettingsScreen />)).toContain('Send test error');
    setup({ monitor: { showTestActions: false } });
    expect(renderToString(<SettingsScreen />)).not.toContain('Send test error');
  });
});

describe('what this build lacks (item: say what needs a native rebuild)', () => {
  it('lists each missing optional module honestly, with the fix', () => {
    const html = renderToString(<SettingsScreen />);
    expect(html).toContain('Not available in this build');
    expect(html).toContain('Battery info unavailable: rebuild required');
    expect(html).toContain('expo-battery');
    // a package that is not in the app at all gets the exact command, not "rebuild"
    expect(html).toContain('Device model and memory unavailable: not installed, run npx upande-mobile-kit fix');
    expect(html).not.toContain('Device model and memory unavailable: rebuild required');
    expect(html).toContain('Biometric unavailable: rebuild required');
    expect(html).toContain('new native build');
    expect(html).toContain('&quot;not installed&quot;: run npx upande-mobile-kit fix');
    expect(html).toContain('&quot;rebuild required&quot;: the package is installed');
  });
  it('is quiet when every module is present', () => {
    nativeFlags.all = true;
    expect(renderToString(<SettingsScreen />)).not.toContain('Not available in this build');
  });
});

describe('biometric ownership', () => {
  it('the kit owns the lock by default and shows its switch', () => {
    expect(renderToString(<SettingsScreen />)).toContain('Biometric unlock');
  });
  it("biometric: 'host' hides the kit's switch and stops listing biometric as missing", () => {
    setup({ biometric: 'host' });
    const html = renderToString(<SettingsScreen />);
    expect(html).not.toContain('Biometric unlock');
    expect(html).not.toContain('>Security<');
    expect(html).not.toContain('Biometric unavailable');
  });
});

describe('unwired useAuth / api / storage (dev notice)', () => {
  let warn: jest.SpyInstance;
  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => warn.mockRestore());

  it('shows nothing when the host wired everything', () => {
    expect(renderToString(<SettingsScreen />)).not.toContain('Dev notice');
  });
  it('lists the stand-ins in use, in development only', () => {
    setup({ useAuth: undefined, api: undefined, storage: undefined, site: 'https://s.example.com' });
    const html = renderToString(<SettingsScreen />);
    expect(html).toContain('Dev notice');
    expect(html).toContain('useAuth not configured');
    expect(html).toContain('device register and sign-out are not connected to your session');
    expect(html).toContain('api not configured');
    expect(html).toContain('storage not configured');
    const g = globalThis as { __DEV__?: boolean };
    const was = g.__DEV__;
    g.__DEV__ = false;
    try {
      expect(renderToString(<SettingsScreen />)).not.toContain('Dev notice');
    } finally {
      g.__DEV__ = was;
    }
  });
});

describe('DevicesScreen (server render)', () => {
  it('redirects a non-manager back to Settings', () => {
    auth.isSystemManager = false;
    expect(renderToString(<DevicesScreen />)).toContain('REDIRECT:/mobile-kit/settings');
  });

  it('renders for a System Manager (data loads after mount)', () => {
    apiMock.mockResolvedValue({ message: { rows: [], total: 0, by_status: {}, server_time: '' } });
    const html = renderToString(<DevicesScreen />);
    expect(html).toContain('Devices');
  });
});
