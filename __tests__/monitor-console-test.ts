import { setup } from './helpers';
import { initState, monitorStats, resetMonitorForTests, setMonitorContext, captureFatal, captureException } from '../src/monitor/core';
import {
  errorFromConsoleArgs, installConsoleBreadcrumbs, installConsoleErrors, installErrorHandler, installRejectionTracking, isErrorLike,
  isRejectionChained,
} from '../src/monitor/instrument';
import { startMonitor, stopMonitor } from '../src/monitor';

beforeEach(async () => {
  setup();
  resetMonitorForTests();
  await initState();
  setMonitorContext({ user: { id: 'u@example.com' } });
});
afterEach(() => {
  stopMonitor();
  resetMonitorForTests();
  delete (globalThis as { HermesInternal?: unknown }).HermesInternal;
  delete (globalThis as { ErrorUtils?: unknown }).ErrorUtils;
});

describe('isErrorLike / errorFromConsoleArgs', () => {
  it('accepts Errors and error-shaped objects, never plain strings or other objects', () => {
    expect(isErrorLike(new Error('x'))).toBe(true);
    expect(isErrorLike({ name: 'ApiError', message: 'bad' })).toBe(true);
    expect(isErrorLike({ message: 'm', stack: 's' })).toBe(true);
    expect(isErrorLike('Warning: each child needs a key')).toBe(false);
    expect(isErrorLike({ message: 'only a message' })).toBe(false);
    expect(isErrorLike({ code: 1 })).toBe(false);
    expect(isErrorLike(null)).toBe(false);
  });

  it('reports the first Error among the arguments, with a leading string as context', () => {
    const err = new Error('boom');
    expect(errorFromConsoleArgs([err])).toEqual({ error: err, extra: { source: 'console.error' } });
    expect(errorFromConsoleArgs(['Failed to load orders:', err])).toEqual({
      error: err, extra: { source: 'console.error', context: 'Failed to load orders:' },
    });
  });

  it('ignores plain strings and objects that are not errors (React render warnings and the like)', () => {
    expect(errorFromConsoleArgs(['Warning: Each child in a list should have a unique "key" prop.'])).toBeNull();
    expect(errorFromConsoleArgs(['msg', { a: 1 }, 42])).toBeNull();
    expect(errorFromConsoleArgs([])).toBeNull();
  });
});

describe('installConsoleErrors', () => {
  it('captures console.error(err), still calls the original, and restores it', () => {
    const original = jest.fn();
    const saved = console.error;
    console.error = original;
    const undo = installConsoleErrors();
    try {
      const err = new Error('caught and logged');
      console.error('Could not load', err);
      expect(original).toHaveBeenCalledWith('Could not load', err);
      expect(monitorStats().raw).toBe(1);
      console.error('Warning: plain string');
      console.error({ not: 'an error' });
      expect(monitorStats().raw).toBe(1);
      expect(original).toHaveBeenCalledTimes(3);
    } finally {
      undo();
    }
    expect(console.error).toBe(original);
    console.error = saved;
  });

  it('never throws into the caller, and never swallows the original’s own result', () => {
    const original = jest.fn(() => 'kept');
    const saved = console.error;
    console.error = original as never;
    const undo = installConsoleErrors();
    resetMonitorForTests(); // monitor state gone: the wrapper must still behave
    expect(() => console.error(new Error('x'))).not.toThrow();
    expect((console.error as unknown as (...a: unknown[]) => unknown)('s')).toBe('kept');
    undo();
    console.error = saved;
  });

  it('records one event when the same error is thrown and then logged', () => {
    const saved = console.error;
    console.error = jest.fn();
    const undo = installConsoleErrors();
    try {
      let handler: ((e: unknown, fatal?: boolean) => void) | undefined;
      (globalThis as { ErrorUtils?: unknown }).ErrorUtils = {
        getGlobalHandler: () => (e: unknown) => console.error(e), // React Native logs what it handled
        setGlobalHandler: (h: (e: unknown, fatal?: boolean) => void) => { handler = h; },
      };
      installErrorHandler();
      const err = new Error('thrown');
      handler!(err, false);
      expect(monitorStats().raw).toBe(1); // global handler, then console.error of the SAME object
      captureException(err); // and a third sighting
      expect(monitorStats().raw).toBe(1);
    } finally {
      undo();
      console.error = saved;
    }
  });

  it('a fatal still goes through even if the error was logged first', () => {
    captureException(new Error('seen')); // different object: unaffected
    const fatal = new Error('fatal');
    captureFatal(fatal);
    expect(monitorStats().raw).toBeGreaterThanOrEqual(1);
  });

  it('with console breadcrumbs on too, stopping the monitor restores the real console', () => {
    const realError = console.error;
    const realWarn = console.warn;
    setup({ monitor: { consoleBreadcrumbs: true } });
    startMonitor();
    expect(console.error).not.toBe(realError);
    stopMonitor();
    expect(console.error).toBe(realError);
    expect(console.warn).toBe(realWarn);
  });

  it('captureConsoleErrors: false leaves console.error alone', () => {
    const realError = console.error;
    setup({ monitor: { captureConsoleErrors: false } });
    startMonitor();
    expect(console.error).toBe(realError);
    stopMonitor();
  });
});

describe('unhandled promise rejections', () => {
  type Opts = { allRejections?: boolean; onUnhandled?: (id: unknown, e: unknown) => void; onHandled?: (id: unknown) => void };

  function hermes() {
    const enabled: Opts[] = [];
    (globalThis as { HermesInternal?: unknown }).HermesInternal = {
      hasPromise: () => true,
      enablePromiseRejectionTracker: (o: Opts) => enabled.push(o),
    };
    return enabled;
  }

  it('in development: reports first, then calls React Native’s own tracker so LogBox keeps working', () => {
    const enabled = hermes();
    const rn = { allRejections: true, onUnhandled: jest.fn(), onHandled: jest.fn() };
    installRejectionTracking({ rnOptions: () => rn });
    expect(enabled).toHaveLength(1);
    const err = new Error('nobody caught me');
    enabled[0].onUnhandled!(7, err);
    expect(monitorStats().raw).toBe(1);
    expect(rn.onUnhandled).toHaveBeenCalledWith(7, err);
    enabled[0].onHandled!(7);
    expect(rn.onHandled).toHaveBeenCalledWith(7);
    expect(isRejectionChained()).toBe(true);
  });

  it('a throwing tracker does not stop the original from running', () => {
    const enabled = hermes();
    const rn = { onUnhandled: jest.fn() };
    installRejectionTracking({ rnOptions: () => rn });
    resetMonitorForTests();
    expect(() => enabled[0].onUnhandled!(1, new Error('x'))).not.toThrow();
    expect(rn.onUnhandled).toHaveBeenCalled();
  });

  it('when React Native’s options cannot be found, development leaves its tracker alone and the warning line is reported instead', () => {
    const enabled = hermes();
    installRejectionTracking({ rnOptions: () => null });
    expect(enabled).toHaveLength(0);
    expect(isRejectionChained()).toBe(false);

    const warning = 'Possible Unhandled Promise Rejection (id: 3):\nError: lost in a promise\n    at foo (app.js:1)';
    const hit = errorFromConsoleArgs([warning], 'warn');
    expect(hit?.error).toMatchObject({ name: 'UnhandledPromiseRejection' });
    expect((hit!.error as Error).message).toContain('lost in a promise');
    expect(hit?.extra).toMatchObject({ source: 'console.warn', unhandledRejection: true });
    expect(errorFromConsoleArgs(['some other warning'], 'warn')).toBeNull();

    const saved = console.warn;
    const original = jest.fn();
    console.warn = original;
    const undo = installConsoleErrors();
    console.warn(warning);
    expect(monitorStats().raw).toBe(1);
    expect(original).toHaveBeenCalledWith(warning);
    undo();
    console.warn = saved;
  });

  it('once chained, the warning line is not turned into a second report', () => {
    hermes();
    installRejectionTracking({ rnOptions: () => ({ onUnhandled: jest.fn() }) });
    expect(errorFromConsoleArgs(['Possible Unhandled Promise Rejection (id: 3):\nError: x'], 'warn')).toBeNull();
  });
});
