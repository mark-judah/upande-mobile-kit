import { useEffect } from 'react';
import { getConfig } from '../config';
import { openSupportChat } from '../support/controller';
import { isPushSupported, notificationsModule, pushEnabled, supportTap, syncPush } from './index';

/**
 * Mounted by `MobileKitProvider`. Keeps this phone's push token registered for whoever is signed in (after the person
 * opted in), re-registers when Expo rotates the token, and opens the conversation when a support notification is
 * tapped, including the tap that launched the app. It never changes how the app's own notifications are shown.
 */
export function PushBridge() {
  const { user } = getConfig().useAuth();

  useEffect(() => {
    if (user) void syncPush();
  }, [user]);

  useEffect(() => {
    if (!isPushSupported()) return undefined;
    const n = notificationsModule();
    if (!n) return undefined;
    const open = (data: unknown) => {
      const tap = supportTap(data);
      if (tap) openSupportChat(tap.issue ?? tap.thread);
    };
    const subs: { remove: () => void }[] = [];
    try {
      subs.push(n.addNotificationResponseReceivedListener((r: { notification: { request: { content: { data: unknown } } } }) => open(r.notification.request.content.data)));
      subs.push(
        n.addPushTokenListener(() => {
          void pushEnabled().then((on) => {
            if (on) void syncPush();
          });
        }),
      );
      // The tap that launched the app.
      void Promise.resolve(n.getLastNotificationResponseAsync?.()).then((r: { notification: { request: { content: { data: unknown } } } } | null | undefined) => {
        if (r) open(r.notification.request.content.data);
      });
    } catch {
      /* a listener could not be added: notifications still arrive, only the tap-to-open is lost */
    }
    return () => subs.forEach((s) => s.remove());
  }, []);

  return null;
}
