/**
 * Where this package and its backend app live on GitHub. Forks override per run
 * with `--kit-repo` / `--backend-repo`; a value containing REPLACE-ME is refused.
 */
export const KIT_REPO = 'mark-judah/upande-mobile-kit';
export const BACKEND_REPO_URL = 'https://github.com/mark-judah/upande-mobile.git';
export const BACKEND_APP = 'upande_mobile';
export const WORKFLOW_REF = 'v0';

export const isPlaceholder = (value) => /REPLACE-ME/.test(String(value ?? ''));

/** Native modules the kit uses. Newly added ones need a new native build, which an OTA update cannot deliver. */
export const NATIVE_MODULES = [
  'expo-updates',
  'expo-constants',
  'expo-file-system',
  'expo-intent-launcher',
  'expo-local-authentication',
  'expo-network',
  // device details on crash reports (model, battery, locale)
  'expo-device',
  'expo-battery',
  'expo-localization',
  '@react-native-async-storage/async-storage',
];
