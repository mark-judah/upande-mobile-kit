import { captureApiCall, captureException, captureFatal, addBreadcrumb, monitorOptions } from './core';
import type { KitApi } from '../config';
import { rememberCrash } from '../support/crash-store';

/**
 * The hooks that feed the monitor. Each is installed once, chains to whatever
 * was there before, and does only O(1) work per event (see core.ts).
 */

type Undo = () => void;
const noop = () => {};

/* ── JavaScript errors ── */

type ErrorUtilsLike = {
  getGlobalHandler?: () => (e: unknown, fatal?: boolean) => void;
  setGlobalHandler?: (h: (e: unknown, fatal?: boolean) => void) => void;
};

export function installErrorHandler(): Undo {
  const eu = (globalThis as { ErrorUtils?: ErrorUtilsLike }).ErrorUtils;
  if (!eu?.setGlobalHandler) return noop;
  const previous = eu.getGlobalHandler?.();
  const handler = (error: unknown, isFatal?: boolean) => {
    try {
      if (isFatal) rememberCrash(error, { fatal: true, source: 'global' });
      if (isFatal) captureFatal(error);
      else captureException(error);
    } catch {
      // the monitor must never break error handling
    }
    previous?.(error, isFatal);
  };
  eu.setGlobalHandler(handler);
  return () => {
    if (previous) eu.setGlobalHandler?.(previous);
  };
}

type RejectionOptions = {
  allRejections?: boolean;
  onUnhandled?: (id: unknown, error: unknown) => void;
  onHandled?: (id: unknown) => void;
};

/** Whether rejections reach the monitor as real error objects (so the log-line fallback is not needed). */
let rejectionChained = false;
export function isRejectionChained(): boolean {
  return rejectionChained;
}

/**
 * Deliberately none: React Native's own tracker options live in an internal module whose path differs between
 * versions, and requiring a path that is absent makes Metro print a warning on every bundle. In development the
 * monitor therefore leaves React Native's tracker alone and turns the warning line it prints into a report
 * (`installConsoleErrors`); tests inject their own options.
 */
function reactNativeRejectionOptions(): RejectionOptions | null {
  return null;
}

/**
 * Promise rejections nobody handled, on Hermes' tracker or the `promise` polyfill's. In development React
 * Native has its own tracker feeding LogBox: this one chains to it (reports first, then calls it) instead of
 * replacing it. When the original options cannot be found, development leaves the tracker alone and the
 * warning line it prints is turned into a report by `installConsoleErrors`.
 */
export function installRejectionTracking(deps: { rnOptions?: () => RejectionOptions | null } = {}): Undo {
  rejectionChained = false;
  const rn = __DEV__ ? (deps.rnOptions ?? reactNativeRejectionOptions)() : null;
  if (__DEV__ && !rn) return noop;
  const options: RejectionOptions = {
    allRejections: true,
    onUnhandled: (id, error) => {
      try {
        captureException(error, { unhandledRejection: true });
      } catch {
        // ignore
      }
      rn?.onUnhandled?.(id, error);
    },
    onHandled: (id) => rn?.onHandled?.(id),
  };
  try {
    const h = (globalThis as { HermesInternal?: { hasPromise?: () => boolean; enablePromiseRejectionTracker?: (o: object) => void } }).HermesInternal;
    if (h?.hasPromise?.() && h.enablePromiseRejectionTracker) {
      h.enablePromiseRejectionTracker(options);
      rejectionChained = true;
      return noop;
    }
  } catch {
    // fall through to the polyfill
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- bundled with React Native
    require('promise/setimmediate/rejection-tracking').enable(options);
    rejectionChained = true;
  } catch {
    // not available: rejections are simply not reported
  }
  return noop;
}

/* ── console.error ── */

/** An Error, or something shaped like one (a name or stack, and a string message). Never a plain string. */
export function isErrorLike(v: unknown): v is { name?: string; message: string; stack?: string } {
  if (!v || typeof v !== 'object') return false;
  if (v instanceof Error) return true;
  const e = v as { message?: unknown; name?: unknown; stack?: unknown };
  return typeof e.message === 'string' && (typeof e.name === 'string' || typeof e.stack === 'string');
}

const UNHANDLED_REJECTION = /^Possible Unhandled Promise Rejection \(id: \d+\):\s*/;

/**
 * What a `console.error(...)` / `console.warn(...)` call should be reported as, or null. The first argument
 * that is an Error (or error-like) wins; a leading string rides along as context. Plain strings are not
 * reported: React and React Native print render warnings that way and they are not errors.
 */
export function errorFromConsoleArgs(args: unknown[], level: 'error' | 'warn' = 'error'): { error: unknown; extra: Record<string, unknown> } | null {
  if (level === 'warn') {
    const first = args[0];
    if (typeof first === 'string' && UNHANDLED_REJECTION.test(first) && !rejectionChained) {
      const err = new Error(first.replace(UNHANDLED_REJECTION, '').slice(0, 500) || 'Unhandled promise rejection');
      err.name = 'UnhandledPromiseRejection';
      return { error: err, extra: { source: 'console.warn', unhandledRejection: true } };
    }
    return null;
  }
  const found = args.find(isErrorLike);
  if (!found) return null;
  const extra: Record<string, unknown> = { source: 'console.error' };
  if (typeof args[0] === 'string') extra.context = args[0].slice(0, 300);
  return { error: found, extra };
}

/**
 * Report `console.error(err)` calls that carry an Error: apps catch errors and log them this way, so they would
 * never reach the global handler. Chains to the previous console method, never throws, and does only O(1)
 * work (see core.ts). In development it also turns React Native's unhandled-rejection warning into a report
 * when the rejection tracker could not be chained.
 */
export function installConsoleErrors(): Undo {
  const orig = { error: console.error, warn: console.warn };
  const wrap = (level: 'error' | 'warn') => {
    const original = orig[level] as (...a: unknown[]) => void;
    return function (this: unknown, ...args: unknown[]) {
      try {
        const hit = errorFromConsoleArgs(args, level);
        if (hit) captureException(hit.error, hit.extra);
      } catch {
        // the monitor must never break logging
      }
      return original.apply(this, args);
    };
  };
  const error = wrap('error');
  const warn = wrap('warn');
  console.error = error;
  console.warn = warn;
  return () => {
    if (console.error === error) console.error = orig.error;
    if (console.warn === warn) console.warn = orig.warn;
  };
}

/** console.warn / console.error as breadcrumbs (opt-in). Only the first string argument, cut, is kept. */
export function installConsoleBreadcrumbs(): Undo {
  const orig = { warn: console.warn, error: console.error };
  const wrap = (level: 'warn' | 'error') =>
    function (this: unknown, ...args: unknown[]) {
      addBreadcrumb({ type: 'console', message: `${level}: ${typeof args[0] === 'string' ? args[0] : '[object]'}` });
      return (orig[level] as (...a: unknown[]) => void).apply(this, args);
    };
  const warn = wrap('warn');
  const error = wrap('error');
  console.warn = warn;
  console.error = error;
  return () => {
    if (console.warn === warn) console.warn = orig.warn;
    if (console.error === error) console.error = orig.error;
  };
}

/* ── fetch ── */

type FetchFn = typeof fetch & { __kitWrapped?: boolean };

export function installFetchInterceptor(): Undo {
  const g = globalThis as { fetch?: FetchFn };
  const original = g.fetch;
  if (typeof original !== 'function' || original.__kitWrapped) return noop;

  const wrapped: FetchFn = function (this: unknown, input: RequestInfo | URL, init?: RequestInit) {
    const start = Date.now();
    const promise = original.call(this, input as never, init);
    // Refs only; the response is looked at after the app has had it. The caller gets the original promise.
    promise.then(
      (res) => {
        try {
          const failed = res.status >= 400;
          const url = typeof input === 'string' ? input : ((input as Request).url ?? String(input));
          const base = {
            method: init?.method ?? (input as Request).method ?? 'GET',
            url,
            status: res.status,
            durationMs: Date.now() - start,
            requestHeaders: init?.headers ?? (input as Request).headers,
            requestBody: init?.body,
            responseHeaders: res.headers,
          };
          if (failed && monitorOptions().captureBodies !== false) {
            // Clone now (before the app reads the body); read it later, off this path.
            const copy = res.clone();
            copy.text().then(
              (text) => captureApiCall({ ...base, responseBody: text.slice(0, 64 * 1024) }),
              () => captureApiCall(base),
            );
          } else {
            captureApiCall(base);
          }
        } catch {
          // never let the monitor affect a request
        }
      },
      (err) => {
        try {
          captureApiCall({
            method: init?.method ?? (input as Request)?.method ?? 'GET',
            url: typeof input === 'string' ? input : ((input as Request)?.url ?? String(input)),
            status: null,
            durationMs: Date.now() - start,
            requestHeaders: init?.headers,
            requestBody: init?.body,
            error: err instanceof Error ? err.message : String(err),
          });
        } catch {
          // ignore
        }
      },
    );
    return promise;
  } as FetchFn;
  wrapped.__kitWrapped = true;
  g.fetch = wrapped;
  return () => {
    if (g.fetch === wrapped) g.fetch = original;
  };
}

/* ── axios ── */

type AxiosConfigLike = { url?: string; baseURL?: string; method?: string; headers?: unknown; data?: unknown; __kitStart?: number };
type AxiosResponseLike = { status: number; headers?: unknown; data?: unknown; config?: AxiosConfigLike };
type AxiosErrorLike = { message?: string; config?: AxiosConfigLike; response?: AxiosResponseLike; code?: string };
/** Structural so a real `AxiosInstance` (any axios 1.x) fits without the kit depending on axios. */
export type AxiosLike = {
  interceptors: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- axios' own signatures are generic and version-specific
    request: { use: (onFulfilled: any, onRejected?: any) => number };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    response: { use: (onFulfilled: any, onRejected?: any) => number };
  };
};

function axiosUrl(c?: AxiosConfigLike): string {
  const url = c?.url ?? '';
  return /^[a-z]+:\/\//i.test(url) || !c?.baseURL ? url : c.baseURL.replace(/\/+$/, '') + '/' + url.replace(/^\/+/, '');
}

/** Record every call an axios instance makes. Returns a function that detaches nothing: interceptors are cheap. */
export function attachAxios(instance: AxiosLike): void {
  instance.interceptors.request.use(((config: AxiosConfigLike) => {
    config.__kitStart = Date.now();
    return config;
  }) as never);
  instance.interceptors.response.use(
    ((res: AxiosResponseLike) => {
      try {
        const c = res.config;
        captureApiCall({
          method: c?.method ?? 'GET', url: axiosUrl(c), status: res.status, durationMs: Date.now() - (c?.__kitStart ?? Date.now()),
        });
      } catch {
        // ignore
      }
      return res;
    }) as never,
    ((err: AxiosErrorLike) => {
      try {
        const c = err.config ?? err.response?.config;
        captureApiCall({
          method: c?.method ?? 'GET', url: axiosUrl(c), status: err.response?.status ?? null,
          durationMs: Date.now() - (c?.__kitStart ?? Date.now()),
          requestHeaders: c?.headers, requestBody: c?.data,
          responseHeaders: err.response?.headers, responseBody: err.response?.data,
          error: err.response ? undefined : (err.message ?? err.code ?? 'Network error'),
        });
      } catch {
        // ignore
      }
      return Promise.reject(err);
    }) as never,
  );
}

/** Wrap a `KitApi`-style client so its failures are reported (for a host client that is neither fetch nor axios). */
export function withMonitoring(api: KitApi): KitApi {
  return (async (req: Parameters<KitApi>[0]) => {
    const start = Date.now();
    try {
      return await api(req);
    } catch (err) {
      try {
        const e = err as { response?: { status?: number; data?: unknown; headers?: unknown }; status?: number; message?: string };
        captureApiCall({
          method: req.method, url: req.url, status: e.response?.status ?? e.status ?? null, durationMs: Date.now() - start,
          requestBody: req.data, responseBody: e.response?.data, responseHeaders: e.response?.headers,
          error: e.response || e.status ? undefined : (e.message ?? 'Network error'),
        });
      } catch {
        // ignore
      }
      throw err;
    }
  }) as KitApi;
}
