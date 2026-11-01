/**
 * expo-router route handling for the CLI: which URL a file under app/ serves,
 * whether the kit's pages would collide with a page the app already has, and
 * whether anything in the app links to them.
 *
 * Group folders like `(tabs)` are transparent (they do not appear in the URL),
 * so `app/(tabs)/settings.tsx` and `app/settings.tsx` both serve `/settings`.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

export const DEFAULT_ROUTES = { settings: '/settings', devices: '/devices' };
export const FALLBACK_ROUTES = { settings: '/kit-settings', devices: '/kit-devices' };

const SRC_EXT = /\.(tsx|ts|jsx|js)$/;
const KIT = '@upande/mobile-kit';

const isDir = (p) => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};
const posix = (p) => p.split('\\').join('/');

/** The folder that holds the routes: `app`, or `src/app` when that is where the app keeps them. */
export function appDir(root) {
  for (const d of ['app', 'src/app']) if (isDir(join(root, d))) return d;
  return 'app';
}

/** '' when `route` is usable for a kit page, otherwise what is wrong with it. */
export function validateRoute(route) {
  if (typeof route !== 'string' || !route.startsWith('/')) return 'A route starts with / (for example /kit-settings).';
  if (!/^\/[A-Za-z0-9][\w-]*(\/[A-Za-z0-9][\w-]*)*$/.test(route)) {
    return 'Use letters, digits, - and _ in each segment: no [dynamic] segments, (groups) or spaces.';
  }
  return '';
}

/** Where the file for `route` goes, relative to the app root: /kit-settings -> app/kit-settings.tsx. */
export const routeFileFor = (root, route) => `${appDir(root)}${route}.tsx`;

/**
 * The URL the file at `rel` (relative to the routes folder) serves, or null
 * when it is not a page (layouts, `+not-found`, `+html`, `foo+api` API routes,
 * non-source files).
 */
export function routeOfFile(rel) {
  const p = posix(rel);
  if (!SRC_EXT.test(p)) return null;
  const segs = p.replace(SRC_EXT, '').split('/');
  const last = segs[segs.length - 1];
  if (last === '_layout' || last.startsWith('+') || /\+(api|html|not-found)$/.test(last)) return null;
  const visible = segs.filter((s) => !/^\(.*\)$/.test(s));
  if (visible[visible.length - 1] === 'index') visible.pop();
  return `/${visible.join('/')}`;
}

function walk(dir, out = []) {
  let entries = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const e of entries.sort()) {
    if (e === 'node_modules' || e.startsWith('.')) continue;
    const full = join(dir, e);
    if (isDir(full)) walk(full, out);
    else out.push(full);
  }
  return out;
}

/** Every page under the routes folder: `[{ file: 'app/(tabs)/settings.tsx', url: '/settings' }]`. */
export function listRouteFiles(root) {
  const base = appDir(root);
  const out = [];
  for (const full of walk(join(root, base))) {
    const url = routeOfFile(relative(join(root, base), full));
    if (url !== null) out.push({ file: posix(join(base, relative(join(root, base), full))), url });
  }
  return out;
}

/** Does this file belong to the kit (re-exports one of its screens)? */
export function isKitFile(root, file) {
  try {
    return readFileSync(join(root, file), 'utf8').includes(KIT);
  } catch {
    return false;
  }
}

/**
 * Files that already serve `route` and are not the kit's own: another page at
 * the same URL (route groups ignored), or a folder of that name that has a layout.
 * @returns {{ file: string, url: string }[]}
 */
export function findCollisions(root, route) {
  const out = listRouteFiles(root).filter((f) => f.url === route && !isKitFile(root, f.file));
  const dirRel = `${appDir(root)}${route}`;
  if (isDir(join(root, dirRel))) {
    for (const e of readdirSync(join(root, dirRel))) {
      if (/^_layout\.(tsx|ts|jsx|js)$/.test(e) && !out.some((o) => o.file === `${dirRel}/${e}`)) out.push({ file: `${dirRel}/${e}`, url: route });
    }
  }
  return out;
}

/** The message shown when `route` is taken. */
export function describeCollision(route, collisions, flag) {
  const kind = route.replace(/^\//, '').split('/')[0];
  return [
    `${route} is already served by:`,
    ...collisions.map((c) => `  - ${c.file}`),
    `The kit's page would shadow it or be shadowed by it, so it would never show. Resolve it one of these ways:`,
    `  1. use another path for the kit's page:  ${flag} /kit-${kind}`,
    `  2. rename or remove the file(s) above and run again`,
    `  3. keep your own page and re-export the kit's screen from it:`,
    `       export { ${kind === 'devices' ? 'DevicesRoute' : 'SettingsRoute'} as default } from '${KIT}';`,
  ].join('\n');
}

/* ───────────────────────────── navigation ───────────────────────────── */

/** Source files of the app (not node_modules, not native folders), for scanning. */
export function sourceFiles(root, dirs = ['app', 'src']) {
  const out = [];
  for (const d of dirs) {
    for (const f of walk(join(root, d))) {
      if (SRC_EXT.test(f) && !/(^|\/)(__tests__|android|ios)\//.test(posix(relative(root, f)))) out.push(posix(relative(root, f)));
    }
  }
  return out;
}

const read = (root, rel) => {
  try {
    return readFileSync(join(root, rel), 'utf8');
  } catch {
    return '';
  }
};

/** Layouts that render an expo-router Drawer or Tabs navigator: `[{ file, dir, kind }]`. */
export function findNavigators(root) {
  const out = [];
  for (const f of listLayouts(root)) {
    const src = read(root, f);
    if (/<Drawer[\s>]/.test(src) && /<\/Drawer>/.test(src)) out.push({ file: f, dir: posix(dirname(f)), kind: 'Drawer' });
    else if (/<Tabs[\s>]/.test(src) && /<\/Tabs>/.test(src)) out.push({ file: f, dir: posix(dirname(f)), kind: 'Tabs' });
  }
  return out;
}

function listLayouts(root) {
  const base = appDir(root);
  return walk(join(root, base))
    .filter((f) => /\/_layout\.(tsx|jsx|js|ts)$/.test(posix(f)))
    .map((f) => posix(relative(root, f)));
}

/** The screen name a navigator in `layoutDir` would use for the page at `file` (null when it cannot hold it). */
export function screenNameFor(layoutDir, file) {
  const rel = posix(relative(layoutDir, file));
  if (rel.startsWith('..')) return null;
  return rel.replace(SRC_EXT, '');
}

/**
 * Add `<Drawer.Screen name=… />` / `<Tabs.Screen name=… />` before the closing
 * tag of the navigator, without touching any other line. Only when the closing
 * tag sits on its own line (a shape we recognise); otherwise leaves the source alone.
 * @returns {{ status: 'inserted' | 'already' | 'unrecognised', source: string }}
 */
export function insertNavEntry(source, kind, name, title = 'Settings') {
  if (new RegExp(`name=["']${name.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}["']`).test(source)) return { status: 'already', source };
  const close = `</${kind}>`;
  const first = source.indexOf(close);
  if (first === -1 || source.indexOf(close, first + 1) !== -1) return { status: 'unrecognised', source };
  const lineStart = source.lastIndexOf('\n', first) + 1;
  const ind = source.slice(lineStart, first);
  if (!/^[ \t]*$/.test(ind)) return { status: 'unrecognised', source };
  const lastScreen = [...source.slice(0, first).matchAll(new RegExp(`^([ \\t]*)<${kind}\\.Screen\\b`, 'gm'))].pop();
  const childInd = lastScreen ? lastScreen[1] : `${ind}  `;
  const entry = `${childInd}<${kind}.Screen name="${name}" options={{ title: '${title}' }} />\n`;
  return { status: 'inserted', source: source.slice(0, lineStart) + entry + source.slice(lineStart) };
}

/** What to add by hand when the navigator cannot be edited safely. */
export function navSnippet(route, nav, base = 'app') {
  const lines = [];
  if (nav) {
    const name = screenNameFor(nav.dir, `${base}${route}.tsx`);
    lines.push(`  In ${nav.file}, inside <${nav.kind}>:`, `    <${nav.kind}.Screen name="${name ?? route.replace(/^\//, '')}" options={{ title: 'Settings' }} />`, '  Or link to it from anywhere:');
  } else lines.push('  Link to it from anywhere (a menu item, a button):');
  lines.push("    import { Link, router } from 'expo-router';", `    <Link href="${route}">Settings</Link>        // or: router.push('${route}')`);
  return lines.join('\n');
}

/**
 * Files that link to `route` (a string literal of the path, or a navigator
 * screen named after it), ignoring the kit's own files and `ignore`.
 */
export function linkedFrom(root, route, ignore = []) {
  const name = route.replace(/^\//, '');
  const lit = new RegExp(`['"\`]${route.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}['"\`]`);
  const screen = new RegExp(`name=["']${name.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}["']`);
  return sourceFiles(root).filter((f) => {
    if (ignore.includes(f) || /(^|\/)mobile-kit\.ts$/.test(f) || isKitFile(root, f)) return false;
    const s = read(root, f);
    return lit.test(s) || (/_layout\./.test(f) && screen.test(s));
  });
}

/** The routes the app's `src/mobile-kit.ts` configures (defaults when not set). */
export function configuredRoutes(root) {
  const src = read(root, 'src/mobile-kit.ts');
  const pick = (key, def) => new RegExp(`^[ \\t]*${key}:[ \\t]*['"]([^'"]+)['"]`, 'm').exec(src)?.[1] ?? def;
  return { settings: pick('settingsRoute', DEFAULT_ROUTES.settings), devices: pick('devicesRoute', DEFAULT_ROUTES.devices) };
}

/** The root layout file (relative to the app root), or null. */
export function rootLayoutFile(root) {
  for (const e of ['tsx', 'jsx', 'js']) {
    const rel = `${appDir(root)}/_layout.${e}`;
    if (readFileSafe(join(root, rel)) !== null) return rel;
  }
  return null;
}

function readFileSafe(p) {
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}
