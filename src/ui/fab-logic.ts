import type { KitFabOptions } from '../config';

/**
 * The pure rules behind the floating Settings button: whether it shows, where it sits, which edge it snaps to,
 * and how its position is saved. No React here, so each rule is tested on its own.
 */

export const FAB_SIZE = 48;
export const FAB_MARGIN = 12;
export const FAB_DEFAULT_BOTTOM = 96;
/** Movement under this many dp between touch-down and release is a tap, not a drag. */
export const FAB_TAP_SLOP = 6;

export type FabSide = 'left' | 'right';
export type FabPlacement = { side: FabSide; bottom: number };
export type FabSettings = { enabled: boolean; initialSide: FabSide; bottom: number; whenSignedOut: boolean };

/** The config's `fab` value as settings. `isDev` is `__DEV__`. */
export function resolveFab(fab: boolean | 'dev' | KitFabOptions | undefined, isDev: boolean): FabSettings {
  const base = { initialSide: 'right' as FabSide, bottom: FAB_DEFAULT_BOTTOM, whenSignedOut: false };
  if (fab === false) return { enabled: false, ...base };
  if (fab === 'dev') return { enabled: isDev, ...base };
  if (fab && typeof fab === 'object') {
    return {
      enabled: true,
      initialSide: fab.initialSide === 'left' ? 'left' : 'right',
      bottom: typeof fab.bottom === 'number' && Number.isFinite(fab.bottom) ? Math.max(0, fab.bottom) : base.bottom,
      whenSignedOut: fab.whenSignedOut === true,
    };
  }
  return { enabled: true, ...base };
}

const normalise = (path: string | null | undefined): string => {
  const p = String(path ?? '').split(/[?#]/)[0].replace(/\/+$/, '');
  return p === '' ? '/' : p;
};

/** True on the kit's own pages (its Settings / Devices routes, or anything under /mobile-kit/). */
export function isKitPath(pathname: string | null | undefined, routes: { settings: string; devices: string }): boolean {
  const p = normalise(pathname);
  return p === normalise(routes.settings) || p === normalise(routes.devices) || p === '/mobile-kit' || p.startsWith('/mobile-kit/');
}

export function fabVisible(a: {
  settings: FabSettings;
  pathname: string | null | undefined;
  routes: { settings: string; devices: string };
  keyboardOpen: boolean;
  /** True when the app's own `useAuth` says nobody is signed in (never true on the kit's stand-in auth). */
  signedOut?: boolean;
}): boolean {
  if (a.signedOut && !a.settings.whenSignedOut) return false;
  return a.settings.enabled && !a.keyboardOpen && !isKitPath(a.pathname, a.routes);
}

/** The screen edge a button dropped with its centre at `centerX` snaps to. */
export function snapSide(centerX: number, windowWidth: number): FabSide {
  return centerX < windowWidth / 2 ? 'left' : 'right';
}

/** Left edge (dp) of the button on a side. */
export function leftFor(side: FabSide, windowWidth: number): number {
  return side === 'left' ? FAB_MARGIN : Math.max(FAB_MARGIN, windowWidth - FAB_SIZE - FAB_MARGIN);
}

/** Keep the button fully on screen and clear of the status bar / home indicator. */
export function clampBottom(bottom: number, windowHeight: number, insets: { top: number; bottom: number }): number {
  const min = insets.bottom + FAB_MARGIN;
  const max = Math.max(min, windowHeight - insets.top - FAB_SIZE - FAB_MARGIN);
  return Math.min(max, Math.max(min, bottom));
}

/** Top edge (dp) for a `bottom` distance. */
export function topFor(bottom: number, windowHeight: number): number {
  return windowHeight - bottom - FAB_SIZE;
}

/** Where a drag that started at `from` and moved by (dx, dy) ends, as a placement. */
export function placementAfterDrag(
  from: { left: number; top: number },
  move: { dx: number; dy: number },
  win: { width: number; height: number },
  insets: { top: number; bottom: number },
): FabPlacement {
  const centerX = from.left + move.dx + FAB_SIZE / 2;
  const bottom = win.height - (from.top + move.dy) - FAB_SIZE;
  return { side: snapSide(centerX, win.width), bottom: clampBottom(bottom, win.height, insets) };
}

export const isTap = (dx: number, dy: number): boolean => Math.abs(dx) < FAB_TAP_SLOP && Math.abs(dy) < FAB_TAP_SLOP;

export function encodePlacement(p: FabPlacement): string {
  return JSON.stringify({ side: p.side, bottom: Math.round(p.bottom) });
}

export function decodePlacement(raw: string | null | undefined): FabPlacement | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { side?: unknown; bottom?: unknown };
    if ((v.side === 'left' || v.side === 'right') && typeof v.bottom === 'number' && Number.isFinite(v.bottom)) {
      return { side: v.side, bottom: v.bottom };
    }
  } catch {
    // unreadable: use the default
  }
  return null;
}

/** How long a press must last to count as a long-press, ms. */
export const FAB_LONG_PRESS_MS = 600;

/** A press held still for `FAB_LONG_PRESS_MS` or more. The floating button opens "Report a problem" on it. */
export const isLongPress = (heldMs: number): boolean => heldMs >= FAB_LONG_PRESS_MS;

/** How far through the long press the hold is, 0 to 1 (drives the ring that fills while the button is held). */
export const holdFraction = (heldMs: number): number => Math.min(1, Math.max(0, heldMs / FAB_LONG_PRESS_MS));
/** How often the hold ring redraws while the button is held. */
export const HOLD_TICK_MS = 40;
