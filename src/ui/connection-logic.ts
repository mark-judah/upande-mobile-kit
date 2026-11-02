/** When to warn about the connection. Pure, so it can be tested without a phone. */

export type LinkSample = { connected: boolean | undefined; reachable: boolean | undefined };
export type BannerState = 'ok' | 'offline' | 'slow';

/** Offline means the phone says so; an unknown answer is never treated as offline. */
export function isOffline(s: LinkSample): boolean {
  return s.connected === false || s.reachable === false;
}

/**
 * `offlineSince`: when the phone first reported no connection (null while fine). Shouts only after `staleAfterMs`
 * so a lift ride or a handover between access points does not flash a banner; a slow server shows when the last
 * round trip took `slowMs` or more.
 */
export function bannerState(a: { offlineSince: number | null; now: number; staleAfterMs: number; latencyMs: number | undefined; slowMs: number }): BannerState {
  if (a.offlineSince != null && a.now - a.offlineSince >= a.staleAfterMs) return 'offline';
  if (a.offlineSince == null && a.latencyMs != null && a.latencyMs >= a.slowMs) return 'slow';
  return 'ok';
}

export function bannerText(state: BannerState): string {
  if (state === 'offline') return 'No connection. Your work is kept; check the Wi-Fi.';
  if (state === 'slow') return 'The connection is slow. Things may take a while.';
  return '';
}

export function resolveBanner(v: boolean | { staleAfterSec?: number; slowMs?: number } | undefined): { enabled: boolean; staleAfterMs: number; slowMs: number } {
  if (v === false) return { enabled: false, staleAfterMs: 25_000, slowMs: 3000 };
  const o = typeof v === 'object' && v ? v : {};
  return { enabled: true, staleAfterMs: Math.max(5, o.staleAfterSec ?? 25) * 1000, slowMs: Math.max(500, o.slowMs ?? 3000) };
}
