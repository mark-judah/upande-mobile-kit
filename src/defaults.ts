import { useCallback, useEffect, useState } from 'react';
import { getConfig, KitKeys, type KitApi, type KitAuth, type KitStorage } from './config';

/**
 * Built-in stand-ins, so an app with no Frappe client, storage or auth store of
 * its own only has to say which site and repo it uses.
 */

/** AsyncStorage when the app has it, otherwise memory (lost on restart). */
export function defaultStorage(): KitStorage {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- optional peer
    const mod = require('@react-native-async-storage/async-storage');
    const as = mod?.default ?? mod;
    if (as && typeof as.getItem === 'function') {
      return {
        get: (k) => as.getItem(k),
        set: (k, v) => as.setItem(k, v),
        remove: (k) => as.removeItem(k),
      };
    }
  } catch {
    // not installed
  }
  const mem = new Map<string, string>();
  return {
    get: async (k) => mem.get(k) ?? null,
    set: async (k, v) => void mem.set(k, v),
    remove: async (k) => void mem.delete(k),
  };
}

/** `fetch` against `site`: resolves to the JSON body, rejects with the server's own message. */
export function createFetchApi(
  site: string | undefined,
  authHeaders?: () => Record<string, string> | Promise<Record<string, string>>,
): KitApi {
  return async <T,>(req: Parameters<KitApi>[0]): Promise<T> => {
    if (!site) throw new Error('configureMobileKit: pass `site` (or your own `api`) so the kit knows which server to call.');
    const query = Object.entries(req.params ?? {})
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join('&');
    const url = `${site.replace(/\/+$/, '')}${req.url}${query ? `?${query}` : ''}`;
    const res = await fetch(url, {
      method: req.method,
      headers: {
        Accept: 'application/json',
        ...(req.data !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...((await authHeaders?.()) ?? {}),
      },
      body: req.data !== undefined ? JSON.stringify(req.data) : undefined,
    });
    if (!res.ok) {
      let message = `The server answered ${res.status}.`;
      try {
        const body = await res.json();
        if (typeof body?.message === 'string' && body.message) message = body.message;
      } catch {
        // not JSON
      }
      throw new Error(message);
    }
    return (await res.json()) as T;
  };
}

/**
 * Auth state for an app that has no sign-in of its own: only the biometric
 * choice is kept (in the kit's storage). With no `user`, the device register
 * stays quiet, because the server only records a signed-in account.
 */
export function createLocalAuth(site: string | undefined): () => KitAuth {
  return function useLocalAuth(): KitAuth {
    const [enabled, setEnabled] = useState(false);
    useEffect(() => {
      getConfig()
        .storage.get(KitKeys.localBiometric)
        .then((v) => setEnabled(v === '1'))
        .catch(() => {});
    }, []);
    const set = useCallback(async (next: boolean) => {
      await getConfig().storage.set(KitKeys.localBiometric, next ? '1' : '0');
      setEnabled(next);
    }, []);
    return {
      isSystemManager: false,
      user: null,
      instanceUrl: site ?? null,
      biometricEnabled: enabled,
      setBiometricEnabled: set,
    };
  };
}
