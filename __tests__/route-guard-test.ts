import { collisionMessage, isKitScreenMounted, registerKitScreen, resetRouteGuard, ROUTE_CHECK_DELAY_MS, watchKitRoute } from '../src/route-guard';

const routes = { settings: '/settings', devices: '/devices' };

beforeEach(() => {
  resetRouteGuard();
  jest.useFakeTimers();
});
afterEach(() => jest.useRealTimers());

describe('route collision guard', () => {
  it('warns once when a kit route is current but the kit screen never mounted', () => {
    const warn = jest.fn();
    watchKitRoute('/settings', routes, { warn });
    expect(warn).not.toHaveBeenCalled();
    jest.advanceTimersByTime(ROUTE_CHECK_DELAY_MS + 1);
    expect(warn).toHaveBeenCalledTimes(1);
    const msg = warn.mock.calls[0][0] as string;
    expect(msg).toContain('"/settings" is being rendered by another screen');
    expect(msg).toContain('(tabs)');
    expect(msg).toContain("settingsRoute: '/kit-settings'");
    // the same route again (e.g. navigating away and back) does not repeat it
    watchKitRoute('/settings', routes, { warn });
    jest.advanceTimersByTime(ROUTE_CHECK_DELAY_MS + 1);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('stays quiet when the kit screen has mounted', () => {
    const warn = jest.fn();
    const unmount = registerKitScreen('settings');
    expect(isKitScreenMounted('settings')).toBe(true);
    watchKitRoute('/settings', routes, { warn });
    jest.advanceTimersByTime(ROUTE_CHECK_DELAY_MS + 1);
    expect(warn).not.toHaveBeenCalled();
    unmount();
    expect(isKitScreenMounted('settings')).toBe(false);
  });

  it('accepts a screen that mounts inside the delay', () => {
    const warn = jest.fn();
    watchKitRoute('/devices', routes, { warn });
    jest.advanceTimersByTime(500);
    registerKitScreen('devices');
    jest.advanceTimersByTime(ROUTE_CHECK_DELAY_MS);
    expect(warn).not.toHaveBeenCalled();
  });

  it('ignores other paths, and can be cancelled when the path changes', () => {
    const warn = jest.fn();
    watchKitRoute('/home', routes, { warn });
    const cancel = watchKitRoute('/devices', routes, { warn });
    cancel();
    jest.advanceTimersByTime(ROUTE_CHECK_DELAY_MS * 2);
    expect(warn).not.toHaveBeenCalled();
  });

  it('matches the configured route, ignoring a trailing slash and query', () => {
    const warn = jest.fn();
    watchKitRoute('/kit-settings/?tab=1', { settings: '/kit-settings', devices: '/kit-devices' }, { warn });
    jest.advanceTimersByTime(ROUTE_CHECK_DELAY_MS + 1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('"/kit-settings"');
  });

  it('a kit screen on one route does not excuse the other', () => {
    const warn = jest.fn();
    registerKitScreen('settings');
    watchKitRoute('/devices', routes, { warn });
    jest.advanceTimersByTime(ROUTE_CHECK_DELAY_MS + 1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(collisionMessage('devices', '/devices')).toContain('Devices page');
  });
});
