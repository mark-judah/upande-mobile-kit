/**
 * Safe-area insets for the kit's own UI, without making `react-native-safe-area-context` a hard dependency.
 * expo-router brings it, so it is almost always there; when it isn't (or no provider is above us) every inset is 0.
 */

export type Insets = { top: number; bottom: number; left: number; right: number };

export const NO_INSETS: Insets = { top: 0, bottom: 0, left: 0, right: 0 };

function loadInsetsHook(): (() => Insets) | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- optional: expo-router depends on it
    const m = require('react-native-safe-area-context');
    return typeof m?.useSafeAreaInsets === 'function' ? m.useSafeAreaInsets : null;
  } catch {
    return null;
  }
}

let insetsHook: (() => Insets) | null | undefined;

export function useInsets(): Insets {
  if (insetsHook === undefined) insetsHook = loadInsetsHook();
  if (!insetsHook) return NO_INSETS;
  try {
    return insetsHook() ?? NO_INSETS;
  } catch {
    return NO_INSETS; // no provider above us
  }
}
