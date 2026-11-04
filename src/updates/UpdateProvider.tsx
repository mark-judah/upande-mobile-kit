import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState } from 'react-native';
import * as Updates from 'expo-updates';
import {
  autoCheckForApk,
  checkForApk,
  UpdateCheckError,
  type ApkCheck,
  type UpdateErrorKind,
} from './releases';
import {
  canInstallInApp,
  downloadApk,
  findDownloadedApk,
  InstallError,
  launchInstaller,
  openInBrowser,
  type DownloadProgress,
  type InstallErrorKind,
} from './install-apk';
import { getConfig, KitKeys } from '../config';
import { ui } from '../ui/primitives';
import { currentNetwork } from './network';
import { runAutoDownload, shouldPromptInstall } from './auto-download';
import { getAutoDownloadMode } from './preferences';
import { ForceUpdateGate } from './ForceUpdateGate';
import { createForegroundGate } from '../devices/foreground-gate';

/**
 * App-wide state for the APK channel: is a newer native build on GitHub, and
 * the download/install of it.
 *
 * It also applies JS updates (OTA) when the app is opened: checked on launch
 * and, once downloaded, restarted into straight away -- in the first seconds
 * after opening, while nothing is in progress. A download that only finishes
 * after that is kept for the next opening rather than restarting the app
 * under someone mid-task. Without this, expo-updates' own ON_LOAD check
 * applied an update only on the NEXT cold start, so a fix took two openings
 * to reach a phone. The Settings "Check for updates" button still works too.
 *
 * APK download follows the person's choice (Settings, default from
 * `apk.autoDownload`, Wi-Fi only unless the app says otherwise): when the
 * daily check finds a newer APK and the connection allows it, the file is
 * fetched in the background, then an "Install now" prompt opens Android's
 * installer. Android never installs silently without device-owner rights, so
 * that one tap is the floor. A finished download is kept; the Settings button
 * becomes "Install", and a dismissed installer can be reopened without
 * downloading again. The check itself runs silently once a day so the
 * Settings screen already knows the answer when opened.
 */

/** A bundle downloaded within this long of opening is applied by an immediate
 *  restart. Later than that the user is working, so it waits for the next
 *  opening instead -- the app never restarts under someone mid-task. */
const DEFAULT_OTA_OPEN_WINDOW_MS = 20 * 1000;
const LAUNCHED_AT = Date.now();
const DEFAULT_FOREGROUND_CHECK_MS = 10 * 60 * 1000;

/** Still in the first moments after opening, when a restart interrupts nothing. */
const justOpened = () => Date.now() - LAUNCHED_AT < (getConfig().otaOpenWindowMs ?? DEFAULT_OTA_OPEN_WINDOW_MS);

type UpdateState = {
  check: ApkCheck | null;
  checking: boolean;
  checkError: { kind: UpdateErrorKind; message: string } | null;
  downloading: boolean;
  progress: DownloadProgress | null;
  /** The version whose APK is fully downloaded and waiting to be installed. */
  downloaded: string | null;
  installError: { kind: InstallErrorKind | null; message: string } | null;
  /** Ask GitHub now, ignoring the daily throttle. */
  refresh: () => Promise<ApkCheck | null>;
  /** Download the newest APK, or — once it is downloaded — open the installer.
   *  Resolves true when that step succeeded (or the browser fallback was
   *  reached). Pass the result of a `refresh()` made in the same tick, before
   *  state has caught up. */
  install: (target?: ApkCheck | null) => Promise<boolean>;
};

const UpdateContext = createContext<UpdateState | null>(null);

/** What the person sees when an install fails: the app's own message, never a
 *  raw system error (that one is logged). */
function installErrorFor(err: unknown): { kind: InstallErrorKind | null; message: string } {
  if (err instanceof InstallError) return { kind: err.kind, message: err.message };
  if (__DEV__) console.warn('[update] install failed:', err);
  return { kind: null, message: "The update couldn't be installed. Try again." };
}

export function UpdateProvider({ children }: { children: ReactNode }) {
  const [check, setCheck] = useState<ApkCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<UpdateState['checkError']>(null);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [downloaded, setDownloaded] = useState<string | null>(null);
  const [installError, setInstallError] = useState<UpdateState['installError']>(null);

  const [launching, setLaunching] = useState(false);
  const busy = useRef(false);
  /** The finished download, read synchronously by `install`. */
  const ready = useRef<{ version: string; uri: string } | null>(null);

  /* ── OTA: the JS bundle inside the same runtime, applied on opening ───── */

  const otaApplied = useRef(false);

  /** Restart into a downloaded bundle -- only right after opening. Once per
   *  process: the native ON_LOAD download and the check below can both
   *  report the same bundle. */
  const applyOtaOnOpen = useCallback(async () => {
    if (otaApplied.current || !justOpened()) return;
    otaApplied.current = true;
    try {
      await Updates.reloadAsync();
    } catch {
      // A failed reload leaves the bundle installed for the next opening.
      otaApplied.current = false;
    }
  }, []);

  // On opening: ask the update server for a newer bundle and apply it. Every
  // failure is swallowed -- this runs unattended, and the next opening simply
  // tries again.
  useEffect(() => {
    if (__DEV__ || !Updates.isEnabled) return;
    (async () => {
      try {
        const found = await Updates.checkForUpdateAsync();
        if (!found.isAvailable) return;
        await Updates.fetchUpdateAsync();
        await applyOtaOnOpen();
      } catch {
        // Nothing to tell the user; the next opening retries.
      }
    })();
  }, [applyOtaOnOpen]);

  // expo-updates' own ON_LOAD download lands here; apply it now (if still
  // just opened) rather than on the next cold start.
  const { isUpdatePending } = Updates.useUpdates();
  useEffect(() => {
    if (__DEV__ || !Updates.isEnabled || !isUpdatePending) return;
    applyOtaOnOpen();
  }, [isUpdatePending, applyOtaOnOpen]);

  // Coming back to the foreground: look again. Handhelds are rarely restarted, so launch-only checks leave them on old
  // code for days. The APK check throttles itself to once a day; a JS bundle found here is offered, never forced.
  const foregroundOffered = useRef(false);
  useEffect(() => {
    const allow = createForegroundGate(getConfig().foregroundUpdateCheckMinMs ?? DEFAULT_FOREGROUND_CHECK_MS);
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active' || !allow()) return;
      autoCheckForApk().then(
        (result) => {
          if (result) setCheck((cur) => (cur && cur.available === result.available && cur.latestVersion === result.latestVersion ? cur : result));
        },
        () => {},
      );
      if (__DEV__ || !Updates.isEnabled || getConfig().otaOnForeground === false || foregroundOffered.current) return;
      (async () => {
        try {
          const found = await Updates.checkForUpdateAsync();
          if (!found.isAvailable) return;
          const fetched = await Updates.fetchUpdateAsync();
          if (!fetched.isNew || foregroundOffered.current) return;
          foregroundOffered.current = true;
          ui().showDialog(
            'Update ready',
            'A new version was downloaded. Restart now to use it?',
            [
              { text: 'Later', style: 'cancel' }, // the bundle is already downloaded: it applies the next time the app opens
              { text: 'Restart now', onPress: () => void Updates.reloadAsync() },
            ],
            { name: 'cloud-download-outline', tone: 'success' },
          );
        } catch {
          // Nothing to tell the person; the next return to the app tries again.
        }
      })();
    });
    return () => sub.remove();
  }, []);

  // An APK downloaded before (in this run or an earlier one) is offered for
  // install straight away instead of being fetched again.
  useEffect(() => {
    const apk = check?.available ? check.apk : null;
    if (!apk || ready.current?.version === apk.version) return;
    let cancelled = false;
    findDownloadedApk(apk.downloadUrl, { fileName: apk.assetName, expectedBytes: apk.sizeBytes }).then((uri) => {
      if (cancelled || !uri) return;
      ready.current = { version: apk.version, uri };
      setDownloaded(apk.version);
    });
    return () => {
      cancelled = true;
    };
  }, [check]);

  useEffect(() => {
    let cancelled = false;
    autoCheckForApk().then((result) => {
      if (!cancelled && result) setCheck((current) => current ?? result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const refresh = useCallback(async () => {
    setChecking(true);
    setCheckError(null);
    try {
      const result = await checkForApk();
      setCheck(result);
      return result;
    } catch (err) {
      // Only the app's own messages reach the screen; anything else is logged.
      if (err instanceof UpdateCheckError) setCheckError({ kind: err.kind, message: err.message });
      else {
        if (__DEV__) console.warn('[update] check failed:', err);
        setCheckError({ kind: 'failed', message: "Couldn't check for updates. Try again in a moment." });
      }
      return null;
    } finally {
      setChecking(false);
    }
  }, []);

  const install = useCallback(async (target?: ApkCheck | null) => {
    const apk = (target ?? check)?.apk;
    if (!apk || busy.current) return false;
    // Anything but the background download below is the person's own action.
    if (target !== check) manual.current = true;

    setInstallError(null);
    if (!canInstallInApp()) {
      // Older APK without the intent launcher: the browser does the download.
      try {
        await openInBrowser(apk.downloadUrl);
        return true;
      } catch {
        setInstallError({ kind: null, message: 'Could not open the download link.' });
        return false;
      }
    }

    busy.current = true;
    try {
      if (ready.current?.version === apk.version) {
        // Still complete on disk? Otherwise fall through and fetch the rest.
        const uri = apk.sizeBytes
          ? await findDownloadedApk(apk.downloadUrl, { fileName: apk.assetName, expectedBytes: apk.sizeBytes })
          : ready.current.uri;
        if (uri) {
          await launchInstaller(uri);
          return true;
        }
        ready.current = null;
        setDownloaded(null);
      }

      setDownloading(true);
      setProgress(null);
      try {
        const uri = await downloadApk(apk.downloadUrl, {
          fileName: apk.assetName,
          expectedBytes: apk.sizeBytes,
          onProgress: setProgress,
        });
        ready.current = { version: apk.version, uri };
        setDownloaded(apk.version);
        return true;
      } finally {
        setDownloading(false);
        setProgress(null);
      }
    } catch (err) {
      setInstallError(installErrorFor(err));
      return false;
    } finally {
      busy.current = false;
    }
  }, [check]);

  /* ── Background download + "Install now" prompt ──────────────────────── */

  /** Versions already handled this run, so a re-render never repeats them. */
  const autoTried = useRef<string | null>(null);
  // Bumped each time the app comes back to the foreground: a download that was skipped (Wi-Fi only, on mobile data)
  // or interrupted gets another chance, instead of waiting for the next cold start.
  const [resumeTick, setResumeTick] = useState(0);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') setResumeTick((n) => n + 1);
    });
    return () => sub.remove();
  }, []);
  const prompted = useRef<string | null>(null);
  /** The person pressed the Settings button: no prompt on top of their own action. */
  const manual = useRef(false);
  const forced = getConfig().apk?.force !== false;
  const gateApk = check?.available ? check.apk : null;
  const gateOpen = forced && !!gateApk && downloaded === gateApk.version && canInstallInApp();
  const onGateInstall = useCallback(async () => {
    setLaunching(true);
    try {
      await install(check);
    } finally {
      setLaunching(false);
    }
  }, [install, check]);

  useEffect(() => {
    const apk = check?.available ? check.apk : null;
    const attempt = `${apk?.version}|${resumeTick}`;
    if (!apk || !canInstallInApp() || autoTried.current === attempt) return;
    autoTried.current = attempt;
    runAutoDownload({
      onDisk: async () => !!(await findDownloadedApk(apk.downloadUrl, { fileName: apk.assetName, expectedBytes: apk.sizeBytes })),
      mode: getAutoDownloadMode,
      network: currentNetwork,
      download: () => install(check),
    }).catch(() => {
      // Silent: the Settings button still works, and the next check retries.
    });
  }, [check, install, resumeTick]);

  useEffect(() => {
    const apk = check?.available ? check.apk : null;
    // With `apk.force` (the default) the blocking gate below replaces this optional prompt.
    if (forced) return;
    if (!apk || downloaded !== apk.version || manual.current || prompted.current === apk.version || !canInstallInApp()) return;
    prompted.current = apk.version;
    (async () => {
      const { storage, appName } = getConfig();
      const dismissed = await storage.get(KitKeys.installPromptDismissed).catch(() => null);
      if (
        !shouldPromptInstall({
          availableVersion: apk.version,
          downloadedVersion: downloaded,
          manual: manual.current,
          promptedVersion: null,
          dismissedVersion: dismissed,
          canInstallInApp: true,
        })
      )
        return;
      ui().showDialog(
        'Update ready',
        `Version ${apk.version} of ${appName} has been downloaded. Install it now?`,
        [
          {
            text: 'Later',
            style: 'cancel',
            onPress: () => {
              storage.set(KitKeys.installPromptDismissed, apk.version).catch(() => {});
            },
          },
          { text: 'Install now', onPress: () => void install(check) },
        ],
        { name: 'checkmark-circle-outline', tone: 'success' },
      );
    })();
  }, [check, downloaded, install, forced]);

  const value = useMemo(
    () => ({ check, checking, checkError, downloading, progress, downloaded, installError, refresh, install }),
    [check, checking, checkError, downloading, progress, downloaded, installError, refresh, install],
  );

  return (
    <UpdateContext.Provider value={value}>
      {children}
      {gateOpen ? (
        <ForceUpdateGate version={gateApk?.version ?? ''} busy={launching} error={installError} onInstall={() => void onGateInstall()} />
      ) : null}
    </UpdateContext.Provider>
  );
}

/** Safe outside the provider: returns a quiet default. */
export function useApkUpdate(): UpdateState {
  return (
    useContext(UpdateContext) ?? {
      check: null,
      checking: false,
      checkError: null,
      downloading: false,
      progress: null,
      downloaded: null,
      installError: null,
      refresh: async () => null,
      install: async () => false,
    }
  );
}
