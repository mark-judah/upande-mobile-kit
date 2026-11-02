/**
 * The floating Settings button: rendered by MobileKitProvider, hidden where it should be, remembers its spot.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { KitKeys } from '../../src/config';
import { auth, setup, store } from '../helpers';

const mockPath = { current: '/' };
const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: (...a: unknown[]) => mockPush(...a), replace: jest.fn() },
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
jest.mock('@expo/vector-icons', () => ({ Ionicons: ({ name }: { name: string }) => `ICON:${name}` }));
jest.mock('../../src/devices/install-register', () => ({
  reportInstall: jest.fn(),
  getInstallId: async () => 'install-1',
  getRegisteredRowId: async () => null,
  waitForLaunchRegistration: async () => {},
}));

import { MobileKitProvider } from '../../src/MobileKitProvider';
import { KitSettingsButton } from '../../src/ui/KitFab';
import { openKitSettings } from '../../src/open-settings';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const LABEL = 'aria-label="Open settings"';
const render = () => renderToString(<MobileKitProvider><span>HOST-APP</span></MobileKitProvider>);

beforeEach(() => {
  mockPath.current = '/';
  mockPush.mockReset();
  auth.user = 'person@example.com' as never; // signed in (server rendering runs no effects, so nothing is reported)
});

describe('before sign-in', () => {
  it('is hidden on the login screen when the app wires its own useAuth (its gate would bounce the page)', () => {
    setup();
    auth.user = null as never;
    mockPath.current = '/login';
    expect(render()).not.toContain(LABEL);
  });

  it('shows with whenSignedOut: true', () => {
    setup({ fab: { whenSignedOut: true } });
    auth.user = null as never;
    mockPath.current = '/login';
    expect(render()).toContain(LABEL);
  });

  it('always shows on the kit’s stand-in auth, which cannot tell', () => {
    setup({ useAuth: undefined });
    mockPath.current = '/login';
    expect(render()).toContain(LABEL);
  });
});

describe('visibility', () => {
  it('floats over any host screen by default, next to the host app', () => {
    setup();
    const html = render();
    expect(html).toContain('HOST-APP');
    expect(html).toContain(LABEL);
    expect(html).toContain('ICON:settings-outline');
  });

  it('is not on the kit’s own pages', () => {
    setup();
    for (const path of ['/mobile-kit/settings', '/mobile-kit/devices', '/mobile-kit/anything']) {
      mockPath.current = path;
      expect(render()).not.toContain(LABEL);
    }
  });

  it('is still there on the host’s own /settings page', () => {
    setup();
    mockPath.current = '/settings';
    expect(render()).toContain(LABEL);
  });

  it('follows a custom settings route', () => {
    setup({ settingsRoute: '/admin/kit' });
    mockPath.current = '/admin/kit';
    expect(render()).not.toContain(LABEL);
    mockPath.current = '/orders';
    expect(render()).toContain(LABEL);
    mockPath.current = '/mobile-kit/settings'; // the kit's own folder stays kit territory
    expect(render()).not.toContain(LABEL);
  });

  it('fab: false removes it; fab: "dev" and an object keep it (this is a dev build)', () => {
    setup({ fab: false });
    expect(render()).not.toContain(LABEL);
    setup({ fab: 'dev' });
    expect(render()).toContain(LABEL);
    setup({ fab: { initialSide: 'left', bottom: 200 } });
    expect(render()).toContain(LABEL);
  });
});

describe('opening settings', () => {
  it('openKitSettings pushes the settings route (default, then a custom one)', () => {
    setup();
    openKitSettings();
    expect(mockPush).toHaveBeenLastCalledWith('/mobile-kit/settings');
    setup({ settingsRoute: '/admin/kit' });
    openKitSettings();
    expect(mockPush).toHaveBeenLastCalledWith('/admin/kit');
  });

  it('KitSettingsButton renders a labelled button for hosts that bring their own entry', () => {
    setup({ fab: false });
    const html = renderToString(<KitSettingsButton label="App settings" />);
    expect(html).toContain('App settings');
    expect(html).toContain(LABEL);
  });
});

describe('in a live tree', () => {
  let root: Root;
  let host: HTMLElement;
  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it('shows up, and reads the saved position from the kit storage', async () => {
    setup();
    store.set(KitKeys.fabPosition, JSON.stringify({ side: 'left', bottom: 180 }));
    const get = jest.fn(async (k: string) => store.get(k) ?? null);
    setup({ storage: { get, set: async (k, v) => void store.set(k, v), remove: async (k) => void store.delete(k) } });
    await act(async () => {
      root.render(<MobileKitProvider><span>HOST-APP</span></MobileKitProvider>);
    });
    expect(host.querySelector('[aria-label="Open settings"]')).not.toBeNull();
    expect(get).toHaveBeenCalledWith(KitKeys.fabPosition);
  });

  it('survives a storage that fails', async () => {
    setup({ storage: { get: async () => { throw new Error('no storage'); }, set: async () => { throw new Error('no storage'); }, remove: async () => {} } });
    await act(async () => {
      root.render(<MobileKitProvider><span>HOST-APP</span></MobileKitProvider>);
    });
    expect(host.textContent).toContain('HOST-APP');
    expect(host.querySelector('[aria-label="Open settings"]')).not.toBeNull();
  });

  const press = (el: EventTarget, type: string, x: number, y: number) =>
    act(() => {
      el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }));
    });

  it('a tap opens the Settings page', async () => {
    setup();
    await act(async () => {
      root.render(<MobileKitProvider><span>HOST-APP</span></MobileKitProvider>);
    });
    const fab = host.querySelector('[aria-label="Open settings"]')!;
    await press(fab, 'mousedown', 300, 500);
    await press(document, 'mouseup', 300, 500);
    expect(mockPush).toHaveBeenCalledWith('/mobile-kit/settings');
  });

  it('a drag does not open it, and the new spot is saved', async () => {
    setup();
    await act(async () => {
      root.render(<MobileKitProvider><span>HOST-APP</span></MobileKitProvider>);
    });
    const fab = host.querySelector('[aria-label="Open settings"]')!;
    await press(fab, 'mousedown', 300, 500);
    await press(document, 'mousemove', 80, 420);
    await press(document, 'mouseup', 80, 420);
    expect(mockPush).not.toHaveBeenCalled();
    await act(async () => {});
    const saved = JSON.parse(store.get(KitKeys.fabPosition) ?? 'null');
    expect(saved).toMatchObject({ side: expect.stringMatching(/left|right/) });
  });

  it('is removed when the person navigates onto a kit page', async () => {
    setup();
    await act(async () => {
      root.render(<MobileKitProvider><span>HOST-APP</span></MobileKitProvider>);
    });
    expect(host.querySelector('[aria-label="Open settings"]')).not.toBeNull();
    mockPath.current = '/mobile-kit/settings';
    await act(async () => {
      root.render(<MobileKitProvider><span>HOST-APP</span></MobileKitProvider>);
    });
    expect(host.querySelector('[aria-label="Open settings"]')).toBeNull();
  });
});
