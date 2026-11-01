import { renderToString } from 'react-dom/server';
import { apiMock, auth, setup } from '../helpers';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn() },
  Redirect: ({ href }: { href: string }) => `REDIRECT:${href}`,
  usePathname: () => '/settings',
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
jest.mock('expo', () => ({ requireOptionalNativeModule: () => null }));

import { SettingsScreen } from '../../src/screens/SettingsScreen';
import { DevicesScreen } from '../../src/screens/DevicesScreen';
import { MobileKitProvider } from '../../src/MobileKitProvider';

beforeEach(() => {
  setup();
  auth.isSystemManager = true;
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

describe('DevicesScreen (server render)', () => {
  it('redirects a non-manager back to Settings', () => {
    auth.isSystemManager = false;
    expect(renderToString(<DevicesScreen />)).toContain('REDIRECT:/settings');
  });

  it('renders for a System Manager (data loads after mount)', () => {
    apiMock.mockResolvedValue({ message: { rows: [], total: 0, by_status: {}, server_time: '' } });
    const html = renderToString(<DevicesScreen />);
    expect(html).toContain('Devices');
  });
});
