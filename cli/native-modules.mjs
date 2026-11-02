/** ESM view of shared/native-modules.cjs, the one list of native modules every part of the kit uses. */
import lib from '../shared/native-modules.cjs';

export const {
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
} = lib;

/** Shown wherever a module is missing; `host` = the app owns the biometric lock, so that one is only a warning. */
const lowerFirst = (t) => t.charAt(0).toLowerCase() + t.slice(1);
export function describeMissing(status) {
  return !status.inPackageJson
    ? `${status.pkg} is not installed in this app (${lowerFirst(status.disables)})`
    : `${status.pkg} is in package.json but not in node_modules (${lowerFirst(status.disables)})`;
}
