/**
 * Effects need a real render: these mount the provider in jsdom (react-dom/client + act).
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AppState } from 'react-native';
import { auth, setup } from '../helpers';

const mockPath = { current: '/' };
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn() },
  Redirect: () => null,
  usePathname: () => mockPath.current,
}));
jest.mock('expo-updates', () => ({
  manifest: null, runtimeVersion: '101.2', isEmbeddedLaunch: false, updateId: 'abcdef12', channel: 'production', createdAt: new Date(), isEnabled: false,
  useUpdates: () => ({ isUpdatePending: false }), checkForUpdateAsync: jest.fn(), fetchUpdateAsync: jest.fn(), reloadAsync: jest.fn(),
}));
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { version: '1.2.3', runtimeVersion: '101.2' }, nativeAppVersion: '1.2.0', nativeBuildVersion: '12' },
}));
jest.mock('expo-file-system/legacy', () => ({ documentDirectory: 'file:///f/', getInfoAsync: jest.fn() }));
jest.mock('expo', () => ({ requireOptionalNativeModule: () => null }));
// Icons load a font through expo-asset on mount, which only works on a device; not what is under test.
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
const mockReport = jest.fn();
jest.mock('../../src/devices/install-register', () => ({
  reportInstall: (...a: unknown[]) => mockReport(...a),
  getInstallId: async () => 'install-1',
  getRegisteredRowId: async () => null,
  waitForLaunchRegistration: async () => {},
}));

import { MobileKitProvider } from '../../src/MobileKitProvider';
import { SettingsScreen } from '../../src/screens/SettingsScreen';
import { ROUTE_CHECK_DELAY_MS, resetRouteGuard } from '../../src/route-guard';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLElement;
let warn: jest.SpyInstance;
let appStateHandler: ((s: string) => void) | undefined;

beforeEach(() => {
  jest.useFakeTimers().setSystemTime(10_000_000);
  resetRouteGuard();
  mockReport.mockReset();
  mockPath.current = '/';
  auth.user = 'test@example.com';
  warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  appStateHandler = undefined;
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((_: string, h: (s: string) => void) => {
    appStateHandler = h;
    return { remove: () => {} };
  }) as never);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  warn.mockRestore();
  jest.restoreAllMocks();
  jest.useRealTimers();
});

const mount = (ui: React.ReactElement) => act(() => root.render(ui));
/** Lets the screens' on-mount promises settle inside act (so no 'not wrapped in act' noise). */
const settle = () => act(async () => { await Promise.resolve(); });
const advance = (ms: number) => act(() => void jest.advanceTimersByTime(ms));
const collisionWarnings = () => warn.mock.calls.filter((c) => String(c[0]).includes('is being rendered by another screen'));

describe('route collision warning (dev)', () => {
  it('warns when /mobile-kit/settings is current but another screen renders there', () => {
    setup();
    mockPath.current = '/mobile-kit/settings';
    mount(<MobileKitProvider><div>the app's own settings screen</div></MobileKitProvider>);
    advance(ROUTE_CHECK_DELAY_MS + 100);
    expect(collisionWarnings()).toHaveLength(1);
    expect(String(collisionWarnings()[0][0])).toContain('"/mobile-kit/settings"');
  });

  it("stays quiet when the kit's own Settings screen is what renders", async () => {
    setup();
    mockPath.current = '/mobile-kit/settings';
    mount(<MobileKitProvider><SettingsScreen /></MobileKitProvider>);
    await settle();
    advance(ROUTE_CHECK_DELAY_MS + 100);
    expect(collisionWarnings()).toHaveLength(0);
  });

  it('follows a custom settingsRoute (rarely needed)', () => {
    setup({ settingsRoute: '/kit-settings' });
    mockPath.current = '/kit-settings';
    mount(<MobileKitProvider><div>something else</div></MobileKitProvider>);
    advance(ROUTE_CHECK_DELAY_MS + 100);
    expect(String(collisionWarnings()[0][0])).toContain('"/kit-settings"');
  });

  it('does nothing in a release build', () => {
    const g = globalThis as { __DEV__?: boolean };
    const was = g.__DEV__;
    g.__DEV__ = false;
    try {
      setup();
      mockPath.current = '/mobile-kit/settings';
      mount(<MobileKitProvider><div>x</div></MobileKitProvider>);
      advance(ROUTE_CHECK_DELAY_MS + 100);
      expect(collisionWarnings()).toHaveLength(0);
    } finally {
      g.__DEV__ = was;
    }
  });
});

describe('foreground report debounce', () => {
  const foreground = () => mockReport.mock.calls.filter((c) => c[0]?.reason === 'foreground');

  it('lets one through per 30 s however many "active" events fire', () => {
    setup();
    mount(<MobileKitProvider><div /></MobileKitProvider>);
    expect(appStateHandler).toBeDefined();
    expect(mockReport.mock.calls.some((c) => c[0]?.reason === 'launch')).toBe(true);
    act(() => appStateHandler!('active'));
    for (let i = 0; i < 4; i += 1) {
      advance(3000);
      act(() => appStateHandler!('active')); // a lock screen / permission prompt bouncing
    }
    expect(foreground()).toHaveLength(1);
    advance(30_000);
    act(() => appStateHandler!('active'));
    expect(foreground()).toHaveLength(2);
  });

  it('ignores non-active states and honours foregroundReportMinMs', () => {
    setup({ foregroundReportMinMs: 1000 });
    mount(<MobileKitProvider><div /></MobileKitProvider>);
    act(() => appStateHandler!('background'));
    act(() => appStateHandler!('inactive'));
    expect(foreground()).toHaveLength(0);
    act(() => appStateHandler!('active'));
    advance(1500);
    act(() => appStateHandler!('active'));
    expect(foreground()).toHaveLength(2);
  });
});
