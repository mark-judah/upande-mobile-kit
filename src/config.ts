import type { ComponentType, ReactNode } from 'react';
import { createFetchApi, createLocalAuth, defaultStorage } from './defaults';
import type { MonitorOptions } from './monitor/types';

/**
 * Everything the kit needs from the host app, supplied once through
 * `configureMobileKit()`. The kit never imports from the host's source tree:
 * apps differ in their API client, storage, auth store and theme, and those
 * differences are the only thing a new app has to describe.
 */

/** The host's Frappe client: resolves to the response BODY (`{ message }` for
 *  whitelisted methods), rejects on HTTP/network failure. */
export type KitApi = <T = unknown>(req: {
  method: 'GET' | 'POST';
  url: string;
  params?: Record<string, string | number | boolean | undefined>;
  data?: unknown;
}) => Promise<T>;

export type KitStorage = {
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string) => Promise<void>;
  remove: (key: string) => Promise<void>;
};

/** What the Settings and Devices screens read from the host's auth state. */
export type KitAuth = {
  isSystemManager: boolean;
  /** The account's roles, attached to crash reports. Omit and System Managers report `['System Manager']`. */
  roles?: string[];
  fullName?: string | null;
  email?: string | null;
  /** The signed-in account id, used to throttle device reports and to detect a sign-in. */
  user?: string | null;
  instanceUrl?: string | null;
  biometricEnabled: boolean;
  setBiometricEnabled: (enabled: boolean) => Promise<void>;
  /** Omit both (an app with no sign-in) and the Session card is hidden. */
  logout?: () => Promise<void>;
  /** Clears the session and disables biometric unlock. */
  forgetDevice?: () => Promise<void>;
};

export type KitTheme = {
  primary: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  textOnPrimary: string;
  surface: string;
  surfaceAlt: string;
  background: string;
  border: string;
  danger: string;
  /** Font family names; empty string uses the platform font. */
  fontRegular: string;
  fontMedium: string;
  fontSemiBold: string;
  fontBold: string;
};

export const DEFAULT_THEME: KitTheme = {
  primary: '#1F6F43',
  text: '#111111',
  textSecondary: '#555555',
  textMuted: '#888888',
  textOnPrimary: '#FFFFFF',
  surface: '#FFFFFF',
  surfaceAlt: '#F3F3F3',
  background: '#F7F7F7',
  border: '#E3E3E3',
  danger: '#B91C1C',
  fontRegular: '',
  fontMedium: '',
  fontSemiBold: '',
  fontBold: '',
};

export type KitDialogButton = { text: string; style?: 'cancel' | 'default' | 'destructive'; onPress?: () => void };
export type KitDialogIcon = { name: string; tone?: 'success' | 'warn' | 'info' };

/** Screens and widgets the host may swap for its own look. Every one is optional. */
export type KitUi = {
  Screen?: ComponentType<{
    title: string;
    children?: ReactNode;
    loading?: boolean;
    error?: string | null;
    onRetry?: () => void;
    onRefresh?: () => void;
  }>;
  Card?: ComponentType<{ title?: string; children?: ReactNode }>;
  Button?: ComponentType<{
    label: string;
    onPress: () => void;
    variant?: 'primary' | 'outline' | 'ghost';
    color?: string;
    loading?: boolean;
    disabled?: boolean;
    iconLeft?: string;
    style?: object;
  }>;
  /** A hook returning toast functions. Defaults to `Alert.alert`. */
  useToast?: () => { showSuccess: (message: string) => void; showError: (message: string) => void };
  /** Modal with buttons. Defaults to `Alert.alert`. */
  showDialog?: (title: string, message: string, buttons: KitDialogButton[], icon?: KitDialogIcon) => void;
  /** A hook: is the phone online? Defaults to always true. */
  useOnline?: () => boolean;
};

export type KitEndpoints = {
  registerInstall: string;
  installs: string;
  versions: string;
  /** Where crash / API reports are sent. */
  ingest: string;
};

export const DEFAULT_ENDPOINTS: KitEndpoints = {
  registerInstall: '/api/method/upande_mobile.api.register_install',
  installs: '/api/method/upande_mobile.api.installs',
  versions: '/api/method/frappe.utils.change_log.get_versions',
  ingest: '/api/method/upande_mobile.api.monitor.ingest',
};

/** How the APK update is fetched once a newer one is found. */
export type ApkAutoDownload = 'wifi' | 'always' | 'never';

export type KitApkOptions = {
  /**
   * `wifi` (default): download in the background on Wi-Fi only; an unknown
   * network counts as not-Wi-Fi. `always`: any connection. `never`: only when
   * the person taps. The person can change it in Settings; that choice wins.
   */
  autoDownload?: ApkAutoDownload;
};

export type MobileKitConfig = {
  /** The Mobile App record's name on the server, e.g. "My App". Also the title of the app. */
  appName: string;
  /** `owner/repo` that publishes this app's GitHub Releases (APKs). */
  githubRepo: string;
  /** The Frappe site's base URL, e.g. "https://your.site". Used by the built-in `api`. */
  site?: string;
  /**
   * The host's Frappe client. Omit it and the kit uses `fetch` against `site`
   * (with `authHeaders` when given).
   */
  api?: KitApi;
  /** Extra headers for the built-in `api`, e.g. `{ Authorization: 'token key:secret' }`. */
  authHeaders?: () => Record<string, string> | Promise<Record<string, string>>;
  /** Omit it and the kit uses AsyncStorage when installed, else memory. */
  storage?: KitStorage;
  /** A hook the screens call to read the host's auth state. Omit for an app with no sign-in. */
  useAuth?: () => KitAuth;
  apk?: KitApkOptions;
  /** Crash and API monitoring. On by default; `monitor: { enabled: false }` installs nothing. */
  monitor?: MonitorOptions;
  /** Turns a thrown API error into text for the screen. */
  errorMessage?: (err: unknown) => string;
  theme?: Partial<KitTheme>;
  ui?: KitUi;
  endpoints?: Partial<KitEndpoints>;
  /** Server-side apps worth showing on Settings, [key, label], in display order. */
  serverApps?: [string, string][];
  /** Route the kit navigates to after sign-out / forget device. Default "/login". */
  loginRoute?: string;
  devicesRoute?: string;
  settingsRoute?: string;
  /** Normalises an instance URL into the key per-server state is stored under. */
  instanceKey?: (url: string | null | undefined) => string;
  /** The device's hardware id, when the host has a better source than the Android ID. */
  deviceKey?: () => string | null;
  /** Long-press on the avatar for 2 s (hidden server switcher in the existing apps). */
  onAvatarLongPress?: () => void;
  /** A bundle downloaded within this long of opening is applied by an immediate restart. */
  otaOpenWindowMs?: number;
};

export type ResolvedConfig = Omit<MobileKitConfig, 'theme' | 'endpoints' | 'api' | 'storage' | 'useAuth'> & {
  theme: KitTheme;
  endpoints: KitEndpoints;
  api: KitApi;
  storage: KitStorage;
  useAuth: () => KitAuth;
};

let current: ResolvedConfig | null = null;

export function configureMobileKit(config: MobileKitConfig): void {
  if (!config.appName) throw new Error('configureMobileKit: appName is required.');
  if (!/^[\w.-]+\/[\w.-]+$/.test(config.githubRepo)) {
    throw new Error('configureMobileKit: githubRepo must look like "owner/repo".');
  }
  const storage = config.storage ?? defaultStorage();
  current = {
    ...config,
    storage,
    api: config.api ?? createFetchApi(config.site, config.authHeaders),
    useAuth: config.useAuth ?? createLocalAuth(config.site),
    theme: { ...DEFAULT_THEME, ...config.theme },
    endpoints: { ...DEFAULT_ENDPOINTS, ...config.endpoints },
  };
}

/** The active configuration. Throws, with the fix, when `configureMobileKit` has not run. */
export function getConfig(): ResolvedConfig {
  if (!current) {
    throw new Error(
      '@upande/mobile-kit is not configured. Call configureMobileKit({...}) once at startup, before any screen renders (see the README).',
    );
  }
  return current;
}

export function isConfigured(): boolean {
  return current !== null;
}

/** For tests. */
export function resetMobileKit(): void {
  current = null;
}

/** Storage keys the kit owns. Prefixed, so a host's "clear all but these" sweep never touches them. */
export const KitKeys = {
  apkUpdateCheck: 'upande_kit:apk_update_check',
  updateDismissed: 'upande_kit:update_dismissed_version',
  installId: 'upande_install_id_v1',
  lastReport: 'upande_install_reported_at_v1',
  lastUser: 'upande_install_reported_user_v1',
  lastVersion: 'upande_install_reported_version_v1',
  rowId: 'upande_install_row_id_v1',
  instanceSwitched: 'upande_kit:instance_switched',
  apkAutoDownload: 'upande_kit:apk_auto_download',
  installPromptDismissed: 'upande_kit:install_prompt_dismissed_version',
  localBiometric: 'upande_kit:local_biometric',
  monitorEnabled: 'upande_kit:monitor_enabled',
  monitorQueue: 'upande_kit:monitor_queue',
} as const;

/** Default key for a server URL: lower-case host and path, no scheme, no trailing slash. */
export function defaultInstanceKey(url: string | null | undefined): string {
  return String(url ?? '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '');
}

export function instanceKeyOf(url: string | null | undefined): string {
  return (current?.instanceKey ?? defaultInstanceKey)(url);
}
