/**
 * How the network treats this app: how long its own API calls take (rolling, in memory) and how long a tiny
 * request to the server takes right now. Cheap by construction: recording a call is O(1), the latency probe runs
 * in the background at most once a minute and is never awaited by anything that matters.
 */

const WINDOW = 100;
const samples: number[] = [];
let failed = 0;
let seen = 0;

/** Path of the latency probe; never recorded as one of the app's own calls. */
export const PING_PATH = '/api/method/ping';

/** One finished API call: how long it took and whether it worked. */
export function recordApiTiming(durationMs: number, ok: boolean): void {
  if (!Number.isFinite(durationMs) || durationMs < 0) return;
  seen += 1;
  if (!ok) failed += 1;
  samples.push(Math.round(durationMs));
  if (samples.length > WINDOW) samples.shift();
}

export type ApiTimingSummary = { api_calls?: number; api_avg_ms?: number; api_p95_ms?: number; api_error_pct?: number };

/** Average and 95th-percentile response time of the recent calls, and the share that failed. Empty until a call is seen. */
export function apiTimingSummary(): ApiTimingSummary {
  if (!samples.length) return {};
  const sorted = [...samples].sort((a, b) => a - b);
  const avg = sorted.reduce((a, b) => a + b, 0) / sorted.length;
  const p95 = sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
  return { api_calls: seen, api_avg_ms: Math.round(avg), api_p95_ms: p95, api_error_pct: Math.round((failed / seen) * 1000) / 10 };
}

let probeSite: string | undefined;
/** The server the signed-in person actually talks to (it may differ from the configured site). */
export function setProbeSite(url: string | null | undefined): void {
  probeSite = url || undefined;
}
export function getProbeSite(): string | undefined {
  return probeSite;
}

const LATENCY_TTL_MS = 60_000;
const LATENCY_TIMEOUT_MS = 4000;
let latency: { at: number; ms: number } | null = null;
let probing = false;

/** The last measured round trip to the server, in ms, or undefined before the first probe has answered. */
export function lastLatencyMs(): number | undefined {
  return latency?.ms;
}

/**
 * Starts a latency probe when the last one is stale. Returns at once; the answer shows up in `lastLatencyMs()`.
 * A timeout records the timeout itself, so a dead link shows as slow rather than as nothing.
 */
export function refreshLatency(
  site: string | undefined,
  deps: { fetchImpl?: typeof fetch; now?: () => number } = {},
): void {
  const now = deps.now ?? Date.now;
  const doFetch = deps.fetchImpl ?? (typeof fetch === 'function' ? fetch : undefined);
  if (!site || !doFetch || probing || (latency && now() - latency.at < LATENCY_TTL_MS)) return;
  probing = true;
  const started = now();
  const controller = typeof AbortController === 'function' ? new AbortController() : undefined;
  const timer = setTimeout(() => controller?.abort(), LATENCY_TIMEOUT_MS);
  doFetch(site.replace(/\/+$/, '') + PING_PATH, { method: 'GET', signal: controller?.signal })
    .then(
      () => {
        latency = { at: now(), ms: Math.max(1, now() - started) };
      },
      () => {
        latency = { at: now(), ms: LATENCY_TIMEOUT_MS };
      },
    )
    .finally(() => {
      clearTimeout(timer);
      probing = false;
    });
}

/** For tests. */
export function resetNetStats(): void {
  samples.length = 0;
  failed = 0;
  seen = 0;
  latency = null;
  probing = false;
  probeSite = undefined;
}
