import { activityOf, litDots, RING_DOTS, ringDots } from '../src/ui/ring-logic';
import { apiTimingSummary, PING_PATH, recordApiTiming, refreshLatency, lastLatencyMs, resetNetStats, setProbeSite, getProbeSite } from '../src/monitor/net-stats';

describe('progress ring geometry', () => {
  it('puts the first dot at 12 o’clock and spreads the rest on a circle', () => {
    const d = ringDots(100, 4);
    expect(d).toHaveLength(RING_DOTS);
    expect(d[0].left).toBeCloseTo(48);
    expect(d[0].top).toBeCloseTo(0);
    const q = d[RING_DOTS / 4]; // a quarter turn: 3 o'clock
    expect(q.left).toBeCloseTo(96);
    expect(q.top).toBeCloseTo(48);
  });
  it('lights dots in proportion, at least one once started, all only at the end', () => {
    expect(litDots(null)).toBe(0);
    expect(litDots(0)).toBe(1);
    expect(litDots(0.5)).toBe(RING_DOTS / 2);
    expect(litDots(1)).toBe(RING_DOTS);
    expect(litDots(7)).toBe(RING_DOTS);
    expect(litDots(Number.NaN)).toBe(0);
  });
  it('prefers the APK download, falls back to a JS update, else nothing', () => {
    expect(activityOf({ apkDownloading: true, apkFraction: 0.4, otaDownloading: true })).toEqual({ kind: 'apk', fraction: 0.4 });
    expect(activityOf({ apkDownloading: true, apkFraction: undefined, otaDownloading: false })).toEqual({ kind: 'apk', fraction: null });
    expect(activityOf({ apkDownloading: false, apkFraction: null, otaDownloading: true })).toEqual({ kind: 'ota', fraction: null });
    expect(activityOf({ apkDownloading: false, apkFraction: null, otaDownloading: false })).toBeNull();
  });
});

describe('network stats', () => {
  beforeEach(resetNetStats);
  it('is empty until a call has been seen', () => {
    expect(apiTimingSummary()).toEqual({});
  });
  it('averages, takes the 95th percentile and counts failures', () => {
    for (let i = 1; i <= 20; i += 1) recordApiTiming(i * 10, i !== 20);
    const s = apiTimingSummary();
    expect(s.api_calls).toBe(20);
    expect(s.api_avg_ms).toBe(105);
    expect(s.api_p95_ms).toBe(190);
    expect(s.api_error_pct).toBe(5);
  });
  it('keeps only the newest 100 timings but counts every call', () => {
    for (let i = 0; i < 150; i += 1) recordApiTiming(i < 50 ? 5000 : 10, true);
    const s = apiTimingSummary();
    expect(s.api_calls).toBe(150);
    expect(s.api_avg_ms).toBe(10);
  });
  it('ignores garbage durations', () => {
    recordApiTiming(Number.NaN, true);
    recordApiTiming(-3, true);
    expect(apiTimingSummary()).toEqual({});
  });
  it('probes the server once a minute and remembers the answer', async () => {
    let t = 1000;
    const fetchImpl = jest.fn(async (_url: string) => {
      t += 80;
      return {} as Response;
    });
    refreshLatency('https://site.example.com/', { fetchImpl: fetchImpl as never, now: () => t });
    expect(fetchImpl.mock.calls[0][0]).toBe(`https://site.example.com${PING_PATH}`);
    await new Promise<void>((r) => setImmediate(() => r()));
    expect(lastLatencyMs()).toBe(80);
    refreshLatency('https://site.example.com', { fetchImpl: fetchImpl as never, now: () => t + 10_000 });
    expect(fetchImpl).toHaveBeenCalledTimes(1); // still fresh
    refreshLatency('https://site.example.com', { fetchImpl: fetchImpl as never, now: () => t + 61_000 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
  it('records a dead link as the timeout rather than as nothing', async () => {
    const fetchImpl = jest.fn(async (_url: string) => {
      throw new Error('offline');
    });
    refreshLatency('https://site.example.com', { fetchImpl: fetchImpl as never, now: () => 5 });
    await new Promise<void>((r) => setImmediate(() => r()));
    expect(lastLatencyMs()).toBe(4000);
  });
  it('does nothing without a site', () => {
    const fetchImpl = jest.fn();
    refreshLatency(undefined, { fetchImpl: fetchImpl as never });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('remembers the server the person actually uses', () => {
    setProbeSite('https://a.example.com');
    expect(getProbeSite()).toBe('https://a.example.com');
    setProbeSite(null);
    expect(getProbeSite()).toBeUndefined();
  });
});
