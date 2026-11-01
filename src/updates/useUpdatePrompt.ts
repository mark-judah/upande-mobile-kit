import { useEffect } from 'react';
import { Linking } from 'react-native';
import { getConfig, KitKeys } from '../config';
import { ui } from '../ui/primitives';
import { autoCheckForApk, releasesPageUrl } from './releases';
import { canInstallInApp } from './install-apk';
import { useApkUpdate } from './UpdateProvider';

/**
 * Once per app session (when `active` becomes true), offer a one-tap "Update
 * available" prompt when a newer APK exists. A version the person dismissed
 * with "Later" is not offered again — only a NEWER release brings the prompt
 * back, so it never nags on every launch.
 *
 * "Update" downloads the APK in-app, then offers "Install" to open Android's
 * installer; without in-app install support it opens the releases page.
 * Best-effort: any failure (offline, no releases yet) is a no-op.
 * Must be used inside <MobileKitProvider> (or <UpdateProvider>).
 */
export function useUpdatePrompt(active: boolean): void {
  const { refresh, install } = useApkUpdate();

  useEffect(() => {
    if (!active) return;
    let cancelled = false;

    (async () => {
      const { storage, appName } = getConfig();
      const { showDialog } = ui();
      const check = await autoCheckForApk();
      if (cancelled || !check?.available || !check.apk) return;
      const latest = check.apk.version;

      const dismissed = await storage.get(KitKeys.updateDismissed).catch(() => null);
      if (cancelled || dismissed === latest) return;

      showDialog(
        'Update available',
        `A newer version (v${latest}) of ${appName} is available. You're on v${check.current}. Update to get the latest fixes.`,
        [
          {
            text: 'Later',
            style: 'cancel',
            onPress: () => {
              storage.set(KitKeys.updateDismissed, latest).catch(() => {});
            },
          },
          {
            text: 'Update',
            onPress: async () => {
              const fresh = await refresh();
              if (fresh?.available && (await install(fresh))) {
                // The browser fallback handles the rest itself.
                if (!canInstallInApp()) return;
                showDialog(
                  'Update downloaded',
                  `v${fresh.apk?.version ?? latest} is ready to install.`,
                  [
                    { text: 'Later', style: 'cancel' },
                    { text: 'Install', onPress: () => void install(fresh) },
                  ],
                  { name: 'checkmark-circle-outline', tone: 'success' },
                );
                return;
              }
              Linking.openURL(releasesPageUrl()).catch(() => {});
            },
          },
        ],
        { name: 'cloud-download-outline', tone: 'info' },
      );
    })();

    return () => {
      cancelled = true;
    };
    // refresh/install are stable callbacks; re-running on their identity
    // would re-prompt every time a check lands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
}
