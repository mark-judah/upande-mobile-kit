import { setup } from './helpers';
import { initState, monitorStats, resetMonitorForTests, setMonitorContext } from '../src/monitor/core';
import {
  attachAxios, installConsoleBreadcrumbs, installErrorHandler, installFetchInterceptor, withMonitoring, type AxiosLike,
} from '../src/monitor/instrument';

beforeEach(async () => {
  setup();
  resetMonitorForTests();
  await initState();
  setMonitorContext({ user: { id: 'u@example.com' } });
});
afterEach(() => resetMonitorForTests());

describe('error handler', () => {
  it('captures, then chains to the previous handler', () => {
    let installed: ((e: unknown, fatal?: boolean) => void) | undefined;
    const previous = jest.fn();
    (globalThis as { ErrorUtils?: unknown }).ErrorUtils = {
      getGlobalHandler: () => previous,
      setGlobalHandler: (h: (e: unknown, fatal?: boolean) => void) => {
        installed = h;
      },
    };
    const undo = installErrorHandler();
    installed!(new Error('soft'), false);
    expect(monitorStats().raw).toBe(1);
    expect(previous).toHaveBeenCalledWith(expect.any(Error), false);
    installed!(new Error('hard'), true);
    expect(previous).toHaveBeenCalledTimes(2);
    undo();
    expect(installed).toBe(previous);
    delete (globalThis as { ErrorUtils?: unknown }).ErrorUtils;
  });

  it('does nothing where there is no ErrorUtils', () => {
    expect(() => installErrorHandler()()).not.toThrow();
  });
});

describe('fetch interceptor', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  function fakeResponse(status: number, body = '{"exc":"x"}') {
    const res: Record<string, unknown> = { status, headers: new Map([['content-type', 'application/json']]) };
    res.clone = () => ({ ...res, text: async () => body });
    res.text = async () => body;
    return res;
  }

  it('returns the original response untouched and records failures with the cloned body', async () => {
    const res = fakeResponse(500);
    globalThis.fetch = jest.fn(async () => res) as never;
    const undo = installFetchInterceptor();
    const got = await fetch('https://s.example.com/api/x', { method: 'POST', body: '{"pwd":"p"}', headers: { Authorization: 'a' } });
    expect(got).toBe(res);
    await new Promise((r) => setTimeout(r, 0));
    expect(monitorStats().raw).toBe(1);
    undo();
  });

  it('records a rejected fetch as a network failure and rethrows to the caller', async () => {
    globalThis.fetch = jest.fn(async () => {
      throw new TypeError('Network request failed');
    }) as never;
    const undo = installFetchInterceptor();
    await expect(fetch('https://s.example.com/a')).rejects.toThrow('Network request failed');
    await new Promise((r) => setTimeout(r, 0));
    expect(monitorStats().raw).toBe(1);
    undo();
  });

  it('does not record successful calls and wraps only once', async () => {
    globalThis.fetch = jest.fn(async () => fakeResponse(200)) as never;
    const undo = installFetchInterceptor();
    const wrapped = globalThis.fetch;
    const again = installFetchInterceptor();
    expect(globalThis.fetch).toBe(wrapped);
    await fetch('https://s.example.com/ok');
    await new Promise((r) => setTimeout(r, 0));
    expect(monitorStats().raw).toBe(0);
    again();
    undo();
  });
});

describe('axios helper', () => {
  function fakeAxios() {
    let ok: (r: never) => unknown = (r) => r;
    let bad: (e: never) => unknown = (e) => e;
    let req: (c: never) => unknown = (c) => c;
    const inst: AxiosLike = {
      interceptors: {
        request: { use: (f: typeof req) => ((req = f), 0) },
        response: { use: (f: typeof ok, g: typeof bad) => ((ok = f), (bad = g), 0) },
      },
    };
    return { inst, run: { req: (c: object) => req(c as never), ok: (r: object) => ok(r as never), bad: (e: object) => bad(e as never) } };
  }

  it('records HTTP errors with request and response, and rethrows', async () => {
    const { inst, run } = fakeAxios();
    attachAxios(inst);
    const config = run.req({ method: 'post', baseURL: 'https://s.example.com/', url: '/api/m', data: '{"a":1}', headers: { a: 'b' } });
    await expect(run.bad({ config, response: { status: 417, data: { exc: 'x' }, headers: {} } })).rejects.toBeTruthy();
    expect(monitorStats().raw).toBe(1);
  });

  it('records a network error (no response) and ignores successes', async () => {
    const { inst, run } = fakeAxios();
    attachAxios(inst);
    run.ok({ status: 200, config: { url: '/fine', method: 'get' } });
    expect(monitorStats().raw).toBe(0);
    await expect(run.bad({ config: { url: '/down', method: 'get' }, message: 'Network Error' })).rejects.toBeTruthy();
    expect(monitorStats().raw).toBe(1);
  });
});

describe('withMonitoring', () => {
  it('reports a failing client call and rethrows the same error', async () => {
    const boom = Object.assign(new Error('Request failed'), { response: { status: 403, data: { message: 'no' } } });
    const api = withMonitoring((async () => {
      throw boom;
    }) as never);
    await expect(api({ method: 'GET', url: '/api/method/x' })).rejects.toBe(boom);
    expect(monitorStats().raw).toBe(1);
  });
  it('passes successes through unrecorded', async () => {
    const api = withMonitoring((async () => ({ message: 1 })) as never);
    await expect(api({ method: 'GET', url: '/x' })).resolves.toEqual({ message: 1 });
    expect(monitorStats().raw).toBe(0);
  });
});

describe('console breadcrumbs', () => {
  it('records warn/error text as breadcrumbs without swallowing the log, and restores', () => {
    const w = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const undo = installConsoleBreadcrumbs();
    console.warn('careful', { a: 1 });
    expect(w).toHaveBeenCalledWith('careful', { a: 1 });
    undo();
    expect(console.warn).toBe(w);
    w.mockRestore();
  });
});
