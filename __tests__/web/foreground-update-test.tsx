import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AppState } from 'react-native';
import { setup } from '../helpers';

const mockCheck = jest.fn(async () => ({ isAvailable: true }));
const mockFetch = jest.fn(async () => ({ isNew: true }));
jest.mock('expo-updates', () => ({
  manifest: null, runtimeVersion: '1.2', isEmbeddedLaunch: false, updateId: 'abc', channel: 'production', createdAt: new Date(), isEnabled: true,
  useUpdates: () => ({ isUpdatePending: false, isDownloading: false }),
  checkForUpdateAsync: () => mockCheck(), fetchUpdateAsync: () => mockFetch(), reloadAsync: jest.fn(),
}));
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { version: '1.2.3', runtimeVersion: '1.2' }, nativeAppVersion: '1.2.0', nativeBuildVersion: '12' } }));
jest.mock('expo-file-system/legacy', () => ({ documentDirectory: 'file:///f/', getInfoAsync: jest.fn() }));
jest.mock('expo', () => ({ requireOptionalNativeModule: () => null }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

import { UpdateProvider } from '../../src/updates/UpdateProvider';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const handlers: ((s: string) => void)[] = [];
const fire = (s: string) => handlers.forEach((h) => h(s));
const showDialog = jest.fn();
let root: Root;
let host: HTMLElement;
const realDev = (globalThis as { __DEV__?: boolean }).__DEV__;

beforeEach(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
  jest.useFakeTimers().setSystemTime(10_000_000);
  handlers.length = 0;
  showDialog.mockReset();
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((_: string, h: (s: string) => void) => {
    handlers.push(h);
    return { remove: () => {} };
  }) as never);
  // GitHub is not reachable in tests: the APK check just finds nothing.
  (globalThis as { fetch?: unknown }).fetch = jest.fn(async () => { throw new Error('offline'); });
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  jest.restoreAllMocks();
  jest.useRealTimers();
  (globalThis as { __DEV__?: boolean }).__DEV__ = realDev;
});

async function mount(config: Parameters<typeof setup>[0] = {}) {
  setup({ ui: { showDialog } as never, ...config });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(<UpdateProvider>{null}</UpdateProvider>);
  });
  mockCheck.mockClear();
  mockFetch.mockClear();
  showDialog.mockClear();
}

const settle = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

describe('looking for updates when the app comes back', () => {
  it('downloads a new bundle found on return and ASKS before restarting', async () => {
    await mount();
    act(() => fire('active'));
    await settle();
    expect(mockCheck).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(showDialog).toHaveBeenCalledTimes(1);
    expect(showDialog.mock.calls[0][0]).toBe('Update ready');
    expect(showDialog.mock.calls[0][2].map((b: { text: string }) => b.text)).toEqual(['Later', 'Restart now']);
  });

  it('offers the same downloaded bundle only once, however often the app returns', async () => {
    mockFetch.mockResolvedValue({ isNew: true, manifest: { id: 'bundle-1' } } as never);
    await mount();
    act(() => fire('active'));
    await settle();
    expect(mockCheck).toHaveBeenCalledTimes(1);
    jest.setSystemTime(10_000_000 + 11 * 60_000);
    act(() => fire('active'));
    await settle();
    // It looks again (a newer bundle may exist), but the same one is not offered twice.
    expect(showDialog).toHaveBeenCalledTimes(1);
  });

  it('offers a NEWER bundle that is published later the same day', async () => {
    mockFetch.mockResolvedValue({ isNew: true, manifest: { id: 'bundle-1' } } as never);
    await mount();
    act(() => fire('active'));
    await settle();
    mockFetch.mockResolvedValue({ isNew: true, manifest: { id: 'bundle-2' } } as never);
    jest.setSystemTime(10_000_000 + 11 * 60_000);
    act(() => fire('active'));
    await settle();
    expect(showDialog).toHaveBeenCalledTimes(2);
  });

  it('does nothing on background, when nothing is new, or when the app turned it off', async () => {
    await mount();
    act(() => fire('background'));
    await settle();
    expect(mockCheck).not.toHaveBeenCalled();
    mockCheck.mockResolvedValueOnce({ isAvailable: false });
    act(() => fire('active'));
    await settle();
    expect(mockFetch).not.toHaveBeenCalled();
    expect(showDialog).not.toHaveBeenCalled();
  });

  it('otaOnForeground: false leaves foreground returns alone', async () => {
    act(() => root?.unmount?.());
    await mount({ otaOnForeground: false });
    act(() => fire('active'));
    await settle();
    expect(mockCheck).not.toHaveBeenCalled();
  });
});
