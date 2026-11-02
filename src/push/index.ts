import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { getConfig, KitKeys } from '../config';
import { getInstallId } from '../devices/install-register';
import { hasNativeModule } from '../native-probe';
import { registerForPush, type NotificationsLike, type PushDeps, type PushStatus } from './push-core';

export { pushStatusMessage, supportTap } from './push-core';
export type { PushStatus } from './push-core';

/**
 * `require` directly inside `try`: the only shape Metro accepts for a package the app may not have installed
 * (anywhere else a missing package fails the whole bundle).
 */
function loadNotifications(): NotificationsLike | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- optional package
    return require('expo-notifications') as NotificationsLike;
  } catch {
    return null;
  }
}

let moduleCache: NotificationsLike | null | undefined;
/** `expo-notifications` once its native side is known to exist in this build; null otherwise. */
export function notificationsModule(): (NotificationsLike & Record<string, any>) | null { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (moduleCache === undefined) moduleCache = hasNativeModule('ExpoPushTokenManager') ? loadNotifications() : null;
  return moduleCache as (NotificationsLike & Record<string, any>) | null; // eslint-disable-line @typescript-eslint/no-explicit-any
}

/** Whether the app has switched push off (`push: false`). */
export function pushAllowed(): boolean {
  return getConfig().push !== false;
}

export function isPushSupported(): boolean {
  return pushAllowed() && notificationsModule() !== null;
}

function projectId(): string | undefined {
  const push = getConfig().push;
  if (push && typeof push === 'object' && push.projectId) return push.projectId;
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  const eas = (Constants as unknown as { easConfig?: { projectId?: string } }).easConfig;
  return extra?.eas?.projectId ?? eas?.projectId;
}

async function sendToken(token: string): Promise<void> {
  const { api, appName, endpoints } = getConfig();
  await api({
    method: 'POST',
    url: endpoints.registerPush,
    data: { app: appName, token, install_id: (await getInstallId().catch(() => null)) ?? '', platform: Platform.OS },
  });
}

function deps(): PushDeps {
  return { module: notificationsModule(), projectId: projectId(), platform: Platform.OS, channelName: 'Support replies', register: sendToken };
}

export async function pushEnabled(): Promise<boolean> {
  try {
    return (await getConfig().storage.get(KitKeys.pushEnabled)) === '1';
  } catch {
    return false;
  }
}

/** Turn reply notifications on: asks the phone's permission, then registers the token. The choice is remembered only on success. */
export async function enableReplyNotifications(): Promise<PushStatus> {
  if (!pushAllowed()) return 'no-native-module';
  const { status, token } = await registerForPush(deps(), { ask: true });
  if (status === 'ok' && token) {
    const { storage } = getConfig();
    await storage.set(KitKeys.pushEnabled, '1').catch(() => {});
    await storage.set(KitKeys.pushToken, token).catch(() => {});
  }
  return status;
}

/** Forget this phone's token on the server (best effort). Leaves the person's choice alone, so the next sign-in re-registers. */
export async function unregisterToken(): Promise<void> {
  try {
    const { storage, api, endpoints } = getConfig();
    const token = await storage.get(KitKeys.pushToken);
    // Never hold up a sign-out for a slow network.
    if (token) await Promise.race([api({ method: 'POST', url: endpoints.unregisterPush, data: { token } }), new Promise<void>((r) => setTimeout(r, 3000))]);
  } catch {
    /* the server drops dead tokens itself */
  }
}

/** Turn reply notifications off: forget the token on the server and the choice on the phone. */
export async function disableReplyNotifications(): Promise<void> {
  await unregisterToken();
  const { storage } = getConfig();
  await storage.set(KitKeys.pushEnabled, '0').catch(() => {});
  await storage.remove(KitKeys.pushToken).catch(() => {});
}

/** At launch and after a sign-in: when the person opted in, keep the server's copy of the token current (never prompts). */
export async function syncPush(): Promise<PushStatus | 'off'> {
  if (!isPushSupported() || !(await pushEnabled())) return 'off';
  const { status, token } = await registerForPush(deps(), { ask: false });
  if (status === 'ok' && token) await getConfig().storage.set(KitKeys.pushToken, token).catch(() => {});
  return status;
}

/** After a person's first message: ask once, in words, whether to tell them when support replies. */
export async function offerReplyNotifications(showDialog: (title: string, message: string, buttons: { text: string; style?: 'cancel' | 'default'; onPress?: () => void }[]) => void): Promise<void> {
  if (!isPushSupported() || (await pushEnabled())) return;
  const { storage } = getConfig();
  if (await storage.get(KitKeys.pushOffered).catch(() => null)) return;
  await storage.set(KitKeys.pushOffered, '1').catch(() => {});
  showDialog('Get notified?', 'We can send you a notification when support replies.', [
    { text: 'Not now', style: 'cancel' },
    { text: 'Turn on', onPress: () => void enableReplyNotifications() },
  ]);
}
