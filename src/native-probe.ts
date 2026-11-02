import { NativeModules } from 'react-native';

/**
 * True when a native module is compiled into this build. Expo modules register with `expo`'s registry; plain React
 * Native modules (netinfo, view-shot) register as legacy or TurboModules, which `requireOptionalNativeModule` cannot
 * see. Checking all three means an OTA bundle never `require`s a package whose native side an APK was built without.
 */
export function hasNativeModule(name: string): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- may be absent in tests
    const core = require('expo');
    if (typeof core?.requireOptionalNativeModule === 'function' && core.requireOptionalNativeModule(name)) return true;
  } catch {
    /* next probe */
  }
  try {
    if ((NativeModules as Record<string, unknown> | undefined)?.[name]) return true;
  } catch {
    /* next probe */
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const reg = require('react-native')?.TurboModuleRegistry;
    if (typeof reg?.get === 'function' && reg.get(name)) return true;
  } catch {
    /* absent */
  }
  return false;
}
