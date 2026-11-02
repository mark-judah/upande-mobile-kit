import {
  clampBottom, decodePlacement, encodePlacement, FAB_DEFAULT_BOTTOM, FAB_MARGIN, FAB_SIZE, FAB_TAP_SLOP, fabVisible, isKitPath,
  isTap, leftFor, placementAfterDrag, resolveFab, snapSide, topFor,
} from '../src/ui/fab-logic';

const routes = { settings: '/mobile-kit/settings', devices: '/mobile-kit/devices' };
const insets = { top: 24, bottom: 16 };

describe('resolveFab', () => {
  it('is on by default, at the right edge', () => {
    expect(resolveFab(undefined, false)).toEqual({ enabled: true, initialSide: 'right', bottom: FAB_DEFAULT_BOTTOM, whenSignedOut: false });
    expect(resolveFab(true, false).enabled).toBe(true);
  });
  it('false hides it; "dev" shows it only in development builds', () => {
    expect(resolveFab(false, true).enabled).toBe(false);
    expect(resolveFab('dev', true).enabled).toBe(true);
    expect(resolveFab('dev', false).enabled).toBe(false);
  });
  it('an object keeps it on and sets the start; bad numbers fall back', () => {
    expect(resolveFab({ initialSide: 'left', bottom: 140 }, false)).toEqual({ enabled: true, initialSide: 'left', bottom: 140, whenSignedOut: false });
    expect(resolveFab({ bottom: Number.NaN }, false).bottom).toBe(FAB_DEFAULT_BOTTOM);
    expect(resolveFab({ bottom: -5 }, false).bottom).toBe(0);
  });
});

describe('isKitPath / fabVisible', () => {
  it('recognises the kit pages, with a query or trailing slash, and anything under /mobile-kit/', () => {
    expect(isKitPath('/mobile-kit/settings', routes)).toBe(true);
    expect(isKitPath('/mobile-kit/devices/', routes)).toBe(true);
    expect(isKitPath('/mobile-kit/settings?x=1', routes)).toBe(true);
    expect(isKitPath('/mobile-kit/anything', routes)).toBe(true);
    expect(isKitPath('/', routes)).toBe(false);
    expect(isKitPath('/settings', routes)).toBe(false); // the host's own page
    expect(isKitPath(null, routes)).toBe(false);
  });
  it('honours custom routes', () => {
    expect(isKitPath('/admin/kit', { settings: '/admin/kit', devices: '/admin/kit-devices' })).toBe(true);
  });
  const on = resolveFab(true, false);
  it('shows on host screens, hides on the kit pages, with the keyboard open, or when disabled', () => {
    expect(fabVisible({ settings: on, pathname: '/orders', routes, keyboardOpen: false })).toBe(true);
    expect(fabVisible({ settings: on, pathname: '/mobile-kit/settings', routes, keyboardOpen: false })).toBe(false);
    expect(fabVisible({ settings: on, pathname: '/orders', routes, keyboardOpen: true })).toBe(false);
    expect(fabVisible({ settings: resolveFab(false, false), pathname: '/orders', routes, keyboardOpen: false })).toBe(false);
  });
  it('hides before sign-in (the host gate would bounce the page), unless whenSignedOut is set', () => {
    expect(fabVisible({ settings: on, pathname: '/login', routes, keyboardOpen: false, signedOut: true })).toBe(false);
    expect(fabVisible({ settings: on, pathname: '/orders', routes, keyboardOpen: false, signedOut: false })).toBe(true);
    expect(fabVisible({ settings: on, pathname: '/login', routes, keyboardOpen: false })).toBe(true); // stand-in auth: unknown, so shown
    const always = resolveFab({ whenSignedOut: true }, false);
    expect(fabVisible({ settings: always, pathname: '/login', routes, keyboardOpen: false, signedOut: true })).toBe(true);
    expect(resolveFab(true, false).whenSignedOut).toBe(false);
  });
});

describe('placement', () => {
  it('snaps to the nearest side', () => {
    expect(snapSide(10, 360)).toBe('left');
    expect(snapSide(179, 360)).toBe('left');
    expect(snapSide(180, 360)).toBe('right');
    expect(snapSide(350, 360)).toBe('right');
  });
  it('puts the button a margin from the chosen edge', () => {
    expect(leftFor('left', 360)).toBe(FAB_MARGIN);
    expect(leftFor('right', 360)).toBe(360 - FAB_SIZE - FAB_MARGIN);
    expect(leftFor('right', 10)).toBe(FAB_MARGIN); // a tiny window never goes negative
  });
  it('keeps it on screen between the insets', () => {
    expect(clampBottom(-50, 800, insets)).toBe(insets.bottom + FAB_MARGIN);
    expect(clampBottom(5000, 800, insets)).toBe(800 - insets.top - FAB_SIZE - FAB_MARGIN);
    expect(clampBottom(200, 800, insets)).toBe(200);
  });
  it('a drag ends on the nearest side at the dropped height', () => {
    const win = { width: 360, height: 800 };
    const from = { left: leftFor('right', 360), top: topFor(96, 800) };
    // drag far left and up 100: left side, 100 more from the bottom
    expect(placementAfterDrag(from, { dx: -280, dy: -100 }, win, insets)).toEqual({ side: 'left', bottom: 196 });
    // a small nudge stays on the right
    expect(placementAfterDrag(from, { dx: -20, dy: 0 }, win, insets)).toEqual({ side: 'right', bottom: 96 });
    // dragged off the bottom: clamped above the home indicator
    expect(placementAfterDrag(from, { dx: 0, dy: 900 }, win, insets).bottom).toBe(insets.bottom + FAB_MARGIN);
  });
  it('tells a tap from a drag', () => {
    expect(isTap(0, 0)).toBe(true);
    expect(isTap(FAB_TAP_SLOP - 1, -(FAB_TAP_SLOP - 1))).toBe(true);
    expect(isTap(FAB_TAP_SLOP, 0)).toBe(false);
    expect(isTap(0, -20)).toBe(false);
  });
});

describe('saved position', () => {
  it('round-trips', () => {
    expect(decodePlacement(encodePlacement({ side: 'left', bottom: 123.6 }))).toEqual({ side: 'left', bottom: 124 });
  });
  it('ignores anything unreadable', () => {
    for (const bad of [null, undefined, '', 'nope', '{}', '{"side":"top","bottom":1}', '{"side":"left","bottom":"x"}', '{"side":"left","bottom":null}']) {
      expect(decodePlacement(bad as string)).toBeNull();
    }
  });
});

describe('long-press hold ring', () => {
  const { holdFraction, FAB_LONG_PRESS_MS } = require('../src/ui/fab-logic');
  it('fills from 0 to 1 over the long-press time and never leaves that range', () => {
    expect(holdFraction(0)).toBe(0);
    expect(holdFraction(FAB_LONG_PRESS_MS / 2)).toBeCloseTo(0.5);
    expect(holdFraction(FAB_LONG_PRESS_MS)).toBe(1);
    expect(holdFraction(FAB_LONG_PRESS_MS * 3)).toBe(1);
    expect(holdFraction(-50)).toBe(0);
  });
});
