import { requireOptionalNativeModule } from 'expo';

/**
 * Which optional native modules this build was compiled with.
 *
 * An over-the-air update cannot add native code: a module the installed APK
 * (or dev client) was built without is simply absent, and the kit degrades
 * around it. That is fine, but it must not be silent — Settings lists what is
 * missing and says a new native build is needed, and crash reports carry the
 * list as `missing_modules`.
 */

export type OptionalModule = {
  /** The npm package to install. */
  pkg: string;
  /** The native module name to probe (null: a JS-only check). */
  native: string | null;
  /** What stops working without it, in the words shown on Settings. */
  disables: string;
};

export const OPTIONAL_MODULES: OptionalModule[] = [
  { pkg: 'expo-device', native: 'ExpoDevice', disables: 'Device model and memory unavailable' },
  { pkg: 'expo-battery', native: 'ExpoBattery', disables: 'Battery info unavailable' },
  { pkg: 'expo-localization', native: 'ExpoLocalization', disables: 'Locale and time zone unavailable' },
  { pkg: 'expo-network', native: 'ExpoNetwork', disables: 'Network type and background APK downloads unavailable' },
  { pkg: 'expo-file-system', native: 'ExpoFileSystem', disables: 'Free storage and APK downloads unavailable' },
  { pkg: 'expo-intent-launcher', native: 'ExpoIntentLauncher', disables: 'In-app APK install unavailable' },
  { pkg: 'expo-local-authentication', native: 'ExpoLocalAuthentication', disables: 'Biometric unavailable' },
  { pkg: '@react-native-async-storage/async-storage', native: null, disables: 'Settings not kept between launches' },
];

function present(m: OptionalModule): boolean {
  try {
    if (m.native) return !!requireOptionalNativeModule(m.native);
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- optional peer, probed on purpose
    const mod = require(m.pkg);
    const as = mod?.default ?? mod;
    return !!as && typeof as.getItem === 'function';
  } catch {
    return false;
  }
}

/** The optional modules this build lacks. `skip` leaves out packages the app does not use (e.g. biometric owned by the host). */
export function missingModules(skip: string[] = []): OptionalModule[] {
  return OPTIONAL_MODULES.filter((m) => !skip.includes(m.pkg) && !present(m));
}

/** Package names only, for crash reports. */
export function missingModuleNames(skip: string[] = []): string[] {
  return missingModules(skip).map((m) => m.pkg);
}
