/**
 * Push registration for support replies, free of React and native modules so it can be tested. The real
 * `expo-notifications` module and the server call are passed in.
 */

export type PushStatus = 'ok' | 'no-native-module' | 'permission-denied' | 'no-project-id' | 'no-token' | 'error';

export type NotificationsLike = {
  getPermissionsAsync: () => Promise<{ granted: boolean }>;
  requestPermissionsAsync: () => Promise<{ granted: boolean }>;
  getExpoPushTokenAsync: (o: { projectId: string }) => Promise<{ data?: string }>;
  setNotificationChannelAsync?: (id: string, o: Record<string, unknown>) => Promise<unknown>;
  AndroidImportance?: { HIGH?: number; MAX?: number };
};

export type PushDeps = {
  module: NotificationsLike | null;
  projectId: string | undefined;
  platform: string;
  channelName: string;
  /** Tell the server about this token. */
  register: (token: string) => Promise<void>;
};

export const SUPPORT_CHANNEL_ID = 'support';

/**
 * Asks for permission when `ask` is true (never when false, so a launch-time sync cannot pop a dialog), gets the Expo
 * push token and registers it. Never throws.
 */
export async function registerForPush(deps: PushDeps, opts: { ask: boolean }): Promise<{ status: PushStatus; token?: string }> {
  const n = deps.module;
  if (!n) return { status: 'no-native-module' };
  try {
    if (deps.platform === 'android' && n.setNotificationChannelAsync) {
      await n.setNotificationChannelAsync(SUPPORT_CHANNEL_ID, {
        name: deps.channelName,
        importance: n.AndroidImportance?.HIGH ?? 4,
        sound: 'default',
      });
    }
    let granted = (await n.getPermissionsAsync()).granted;
    if (!granted && opts.ask) granted = (await n.requestPermissionsAsync()).granted;
    if (!granted) return { status: 'permission-denied' };
    if (!deps.projectId) return { status: 'no-project-id' };
    const token = (await n.getExpoPushTokenAsync({ projectId: deps.projectId })).data;
    if (!token) return { status: 'no-token' };
    await deps.register(token);
    return { status: 'ok', token };
  } catch {
    return { status: 'error' };
  }
}

/** What a tapped notification asks the app to open, or null when it is not a support notification. */
export function supportTap(data: unknown): { issue?: string; thread?: string } | null {
  const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  if (d.upande_mobile !== 'support') return null;
  return {
    ...(typeof d.issue === 'string' && d.issue ? { issue: d.issue } : {}),
    ...(typeof d.thread === 'string' && d.thread ? { thread: d.thread } : {}),
  };
}

/** The message the Settings switch shows when enabling did not work. */
export function pushStatusMessage(status: PushStatus): string {
  switch (status) {
    case 'ok':
      return 'You will get a notification when support replies.';
    case 'permission-denied':
      return "Notifications are blocked for this app. Turn them on in your phone's settings, then try again.";
    case 'no-project-id':
      return 'This app is missing its Expo project id (extra.eas.projectId), so it cannot receive notifications.';
    case 'no-native-module':
      return 'This version of the app cannot receive notifications. Install the latest build.';
    default:
      return "Couldn't turn notifications on. Try again in a moment.";
  }
}
