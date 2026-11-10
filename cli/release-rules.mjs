/**
 * What decides "this release needs a new APK" instead of an over-the-air update, with no marker to remember.
 *
 * Two rules, both read from the app itself (nothing to install, no extra command):
 *
 *  1. THE NATIVE SURFACE. Every dependency whose package carries native code (an `android/` or `ios/` folder, an Expo module
 *     or a config plugin) is recorded with its installed version, plus the kit's own plugin files, the `patches/` folder and
 *     the native fields of app.json. The record is saved in app.json (`expo.extra.mobileKit.nativeBaseline`) every time an APK
 *     is built. When it differs from what is installed now, an APK is needed. Because it is compared with the last APK (not
 *     the last release), a native change that slipped out once is still caught by the next release.
 *  2. FILE LISTS. `expo.extra.mobileKit.release` lists folders and files, as globs, per kind of release:
 *       { "apk": ["modules/**"], "ota": ["assets/fonts/**"] }
 *     A changed file that matches `apk` needs an APK. A file that matches `ota` (or is in the built-in JS-only list below)
 *     is fine over the air. A file that matches neither is unknown, and unknown means APK: the safe mistake costs a build,
 *     the other one costs a broken phone. The reason names the file, so the next step is to list it.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Folders and files that only ever hold JavaScript, tests, docs or tooling. Add to them with `release.ota`. */
export const DEFAULT_OTA = [
  'app/**', 'src/**', '__tests__/**', '**/*.test.*', '**/*.spec.*', 'docs/**', 'backend/**', 'scripts/**', '.github/**',
  '**/*.md', '.gitignore', '.gitattributes', '.editorconfig', '.prettierrc*', '.eslintrc*', 'LICENSE',
];
/** Folders and files that are native code or build config. Add to them with `release.apk`. */
export const DEFAULT_APK = ['android/**', 'ios/**', 'patches/**', 'plugins/**', 'eas.json', 'metro.config.js', 'babel.config.js'];
/** Files the surface rule already reads (a dependency or app.json change is judged by what it changes, not by name). */
export const SURFACE_FILES = ['package.json', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb', 'app.json', 'version.json'];

const KIT = '@upande/mobile-kit';

/** A glob as a RegExp: `**` crosses folders, `*` and `?` stay inside one. */
export function globToRegExp(glob) {
  let out = '';
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      if (glob[i + 2] === '/') {
        out += '(?:.*/)?';
        i += 2;
      } else {
        out += '.*';
        i += 1;
      }
    } else if (c === '*') out += '[^/]*';
    else if (c === '?') out += '[^/]';
    else out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${out}$`);
}

const matcher = (globs) => {
  const list = globs.map(globToRegExp);
  return (file) => list.some((re) => re.test(file));
};

/** `{ apk, ota }` globs from app.json, ignoring anything that is not a list of strings. */
export function releaseLists(appConfig) {
  const r = appConfig?.expo?.extra?.mobileKit?.release ?? {};
  const strings = (v) => (Array.isArray(v) ? v.filter((s) => typeof s === 'string' && s.trim()).map((s) => s.trim().replace(/^\.?\//, '')) : []);
  return { apk: strings(r.apk), ota: strings(r.ota) };
}

/**
 * Sorts the files a release changed. `apk` are files that need an APK, `unknown` are files nothing says anything about
 * (treated as needing one), everything else is JS-only and is not returned. Precedence: the app's `apk` list, the built-in
 * native list, the app's `ota` list, the built-in JS-only list; a file read by the surface rule is skipped.
 */
export function classifyFiles(files, lists = { apk: [], ota: [] }) {
  const isApk = matcher([...lists.apk, ...DEFAULT_APK]);
  const isOta = matcher([...lists.ota, ...DEFAULT_OTA]);
  const skip = new Set(SURFACE_FILES);
  const apk = [];
  const unknown = [];
  for (const raw of files) {
    const file = raw.replace(/\\/g, '/');
    if (isApk(file)) apk.push(file);
    else if (isOta(file) || skip.has(file)) continue;
    else unknown.push(file);
  }
  return { apk, unknown };
}

const readJson = (p) => {
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
};
const isDir = (p) => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};
const sha = (s) => createHash('sha256').update(s).digest('hex').slice(0, 12);

function filesUnder(dir) {
  const out = [];
  const walk = (d) => {
    for (const name of readdirSync(d).sort()) {
      const full = join(d, name);
      if (isDir(full)) walk(full);
      else out.push(full);
    }
  };
  if (isDir(dir)) walk(dir);
  return out;
}

const fileHash = (paths) => sha(paths.map((p) => `${p}\n${readFileSync(p, 'utf8')}`).join('\n--\n'));

/** The native fields of app.json: what changes the built app, not the version, runtime or update URL. */
export function appNativeFields(appConfig) {
  const e = { ...(appConfig?.expo ?? {}) };
  const android = { ...(e.android ?? {}) };
  delete android.versionCode;
  delete android.versionName;
  const pick = {
    name: e.name, slug: e.slug, scheme: e.scheme, icon: e.icon, splash: e.splash, orientation: e.orientation,
    userInterfaceStyle: e.userInterfaceStyle, newArchEnabled: e.newArchEnabled, jsEngine: e.jsEngine,
    plugins: e.plugins ?? null, android, ios: e.ios ?? null, androidStatusBar: e.androidStatusBar,
  };
  return pick;
}

/**
 * The native surface of the app as `{ key: shortHash }`. Reads node_modules, so it returns null when they are not
 * installed (the caller then skips this rule instead of guessing).
 */
export function nativeSurface(root, pkg, appConfig) {
  const nm = join(root, 'node_modules');
  if (!isDir(nm)) return null;
  const parts = {};
  for (const name of Object.keys(pkg?.dependencies ?? {}).sort()) {
    const dir = join(nm, name);
    const info = readJson(join(dir, 'package.json'));
    if (!info) continue;
    const native =
      isDir(join(dir, 'android')) || isDir(join(dir, 'ios')) ||
      ['expo-module.config.json', 'app.plugin.js', 'react-native.config.js'].some((f) => existsSync(join(dir, f)));
    if (!native) continue;
    if (name === KIT) {
      // Its version moves with every fix; only what it asks of the native build counts.
      const own = [join(dir, 'app.plugin.js'), join(dir, 'shared', 'native-modules.json'), ...filesUnder(join(dir, 'plugins'))].filter(existsSync);
      parts[`${KIT} (native modules and plugins)`] = fileHash(own);
    } else parts[name] = info.version ?? 'unknown';
  }
  const patches = filesUnder(join(root, 'patches'));
  if (patches.length) parts['patches/'] = fileHash(patches);
  parts['app.json (native fields)'] = sha(JSON.stringify(appNativeFields(appConfig)));
  const hash = sha(JSON.stringify(Object.entries(parts)));
  return { hash, parts };
}

/** What differs between the baseline saved at the last APK and the surface now, as sentences. Empty when it is the same. */
export function surfaceDiff(baseline, now) {
  if (!baseline?.parts || !now?.parts) return [];
  const a = baseline.parts;
  const b = now.parts;
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  const added = keys.filter((k) => !(k in a) && k in b);
  const removed = keys.filter((k) => k in a && !(k in b));
  const changed = keys.filter((k) => k in a && k in b && a[k] !== b[k]);
  const out = [];
  if (added.length) out.push(`native code added since the last APK: ${added.join(', ')}`);
  if (removed.length) out.push(`native code removed since the last APK: ${removed.join(', ')}`);
  if (changed.length) out.push(`native code changed since the last APK: ${changed.join(', ')}`);
  return out;
}

/** Every reason the files changed since the last APK need one, as sentences. */
export function fileReasons({ apk, unknown }) {
  const out = [];
  const some = (l) => `${l.slice(0, 3).join(', ')}${l.length > 3 ? `, +${l.length - 3} more` : ''}`;
  if (apk.length) out.push(`files that need an APK changed (${some(apk)})`);
  if (unknown.length) {
    out.push(
      `${some(unknown)} ${unknown.length === 1 ? 'is' : 'are'} not in the release lists, so an APK is built to be safe` +
        ' (list it under expo.extra.mobileKit.release.ota, or .apk, in app.json)',
    );
  }
  return out;
}

const HELP_KIT =
  'All of the kit\'s settings for this app live here. Edit the lists under "release"; the kit manages nativeBaseline and apkTag itself.';
const HELP_RELEASE =
  'Decides APK or OTA for you. "apk": folders/files (globs) that need a new APK when they change, e.g. "modules/**". "ota": folders/files that are safe over the air, e.g. "assets/fonts/**". ' +
  'Built in: app/**, src/**, tests, docs, *.md are OTA; android/**, ios/**, patches/**, plugins/** are APK. A changed file in neither list builds an APK to be safe, and the release says which file to list.';

/**
 * Puts every setting the kit reads into app.json -> expo.extra.mobileKit with a comment, so there is one place to look and
 * nothing to remember. Adds what is missing, never changes what is there. Returns true when it changed anything.
 * (JSON has no comments, and the files are rewritten by tools, so the comments are `_help` strings the kit ignores.)
 */
export function ensureMobileKitConfig(appConfig) {
  if (!appConfig?.expo) return false;
  const before = JSON.stringify(appConfig);
  const expo = appConfig.expo;
  expo.extra = { ...(expo.extra ?? {}) };
  const old = expo.extra.mobileKit ?? {};
  const release = { ...(old.release ?? {}) };
  const nextRelease = {
    _help: HELP_RELEASE,
    apk: Array.isArray(release.apk) ? release.apk : [],
    ota: Array.isArray(release.ota) ? release.ota : [],
  };
  const { _help: _h1, release: _r, ...rest } = old;
  const next = { _help: HELP_KIT, ...rest };
  if (!('versionCodeBase' in next)) next.versionCodeBase = 0;
  if (!('runtimeMajorBase' in next)) next.runtimeMajorBase = 0;
  next.release = nextRelease;
  // keep the kit-managed records last
  for (const k of ['nativeBaseline', 'apkTag']) if (k in next) {
    const v = next[k];
    delete next[k];
    next[k] = v;
  }
  expo.extra.mobileKit = next;
  return JSON.stringify(appConfig) !== before;
}
