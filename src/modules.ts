import { requireOptionalNativeModule } from 'expo';
import MODULE_LIST from '../shared/native-modules.json';

/**
 * Which native modules this build can actually use.
 *
 * The list itself is shared/native-modules.json, the one list the CLI, the config plugin and this screen
 * all read. An over-the-air update cannot add native code: a module the installed APK (or dev client) was
 * built without is simply absent, and the kit degrades around it. That must not be silent — Settings lists
 * what is missing and how to fix it, and crash reports carry the list as `missing_modules`.
 *
 * Two different problems look the same from inside the app, so they are told apart:
 *   - 'not-installed': the package is not in the app at all. Fix: `npx upande-mobile-kit fix`, then build.
 *   - 'rebuild': the package is installed but this binary was built without its native side (or it is Expo
 *     Go / an old dev client). Fix: make a new native build.
 */

/** The one command that repairs a missing module (the CLI exports the same string; a test keeps them equal). */
export const FIX_COMMAND = 'npx upande-mobile-kit fix';

export type OptionalModule = {
  /** The npm package to install. */
  pkg: string;
  /** Native module names to probe (any one present counts). Empty: a JS-only check. */
  native: string[];
  /** What stops working without it, in the words shown on Settings. */
  disables: string;
};

export type ModuleState = 'present' | 'rebuild' | 'not-installed';
export type MissingModule = OptionalModule & { state: 'rebuild' | 'not-installed' };

type Entry = OptionalModule & { runtime: boolean };

/** Modules the running app checks (expo-updates and expo-constants are imported unconditionally, so they are not probed). */
export const OPTIONAL_MODULES: OptionalModule[] = (MODULE_LIST as Entry[])
  .filter((m) => m.runtime)
  .map(({ pkg, native, disables }) => ({ pkg, native, disables }));

/**
 * Loaders with LITERAL package names, each `require` directly inside `try` (the only shape Metro will skip when the
 * package is not installed; anywhere else it fails the whole bundle). Metro can only bundle a `require` whose argument
 * is a string literal; a variable one is rejected at runtime, which made every package look missing.
 */
const LOADERS: Record<string, () => unknown> = {
  /* eslint-disable @typescript-eslint/no-require-imports -- optional packages, probed on purpose */
  'expo-file-system': () => {
    try {
      return require('expo-file-system');
    } catch (e) {
      throw e; // a missing package surfaces as the probe's load error
    }
  },
  'expo-intent-launcher': () => {
    try {
      return require('expo-intent-launcher');
    } catch (e) {
      throw e; // a missing package surfaces as the probe's load error
    }
  },
  'expo-local-authentication': () => {
    try {
      return require('expo-local-authentication');
    } catch (e) {
      throw e; // a missing package surfaces as the probe's load error
    }
  },
  'expo-network': () => {
    try {
      return require('expo-network');
    } catch (e) {
      throw e; // a missing package surfaces as the probe's load error
    }
  },
  'expo-device': () => {
    try {
      return require('expo-device');
    } catch (e) {
      throw e; // a missing package surfaces as the probe's load error
    }
  },
  'expo-battery': () => {
    try {
      return require('expo-battery');
    } catch (e) {
      throw e; // a missing package surfaces as the probe's load error
    }
  },
  'expo-sensors': () => {
    try {
      return require('expo-sensors');
    } catch (e) {
      throw e; // a missing package surfaces as the probe's load error
    }
  },
  'expo-localization': () => {
    try {
      return require('expo-localization');
    } catch (e) {
      throw e; // a missing package surfaces as the probe's load error
    }
  },
  '@react-native-async-storage/async-storage': () => {
    try {
      return require('@react-native-async-storage/async-storage');
    } catch (e) {
      throw e; // a missing package surfaces as the probe's load error
    }
  },
  /* eslint-enable @typescript-eslint/no-require-imports */
};

/** True when `err` says the package itself could not be found (Metro's "unknown module" / "cannot find module"), not that its native side is absent. */
export function isPackageNotFound(err: unknown): boolean {
  const msg = String((err as { message?: unknown } | null)?.message ?? err ?? '');
  if (/native module/i.test(msg)) return false;
  return /requiring unknown module|cannot find module|unable to resolve|module not found|could not be found/i.test(msg);
}

/** Pure: what the probes found. `nativeSeen` = a native module answered; `loadError` = what requiring the package threw (undefined: it loaded). */
export function classify(m: OptionalModule, found: { nativeSeen: boolean; loaded: boolean; loadedValue?: unknown; loadError?: unknown }): ModuleState {
  if (m.native.length > 0) {
    if (found.nativeSeen) return 'present';
    return found.loaded || !isPackageNotFound(found.loadError) ? 'rebuild' : 'not-installed';
  }
  // JS-only package (AsyncStorage): present when it loads and works.
  if (found.loaded) {
    const as = (found.loadedValue as { default?: unknown } | null)?.default ?? found.loadedValue;
    return as && typeof (as as { getItem?: unknown }).getItem === 'function' ? 'present' : 'rebuild';
  }
  return isPackageNotFound(found.loadError) ? 'not-installed' : 'rebuild';
}

function probe(m: OptionalModule): ModuleState {
  let nativeSeen = false;
  for (const name of m.native) {
    try {
      if (requireOptionalNativeModule(name)) {
        nativeSeen = true;
        break;
      }
    } catch {
      /* try the next name */
    }
  }
  if (nativeSeen) return 'present';
  try {
    const value = LOADERS[m.pkg]?.();
    return classify(m, { nativeSeen, loaded: true, loadedValue: value });
  } catch (loadError) {
    return classify(m, { nativeSeen, loaded: false, loadError });
  }
}

/** The optional modules this build lacks, each with why. `skip` leaves out packages the app does not use (e.g. biometric owned by the host). */
export function missingModules(skip: string[] = []): MissingModule[] {
  const out: MissingModule[] = [];
  for (const m of OPTIONAL_MODULES) {
    if (skip.includes(m.pkg)) continue;
    const state = probe(m);
    if (state !== 'present') out.push({ ...m, state });
  }
  return out;
}

/** Package names only, for crash reports. */
export function missingModuleNames(skip: string[] = []): string[] {
  return missingModules(skip).map((m) => m.pkg);
}

/** One row of the Settings card. */
export function describeMissing(m: MissingModule): string {
  return m.state === 'not-installed' ? `${m.disables}: not installed, run ${FIX_COMMAND}` : `${m.disables}: rebuild required`;
}

/** The sentence under the Settings card, covering whichever kinds are present. */
export function missingAdvice(list: MissingModule[]): string {
  const parts: string[] = [];
  if (list.some((m) => m.state === 'not-installed')) {
    parts.push(`"not installed": run ${FIX_COMMAND} in the app folder, then make a new native build.`);
  }
  if (list.some((m) => m.state === 'rebuild')) {
    parts.push('"rebuild required": the package is installed, but this build was made without it (an update delivered over the air cannot add native modules). Make a new native build (APK or dev client); Expo Go already includes most of them.');
  }
  return parts.join(' ');
}

/** The single development-console line for everything missing, or null when nothing is. */
export function missingSummary(list: MissingModule[]): string | null {
  if (list.length === 0) return null;
  const names = list.map((m) => `${m.pkg} (${m.state === 'not-installed' ? 'not installed' : 'rebuild required'})`).join(', ');
  return `[@upande/mobile-kit] ${list.length} native module${list.length === 1 ? '' : 's'} unavailable in this build: ${names}. Some features are off. Run: ${FIX_COMMAND}`;
}
