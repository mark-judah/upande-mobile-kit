/**
 * Whether the phone can really reach the server, judged by what actually happens to requests rather than by what the
 * operating system says. Some handhelds (the Honeywell EDA52 for one) keep reporting "connected" after the Wi-Fi radio
 * has stopped carrying data. After `THRESHOLD` failed attempts in a row the app counts as offline, whatever Android says,
 * and a single answer from the server clears it.
 */

export const OFFLINE_AFTER_FAILURES = 2;

let failures = 0;
let forced = false;

/** A request to the app's server finished: `true` when the server answered at all (any status), `false` when it was never reached. */
export function noteNetworkResult(reachedServer: boolean): void {
  if (reachedServer) {
    failures = 0;
    forced = false;
    return;
  }
  failures += 1;
  if (failures >= OFFLINE_AFTER_FAILURES) forced = true;
}

export function isForcedOffline(): boolean {
  return forced;
}

/** Whether `url` points at the app's own server (a relative URL does: it resolves against the base URL). */
export function isOwnServer(url: string, site: string | undefined): boolean {
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) return true;
  if (!site) return false;
  try {
    return new URL(url).host === new URL(site).host;
  } catch {
    return false;
  }
}

/** For tests. */
export function resetLinkHealth(): void {
  failures = 0;
  forced = false;
}
