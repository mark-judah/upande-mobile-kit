import { AppState, type AppStateStatus, type NativeEventSubscription } from 'react-native';
import { getConfig, KitKeys } from '../config';
import { getInstallId, waitForLaunchRegistration } from '../devices/install-register';
import { RingBuffer } from './buffer';
import { appBuildFacts, collectDeviceFacts, peekDeviceFacts } from './device';
import {
  bodyToText, byteLength, cutBytes, headersToObject, makeKeyMatcher, redactHeaders, redactUrl,
} from './redact';
import {
  LIMITS, MONITOR_DEFAULTS, type ApiRecord, type Breadcrumb, type MonitorEvent, type MonitorKind,
  type MonitorLevel, type MonitorOptions, type MonitorPayload, type MonitorUser,
} from './types';

/**
 * The monitor. The rule: the code that runs when the app does something (an
 * API call returns, an error is thrown) only pushes a small object onto a
 * bounded ring buffer. Redaction, JSON, device probes, storage and the network
 * all happen later, in `flushNow`, after interactions have settled.
 */

/** What the hot path records. Raw references only: nothing here is copied, stringified or redacted. */
type RawItem =
  | { t: 'error'; ts: number; err: unknown; fatal: boolean; extra?: Record<string, unknown> }
  | { t: 'message'; ts: number; message: string; level: MonitorLevel; extra?: Record<string, unknown> }
  | {
      t: 'api'; ts: number; method: string; url: string; status: number | null; duration: number;
      reqHeaders?: unknown; reqBody?: unknown; resHeaders?: unknown; resBody?: unknown; error?: string; ok: boolean;
    };

type RawCrumb = { ts: number; type: Breadcrumb['type']; message: string; data?: Record<string, unknown> };

export type ApiCapture = {
  method: string;
  url: string;
  status: number | null;
  durationMs: number;
  requestHeaders?: unknown;
  requestBody?: unknown;
  responseHeaders?: unknown;
  responseBody?: unknown;
  error?: string;
};

type Resolved = Required<Pick<MonitorOptions, 'captureBodies' | 'maxBodyBytes' | 'breadcrumbs' | 'sampleSuccess' | 'maxEventsPerSession' | 'flushIntervalSec'>> &
  Pick<MonitorOptions, 'redactKeys' | 'ignoreUrls'>;

const state = {
  opts: { ...MONITOR_DEFAULTS } as Resolved,
  enabled: true,
  started: false,
  ready: Promise.resolve() as Promise<void>,
  raw: new RingBuffer<RawItem>(LIMITS.rawBufferSize),
  crumbs: new RingBuffer<RawCrumb>(MONITOR_DEFAULTS.breadcrumbs),
  queue: [] as MonitorEvent[],
  sessionId: '',
  sessionCount: 0,
  droppedForCap: 0,
  ctx: {} as { user?: MonitorUser; screen?: string },
  recent: new Map<string, { at: number; event: MonitorEvent }>(),
  timer: null as ReturnType<typeof setTimeout> | null,
  timerDue: 0,
  failures: 0,
  backoffUntil: 0,
  sending: false,
  lastApiKey: '',
  lastApiAt: 0,
  appStateSub: null as NativeEventSubscription | null,
  isSecret: makeKeyMatcher(),
  ingestPath: '',
};

function newId(): string {
  const hex = '0123456789abcdef';
  let out = '';
  for (let i = 0; i < 32; i += 1) out += hex[Math.floor(Math.random() * 16)];
  return `${out.slice(0, 8)}-${out.slice(8, 12)}-4${out.slice(13, 16)}-${out.slice(16, 20)}-${out.slice(20)}`;
}

/* ───────────────────────── configuration ───────────────────────── */

export function resolveOptions(o: MonitorOptions = {}): Resolved {
  return {
    captureBodies: o.captureBodies ?? MONITOR_DEFAULTS.captureBodies,
    maxBodyBytes: o.maxBodyBytes ?? MONITOR_DEFAULTS.maxBodyBytes,
    breadcrumbs: o.breadcrumbs ?? MONITOR_DEFAULTS.breadcrumbs,
    sampleSuccess: Math.min(1, Math.max(0, o.sampleSuccess ?? MONITOR_DEFAULTS.sampleSuccess)),
    maxEventsPerSession: o.maxEventsPerSession ?? MONITOR_DEFAULTS.maxEventsPerSession,
    flushIntervalSec: o.flushIntervalSec ?? MONITOR_DEFAULTS.flushIntervalSec,
    redactKeys: o.redactKeys,
    ignoreUrls: o.ignoreUrls,
  };
}

export function monitorOptions(): MonitorOptions {
  try {
    return getConfig().monitor ?? {};
  } catch {
    return {};
  }
}

/* ───────────────────────── hot path ───────────────────────── */

function afterPush(): void {
  if (state.raw.length >= LIMITS.flushAtCount) schedule(0);
  else if (!state.timer) schedule(state.opts.flushIntervalSec * 1000);
}

/**
 * Error objects already recorded. The same error often arrives twice (thrown, then logged with console.error by
 * the app or by React Native): the first sighting is the one that counts.
 */
let seenErrors = new WeakSet<object>();
function alreadySeen(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  if (seenErrors.has(err)) return true;
  seenErrors.add(err);
  return false;
}

/** Record a thrown error. O(1): the error object is kept as-is until the flush. */
export function captureException(err: unknown, extra?: Record<string, unknown>): void {
  if (!state.enabled || alreadySeen(err)) return;
  state.raw.push({ t: 'error', ts: Date.now(), err, fatal: false, extra });
  afterPush();
}

export function captureMessage(message: string, level: MonitorLevel = 'info', extra?: Record<string, unknown>): void {
  if (!state.enabled) return;
  state.raw.push({ t: 'message', ts: Date.now(), message, level, extra });
  afterPush();
}

export function addBreadcrumb(crumb: { type?: Breadcrumb['type']; message: string; data?: Record<string, unknown> }): void {
  if (!state.enabled) return;
  state.crumbs.push({ ts: Date.now(), type: crumb.type ?? 'log', message: crumb.message, data: crumb.data });
}

function ignored(url: string): boolean {
  if (state.ingestPath && url.includes(state.ingestPath)) return true;
  const list = state.opts.ignoreUrls;
  if (!list) return false;
  for (const m of list) if (typeof m === 'string' ? url.includes(m) : m.test(url)) return true;
  return false;
}

/**
 * Record one API call. Failed calls (status >= 400, no status, or an error) are
 * kept in full; successful ones only when sampled, and then as metadata.
 */
export function captureApiCall(c: ApiCapture): void {
  if (!state.enabled || ignored(c.url)) return;
  const ok = c.status !== null && c.status < 400 && !c.error;
  const ts = Date.now();
  // Breadcrumb for every call (a few fields; formatted at flush).
  state.crumbs.push({ ts, type: 'api', message: '', data: { method: c.method, url: c.url, status: c.status, ms: c.durationMs } });
  if (ok && !(state.opts.sampleSuccess > 0 && Math.random() < state.opts.sampleSuccess)) return;
  // axios over fetch would report the same call twice: keep one.
  const key = c.method + ' ' + c.url + ' ' + c.status;
  if (key === state.lastApiKey && ts - state.lastApiAt < 100) return;
  state.lastApiKey = key;
  state.lastApiAt = ts;
  state.raw.push({
    t: 'api', ts, method: c.method, url: c.url, status: c.status, duration: c.durationMs, ok, error: c.error,
    reqHeaders: ok ? undefined : c.requestHeaders, reqBody: ok ? undefined : c.requestBody,
    resHeaders: ok ? undefined : c.responseHeaders, resBody: ok ? undefined : c.responseBody,
  });
  afterPush();
}

/** An unhandled crash: kept like any error, then queued and sent without waiting for the idle timer. */
export function captureFatal(err: unknown): void {
  if (!state.enabled) return;
  if (err && typeof err === 'object') seenErrors.add(err);
  state.raw.push({ t: 'error', ts: Date.now(), err, fatal: true });
  // The process may die right after this: build from what is already known, persist, try to send.
  void flushNow({ urgent: true });
}

export function setMonitorContext(patch: { user?: MonitorUser | null; screen?: string }): void {
  const hadUser = !!state.ctx.user;
  if ('user' in patch) state.ctx.user = patch.user ?? undefined;
  if (patch.screen !== undefined) state.ctx.screen = patch.screen;
  // Reports filed before sign-in are waiting: send them now.
  if (!hadUser && state.ctx.user && (state.queue.length || state.raw.length)) schedule(0);
}

/* ───────────────────────── scheduling ───────────────────────── */

function schedule(ms: number): void {
  const due = Date.now() + Math.max(ms, state.backoffUntil - Date.now(), 0);
  // A timer already due at or before this moment is enough: a storm of events arms one timer, not one each.
  if (state.timer && state.timerDue <= due) return;
  if (state.timer) clearTimeout(state.timer);
  state.timerDue = due;
  state.timer = setTimeout(() => {
    state.timer = null;
    // After the current frame's work: an idle callback where there is one, else straight away (the timer already deferred it).
    const idle = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void }).requestIdleCallback;
    if (idle) idle(() => void flushNow(), { timeout: 2000 });
    else void flushNow();
  }, Math.max(0, due - Date.now()));
}

/* ───────────────────────── building events (off the hot path) ───────────────────────── */

function errorParts(err: unknown): { name?: string; message: string; stack?: string } {
  if (err && typeof err === 'object') {
    const e = err as { name?: unknown; message?: unknown; stack?: unknown };
    const message = typeof e.message === 'string' ? e.message : safeJson(err);
    return {
      name: typeof e.name === 'string' ? e.name : undefined,
      message: cutBytes(message || 'Unknown error', 2000),
      stack: typeof e.stack === 'string' ? cutBytes(e.stack, 16 * 1024) : undefined,
    };
  }
  return { message: cutBytes(String(err), 2000) };
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
}

/** `/api/resource/Item/ITEM-0001?x=1` -> `/api/resource/Item/:id`: calls to one route group together. */
export function pathTemplate(url: string): string {
  const noQuery = url.split('?')[0].split('#')[0].replace(/^[a-z]+:\/\/[^/]+/i, '');
  return noQuery
    .split('/')
    .map((seg) => (/^\d+$/.test(seg) || /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(seg) || (/\d/.test(seg) && /[A-Za-z]/.test(seg) && seg.length > 6 && /[-_]/.test(seg)) ? ':id' : seg))
    .join('/');
}

function firstFrame(stack?: string): string {
  return (stack ?? '').split('\n').find((l) => /\bat\b|@|:\d+/.test(l))?.trim().slice(0, 160) ?? '';
}

function dedupeKey(e: MonitorEvent): string {
  return e.kind === 'api' && e.request
    ? `api|${e.request.method}|${pathTemplate(e.request.url)}|${e.request.status}|${(e.request.error ?? '').slice(0, 80)}`
    : `${e.kind}|${e.name ?? ''}|${e.message.slice(0, 200)}|${firstFrame(e.stack)}`;
}

function crumbsFor(upTo: number): Breadcrumb[] {
  return state.crumbs.peekLast(state.opts.breadcrumbs).filter((c) => c.ts <= upTo).map((c) => {
    if (c.type === 'api' && c.data) {
      const d = c.data as { method: string; url: string; status: number | null; ms: number };
      return { ts: new Date(c.ts).toISOString(), type: 'api' as const, message: `${d.method} ${redactUrl(String(d.url), state.isSecret)} → ${d.status ?? 'failed'} (${d.ms} ms)` };
    }
    return { ts: new Date(c.ts).toISOString(), type: c.type, message: cutBytes(c.message, 300), ...(c.data ? { data: c.data } : {}) };
  });
}

function apiRecord(r: Extract<RawItem, { t: 'api' }>): ApiRecord {
  const max = state.opts.maxBodyBytes;
  const rec: ApiRecord = { method: r.method.toUpperCase(), url: redactUrl(r.url, state.isSecret), status: r.status, duration_ms: r.duration };
  if (r.error) rec.error = cutBytes(r.error, 500);
  if (r.ok) return rec;
  const rh = redactHeaders(headersToObject(r.reqHeaders), state.isSecret);
  if (rh) rec.request_headers = rh;
  const sh = redactHeaders(headersToObject(r.resHeaders), state.isSecret);
  if (sh) rec.response_headers = sh;
  if (state.opts.captureBodies) {
    const rq = bodyToText(r.reqBody, max, state.isSecret);
    const rs = bodyToText(r.resBody, max, state.isSecret);
    if (rq) rec.request_body = rq.text;
    if (rs) rec.response_body = rs.text;
    if (rq?.truncated || rs?.truncated) rec.truncated = true;
  }
  return rec;
}

/** Turn one raw item into a wire event. All the expensive work lives here. */
export function buildEvent(r: RawItem, device: MonitorEvent['device']): MonitorEvent {
  const base = {
    id: newId(),
    ts: new Date(r.ts).toISOString(),
    session_id: state.sessionId,
    ...appBuildFacts(),
    breadcrumbs: crumbsFor(r.ts),
    device,
    ...(state.ctx.screen ? { screen: state.ctx.screen } : {}),
    ...(state.ctx.user ? { user: state.ctx.user } : {}),
  };
  if (r.t === 'error') {
    const p = errorParts(r.err);
    const kind: MonitorKind = r.fatal ? 'crash' : 'error';
    return {
      ...base, kind, level: r.fatal ? 'fatal' : 'error', ...p, ...(r.fatal ? { fatal: true } : {}),
      ...(r.extra ? { extra: scrubExtra(r.extra) } : {}),
    };
  }
  if (r.t === 'message') {
    return { ...base, kind: 'log', level: r.level, message: cutBytes(r.message, 2000), ...(r.extra ? { extra: scrubExtra(r.extra) } : {}) };
  }
  const request = apiRecord(r);
  return {
    ...base, kind: 'api', level: r.ok ? 'info' : 'error', name: 'ApiError',
    message: cutBytes(`${request.method} ${pathTemplate(request.url)} → ${r.status ?? request.error ?? 'failed'}`, 500),
    request,
  };
}

function scrubExtra(extra: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(extra)) out[k] = state.isSecret(k) ? '[redacted]' : v;
  try {
    return byteLength(JSON.stringify(out)) > 8192 ? { truncated: true } : out;
  } catch {
    return { unserialisable: true };
  }
}

/** Queue an event, merging a repeat of one already waiting (same error inside 60 s) into its count. */
function enqueue(event: MonitorEvent, now: number): void {
  const key = dedupeKey(event);
  const seen = state.recent.get(key);
  if (seen && now - seen.at < LIMITS.dedupeWindowMs) {
    if (state.queue.includes(seen.event)) seen.event.count = (seen.event.count ?? 1) + 1;
    return;
  }
  if (state.sessionCount >= state.opts.maxEventsPerSession) {
    state.droppedForCap += 1;
    return;
  }
  state.sessionCount += 1;
  state.recent.set(key, { at: now, event });
  if (state.recent.size > 200) state.recent.delete(state.recent.keys().next().value as string);
  state.queue.push(event);
}

function trimQueue(): void {
  while (state.queue.length > LIMITS.maxQueuedEvents) state.queue.shift();
  let bytes = byteLength(safeJson(state.queue));
  while (bytes > LIMITS.maxQueuedBytes && state.queue.length > 1) {
    bytes -= byteLength(safeJson(state.queue[0])) + 1;
    state.queue.shift();
  }
}

async function persistQueue(): Promise<void> {
  try {
    const { storage } = getConfig();
    if (state.queue.length === 0) await storage.remove(KitKeys.monitorQueue);
    else await storage.set(KitKeys.monitorQueue, safeJson(state.queue));
  } catch {
    // storage unusable: the queue stays in memory
  }
}

/* ───────────────────────── flush ───────────────────────── */

export function buildPayload(events: MonitorEvent[], installId: string, app: string): MonitorPayload {
  return { app, install_id: installId, sent_at: new Date().toISOString(), events };
}

/** The next chunk: up to 50 events and 512 KB, always at least one. */
export function nextChunk(queue: MonitorEvent[]): MonitorEvent[] {
  const out: MonitorEvent[] = [];
  let bytes = 400;
  for (const e of queue) {
    const size = byteLength(safeJson(e)) + 1;
    if (out.length >= LIMITS.maxEventsPerRequest || (out.length > 0 && bytes + size > LIMITS.maxRequestBytes)) break;
    out.push(e);
    bytes += size;
  }
  return out;
}

let flushing: Promise<void> | null = null;

/** Build events from the raw buffer, queue them, and send what the server will take. */
export function flushNow(opts: { urgent?: boolean } = {}): Promise<void> {
  if (flushing && !opts.urgent) return flushing;
  const run = (async () => {
    await state.ready;
    if (!state.enabled) {
      state.raw.drain();
      return;
    }
    const items = state.raw.drain();
    if (items.length) {
      const device = opts.urgent ? peekDeviceFacts() : await collectDeviceFacts().catch(() => peekDeviceFacts());
      const now = Date.now();
      for (const r of items) {
        try {
          enqueue(buildEvent(r, device), now);
        } catch {
          // one malformed item must not lose the rest
        }
      }
      trimQueue();
      await persistQueue();
    }
    await send(opts.urgent === true);
  })().finally(() => {
    if (flushing === run) flushing = null;
  });
  flushing = run;
  return run;
}

/** Said once per run, in development only: why nothing is arriving. */
let loggedPause = false;

/** `urgent`: an unhandled crash, sent without waiting for anything (the process may die any moment). */
async function send(urgent = false): Promise<void> {
  if (state.sending || state.queue.length === 0) return;
  if (!state.ctx.user) return; // reports need a signed-in session; they wait for the sign-in
  if (Date.now() < state.backoffUntil) return schedule(0);
  state.sending = true;
  let pausedWait = 0;
  try {
    // The launch registration goes first: an older server only learns this app exists from it.
    if (!urgent) await waitForLaunchRegistration();
    const cfg = getConfig();
    const installId = state.queue[0].device.install_id ?? (await getInstallId());
    if (!installId) return;
    let waitMs = state.opts.flushIntervalSec * 1000;
    while (state.queue.length) {
      const chunk = nextChunk(state.queue);
      const res = await cfg.api<{ message?: { accepted?: number; dropped?: number; next_flush_ms?: number; paused?: boolean; reason?: string } }>({
        method: 'POST',
        url: cfg.endpoints.ingest,
        data: { payload: JSON.stringify(buildPayload(chunk, installId, cfg.appName)) },
      });
      state.failures = 0;
      const m = res?.message;
      const hint = m?.next_flush_ms;
      if (typeof hint === 'number' && Number.isFinite(hint)) waitMs = Math.min(10 * 60_000, Math.max(5_000, hint));
      if (m?.paused === true) {
        // The server is not taking reports right now (switched off, or the app is not set up yet): keep them,
        // not discard. A reply that took nothing and did NOT say paused means the events themselves were bad.
        pausedWait = typeof hint === 'number' && Number.isFinite(hint) ? waitMs : 10 * 60_000;
        if (__DEV__ && !loggedPause) {
          loggedPause = true;
          console.log(`[@upande/mobile-kit] the server is not accepting crash reports yet${m.reason ? ` (${m.reason})` : ''}; they are kept and retried.`);
        }
        break;
      }
      state.queue.splice(0, chunk.length);
    }
    await persistQueue();
    if (pausedWait) schedule(pausedWait);
    else if (state.raw.length) schedule(waitMs);
  } catch {
    state.failures += 1;
    state.backoffUntil = Date.now() + Math.min(LIMITS.backoffBaseMs * 2 ** (state.failures - 1), LIMITS.backoffMaxMs);
    schedule(0);
  } finally {
    state.sending = false;
  }
}

/* ───────────────────────── lifecycle ───────────────────────── */

export function isMonitoringEnabled(): boolean {
  return state.enabled;
}

/** Resolves once the person's saved choice and the waiting queue have been loaded. */
export function monitoringReady(): Promise<void> {
  return state.ready;
}

/** The person's own switch ("Send crash reports"): persisted, and drops anything waiting. */
export async function setMonitoringEnabled(enabled: boolean): Promise<void> {
  state.enabled = enabled;
  try {
    await getConfig().storage.set(KitKeys.monitorEnabled, enabled ? '1' : '0');
  } catch {
    // kept in memory for this run
  }
  if (!enabled) {
    state.raw.drain();
    state.queue = [];
    state.recent.clear();
    await persistQueue();
  }
}

export function onAppState(next: AppStateStatus): void {
  if (!state.enabled) return;
  if (next === 'background' || next === 'inactive') void flushNow();
  else if (next === 'active' && (state.queue.length || state.raw.length)) schedule(0);
}

/** Load the person's choice and the persisted queue. Called by `startMonitor`. */
export function initState(): Promise<void> {
  const cfg = getConfig();
  const o = cfg.monitor ?? {};
  state.opts = resolveOptions(o);
  state.isSecret = makeKeyMatcher(o.redactKeys);
  state.ingestPath = cfg.endpoints.ingest;
  if (state.crumbs.capacity !== state.opts.breadcrumbs) state.crumbs = new RingBuffer<RawCrumb>(Math.max(1, state.opts.breadcrumbs));
  state.sessionId = newId();
  state.sessionCount = 0;
  state.enabled = o.enabled !== false;
  state.ready = (async () => {
    try {
      const [flag, queued] = await Promise.all([cfg.storage.get(KitKeys.monitorEnabled), cfg.storage.get(KitKeys.monitorQueue)]);
      if (flag === '0') state.enabled = false;
      if (state.enabled && queued) {
        const parsed = JSON.parse(queued);
        if (Array.isArray(parsed)) state.queue = [...parsed, ...state.queue].slice(-LIMITS.maxQueuedEvents);
      } else if (!state.enabled) {
        await cfg.storage.remove(KitKeys.monitorQueue);
      }
    } catch {
      // unreadable storage: start empty
    }
    if (state.enabled && state.queue.length) schedule(2000);
  })();
  return state.ready;
}

export function bindAppState(): void {
  state.appStateSub?.remove();
  state.appStateSub = AppState.addEventListener('change', onAppState);
}

export function unbindAppState(): void {
  state.appStateSub?.remove();
  state.appStateSub = null;
}

export function markStarted(v: boolean): boolean {
  const was = state.started;
  state.started = v;
  return was;
}

/** For tests: wipe everything back to a fresh process. */
export function resetMonitorForTests(): void {
  if (state.timer) clearTimeout(state.timer);
  unbindAppState();
  Object.assign(state, {
    opts: { ...MONITOR_DEFAULTS }, enabled: true, started: false, ready: Promise.resolve(),
    raw: new RingBuffer<RawItem>(LIMITS.rawBufferSize), crumbs: new RingBuffer<RawCrumb>(MONITOR_DEFAULTS.breadcrumbs),
    queue: [], sessionId: newId(), sessionCount: 0, droppedForCap: 0, ctx: {}, recent: new Map(), timer: null, timerDue: 0,
    failures: 0, backoffUntil: 0, sending: false, lastApiKey: '', lastApiAt: 0, isSecret: makeKeyMatcher(), ingestPath: '',
  });
  flushing = null;
  seenErrors = new WeakSet<object>();
  loggedPause = false;
}

export function monitorStats() {
  return {
    queued: state.queue.length, raw: state.raw.length, rawDropped: state.raw.dropped, sessionCount: state.sessionCount,
    droppedForCap: state.droppedForCap, failures: state.failures, enabled: state.enabled, queue: state.queue,
  };
}
