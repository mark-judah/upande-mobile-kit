import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { getConfig } from './config';
import { hasNativeModule } from './native-probe';

type OtaExtra = { expoClient?: { version?: string }; appVersion?: string };
const otaExtra = (Updates.manifest as { extra?: OtaExtra } | null)?.extra;

/**
 * The running version. Under an OTA bundle that is the bundle's own, read from
 * its manifest: bundles published before `extra.expoClient` was added leave
 * `Constants.expoConfig` reporting the APK's version.
 */
export const APP_VERSION: string =
  otaExtra?.expoClient?.version ?? otaExtra?.appVersion ?? Constants.expoConfig?.version ?? '1.0.0';

type AppInfo = { nativeApplicationVersion?: string | null; nativeBuildVersion?: string | null };

/**
 * The installed APK's own version and build, from `expo-application` (it reads the Android package info, which OTA
 * updates never change). `Constants.nativeAppVersion` no longer exists, and `Constants.expoConfig` reports the OTA
 * bundle's version, so neither can say which APK is on the phone. The module ships with expo-updates; it is probed
 * first so an APK built without it never gets a bundle that requires it.
 */
function applicationInfo(): AppInfo | null {
  try {
    if (!hasNativeModule('ExpoApplication')) return null;
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- optional, only once its native side exists
    const m = require('expo-application');
    return m ?? null;
  } catch {
    return null;
  }
}

const appInfo = applicationInfo();

/** True when the APK's own version could be read; false means `INSTALLED_APK_VERSION` is only the OTA version. */
export const INSTALLED_APK_KNOWN: boolean = !!appInfo?.nativeApplicationVersion;
/** Version of the installed APK (the native build), which OTA updates never change. */
export const INSTALLED_APK_VERSION: string = appInfo?.nativeApplicationVersion ?? APP_VERSION;
/** Android versionCode of the installed APK. */
export const INSTALLED_APK_BUILD: string | null = appInfo?.nativeBuildVersion ?? null;

/** The runtime this build belongs to (OTA bundles only apply within one). */
export function runtimeVersion(): string | null {
  if (Updates.runtimeVersion) return Updates.runtimeVersion;
  const declared = Constants.expoConfig?.runtimeVersion;
  return typeof declared === 'string' && declared ? declared : null;
}

type SiteApp = { title?: string; version?: string };

/** The Frappe app that is the kit's backend. */
export const KIT_SERVER_APP = 'upande_mobile';
export const KIT_SERVER_LABEL = 'Upande Mobile Kit (server)';

const DEFAULT_SERVER_APPS: [string, string][] = [
  ['frappe', 'Frappe'],
  ['erpnext', 'ERPNext'],
];

/** The apps to list: the app's own choice, then the kit's backend (always, so a missing install is visible). */
export function serverAppsToShow(configured: [string, string][] | undefined): [string, string][] {
  const base = configured ?? DEFAULT_SERVER_APPS;
  return base.some(([key]) => key === KIT_SERVER_APP) ? base : [...base, [KIT_SERVER_APP, KIT_SERVER_LABEL]];
}

/** Versions of the connected site's apps (always including the host's own, if configured), or [] when the site won't say. Never throws. */
export async function getServerVersions(): Promise<{ label: string; version: string }[]> {
  const cfg = getConfig();
  const shown = serverAppsToShow(cfg.serverApps);
  try {
    const res = await cfg.api<{ message?: Record<string, SiteApp> }>({ method: 'GET', url: cfg.endpoints.versions });
    const apps = res?.message ?? {};
    // The kit's backend is listed even when the site lacks it (that is worth seeing); other apps only when present.
    const answered = Object.keys(apps).length > 0;
    return shown
      .filter(([key]) => apps[key] || (key === KIT_SERVER_APP && answered))
      .map(([key, label]) => ({ label, version: apps[key] ? apps[key].version || '—' : 'not installed' }));
  } catch {
    return [];
  }
}

/** The text of Settings' "Code" row: which JS the app is running. */
export function codeLine(): string {
  if (Updates.isEmbeddedLaunch) return 'embedded build';
  const id = (Updates.updateId ?? '').slice(0, 8);
  const channel = (Updates.channel as string | undefined) ?? '';
  const date = Updates.createdAt ? Updates.createdAt.toISOString().slice(0, 10) : '';
  return `OTA ${id || '—'}${date ? ' · ' + date : ''}${channel ? ' · ' + channel : ''}`;
}
