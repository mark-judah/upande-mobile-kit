/**
 * Build-time stop: an app that is missing any native module the kit needs must not be built, or it ships
 * with features silently switched off (no downloads, no battery or storage in crash reports, settings
 * lost on restart). `expo prebuild`, EAS and CI run config plugins, so this is where it fails, with the
 * exact command that repairs it.
 *
 * Props: `strict: false` turns the failure into a warning; `biometric: 'host'` leaves out
 * expo-local-authentication (your app owns the lock, the kit adds none). A `biometric: 'host'` in
 * src/mobile-kit.ts is honoured too, so the plugin prop is rarely needed.
 *
 * Modules are looked up from the PROJECT root (not from where this file sits, which is inside
 * node_modules), walking up the folders the way Node does so hoisted monorepo installs count.
 */
const path = require('node:path');
const lib = require('../shared/native-modules.cjs');

function projectRoot(config) {
  return (config && config._internal && config._internal.projectRoot) || process.cwd();
}

/** The message for the modules that are missing, or null when none are. Pure, for tests. */
function checkNativeModules(root, props = {}) {
  const skip = lib.skipFor({ biometricHost: props.biometric === 'host' || lib.hostOwnsBiometric(root) });
  const missing = lib.missingModules(path.resolve(root), { skip });
  if (missing.length === 0) return null;
  return [
    `@upande/mobile-kit needs native modules this app is missing: ${missing.map((m) => m.pkg).join(', ')}.`,
    ...missing.map((m) => `  - ${m.pkg}: ${m.inPackageJson ? 'in package.json but not installed' : 'not installed'} (${m.disables.charAt(0).toLowerCase() + m.disables.slice(1)})`),
    `Run  ${lib.FIX_COMMAND}  (it installs them with the version that fits your Expo SDK), then build again.`,
    'To build anyway, pass { "strict": false } to the plugin: those features will then be off in the built app.',
  ].join('\n');
}

function withNativeModulesCheck(config, props = {}) {
  const message = checkNativeModules(projectRoot(config), props || {});
  if (!message) return config;
  if (props && props.strict === false) {
    console.warn(`[@upande/mobile-kit] ${message}`);
    return config;
  }
  throw new Error(message);
}

module.exports = withNativeModulesCheck;
module.exports.checkNativeModules = checkNativeModules;
