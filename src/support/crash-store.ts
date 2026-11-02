import { getConfig, KitKeys } from '../config';

/**
 * The last crash, kept on the phone so the NEXT "Report a problem" can carry it. A black screen or a restart is
 * often what made the person write in; without this the report would only describe the screen they ended up on.
 * Local only: it leaves the phone solely inside a report the person chooses to send.
 */

export type StoredCrash = {
  message: string;
  name?: string;
  stack?: string;
  fatal: boolean;
  source: 'global' | 'render' | 'rejection';
  at: string;
  screen?: string;
};

const MAX_STACK = 4000;

export function describeCrash(error: unknown, extra: { fatal: boolean; source: StoredCrash['source']; screen?: string }, now = new Date()): StoredCrash {
  const e = (error && typeof error === 'object' ? error : {}) as { message?: unknown; name?: unknown; stack?: unknown };
  const message = typeof e.message === 'string' && e.message ? e.message : String(error ?? 'Unknown error');
  return {
    message: message.slice(0, 500),
    ...(typeof e.name === 'string' ? { name: e.name } : {}),
    ...(typeof e.stack === 'string' ? { stack: e.stack.slice(0, MAX_STACK) } : {}),
    fatal: extra.fatal,
    source: extra.source,
    at: now.toISOString(),
    ...(extra.screen ? { screen: extra.screen } : {}),
  };
}

/** Remember a crash. Never throws and never waits: it may run as the app is dying. */
export function rememberCrash(error: unknown, extra: { fatal: boolean; source: StoredCrash['source']; screen?: string }): void {
  try {
    void getConfig()
      .storage.set(KitKeys.lastCrash, JSON.stringify(describeCrash(error, extra)))
      .catch(() => {});
  } catch {
    /* the kit may not be configured yet */
  }
}

/** The remembered crash, if any. It stays until a report carrying it has been sent (`forgetCrash`). */
export async function peekCrash(): Promise<StoredCrash | null> {
  try {
    const raw = await getConfig().storage.get(KitKeys.lastCrash);
    const v = raw ? (JSON.parse(raw) as StoredCrash) : null;
    return v && typeof v.message === 'string' ? v : null;
  } catch {
    return null;
  }
}

export async function forgetCrash(): Promise<void> {
  try {
    await getConfig().storage.remove(KitKeys.lastCrash);
  } catch {
    /* nothing to forget */
  }
}
