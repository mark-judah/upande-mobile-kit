/**
 * Dev-only check that the kit's pages are what renders at their routes.
 *
 * Expo Router treats route groups like `(tabs)` as invisible, so
 * `app/(tabs)/settings.tsx` and `app/settings.tsx` are the same URL, and only
 * one of them renders. When that is the app's own screen the kit's Settings
 * page silently never appears. The kit's screens register themselves when they
 * mount; if the current path is a kit route and no kit screen mounted for it
 * shortly after, this says so once.
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
  const file = kind === 'settings' ? 'settings' : 'devices';
  return (
    `[@upande/mobile-kit] "${route}" is being rendered by another screen, not the kit's ${kind === 'settings' ? 'Settings' : 'Devices'} page. ` +
    `Expo Router ignores route groups like (tabs), so app/(tabs)/${file}.tsx and app/${file}.tsx are the same URL and only one renders. ` +
    `Fix: put the kit's page on another path (e.g. app/kit-${file}.tsx) and set configureMobileKit({ ${kind}Route: '/kit-${file}' }), ` +
    `or rename/remove the other screen. Run \`npx upande-mobile-kit doctor\` to list the conflicting files.`
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
