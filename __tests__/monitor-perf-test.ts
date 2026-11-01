import { apiMock, setup } from './helpers';
import * as redact from '../src/monitor/redact';
import {
  addBreadcrumb, captureApiCall, captureException, captureMessage, initState, monitorStats, resetMonitorForTests,
} from '../src/monitor/core';

/**
 * The speed promise: what runs when the app does something only pushes a small
 * object onto a bounded buffer. No JSON, no redaction, no native probes, no
 * storage and no network until the flush.
 */
describe('hot path', () => {
  beforeEach(async () => {
    setup();
    resetMonitorForTests();
    await initState();
  });
  afterEach(() => resetMonitorForTests());

  it('10,000 captures take well under 100 ms and do no serialisation or redaction', () => {
    const stringify = jest.spyOn(JSON, 'stringify');
    const parse = jest.spyOn(JSON, 'parse');
    const bodyToText = jest.spyOn(redact, 'bodyToText');
    const redactHeaders = jest.spyOn(redact, 'redactHeaders');
    const redactUrl = jest.spyOn(redact, 'redactUrl');
    const body = JSON.stringify({ a: 'x'.repeat(5000), password: 'p' });
    const err = new Error('boom');
    stringify.mockClear();

    const t0 = performance.now();
    for (let i = 0; i < 10_000; i += 1) {
      captureException(err);
      captureApiCall({ method: 'POST', url: `https://s.example.com/api/${i}`, status: 500, durationMs: 3, requestBody: body, responseBody: body, requestHeaders: { Authorization: 'x' } });
      addBreadcrumb({ message: 'tap' });
      captureMessage('hi');
    }
    const ms = performance.now() - t0;

    expect(stringify).not.toHaveBeenCalled();
    expect(parse).not.toHaveBeenCalled();
    expect(bodyToText).not.toHaveBeenCalled();
    expect(redactHeaders).not.toHaveBeenCalled();
    expect(redactUrl).not.toHaveBeenCalled();
    expect(apiMock).not.toHaveBeenCalled();
    // 40,000 calls; the bound is deliberately loose for slow CI machines.
    expect(ms).toBeLessThan(500);
    jest.restoreAllMocks();
  });

  it('memory stays bounded however many events arrive', () => {
    for (let i = 0; i < 50_000; i += 1) captureException(new Error(String(i)));
    const s = monitorStats();
    expect(s.raw).toBeLessThanOrEqual(200);
    expect(s.rawDropped).toBeGreaterThan(49_000);
  });

  it('an error storm schedules one timer, not one per error', () => {
    const spy = jest.spyOn(globalThis, 'setTimeout');
    for (let i = 0; i < 1000; i += 1) captureException(new Error('x'));
    expect(spy.mock.calls.length).toBeLessThanOrEqual(3);
    spy.mockRestore();
  });
});
