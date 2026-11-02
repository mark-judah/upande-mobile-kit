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

/**
 * The human message in a Frappe error body: the first `_server_messages` entry, else `message`, else the text after
 * the exception class (`frappe.exceptions.ValidationError: Item not found` -> "Item not found"). Null when none.
 */
export function frappeErrorMessage(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const clean = (t: string) => t.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (typeof b._server_messages === 'string') {
    try {
      const list = JSON.parse(b._server_messages) as unknown[];
      for (const entry of list) {
        const m = typeof entry === 'string' ? (JSON.parse(entry) as { message?: unknown }) : (entry as { message?: unknown });
        if (typeof m?.message === 'string' && clean(m.message)) return clean(m.message);
      }
    } catch {
      // fall through
    }
  }
  if (typeof b.message === 'string' && clean(b.message)) return clean(b.message);
  const exc = typeof b.exception === 'string' ? b.exception : typeof b.exc === 'string' ? b.exc : '';
  const after = /^[\w.]+Error:\s*(.+)$|^[\w.]+Exception:\s*(.+)$|^[\w.]+:\s*(.+)$/s.exec(exc.split('\n')[0]);
  const text = after ? (after[1] ?? after[2] ?? after[3]) : '';
  return text && clean(text) ? clean(text) : null;
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
      let body: unknown;
      try {
        body = await res.json();
      } catch {
        // not JSON
      }
      // The status and body ride on the error so callers (session recovery, error screens) can read them.
      throw Object.assign(new Error(frappeErrorMessage(body) ?? `The server answered ${res.status}.`), { status: res.status, body });
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
