import { KitKeys } from '../src/config';
import { setup, store } from './helpers';

const mockReload = jest.fn();
jest.mock('expo-updates', () => ({ reloadAsync: () => mockReload() }));

import { consumeInstanceSwitched, restartForInstance } from '../src/restart';

beforeEach(() => {
  setup();
  mockReload.mockReset().mockResolvedValue(undefined);
});

describe('restartForInstance', () => {
  it('flags the server a sign-in landed on, then reloads', async () => {
    expect(await restartForInstance('https://Site-One.example.com/')).toBe(true);
    expect(store.get(KitKeys.instanceSwitched)).toBe('site-one.example.com');
    expect(mockReload).toHaveBeenCalled();
  });
  it('sets no flag when the change signs out', async () => {
    await restartForInstance(null);
    expect(store.has(KitKeys.instanceSwitched)).toBe(false);
  });
  it('drops the flag when the restart fails, so the lock is never skipped by accident', async () => {
    mockReload.mockRejectedValue(new Error('no'));
    // Production: no dev-menu reload to fall back on.
    const g = globalThis as unknown as { __DEV__: boolean };
    const dev = g.__DEV__;
    g.__DEV__ = false;
    try {
      expect(await restartForInstance('https://site-one.example.com')).toBe(false);
    } finally {
      g.__DEV__ = dev;
    }
    expect(store.has(KitKeys.instanceSwitched)).toBe(false);
  });
});

describe('consumeInstanceSwitched', () => {
  it('is true once, and only on the server the sign-in was to', async () => {
    store.set(KitKeys.instanceSwitched, 'site-one.example.com');
    expect(await consumeInstanceSwitched('https://site-one.example.com')).toBe(true);
    expect(await consumeInstanceSwitched('https://site-one.example.com')).toBe(false);
  });
  it('is false on another server, and still drops the flag', async () => {
    store.set(KitKeys.instanceSwitched, 'site-one.example.com');
    expect(await consumeInstanceSwitched('https://two.example.com')).toBe(false);
    expect(store.has(KitKeys.instanceSwitched)).toBe(false);
  });
});
