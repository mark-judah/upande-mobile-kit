import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { getConfig } from './config';

type OtaExtra = { expoClient?: { version?: string }; appVersion?: string };
const otaExtra = (Updates.manifest as { extra?: OtaExtra } | null)?.extra;

/**
 * The running version. Under an OTA bundle that is the bundle's own, read from
 * its manifest: bundles published before `extra.expoClient` was added leave
 * `Constants.expoConfig` reporting the APK's version.
 */
export const APP_VERSION: string =
  otaExtra?.expoClient?.version ?? otaExtra?.appVersion ?? Constants.expoConfig?.version ?? '1.0.0';

/** Version of the installed APK (the native build), which OTA updates never change. */
export const INSTALLED_APK_VERSION: string = Constants.nativeAppVersion ?? APP_VERSION;
/** Android versionCode of the installed APK. */
export const INSTALLED_APK_BUILD: string | null = Constants.nativeBuildVersion ?? null;

/** The runtime this build belongs to (OTA bundles only apply within one). */
export function runtimeVersion(): string | null {
  if (Updates.runtimeVersion) return Updates.runtimeVersion;
  const declared = Constants.expoConfig?.runtimeVersion;
  return typeof declared === 'string' && declared ? declared : null;
}

type SiteApp = { title?: string; version?: string };

const DEFAULT_SERVER_APPS: [string, string][] = [
  ['frappe', 'Frappe'],
  ['erpnext', 'ERPNext'],
];

/** Versions of the connected site's apps (always including the host's own, if configured), or [] when the site won't say. Never throws. */
export async function getServerVersions(): Promise<{ label: string; version: string }[]> {
  const cfg = getConfig();
  const shown = cfg.serverApps ?? DEFAULT_SERVER_APPS;
  try {
    const res = await cfg.api<{ message?: Record<string, SiteApp> }>({ method: 'GET', url: cfg.endpoints.versions });
    const apps = res?.message ?? {};
    return shown
      .filter(([key]) => apps[key])
      .map(([key, label]) => ({ label, version: apps[key].version || '—' }));
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
