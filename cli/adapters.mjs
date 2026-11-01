/**
 * Wiring the host app's own session into the kit.
 *
 * Without `useAuth`, `api` and `storage` the kit runs on stand-ins: it looks
 * like the Settings page works, but sign-out, the biometric switch and the
 * device register are not connected to the app's real session. This finds the
 * app's own auth store / API client / storage module (conservatively) and
 * writes the adapter into src/mobile-kit.ts. When it is not confident it says
 * so, and the wizard asks.
 */
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { sourceFiles } from './routes.mjs';

const read = (root, rel) => {
  try {
    return readFileSync(join(root, rel), 'utf8');
  } catch {
    return '';
  }
};
const shortest = (a) => [...a].sort((x, y) => x.length - y.length || x.localeCompare(y))[0] ?? null;
const has = (src, word) => new RegExp(`\\b${word}\\b`).test(src);

/** Files of the app (the kit's own config excluded), for scanning. */
const hostFiles = (root) =>
  sourceFiles(root, ['src', 'app', 'store', 'stores', 'lib', 'core', 'services', 'hooks', 'utils', 'context', 'contexts']).filter(
    (f) => !/(^|\/)mobile-kit\.ts$/.test(f),
  );

/** Does the app already lock itself with expo-local-authentication (so two locks would fight)? */
export function detectHostBiometric(root) {
  return hostFiles(root).filter((f) => /expo-local-authentication|authenticateAsync|LocalAuthentication\b/.test(read(root, f)));
}

/**
 * Look for the app's auth store, API client and storage module.
 * @returns {{ auth: Spec|null, api: Spec|null, storage: Spec|null }} where Spec = { file, exportName, mode? }
 */
export function detectHost(root) {
  const files = hostFiles(root);
  const withSrc = files.map((f) => [f, read(root, f)]);
  const pick = (re, filter = () => true) => shortest(withSrc.filter(([f, s]) => re.test(s) && filter(f, s)).map(([f]) => f));

  const storeFile = pick(/export\s+(?:const|function)\s+useAuthStore\b|export\s*\{[^}]*\buseAuthStore\b/);
  const hookFile = storeFile ? null : pick(/export\s+(?:const|function)\s+useAuth\b/, (_f, s) => has(s, 'roles') || has(s, 'isSystemManager'));
  const auth = storeFile
    ? { file: storeFile, exportName: 'useAuthStore', mode: 'store' }
    : hookFile
      ? { file: hookFile, exportName: 'useAuth', mode: 'hook' }
      : null;

  const apiFile = pick(/export\s+(?:async\s+)?(?:function\s+api\b|const\s+api\b)/, (f) => /(client|api|http|request)/i.test(f));
  const storageFile = pick(
    /export\s+const\s+storage\b/,
    (_f, s) => has(s, 'get') && has(s, 'set') && has(s, 'remove'),
  );
  return {
    auth,
    api: apiFile ? { file: apiFile, exportName: 'api' } : null,
    storage: storageFile ? { file: storageFile, exportName: 'storage' } : null,
  };
}

/**
 * Is `exportName` a selector-style store hook (`useStore((s) => s.field)`, zustand / redux-like)
 * or a hook that returns the whole object (`const auth = useAuth()`)?
 */
export function inferMode(source, exportName) {
  if (/Store$/.test(exportName)) return 'store';
  const decl = new RegExp(`export\\s+(?:const|function)\\s+${exportName}\\b[^\\n]*`).exec(source)?.[0] ?? '';
  if (/=\s*create\b|\(\s*\w*[sS]elector\b|\(\s*sel\b/.test(decl)) return 'store';
  return 'hook';
}

/** `./core/auth/store` for src/core/auth/store.ts, as seen from src/mobile-kit.ts. */
export function importPath(file) {
  let rel = relative('src', file).split('\\').join('/').replace(/\.(tsx|ts|jsx|js)$/, '').replace(/\/index$/, '');
  if (!rel.startsWith('.')) rel = `./${rel}`;
  return rel;
}

const FIELD_NAMES = {
  fullName: ['fullName', 'full_name'],
  email: ['email'],
  instanceUrl: ['instanceUrl', 'serverUrl', 'siteUrl', 'baseUrl'],
};

/**
 * The `useAuth` adapter for a store / hook module, from the fields the module mentions.
 * @returns {{ code: string, wired: string[], missing: string[] } | null}  null = cannot tell who is signed in
 */
export function buildAuthAdapter({ source, exportName, mode, alias = exportName }) {
  const field = (key) => FIELD_NAMES[key].find((n) => has(source, n)) ?? null;
  const roles = has(source, 'roles');
  const isSM = has(source, 'isSystemManager');
  if (!roles && !isSM) return null;

  const sel = (varName, prop) => (mode === 'hook' ? `const ${varName} = auth.${prop};` : `const ${varName} = ${alias}((s) => s.${prop});`);
  const lines = [];
  const ret = [];
  const wired = [];
  const missing = [];
  if (mode === 'hook') lines.push(`const auth = ${alias}();`);

  if (roles) {
    lines.push(sel('roles', 'roles'));
    ret.push("isSystemManager: (roles ?? []).includes('System Manager')", 'roles: roles ?? undefined');
    wired.push('roles', 'isSystemManager');
  } else {
    lines.push(sel('isSystemManager', 'isSystemManager'));
    ret.push('isSystemManager: !!isSystemManager');
    wired.push('isSystemManager');
  }
  for (const key of ['fullName', 'email', 'instanceUrl']) {
    const prop = field(key);
    if (prop) {
      lines.push(sel(key, prop));
      ret.push(`${key}`);
      wired.push(key);
    } else missing.push(key);
  }
  if (field('email')) ret.push('user: email ?? null');
  else if (/\buser\s*:\s*(string|null)/.test(source)) {
    lines.push(sel('user', 'user'));
    ret.push('user: user ?? null');
  } else missing.push('user');

  if (has(source, 'biometricEnabled') && has(source, 'setBiometricEnabled')) {
    lines.push(sel('biometricEnabled', 'biometricEnabled'), sel('setBiometricEnabled', 'setBiometricEnabled'));
    ret.push('biometricEnabled: !!biometricEnabled', 'setBiometricEnabled: async (enabled: boolean) => {\n        await setBiometricEnabled(enabled);\n      }');
    wired.push('biometricEnabled', 'setBiometricEnabled');
  } else {
    ret.push(
      'biometricEnabled: false, // your auth state has no biometric flag, so the kit\'s switch cannot persist (use biometric: \'host\' if your app owns the lock)',
      'setBiometricEnabled: async () => {}',
    );
    missing.push('biometricEnabled', 'setBiometricEnabled');
  }
  for (const fn of ['logout', 'forgetDevice']) {
    if (has(source, fn)) {
      lines.push(sel(fn, fn));
      ret.push(`${fn}: async () => {\n        await ${fn}();\n      }`);
      wired.push(fn);
    } else missing.push(fn);
  }
  const body = [...lines.map((l) => `    ${l}`), '    return {', ...ret.map((r) => `      ${r},`), '    };'].join('\n');
  return { code: `  useAuth: () => {\n${body}\n  },`, wired, missing };
}

/**
 * Everything src/mobile-kit.ts needs for the host modules: imports, the config
 * lines, what was wired and what is left on stand-ins.
 * @param {{ root: string, auth?: Spec|null, api?: Spec|null, storage?: Spec|null }} p
 */
export function buildAdapters({ root, auth = null, api = null, storage = null }) {
  const imports = [];
  const lines = [];
  const wired = [];
  const standIns = [];
  const notes = [];

  if (auth) {
    const source = read(root, auth.file);
    const built = buildAuthAdapter({ source, exportName: auth.exportName, mode: auth.mode ?? inferMode(source, auth.exportName), alias: auth.exportName });
    if (built) {
      imports.push(`import { ${auth.exportName} } from '${importPath(auth.file)}';`);
      lines.push(built.code);
      wired.push(`useAuth <- ${auth.file} (${auth.exportName}: ${built.wired.join(', ')})`);
      if (built.missing.length) notes.push(`useAuth: ${built.missing.join(', ')} not found in ${auth.file}, left unset`);
    } else {
      standIns.push('useAuth');
      notes.push(`${auth.file} has neither roles nor isSystemManager, so the kit cannot tell who is a System Manager: useAuth left on the stand-in`);
    }
  } else standIns.push('useAuth');

  if (api) {
    imports.push(`import { ${api.exportName} as hostApi } from '${importPath(api.file)}';`);
    lines.push('  api: hostApi, // must resolve to the response BODY ({ message } for whitelisted methods)');
    wired.push(`api <- ${api.file}`);
  } else standIns.push('api');

  if (storage) {
    imports.push(`import { ${storage.exportName} as hostStorage } from '${importPath(storage.file)}';`);
    lines.push('  storage: hostStorage,');
    wired.push(`storage <- ${storage.file}`);
  } else standIns.push('storage');

  const hints = [];
  if (standIns.includes('api')) hints.push('  // api,        // (req) => Promise<response body>; sends the signed-in user\'s session');
  if (standIns.includes('storage')) hints.push('  // storage,    // { get, set, remove }; default AsyncStorage, else memory');
  if (standIns.includes('useAuth')) {
    hints.push(
      '  // useAuth: () => ({ isSystemManager, user, instanceUrl, biometricEnabled,',
      '  //                   setBiometricEnabled, logout, forgetDevice, fullName, email }),',
    );
  }
  hints.push("  // theme: { primary: '#...' },");
  return { imports, lines, hints, wired, standIns, notes };
}

/** A one-line description of a stand-in, for the end-of-init report. */
export const STAND_IN_EFFECT = {
  useAuth: "sign-out, the biometric switch and the device register are NOT connected to your session (the kit keeps its own local state)",
  api: "the kit calls your site with plain fetch and no session, so the device register and crash reports are rejected until a user is signed in through it",
  storage: 'the kit stores its settings in AsyncStorage (or memory when that is not installed)',
};
