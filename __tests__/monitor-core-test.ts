import { KitKeys } from '../src/config';
import { apiMock, setup, store } from './helpers';
import {
  addBreadcrumb, buildEvent, captureApiCall, captureException, captureFatal, captureMessage, flushNow, initState, monitorStats,
  nextChunk, pathTemplate, resetMonitorForTests, setMonitorContext, setMonitoringEnabled,
} from '../src/monitor/core';
import { resetDeviceCache } from '../src/monitor/device';
import { reportInstall, resetReportState } from '../src/devices/install-register';
import type { MonitorEvent, MonitorPayload } from '../src/monitor/types';

const user = { id: 'test@example.com', full_name: 'Test User', roles: ['System Manager'] };

async function start(monitor = {}) {
  setup({ monitor });
  resetMonitorForTests();
  resetDeviceCache();
  await initState();
}

const sent = (): MonitorPayload[] => apiMock.mock.calls.map((c) => JSON.parse(c[0].data.payload));

afterEach(() => {
  resetMonitorForTests();
  resetReportState();
});

describe('api timing feed', () => {
  it('counts every call, successful or not, but never the latency probe', async () => {
    await start();
    const { apiTimingSummary, resetNetStats } = jest.requireActual('../src/monitor/net-stats');
    resetNetStats();
    captureApiCall({ method: 'GET', url: '/ok', status: 200, durationMs: 40 });
    captureApiCall({ method: 'GET', url: '/bad', status: 500, durationMs: 60 });
    captureApiCall({ method: 'GET', url: 'https://s.example.com/api/method/ping', status: 200, durationMs: 9999 });
    expect(apiTimingSummary()).toMatchObject({ api_calls: 2, api_avg_ms: 50, api_error_pct: 50 });
  });
});

describe('wire contract', () => {
  it('posts one form field `payload` holding {app, install_id, sent_at, events} to the ingest endpoint', async () => {
    await start();
    setMonitorContext({ user, screen: '/orders' });
    addBreadcrumb({ type: 'navigation', message: '/orders' });
    captureException(new TypeError('boom'), { order: 'SO-1' });
    await flushNow();

    expect(apiMock).toHaveBeenCalledTimes(1);
    const req = apiMock.mock.calls[0][0];
    expect(req.method).toBe('POST');
    expect(req.url).toBe('/api/method/upande_mobile.api.monitor.ingest');
    expect(Object.keys(req.data)).toEqual(['payload']);
    expect(typeof req.data.payload).toBe('string');

    const p = JSON.parse(req.data.payload) as MonitorPayload;
    expect(Object.keys(p).sort()).toEqual(['app', 'events', 'install_id', 'sent_at']);
    expect(p.app).toBe('Test App');
    expect(typeof p.install_id).toBe('string');
    expect(Number.isNaN(Date.parse(p.sent_at))).toBe(false);

    const e = p.events[0];
    expect(e).toMatchObject({ kind: 'error', level: 'error', name: 'TypeError', message: 'boom', screen: '/orders', user });
    expect(e.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(e.ts).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
    expect(typeof e.stack).toBe('string');
    expect(typeof e.session_id).toBe('string');
    expect(typeof e.app_version).toBe('string');
    expect(Array.isArray(e.breadcrumbs)).toBe(true);
    expect(e.breadcrumbs[0]).toMatchObject({ type: 'navigation', message: '/orders' });
    expect(e.extra).toEqual({ order: 'SO-1' });
    expect(e.device.platform).toBeTruthy();
    expect(e.request).toBeUndefined();
  });

  it('shapes an api event like the spec', async () => {
    await start();
    setMonitorContext({ user });
    captureApiCall({
      method: 'post', url: 'https://s.example.com/api/method/a.b?api_key=zzz&page=1', status: 500, durationMs: 321,
      requestHeaders: { Authorization: 'token k:s', 'Content-Type': 'application/json' }, requestBody: '{"usr":"u","pwd":"p","qty":2}',
      responseHeaders: new Map([['set-cookie', 'sid=abc'], ['content-type', 'application/json']]), responseBody: '{"exc":"Traceback","token":"t"}',
    });
    await flushNow();
    const e = sent()[0].events[0];
    expect(e.kind).toBe('api');
    expect(e.level).toBe('error');
    expect(e.request).toEqual({
      method: 'POST',
      url: 'https://s.example.com/api/method/a.b?api_key=[redacted]&page=1',
      status: 500,
      duration_ms: 321,
      request_headers: { Authorization: '[redacted]', 'Content-Type': 'application/json' },
      request_body: '{"usr":"u","pwd":"[redacted]","qty":2}',
      response_headers: { 'set-cookie': '[redacted]', 'content-type': 'application/json' },
      response_body: '{"exc":"Traceback","token":"[redacted]"}',
    });
    expect(e.message).toBe('POST /api/method/a.b → 500');
    expect(JSON.stringify(e)).not.toMatch(/hunter|zzz|token k:s|sid=abc/);
  });

  it('never claims a user: events carry only what the host reported, the server files them under the session', async () => {
    await start();
    setMonitorContext({ user });
    captureMessage('hello', 'warning');
    await flushNow();
    const e = sent()[0].events[0];
    expect(e).toMatchObject({ kind: 'log', level: 'warning', message: 'hello' });
    expect(Object.keys(e).sort()).toEqual(
      expect.arrayContaining(['id', 'kind', 'level', 'ts', 'message', 'session_id', 'app_version', 'breadcrumbs', 'device']),
    );
  });
});

describe('what is sent', () => {
  it('does not send successful calls by default; samples them as metadata only', async () => {
    await start();
    setMonitorContext({ user });
    captureApiCall({ method: 'GET', url: '/ok', status: 200, durationMs: 5, requestBody: 'x', responseBody: 'y' });
    await flushNow();
    expect(apiMock).not.toHaveBeenCalled();

    await start({ sampleSuccess: 1 });
    setMonitorContext({ user });
    captureApiCall({ method: 'GET', url: '/ok', status: 200, durationMs: 5, requestBody: '{"a":1}', responseBody: 'y' });
    await flushNow();
    const e = sent()[0].events[0];
    expect(e.level).toBe('info');
    expect(e.request).toEqual({ method: 'GET', url: '/ok', status: 200, duration_ms: 5 });
  });

  it('records network failures (no status) and 4xx/5xx', async () => {
    await start();
    setMonitorContext({ user });
    captureApiCall({ method: 'GET', url: '/a', status: null, durationMs: 9, error: 'Network request failed' });
    captureApiCall({ method: 'GET', url: '/b', status: 404, durationMs: 9 });
    await flushNow();
    const [a, b] = sent()[0].events;
    expect(a.request?.error).toBe('Network request failed');
    expect(b.request?.status).toBe(404);
  });

  it('skips the ingest endpoint and configured ignoreUrls', async () => {
    await start({ ignoreUrls: ['/healthz', /ping$/] });
    setMonitorContext({ user });
    captureApiCall({ method: 'POST', url: 'https://s/api/method/upande_mobile.api.monitor.ingest', status: 500, durationMs: 1 });
    captureApiCall({ method: 'GET', url: 'https://s/healthz', status: 500, durationMs: 1 });
    captureApiCall({ method: 'GET', url: 'https://s/ping', status: 500, durationMs: 1 });
    expect(monitorStats().raw).toBe(0);
  });

  it('leaves bodies out when captureBodies is false', async () => {
    await start({ captureBodies: false });
    setMonitorContext({ user });
    captureApiCall({ method: 'POST', url: '/x', status: 500, durationMs: 1, requestBody: '{"a":1}', responseBody: 'bad' });
    await flushNow();
    const r = sent()[0].events[0].request!;
    expect(r.request_body).toBeUndefined();
    expect(r.response_body).toBeUndefined();
  });

  it('keeps a call reported by both fetch and axios once', async () => {
    await start();
    setMonitorContext({ user });
    captureApiCall({ method: 'GET', url: '/dup', status: 500, durationMs: 1 });
    captureApiCall({ method: 'GET', url: '/dup', status: 500, durationMs: 1 });
    expect(monitorStats().raw).toBe(1);
  });

  it('attaches at most the configured number of breadcrumbs, newest kept, and formats api crumbs', async () => {
    await start({ breadcrumbs: 3 });
    setMonitorContext({ user });
    for (let i = 0; i < 6; i += 1) addBreadcrumb({ message: `c${i}` });
    captureApiCall({ method: 'GET', url: '/z?token=1', status: 200, durationMs: 4 });
    captureException(new Error('x'));
    await flushNow();
    const crumbs = sent()[0].events[0].breadcrumbs;
    expect(crumbs.map((c) => c.message)).toEqual(['c4', 'c5', 'GET /z?token=[redacted] → 200 (4 ms)']);
  });
});

describe('sign-in, queue and failure', () => {
  it('holds events until someone is signed in, then sends them', async () => {
    await start();
    captureException(new Error('early'));
    await flushNow();
    expect(apiMock).not.toHaveBeenCalled();
    expect(monitorStats().queued).toBe(1);
    expect(JSON.parse(store.get(KitKeys.monitorQueue)!)).toHaveLength(1);

    setMonitorContext({ user });
    await flushNow();
    expect(sent()[0].events.map((e) => e.message)).toEqual(['early']);
    expect(monitorStats().queued).toBe(0);
    expect(store.has(KitKeys.monitorQueue)).toBe(false);
  });

  it('reloads a persisted queue on the next launch', async () => {
    await start();
    captureException(new Error('survives'));
    await flushNow();
    const saved = store.get(KitKeys.monitorQueue)!;
    resetMonitorForTests();
    store.set(KitKeys.monitorQueue, saved);
    await initState();
    expect(monitorStats().queued).toBe(1);
  });

  it('keeps events and backs off when the send fails', async () => {
    await start();
    setMonitorContext({ user });
    apiMock.mockRejectedValue(new Error('offline'));
    captureException(new Error('a'));
    await flushNow();
    expect(monitorStats().queued).toBe(1);
    expect(monitorStats().failures).toBe(1);
    expect(apiMock).toHaveBeenCalledTimes(1);

    captureException(new Error('b'));
    await flushNow(); // inside the back-off window: queued, not sent
    expect(apiMock).toHaveBeenCalledTimes(1);
    expect(monitorStats().queued).toBe(2);
  });

  it('caps the offline queue at 100 events', async () => {
    await start({ maxEventsPerSession: 1000 });
    for (let i = 0; i < 150; i += 1) {
      captureException(new Error(`distinct ${i}`));
      if (i % 50 === 49) await flushNow();
    }
    await flushNow();
    expect(monitorStats().queued).toBe(100);
    expect(monitorStats().queue[99].message).toBe('distinct 149');
  });

  it('sends in batches of at most 50 events', async () => {
    await start({ maxEventsPerSession: 1000 });
    for (let i = 0; i < 100; i += 1) captureException(new Error(`e${i}`));
    setMonitorContext({ user });
    await flushNow();
    expect(sent().map((p) => p.events.length)).toEqual([50, 50]);
  });

  it('nextChunk stops at the byte limit but always returns one event', () => {
    const big = (n: number) => ({ id: String(n), message: 'x'.repeat(300 * 1024) }) as unknown as MonitorEvent;
    expect(nextChunk([big(1), big(2), big(3)])).toHaveLength(1);
    expect(nextChunk([])).toHaveLength(0);
  });
});

describe('dedupe and caps', () => {
  it('folds repeats of one error inside 60 s into a count', async () => {
    await start();
    setMonitorContext({ user });
    for (let i = 0; i < 5; i += 1) captureException(new Error('same'));
    captureException(new Error('other'));
    await flushNow();
    const evs = sent()[0].events;
    expect(evs).toHaveLength(2);
    expect(evs[0].message).toBe('same');
    expect(evs[0].count).toBe(5);
    expect(evs[1].count).toBeUndefined();
  });

  it('groups api failures by route template, not by id', () => {
    expect(pathTemplate('https://s/api/resource/Item/ITEM-00012?x=1')).toBe('/api/resource/Item/:id');
    expect(pathTemplate('/api/resource/Sales Order/42')).toBe('/api/resource/Sales Order/:id');
  });

  it('stops after the per-session cap', async () => {
    await start({ maxEventsPerSession: 3 });
    setMonitorContext({ user });
    for (let i = 0; i < 10; i += 1) captureException(new Error(`n${i}`));
    await flushNow();
    expect(sent()[0].events).toHaveLength(3);
    expect(monitorStats().droppedForCap).toBe(7);
  });
});

describe('kill switch', () => {
  it('stops capture, clears what waits, and is remembered', async () => {
    await start();
    captureException(new Error('waiting'));
    await flushNow();
    await setMonitoringEnabled(false);
    expect(store.get(KitKeys.monitorEnabled)).toBe('0');
    expect(store.has(KitKeys.monitorQueue)).toBe(false);
    captureException(new Error('ignored'));
    expect(monitorStats().raw).toBe(0);

    resetMonitorForTests();
    await initState();
    expect(monitorStats().enabled).toBe(false);
    await setMonitoringEnabled(true);
    captureException(new Error('back'));
    expect(monitorStats().raw).toBe(1);
  });

  it('monitor.enabled=false starts switched off', async () => {
    await start({ enabled: false });
    captureException(new Error('x'));
    expect(monitorStats().raw).toBe(0);
  });
});

describe('buildEvent', () => {
  it('turns a thrown non-Error into a message', async () => {
    await start();
    const e = buildEvent({ t: 'error', ts: Date.now(), err: { code: 7 }, fatal: false }, {});
    expect(e.message).toBe('{"code":7}');
    const f = buildEvent({ t: 'error', ts: Date.now(), err: 'plain', fatal: true }, {});
    expect(f).toMatchObject({ kind: 'crash', level: 'fatal', fatal: true, message: 'plain' });
  });
  it('redacts secret keys in extra', async () => {
    await start();
    const e = buildEvent({ t: 'error', ts: 1, err: new Error('x'), fatal: false, extra: { token: 't', ok: 1 } }, {});
    expect(e.extra).toEqual({ token: '[redacted]', ok: 1 });
  });
});

describe('a server that is not taking reports yet', () => {
  const PAUSED = { message: { accepted: 0, dropped: 2, next_flush_ms: 3_600_000, paused: true, reason: 'app is not registered yet' } };

  it('keeps the events (and the saved copy) while it says paused, and sends them on a later flush', async () => {
    await start();
    setMonitorContext({ user });
    apiMock.mockResolvedValue(PAUSED);
    captureException(new Error('first'));
    captureMessage('second', 'warning');
    await flushNow();
    expect(apiMock).toHaveBeenCalledTimes(1);
    expect(monitorStats().queued).toBe(2);
    expect(JSON.parse(store.get(KitKeys.monitorQueue)!)).toHaveLength(2);

    apiMock.mockResolvedValue({ message: { accepted: 2, dropped: 0, next_flush_ms: 30_000 } });
    await flushNow();
    expect(apiMock).toHaveBeenCalledTimes(2);
    expect(sent()[1].events.map((e) => e.message)).toEqual(['first', 'second']);
    expect(monitorStats().queued).toBe(0);
    expect(store.has(KitKeys.monitorQueue)).toBe(false);
  });

  it('discards a batch the server took nothing from when it did not say paused (the events were bad)', async () => {
    await start();
    setMonitorContext({ user });
    apiMock.mockResolvedValue({ message: { accepted: 0, dropped: 1, next_flush_ms: 1_800_000 } });
    captureException(new Error('malformed'));
    await flushNow();
    expect(monitorStats().queued).toBe(0);
    expect(apiMock).toHaveBeenCalledTimes(1);
  });

  it('a pause part-way through keeps only what was not yet accepted', async () => {
    await start({ maxEventsPerSession: 500 });
    setMonitorContext({ user });
    apiMock.mockResolvedValueOnce({ message: { accepted: 50, dropped: 0, next_flush_ms: 30_000 } }).mockResolvedValue(PAUSED);
    for (let i = 0; i < 60; i += 1) captureMessage(`m${i}`, 'info');
    await flushNow();
    expect(apiMock).toHaveBeenCalledTimes(2);
    expect(monitorStats().queued).toBe(10);
    expect(monitorStats().queue[0].message).toBe('m50');
  });
});

describe('flush ordering', () => {
  function gateRegistration() {
    const order: string[] = [];
    let finish: (v: unknown) => void = () => {};
    apiMock.mockImplementation((req: { url: string }) => {
      if (req.url.includes('register_install')) {
        order.push('register');
        return new Promise((r) => {
          finish = r;
        });
      }
      order.push('ingest');
      return Promise.resolve({ message: { accepted: 1, dropped: 0 } });
    });
    return { order, finish: (v: unknown) => finish(v) };
  }

  it('the first send waits for the launch registration, so an older server has the app when the report lands', async () => {
    await start();
    resetReportState();
    setMonitorContext({ user });
    const gate = gateRegistration();
    const registered = reportInstall({ reason: 'launch', user: user.id });
    captureException(new Error('first crash'));
    const flushed = flushNow();
    await new Promise((r) => setTimeout(r, 80));
    expect(gate.order).toEqual(['register']); // the crash report has not gone out
    gate.finish({ message: { install_id: 'row-1' } });
    await registered;
    await flushed;
    expect(gate.order).toEqual(['register', 'ingest']);
    expect(monitorStats().queued).toBe(0);
  });

  it('sends straight away when no launch registration is running', async () => {
    await start();
    resetReportState();
    setMonitorContext({ user });
    captureException(new Error('x'));
    await flushNow();
    expect(apiMock).toHaveBeenCalledTimes(1);
  });

  it('a fatal error does not wait for it: the process may be gone in a moment', async () => {
    await start();
    resetReportState();
    setMonitorContext({ user });
    const gate = gateRegistration();
    void reportInstall({ reason: 'launch', user: user.id });
    captureFatal(new Error('crash'));
    await new Promise((r) => setTimeout(r, 80));
    expect(gate.order).toContain('ingest');
    const ingest = apiMock.mock.calls.map((c) => c[0]).find((r) => String(r.url).includes('monitor.ingest'));
    expect(JSON.parse(ingest.data.payload).events[0]).toMatchObject({ kind: 'crash', level: 'fatal' });
  });
});
