import type { KitApi } from '../config';
import type { VaultCredentials } from '../vault/vault-core';

/**
 * When the server says the session is dead, sign in again with the credentials the person kept behind their
 * fingerprint, and retry the call once, instead of bouncing them to the login screen mid-task.
 *
 * "Dead session" on Frappe is not only HTTP 401: it also arrives as a 400 CSRF failure, a 403 AuthenticationError,
 * `session_expired`, or a 417 whose message says the session expired. The credentials live in memory only, and only
 * for a person who turned the fingerprint vault on.
 */

const SESSION_EXC_TYPES = new Set(['AuthenticationError', 'CSRFTokenError', 'SessionExpired', 'SessionStoppedError']);

export function isSessionInvalid(status: number | null | undefined, body: unknown): boolean {
  if (status === 401) return true;
  if (!body || typeof body !== 'object') return false;
  const b = body as Record<string, unknown>;
  const excType = String(b.exc_type ?? b.exception_type ?? '');
  if (excType && SESSION_EXC_TYPES.has(excType)) return true;
  if (b.session_expired === 1 || b.session_expired === true) return true;
  const text = `${b.exception ?? ''} ${b.exc ?? ''} ${b.message ?? ''}`.toLowerCase();
  if (status === 400 && (text.includes('csrf') || text.includes('invalid request'))) return true;
  if (status === 403 && (text.includes('authenticationerror') || (text.includes('not permitted') && text.includes('guest')))) return true;
  const raw = b._server_messages;
  if (typeof raw === 'string') {
    const t = raw.toLowerCase();
    if (t.includes('session') && (t.includes('expired') || t.includes('invalid'))) return true;
  }
  return false;
}

/** The status and body of a failed call, whatever client threw it (axios-style `response`, or the kit's own `status` / `body`). */
export function errorParts(err: unknown): { status: number | null; body: unknown } {
  const e = (err && typeof err === 'object' ? err : {}) as { response?: { status?: number; data?: unknown }; status?: number; body?: unknown };
  const status = e.response?.status ?? e.status;
  return { status: typeof status === 'number' ? status : null, body: e.response?.data ?? e.body };
}

let cached: VaultCredentials | null = null;
let inflight: Promise<boolean> | null = null;

/** Keep the credentials in memory for silent re-login. The vault calls this after a fingerprint unlock or enrolment. */
export function cacheCredentials(c: VaultCredentials | null): void {
  cached = c && c.user && c.password ? { ...c } : null;
}

export function hasCachedCredentials(): boolean {
  return cached !== null;
}

/**
 * Sign in again with the cached credentials. One attempt at a time: a burst of failing calls shares one login. Resolves
 * false (never throws) when there are no credentials or the login failed.
 */
export function recoverSession(login: (c: VaultCredentials) => Promise<void>): Promise<boolean> {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      if (!cached) return false;
      await login(cached);
      return true;
    } catch {
      return false;
    } finally {
      setTimeout(() => {
        inflight = null;
      }, 0);
    }
  })();
  return inflight;
}

export type SessionRecovery = {
  /** The app's own login: runs the normal sign-in with the stored credentials and refreshes the session. */
  login: (c: VaultCredentials) => Promise<void>;
  /** Called when the session is dead and could not be restored (send the person to the login screen). */
  onFailure?: () => void;
};

/** Wraps an API client: a dead-session answer triggers a silent re-login and one retry. */
export function withSessionRecovery(api: KitApi, opts: SessionRecovery): KitApi {
  return (async (req: Parameters<KitApi>[0]) => {
    try {
      return await api(req);
    } catch (err) {
      const { status, body } = errorParts(err);
      if (!isSessionInvalid(status, body)) throw err;
      if (await recoverSession(opts.login)) return api(req);
      opts.onFailure?.();
      throw err;
    }
  }) as KitApi;
}

/** For tests. */
export function resetSessionRecovery(): void {
  cached = null;
  inflight = null;
}
