import { useCallback, useEffect, useState } from 'react';
import { Alert } from 'react-native';
import { getConfig, KitKeys } from '../config';
import { hasNativeModule } from '../native-probe';
import * as Biometric from '../biometric';
import * as core from './vault-core';

export type { VaultCredentials } from './vault-core';

/** Secure-store key names allow letters, digits, `.`, `-` and `_`. */
const VAULT_ITEM = 'upande_kit.vault.v1';

let secureCache: core.SecureStoreLike | null | undefined;

/**
 * `require` directly inside `try`: the only shape Metro accepts for a package the app may not have installed
 * (anything else fails the whole bundle with "Unable to resolve module").
 */
function loadSecureStore(): core.SecureStoreLike | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- optional package
    const m = require('expo-secure-store');
    return m?.setItemAsync ? (m as core.SecureStoreLike) : null;
  } catch {
    return null;
  }
}

function secureStore(): core.SecureStoreLike | null {
  if (secureCache !== undefined) return secureCache;
  // Only touch the package once its native side is known to exist in this build.
  secureCache = hasNativeModule('ExpoSecureStore') ? loadSecureStore() : null;
  return secureCache;
}

function deps(): core.VaultDeps | null {
  const secure = secureStore();
  if (!secure) return null;
  const { storage } = getConfig();
  return {
    secure,
    marker: storage,
    secretKey: VAULT_ITEM,
    markerKey: KitKeys.vaultMarker,
  };
}

/** Whether this build can keep a sign-in behind the fingerprint (expo-secure-store and expo-local-authentication are in it). */
export function isVaultSupported(): boolean {
  return secureStore() !== null && Biometric.isModuleAvailable();
}

export async function isVaultEnrolled(): Promise<boolean> {
  const d = deps();
  return d ? core.isEnrolled(d) : false;
}

/** Store the sign-in behind the fingerprint (asks the person to confirm with it first). */
export async function enrolVault(c: core.VaultCredentials, prompt?: string): Promise<boolean> {
  const d = deps();
  return d ? core.enrol(d, c, prompt) : false;
}

/** The stored sign-in, after the fingerprint prompt; null when cancelled or none is stored. */
export async function unlockVault(prompt?: string): Promise<core.VaultCredentials | null> {
  const d = deps();
  return d ? core.unlock(d, prompt) : null;
}

export async function clearVault(): Promise<void> {
  const d = deps();
  if (d) await core.clear(d);
}

/**
 * For a login screen: `{ supported, enrolled, signIn, offer }`.
 *
 * - `enrolled` is true when a sign-in is stored; show a "Sign in with fingerprint" button then.
 * - `signIn()` asks for the fingerprint and resolves with the stored `{ server, user, password }` (or null): run
 *   your normal login with it.
 * - `offer(creds)` after a successful password login: asks once per device "Turn on fingerprint sign-in?".
 */
export function useBiometricVault() {
  const [supported] = useState(() => isVaultSupported());
  const [enrolled, setEnrolled] = useState(false);

  useEffect(() => {
    let alive = true;
    isVaultEnrolled().then((v) => alive && setEnrolled(v));
    return () => {
      alive = false;
    };
  }, []);

  const signIn = useCallback(async (prompt = 'Sign in') => unlockVault(prompt), []);

  const offer = useCallback(
    async (creds: core.VaultCredentials, confirm: (ask: () => Promise<boolean>) => Promise<boolean> = defaultConfirm) => {
      if (!supported) return false;
      const { storage } = getConfig();
      if ((await isVaultEnrolled()) || (await storage.get(KitKeys.vaultOffered).catch(() => null))) return false;
      await storage.set(KitKeys.vaultOffered, '1').catch(() => {});
      const yes = await confirm(async () => true);
      if (!yes) return false;
      const ok = await enrolVault(creds);
      setEnrolled(ok);
      return ok;
    },
    [supported],
  );

  return { supported, enrolled, signIn, offer, refresh: async () => setEnrolled(await isVaultEnrolled()) };
}

function defaultConfirm(): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      'Turn on fingerprint sign-in?',
      'Skip typing your password next time. Your sign-in stays on this phone, protected by your fingerprint or face. You can change this in Settings.',
      [
        { text: 'Not now', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Turn on', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}
