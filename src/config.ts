import type { ComponentType, ReactNode } from 'react';
import { createFetchApi, createLocalAuth, defaultStorage } from './defaults';
import type { MonitorOptions } from './monitor/types';
import { withSessionRecovery, type SessionRecovery } from './session/recovery';

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

/** Identifiers an app can hand to the kit (see `deviceInfo`). */
export type DeviceInfo = { serial_number?: string; mac_address?: string; local_ip?: string };

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
  /** Status colours: success (done, online), warning (waiting, attention). */
  success: string;
  warning: string;
  /** Font family names; empty string uses the platform font. */
  fontRegular: string;
  fontMedium: string;
  fontSemiBold: string;
  fontBold: string;
};

/**
 * The Upande design system: a monochrome chrome (near-black primary, neutral greys, white cards with a hairline
 * border), DM Sans for text and Poppins for headings, colour only for status. These match the fleet's apps; an app
 * with its own tokens passes `theme` and the whole kit follows. The fonts are used when the app has loaded them
 * (`@expo-google-fonts/dm-sans`, `@expo-google-fonts/poppins`) and quietly fall back to the system font when not.
 */
export const DEFAULT_THEME: KitTheme = {
  primary: '#171717',
  text: '#171717',
  textSecondary: '#525252',
  textMuted: '#A3A3A3',
  textOnPrimary: '#FFFFFF',
  surface: '#FFFFFF',
  surfaceAlt: '#F5F5F5',
  background: '#FAFAFA',
  border: '#E5E5E5',
  danger: '#EF4444',
  success: '#22C55E',
  warning: '#F59E0B',
  fontRegular: 'DMSans_400Regular',
  fontMedium: 'DMSans_500Medium',
  fontSemiBold: 'Poppins_600SemiBold',
  fontBold: 'Poppins_700Bold',
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
  /** Where "Report a problem" is sent. */
  submitReport: string;
  /** The single-thread chat used by sites without an Issue doctype: `GET` fetches messages, `POST` sends one. */
  chat: string;
  /** The person's conversations with support (their Issues for this app). */
  supportThreads: string;
  /** Offers this phone's Expo push token for support-reply notifications. */
  registerPush: string;
  /** Forgets this phone's token. */
  unregisterPush: string;
  /** One conversation: what they wrote, then the comments on the Issue. */
  supportThread: string;
  /** The person's answer on a conversation. */
  supportReply: string;
};

export const DEFAULT_ENDPOINTS: KitEndpoints = {
  registerInstall: '/api/method/upande_mobile.api.register_install',
  installs: '/api/method/upande_mobile.api.installs',
  versions: '/api/method/frappe.utils.change_log.get_versions',
  ingest: '/api/method/upande_mobile.api.monitor.ingest',
  submitReport: '/api/method/upande_mobile.api.support.submit_report',
  chat: '/api/method/upande_mobile.api.support.chat',
  supportThreads: '/api/method/upande_mobile.api.support.threads',
  registerPush: '/api/method/upande_mobile.api.support.register_push',
  unregisterPush: '/api/method/upande_mobile.api.support.unregister_push',
  supportThread: '/api/method/upande_mobile.api.support.thread',
  supportReply: '/api/method/upande_mobile.api.support.reply',
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
  /**
   * `true` (default): once a newer APK has been downloaded, a full-screen "Update required" dialog covers the app
   * and cannot be closed (the Android back button included) until the new version is installed. `false`: the
   * dialog offers "Later" and asks again on the next opening.
   */
  force?: boolean;
};

/** The kit's pages live in their own folder so they can never collide with a screen the app already has. */
export const DEFAULT_SETTINGS_ROUTE = '/mobile-kit/settings';
export const DEFAULT_DEVICES_ROUTE = '/mobile-kit/devices';

export type KitEnvironment = 'development' | 'production';
export type KitSites = { production: string; development?: string };

/** The site URL for the environment: explicit `environment`, else `__DEV__`. Trailing slashes dropped. */
export function resolveSite(
  site: string | KitSites | undefined,
  environment?: KitEnvironment,
  isDev: boolean = typeof __DEV__ !== 'undefined' && __DEV__,
): { site: string | undefined; environment: KitEnvironment } {
  const env: KitEnvironment = environment ?? (isDev ? 'development' : 'production');
  const clean = (u?: string) => (u ? u.replace(/\/+$/, '') : undefined);
  if (!site || typeof site === 'string') return { site: clean(site), environment: env };
  const picked = env === 'development' ? site.development || site.production : site.production;
  return { site: clean(picked), environment: env };
}

export type KitFabOptions = {
  /** Which screen edge the button starts on. Default `'right'`. The person can drag it; their spot is remembered. */
  initialSide?: 'left' | 'right';
  /** Distance of the button from the bottom of the screen, in dp, before safe-area insets. Default 96. */
  bottom?: number;
  /**
   * Show the button while nobody is signed in. Default `false`: an app that wires its own `useAuth` usually keeps every
   * screen except its login behind a sign-in gate, which sends the Settings page straight back to the login screen.
   * Without a wired `useAuth` the kit cannot tell, and the button always shows.
   */
  whenSignedOut?: boolean;
  /** Ignored. Shake to hide was removed (it was awkward): the person moves the button out of the way instead. */
  shake?: boolean;
};

export type MobileKitConfig = {
  /** The Mobile App record's name on the server, e.g. "My App". Also the title of the app. */
  appName: string;
  /** `owner/repo` that publishes this app's GitHub Releases (APKs). */
  githubRepo: string;
  /**
   * The Frappe site's base URL, e.g. "https://your.site", used by the built-in `api`.
   * Or one per environment: `{ production: 'https://your.site', development: 'http://localhost:8000' }`.
   * Development builds (`__DEV__`: Metro, dev clients) use `development`, release builds `production`;
   * a missing `development` falls back to `production`. Force one with `environment`.
   */
  site?: string | KitSites;
  /** Pin the environment instead of deriving it from `__DEV__` (e.g. a staging APK that should use `production`). */
  environment?: KitEnvironment;
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
  /**
   * Hardware identifiers the kit cannot read itself. Android 10+ and iOS hide the MAC address and the serial number
   * from apps, so a stock phone reports neither. An app on managed handhelds (a device owner, or a vendor SDK such as
   * Zebra's) can return them here and the kit reports them with the other device facts. Placeholders ("unknown",
   * 02:00:00:00:00:00) are dropped. Never throws into the app.
   */
  deviceInfo?: () => DeviceInfo | Promise<DeviceInfo>;
  theme?: Partial<KitTheme>;
  ui?: KitUi;
  endpoints?: Partial<KitEndpoints>;
  /** Server-side apps worth showing on Settings, [key, label], in display order. */
  serverApps?: [string, string][];
  /** Route the kit navigates to after sign-out / forget device. Default "/login". */
  loginRoute?: string;
  /**
   * Where the kit's Devices / Settings pages are mounted. Rarely needed: the defaults live under their own
   * `/mobile-kit/` folder (`/mobile-kit/devices`, `/mobile-kit/settings`), which no app already uses, so nothing
   * collides. Only set these if you moved the route files yourself; the kit's own links use them.
   */
  devicesRoute?: string;
  settingsRoute?: string;
  /**
   * The floating Settings button, the one entry point that works in any app whatever its navigation looks like.
   * `true` (default): shown on every screen except the kit's own pages (and, when your `useAuth` is wired, the
   * screens before sign-in; see `whenSignedOut`), draggable to either screen edge, hidden
   * while the keyboard is open. `'dev'`: only in development builds. `false`: never (open the page yourself with
   * `openKitSettings()`, `<KitSettingsButton />` or `router.push('/mobile-kit/settings')`). An object keeps it on
   * and sets where it starts.
   */
  fab?: boolean | 'dev' | KitFabOptions;
  /**
   * Who owns the biometric lock. `'kit'` (default): the Settings page shows the kit's unlock switch. `'host'`:
   * the app already locks itself (e.g. with expo-local-authentication) and the kit never enforces a lock of
   * its own. The Settings switch still shows when your `useAuth` is wired: it sets YOUR `biometricEnabled`, and your
   * app does the locking. Without a wired `useAuth` the switch is hidden (there is no real setting behind it).
   */
  biometric?: 'kit' | 'host' | 'vault';
  /**
   * Support tools in Settings: "Report a problem" (a screenshot and diagnostics filed on your site) and "Chat with
   * support". `true` (default) shows both, `false` hides both, or turn one off: `{ chat: false }`.
   */
  support?: boolean | { report?: boolean; chat?: boolean };
  /**
   * Push notifications for support replies (needs `expo-notifications`, an Expo project id and, on Android, Firebase
   * credentials). `true` (default): the person can turn them on in Settings, and is offered them after their first
   * message. `false`: never. `{ projectId }` sets the Expo project id when it is not in `extra.eas.projectId`.
   */
  push?: boolean | { projectId?: string };
  /**
   * A banner when the phone has been offline for a while or the server answers very slowly, with a shortcut to the
   * Wi-Fi settings. `true` (default), `false`, or `{ staleAfterSec: 25, slowMs: 3000 }`.
   */
  connectionBanner?: boolean | { staleAfterSec?: number; slowMs?: number };
  /**
   * Minimum time between two foreground device reports, ms (default 30000). Lock screens, permission prompts
   * and system dialogs fire repeated "active" events; this keeps them from each reaching the report path.
   * The report itself is also throttled (15 minutes) in the install register.
   */
  foregroundReportMinMs?: number;
  /** Normalises an instance URL into the key per-server state is stored under. */
  instanceKey?: (url: string | null | undefined) => string;
  /** The device's hardware id, when the host has a better source than the Android ID. */
  deviceKey?: () => string | null;
  /** Long-press on the avatar for 2 s (hidden server switcher in the existing apps). */
  onAvatarLongPress?: () => void;
  /** A bundle downloaded within this long of opening is applied by an immediate restart. */
  otaOpenWindowMs?: number;
  /**
   * Silent re-login for the kit's own calls (device register, reports, support, crash reports): when the server says
   * the session is dead, `login` is called with the credentials the person kept behind their fingerprint (see the
   * vault) and the call is retried once. Wrap your own client with `withSessionRecovery` to get the same.
   */
  sessionRecovery?: SessionRecovery;
  /**
   * Also look for an update each time the app comes back to the foreground (default `true`). Handhelds are rarely
   * restarted, so checking only at launch would leave them on old code for days. A bundle found this way is not
   * applied behind the person's back: they are asked "Restart now / Later".
   */
  otaOnForeground?: boolean;
  /** Minimum time between two foreground update checks, ms (default 600000, ten minutes). */
  foregroundUpdateCheckMinMs?: number;
};

/** Which pieces the host did not pass, so the kit is running on its built-in stand-ins. */
export type ConfigGap = 'useAuth' | 'api' | 'storage';

export const CONFIG_GAP_MESSAGES: Record<ConfigGap, string> = {
  useAuth: 'useAuth not configured — device register and sign-out are not connected to your session.',
  api: 'api not configured — the kit calls your site with plain fetch instead of your signed-in client, so the device register, Devices and crash reports may not be authenticated.',
  storage: 'storage not configured — the kit keeps its own state in AsyncStorage (or in memory when that is not installed), not in your app storage.',
};

export type ResolvedConfig = Omit<MobileKitConfig, 'theme' | 'endpoints' | 'api' | 'storage' | 'useAuth' | 'site' | 'environment'> & {
  /** True for each piece that is a built-in stand-in because the host did not pass its own. */
  standIns: Record<ConfigGap, boolean>;
  /** The site in use, after choosing the environment. */
  site?: string;
  environment: KitEnvironment;
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
  const { site, environment } = resolveSite(config.site, config.environment);
  current = {
    ...config,
    standIns: { useAuth: !config.useAuth, api: !config.api, storage: !config.storage },
    site,
    environment,
    storage,
    api: config.sessionRecovery ? withSessionRecovery(config.api ?? createFetchApi(site, config.authHeaders), config.sessionRecovery) : (config.api ?? createFetchApi(site, config.authHeaders)),
    useAuth: config.useAuth ?? createLocalAuth(site),
    theme: { ...DEFAULT_THEME, ...config.theme },
    endpoints: { ...DEFAULT_ENDPOINTS, ...config.endpoints },
  };
  warnConfigGaps();
}

let warnedGaps = false;

/** The pieces the host has not wired (empty when everything is the host's own). Safe to call before configure. */
export function getConfigGaps(): ConfigGap[] {
  if (!current) return [];
  return (Object.keys(current.standIns) as ConfigGap[]).filter((k) => current!.standIns[k]);
}

/** One console.warn per process in development, naming each unwired piece. Silent in release builds. */
function warnConfigGaps(): void {
  if (warnedGaps || typeof __DEV__ === 'undefined' || !__DEV__) return;
  const gaps = getConfigGaps();
  if (!gaps.length) return;
  warnedGaps = true;
  console.warn(`[@upande/mobile-kit] ${gaps.map((g) => CONFIG_GAP_MESSAGES[g]).join('\n[@upande/mobile-kit] ')}`);
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
  warnedGaps = false;
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
  fabPosition: 'upande_kit:fab_position',
  fabHidden: 'upande_kit:fab_hidden',
  lastCrash: 'upande_kit:last_crash',
  vaultOffered: 'upande_kit:vault_offered',
  vaultMarker: 'upande_kit:vault_enrolled',
  chatLastSeen: 'upande_kit:chat_last_seen',
  pushEnabled: 'upande_kit:push_enabled',
  pushOffered: 'upande_kit:push_offered',
  pushToken: 'upande_kit:push_token',
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
