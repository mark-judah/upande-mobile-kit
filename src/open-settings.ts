import { router } from 'expo-router';
import { DEFAULT_SETTINGS_ROUTE, getConfig } from './config';

/** Open the kit's Settings page (what the floating button does). Use it from your own menu or button if you prefer. */
export function openKitSettings(): void {
  const route = getConfig().settingsRoute ?? DEFAULT_SETTINGS_ROUTE;
  router.push(route as never);
}
