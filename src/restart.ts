import { DevSettings } from 'react-native';
import * as Updates from 'expo-updates';
import { getConfig, instanceKeyOf, KitKeys } from './config';

/**
 * Start the JavaScript over after the live instance changed. Every screen's
 * store, every in-memory cache, open database and in-flight request belonged
 * to the previous instance; a fresh start drops them all at once instead of
 * relying on each one being reset by hand.
 *
 * `signedInTo`: the server a sign-in just landed on. The next start is then
 * already signed in there, so it skips the biometric lock once — on that
 * server only. Omitted (a change that signs out), the lock is never skipped.
 *
 * Returns false when the app could not be restarted (the caller then carries
 * on in place); the skip-lock flag never outlives a failed restart.
 */
export async function restartForInstance(signedInTo?: string | null): Promise<boolean> {
  const { storage } = getConfig();
  const key = signedInTo ? instanceKeyOf(signedInTo) : '';
  if (key) await storage.set(KitKeys.instanceSwitched, key).catch(() => {});
  try {
    await Updates.reloadAsync();
    return true;
  } catch {
    // Development builds: expo-updates refuses, the dev menu's reload works.
  }
  if (__DEV__) {
    try {
      DevSettings.reload();
      return true;
    } catch {
      // fall through
    }
  }
  await storage.remove(KitKeys.instanceSwitched).catch(() => {});
  return false;
}

/** On the start that follows a switched sign-in: true once, and only when the
 *  app is on the server that sign-in was to. The flag is read and dropped. */
export async function consumeInstanceSwitched(currentUrl: string | null): Promise<boolean> {
  const { storage } = getConfig();
  const flag = await storage.get(KitKeys.instanceSwitched).catch(() => null);
  if (flag) await storage.remove(KitKeys.instanceSwitched).catch(() => {});
  return !!flag && !!currentUrl && flag === instanceKeyOf(currentUrl);
}
