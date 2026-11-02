import { setup } from './helpers';
import { cacheCredentials, errorParts, isSessionInvalid, recoverSession, resetSessionRecovery, withSessionRecovery } from '../src/session/recovery';
import { frappeErrorMessage } from '../src/defaults';
import { isForcedOffline, isOwnServer, noteNetworkResult, resetLinkHealth } from '../src/monitor/link-health';
import { captureApiCall, initState, resetMonitorForTests } from '../src/monitor/core';
import { refreshLatency, resetNetStats, setProbeSite } from '../src/monitor/net-stats';
import type { KitApi } from '../src/config';

const creds = { server: 'https://s.example.com', user: 'a@b.c', password: 'pw' };

describe('what counts as a dead session', () => {
  it('401 always; the Frappe families of 400, 403 and 417 too', () => {
    expect(isSessionInvalid(401, {})).toBe(true);
    expect(isSessionInvalid(400, { exc_type: 'CSRFTokenError' })).toBe(true);
    expect(isSessionInvalid(400, { exception: 'Invalid Request' })).toBe(true);
    expect(isSessionInvalid(403, { exc_type: 'AuthenticationError' })).toBe(true);
    expect(isSessionInvalid(403, { exception: 'frappe.exceptions.AuthenticationError: x' })).toBe(true);
    expect(isSessionInvalid(200, { session_expired: 1 })).toBe(true);
    expect(isSessionInvalid(417, { _server_messages: '["{\\"message\\": \\"Session Expired. Please login again\\"}"]' })).toBe(true);
  });
  it('a real permission error or an ordinary failure is not a dead session', () => {
    expect(isSessionInvalid(403, { exc_type: 'PermissionError', exception: 'Not permitted' })).toBe(false);
    expect(isSessionInvalid(500, { exception: 'boom' })).toBe(false);
    expect(isSessionInvalid(404, null)).toBe(false);
    expect(isSessionInvalid(null, undefined)).toBe(false);
  });
  it('reads status and body from an axios-style error or the kit’s own', () => {
    expect(errorParts({ response: { status: 401, data: { a: 1 } } })).toEqual({ status: 401, body: { a: 1 } });
    expect(errorParts({ status: 403, body: 'x' })).toEqual({ status: 403, body: 'x' });
    expect(errorParts(new Error('x'))).toEqual({ status: null, body: undefined });
  });
});

describe('silent re-login', () => {
  beforeEach(() => resetSessionRecovery());
  const dead = Object.assign(new Error('x'), { status: 401, body: {} });

  it('signs in again with the cached credentials and retries the call once', async () => {
    cacheCredentials(creds);
    const login = jest.fn(async () => {});
    const api = jest.fn().mockRejectedValueOnce(dead).mockResolvedValueOnce({ message: 'ok' });
    const wrapped = withSessionRecovery(api as unknown as KitApi, { login });
    await expect(wrapped({ method: 'GET', url: '/x' })).resolves.toEqual({ message: 'ok' });
    expect(login).toHaveBeenCalledWith(creds);
    expect(api).toHaveBeenCalledTimes(2);
  });

  it('gives up, reports the failure and rethrows when there are no credentials or the login fails', async () => {
    const onFailure = jest.fn();
    const api = jest.fn().mockRejectedValue(dead);
    const noCreds = withSessionRecovery(api as unknown as KitApi, { login: jest.fn(), onFailure });
    await expect(noCreds({ method: 'GET', url: '/x' })).rejects.toBe(dead);
    expect(onFailure).toHaveBeenCalledTimes(1);

    resetSessionRecovery();
    cacheCredentials(creds);
    const failing = withSessionRecovery(api as unknown as KitApi, { login: async () => { throw new Error('bad password'); }, onFailure });
    await expect(failing({ method: 'GET', url: '/x' })).rejects.toBe(dead);
    expect(onFailure).toHaveBeenCalledTimes(2);
  });

  it('retries only once: a second dead answer is returned, not looped', async () => {
    cacheCredentials(creds);
    const login = jest.fn(async () => {});
    const api = jest.fn().mockRejectedValue(dead);
    await expect(withSessionRecovery(api as unknown as KitApi, { login })({ method: 'GET', url: '/x' })).rejects.toBe(dead);
    expect(api).toHaveBeenCalledTimes(2);
    expect(login).toHaveBeenCalledTimes(1);
  });

  it('does not touch errors that are not a dead session', async () => {
    cacheCredentials(creds);
    const login = jest.fn();
    const boom = Object.assign(new Error('x'), { status: 500, body: {} });
    await expect(withSessionRecovery(jest.fn().mockRejectedValue(boom) as unknown as KitApi, { login })({ method: 'GET', url: '/x' })).rejects.toBe(boom);
    expect(login).not.toHaveBeenCalled();
  });

  it('a burst of failing calls shares one login', async () => {
    cacheCredentials(creds);
    let release!: () => void;
    const login = jest.fn(() => new Promise<void>((r) => { release = r; }));
    const a = recoverSession(login);
    const b = recoverSession(login);
    release();
    expect(await a).toBe(true);
    expect(await b).toBe(true);
    expect(login).toHaveBeenCalledTimes(1);
  });

  it('is wired into the config: the kit’s own api recovers when `sessionRecovery` is given', async () => {
    cacheCredentials(creds);
    const login = jest.fn(async () => {});
    const raw = jest.fn().mockRejectedValueOnce(dead).mockResolvedValueOnce({ message: 'fine' });
    setup({ api: raw as unknown as KitApi, sessionRecovery: { login } });
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getConfig } = require('../src/config');
    await expect(getConfig().api({ method: 'GET', url: '/x' })).resolves.toEqual({ message: 'fine' });
    expect(login).toHaveBeenCalledTimes(1);
  });
});

describe('readable Frappe errors', () => {
  it('prefers the first server message, then message, then the text after the exception class', () => {
    expect(frappeErrorMessage({ _server_messages: '["{\\"message\\": \\"<b>Item</b> ITM-1 not found\\"}"]' })).toBe('Item ITM-1 not found');
    expect(frappeErrorMessage({ message: 'Bucket is already received' })).toBe('Bucket is already received');
    expect(frappeErrorMessage({ exception: 'frappe.exceptions.ValidationError: Shelf is full\n' })).toBe('Shelf is full');
    expect(frappeErrorMessage({ exc_type: 'x' })).toBeNull();
    expect(frappeErrorMessage('plain')).toBeNull();
    expect(frappeErrorMessage({ _server_messages: '{broken' })).toBeNull();
  });
});

describe('link health: judging the connection by what requests do', () => {
  beforeEach(() => {
    resetLinkHealth();
    resetNetStats();
    resetMonitorForTests();
    setup({ site: 'https://s.example.com' });
  });

  it('two unreached requests in a row mean offline, whatever the OS says; one answer clears it', () => {
    noteNetworkResult(false);
    expect(isForcedOffline()).toBe(false);
    noteNetworkResult(false);
    expect(isForcedOffline()).toBe(true);
    noteNetworkResult(true);
    expect(isForcedOffline()).toBe(false);
    noteNetworkResult(false);
    noteNetworkResult(true);
    noteNetworkResult(false);
    expect(isForcedOffline()).toBe(false); // not consecutive
  });

  it('only the app’s own server counts: a relative URL does, another host does not', () => {
    expect(isOwnServer('/api/method/x', 'https://s.example.com')).toBe(true);
    expect(isOwnServer('https://s.example.com/api/x', 'https://s.example.com')).toBe(true);
    expect(isOwnServer('https://api.github.com/repos', 'https://s.example.com')).toBe(false);
    expect(isOwnServer('https://s.example.com/x', undefined)).toBe(false);
  });

  it('is fed by the monitor’s API capture, even with crash reporting off, and ignores other hosts and the probe', async () => {
    setup({ site: 'https://s.example.com', monitor: { enabled: true } });
    await initState();
    captureApiCall({ method: 'GET', url: 'https://api.github.com/x', status: null, durationMs: 5, error: 'offline' });
    captureApiCall({ method: 'GET', url: 'https://s.example.com/api/method/ping', status: null, durationMs: 5, error: 'offline' });
    expect(isForcedOffline()).toBe(false);
    captureApiCall({ method: 'POST', url: 'https://s.example.com/api/method/a', status: null, durationMs: 5, error: 'Network request failed' });
    captureApiCall({ method: 'POST', url: 'https://s.example.com/api/method/b', status: null, durationMs: 5, error: 'Network request failed' });
    expect(isForcedOffline()).toBe(true);
    captureApiCall({ method: 'POST', url: 'https://s.example.com/api/method/c', status: 500, durationMs: 5 }); // the server answered: it is reachable
    expect(isForcedOffline()).toBe(false);
  });

  it('the server probe feeds it too, and `force` bypasses the one-a-minute limit', async () => {
    setProbeSite('https://s.example.com');
    const bad = jest.fn(async (_u: string) => { throw new Error('offline'); });
    refreshLatency('https://s.example.com', { fetchImpl: bad as never, now: () => 1 });
    await new Promise<void>((r) => setImmediate(() => r()));
    refreshLatency('https://s.example.com', { fetchImpl: bad as never, now: () => 2 });
    expect(bad).toHaveBeenCalledTimes(1); // inside the minute
    refreshLatency('https://s.example.com', { fetchImpl: bad as never, now: () => 3, force: true });
    await new Promise<void>((r) => setImmediate(() => r()));
    expect(bad).toHaveBeenCalledTimes(2);
    expect(isForcedOffline()).toBe(true);
    const good = jest.fn(async (_u: string) => ({}) as Response);
    refreshLatency('https://s.example.com', { fetchImpl: good as never, now: () => 4, force: true });
    await new Promise<void>((r) => setImmediate(() => r()));
    expect(isForcedOffline()).toBe(false);
  });
});
