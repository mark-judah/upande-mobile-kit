import { pushStatusMessage, registerForPush, supportTap, SUPPORT_CHANNEL_ID, type NotificationsLike } from '../src/push/push-core';

const TOKEN = 'ExponentPushToken[abcDEF123_-xyz]';

function fakeModule(over: Partial<NotificationsLike> = {}): NotificationsLike & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    getPermissionsAsync: async () => ({ granted: false }),
    requestPermissionsAsync: async () => {
      calls.push('request');
      return { granted: true };
    },
    getExpoPushTokenAsync: async () => ({ data: TOKEN }),
    setNotificationChannelAsync: async (id: string) => void calls.push(`channel:${id}`),
    AndroidImportance: { HIGH: 4 },
    ...over,
  };
}
const deps = (module: NotificationsLike | null, over = {}) => ({ module, projectId: 'proj-1', platform: 'android', channelName: 'Support replies', register: jest.fn(async () => {}), ...over });

describe('registering for push', () => {
  it('creates the Android channel, asks permission, gets the token and registers it', async () => {
    const m = fakeModule();
    const d = deps(m);
    const r = await registerForPush(d, { ask: true });
    expect(r).toEqual({ status: 'ok', token: TOKEN });
    expect(m.calls).toEqual([`channel:${SUPPORT_CHANNEL_ID}`, 'request']);
    expect(d.register).toHaveBeenCalledWith(TOKEN);
  });

  it('never prompts when asked not to (a launch-time sync): without permission it stays quiet', async () => {
    const m = fakeModule();
    const d = deps(m);
    expect((await registerForPush(d, { ask: false })).status).toBe('permission-denied');
    expect(m.calls).not.toContain('request');
    expect(d.register).not.toHaveBeenCalled();
  });

  it('reports why it could not: blocked, no project id, no native module, no token, an error', async () => {
    expect((await registerForPush(deps(fakeModule({ requestPermissionsAsync: async () => ({ granted: false }) })), { ask: true })).status).toBe('permission-denied');
    expect((await registerForPush(deps(fakeModule(), { projectId: undefined }), { ask: true })).status).toBe('no-project-id');
    expect((await registerForPush(deps(null), { ask: true })).status).toBe('no-native-module');
    expect((await registerForPush(deps(fakeModule({ getExpoPushTokenAsync: async () => ({}) })), { ask: true })).status).toBe('no-token');
    expect((await registerForPush(deps(fakeModule({ getExpoPushTokenAsync: async () => { throw new Error('fcm'); } })), { ask: true })).status).toBe('error');
    expect((await registerForPush(deps(fakeModule(), { register: async () => { throw new Error('server'); } }), { ask: true })).status).toBe('error');
  });

  it('skips the channel on iOS', async () => {
    const m = fakeModule({ getPermissionsAsync: async () => ({ granted: true }) });
    await registerForPush(deps(m, { platform: 'ios' }), { ask: true });
    expect(m.calls).toEqual([]);
  });

  it('has a plain-language message for every outcome', () => {
    for (const s of ['ok', 'permission-denied', 'no-project-id', 'no-native-module', 'no-token', 'error'] as const) expect(pushStatusMessage(s).length).toBeGreaterThan(10);
    expect(pushStatusMessage('permission-denied')).toMatch(/settings/i);
  });
});

describe('tapping a notification', () => {
  it('only support notifications are ours, and they name the conversation', () => {
    expect(supportTap({ upande_mobile: 'support', issue: 'ISS-1' })).toEqual({ issue: 'ISS-1' });
    expect(supportTap({ upande_mobile: 'support', thread: 'abc' })).toEqual({ thread: 'abc' });
    expect(supportTap({ upande_mobile: 'support' })).toEqual({});
    expect(supportTap({ issue: 'ISS-1' })).toBeNull(); // the host app's own notification
    expect(supportTap(null)).toBeNull();
    expect(supportTap('x')).toBeNull();
  });
});

describe('the kit’s push wiring', () => {
  const mod = fakeModule({ getPermissionsAsync: async () => ({ granted: true }) });
  beforeEach(() => {
    jest.resetModules();
    jest.doMock('../src/native-probe', () => ({ hasNativeModule: () => true }));
    jest.doMock('expo-notifications', () => mod, { virtual: true });
    jest.doMock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { extra: { eas: { projectId: 'proj-1' } } } } }));
    jest.doMock('../src/devices/install-register', () => ({ getInstallId: async () => 'install-1' }));
  });

  const load = () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const cfg = require('./helpers') as typeof import('./helpers');
    cfg.setup();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return { push: require('../src/push') as typeof import('../src/push'), helpers: cfg, keys: (require('../src/config') as typeof import('../src/config')).KitKeys };
  };

  it('turning it on registers the token with the server and remembers the choice', async () => {
    const { push, helpers, keys } = load();
    expect(push.isPushSupported()).toBe(true);
    expect(await push.enableReplyNotifications()).toBe('ok');
    const call = helpers.apiMock.mock.calls.find((c) => String(c[0].url).includes('register_push'))![0];
    expect(call).toMatchObject({ method: 'POST', data: { app: 'Test App', token: TOKEN, install_id: 'install-1' } });
    expect(helpers.store.get(keys.pushEnabled)).toBe('1');
    expect(helpers.store.get(keys.pushToken)).toBe(TOKEN);
  });

  it('turning it off tells the server and forgets the choice', async () => {
    const { push, helpers, keys } = load();
    await push.enableReplyNotifications();
    await push.disableReplyNotifications();
    expect(helpers.apiMock.mock.calls.some((c) => String(c[0].url).includes('unregister_push') && c[0].data.token === TOKEN)).toBe(true);
    expect(helpers.store.get(keys.pushEnabled)).toBe('0');
    expect(helpers.store.has(keys.pushToken)).toBe(false);
  });

  it('a sync at launch only re-registers for a person who opted in', async () => {
    const { push, helpers, keys } = load();
    expect(await push.syncPush()).toBe('off');
    expect(helpers.apiMock).not.toHaveBeenCalled();
    helpers.store.set(keys.pushEnabled, '1');
    expect(await push.syncPush()).toBe('ok');
    expect(helpers.apiMock.mock.calls.some((c) => String(c[0].url).includes('register_push'))).toBe(true);
  });

  it('signing out forgets the token on the server but keeps the person’s choice for the next sign-in', async () => {
    const { push, helpers, keys } = load();
    await push.enableReplyNotifications();
    await push.unregisterToken();
    expect(helpers.apiMock.mock.calls.some((c) => String(c[0].url).includes('unregister_push'))).toBe(true);
    expect(helpers.store.get(keys.pushEnabled)).toBe('1');
  });

  it('offers notifications once, only to someone who has not opted in', async () => {
    const { push, helpers } = load();
    const dialog = jest.fn();
    await push.offerReplyNotifications(dialog);
    expect(dialog).toHaveBeenCalledTimes(1);
    expect(dialog.mock.calls[0][2].map((b: { text: string }) => b.text)).toEqual(['Not now', 'Turn on']);
    await push.offerReplyNotifications(dialog);
    expect(dialog).toHaveBeenCalledTimes(1); // already offered
    helpers.store.clear();
  });

  it('`push: false` switches the whole thing off', async () => {
    const { push, helpers } = load();
    helpers.setup({ push: false });
    expect(push.isPushSupported()).toBe(false);
    expect(await push.enableReplyNotifications()).toBe('no-native-module');
  });
});

