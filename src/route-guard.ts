/**
 * Dev-only check that the kit's pages are what renders at their routes.
 *
 * The kit's pages live under their own `/mobile-kit/` folder, so a collision should be impossible. This is
 * the safety net for the case where something still renders at that path: the kit's screens register when
 * they mount; if the current path is a kit route and no kit screen mounted for it shortly after, this says
 * so once.
 */

export type KitScreenKind = 'settings' | 'devices';

const mounted: Record<KitScreenKind, number> = { settings: 0, devices: 0 };

/** Called by a kit screen on mount; returns the unmount callback. */
export function registerKitScreen(kind: KitScreenKind): () => void {
  mounted[kind] += 1;
  return () => {
    mounted[kind] = Math.max(0, mounted[kind] - 1);
  };
}

export function isKitScreenMounted(kind: KitScreenKind): boolean {
  return mounted[kind] > 0;
}

export const ROUTE_CHECK_DELAY_MS = 1500;

const normalise = (path: string | null | undefined): string => {
  const p = String(path ?? '').split(/[?#]/)[0].replace(/\/+$/, '');
  return p === '' ? '/' : p;
};

export function collisionMessage(kind: KitScreenKind, route: string): string {
  return (
    `[@upande/mobile-kit] "${route}" is being rendered by another screen, not the kit's ${kind === 'settings' ? 'Settings' : 'Devices'} page. ` +
    `The kit's pages normally live under /mobile-kit/, so another file must be serving this path. ` +
    `Run \`npx upande-mobile-kit doctor\` to list it, then rename or remove it.`
  );
}

const warned = new Set<string>();

/**
 * Starts the check for `pathname`. Returns a cancel function, to be called when the path changes or the
 * provider unmounts. Warns at most once per route per process.
 */
export function watchKitRoute(
  pathname: string | null | undefined,
  routes: { settings: string; devices: string },
  opts: { delayMs?: number; warn?: (message: string) => void; setTimer?: typeof setTimeout; clearTimer?: typeof clearTimeout } = {},
): () => void {
  const here = normalise(pathname);
  const kind = (['settings', 'devices'] as const).find((k) => normalise(routes[k]) === here);
  if (!kind) return () => {};
  const warn = opts.warn ?? ((m: string) => console.warn(m));
  const timer = (opts.setTimer ?? setTimeout)(() => {
    if (isKitScreenMounted(kind) || warned.has(here)) return;
    warned.add(here);
    warn(collisionMessage(kind, here));
  }, opts.delayMs ?? ROUTE_CHECK_DELAY_MS);
  return () => (opts.clearTimer ?? clearTimeout)(timer);
}

/** For tests. */
export function resetRouteGuard(): void {
  mounted.settings = 0;
  mounted.devices = 0;
  warned.clear();
}
