'use strict';
/**
 * The single list of native modules the kit needs, and the helpers every part of
 * the kit shares (CLI init/wizard/fix/doctor/verify, the Expo config plugin and,
 * through native-modules.json, the in-app Settings card).
 *
 * They are deliberately NOT peerDependencies: only `expo install` knows which
 * version fits the app's Expo SDK (SDK 54 wants expo-file-system ~19.0, SDK 58
 * wants ~58.0), and npm would pick the highest. So nothing here installs on its
 * own; `npx upande-mobile-kit fix` does, through `expo install`, and the config
 * plugin refuses to build an app that is missing any of them.
 */
const fs = require('node:fs');
const path = require('node:path');

const MODULES = require('./native-modules.json');
const NAMES = MODULES.map((m) => m.pkg);
const FIX_COMMAND = 'npx upande-mobile-kit fix';

/** Packages the app may leave out because it owns the thing they provide (biometric 'host'). */
function skipFor({ biometricHost = false } = {}) {
  return biometricHost ? MODULES.filter((m) => m.skipWhenHostBiometric).map((m) => m.pkg) : [];
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** The installed version of `pkg`, found the way Node resolves (node_modules here, then in each parent: monorepos hoist). Null when absent. */
function installedVersion(root, pkg) {
  let dir = path.resolve(root);
  for (;;) {
    const manifest = readJson(path.join(dir, 'node_modules', pkg, 'package.json'));
    if (manifest) return String(manifest.version ?? '0.0.0');
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Every kit module with where it stands in this app: declared in package.json? installed in node_modules? */
function moduleStatus(root, { skip = [] } = {}) {
  const pkg = readJson(path.join(root, 'package.json')) ?? {};
  const declared = { ...(pkg.devDependencies ?? {}), ...(pkg.dependencies ?? {}) };
  return MODULES.filter((m) => !skip.includes(m.pkg)).map((m) => {
    const version = installedVersion(root, m.pkg);
    return { pkg: m.pkg, disables: m.disables, spec: declared[m.pkg] ?? null, inPackageJson: !!declared[m.pkg], version, installed: version !== null };
  });
}

/** The modules that are not both declared and installed. */
function missingModules(root, opts) {
  return moduleStatus(root, opts).filter((s) => !s.inPackageJson || !s.installed);
}

/** The package manager the app uses, from its lockfile (null: none found, `expo install` then decides). */
function detectPackageManager(root) {
  const has = (f) => fs.existsSync(path.join(root, f));
  if (has('pnpm-lock.yaml')) return 'pnpm';
  if (has('yarn.lock')) return 'yarn';
  if (has('bun.lockb') || has('bun.lock')) return 'bun';
  if (has('package-lock.json')) return 'npm';
  return null;
}

/** The SDK-aware install: `npx expo install [--<pm>] <packages>`. */
function expoInstallArgv(pm, pkgs) {
  return ['npx', 'expo', 'install', ...(pm ? [`--${pm}`] : []), ...pkgs];
}

/** Whether src/mobile-kit.ts (or the given source text) says the host app owns the biometric lock. */
function hostOwnsBiometric(root) {
  for (const f of ['src/mobile-kit.ts', 'src/mobile-kit.tsx', 'src/mobile-kit.js']) {
    try {
      if (/biometric\s*:\s*['"]host['"]/.test(fs.readFileSync(path.join(root, f), 'utf8'))) return true;
    } catch {
      /* next */
    }
  }
  return false;
}

module.exports = {
  MODULES,
  NAMES,
  FIX_COMMAND,
  skipFor,
  installedVersion,
  moduleStatus,
  missingModules,
  detectPackageManager,
  expoInstallArgv,
  hostOwnsBiometric,
};
