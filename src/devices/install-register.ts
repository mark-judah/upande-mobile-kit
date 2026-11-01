import { Platform } from 'react-native';
import { getConfig, instanceKeyOf, KitKeys } from '../config';
import { APP_VERSION, runtimeVersion } from '../version';
import { androidId } from './device-key';

/**
 * The device register: which handhelds run this app, and which build each
 * signed-in person is on. The server side is the `upande_mobile` Frappe app's
 * `register_install`, one register for every app that uses the kit (told apart by
 * `appName`, a Mobile App record).
 *
 * Sent: a random install id, a hardware device key, platform, brand / model,
 * OS version, app and runtime versions, and whether it is a real device. No IP
 * or location — the server records the IP it observes.
 *
 * The device key is the Android ID (`device-key.ts`, from React Native's own
 * PlatformConstants module, so no extra native dependency); null off Android.
 * It keeps one physical device on one server row however often its install id
 * is re-minted. It is sent raw; the server stores only a SHA-256 of it.
 *
 * The install id lives in the host's storage under its own key, outside any
 * "clear on sign-out" list: signing out keeps the same device row, only an
 * uninstall mints a new one. The server answers with the row the report was
 * filed under (another install id when the device key matched an older row);
 * that is kept per server for the Devices screen's "this device".
 *
 * Nothing here is visible: every failure resolves to null.
 */

const KEY_INSTALL_ID = KitKeys.installId;
const KEY_LAST_REPORT = KitKeys.lastReport;
const KEY_LAST_USER = KitKeys.lastUser;
const KEY_LAST_VERSION = KitKeys.lastVersion;
const KEY_ROW_ID = KitKeys.rowId;

/** At most one launch report an hour for the same account on the same version. */
const LAUNCH_INTERVAL_MS = 60 * 60 * 1000;
/** At most one foreground report every 15 minutes. */
const FOREGROUND_INTERVAL_MS = 15 * 60 * 1000;

export type InstallReason = 'login' | 'launch' | 'foreground';

export type InstallFacts = {
  platform: string;
  device_brand: string | null;
  device_model: string | null;
  device_name: string | null;
  os_version: string | null;
  app_version: string;
  runtime_version: string | null;
  is_physical_device: 0 | 1;
  device_key: string | null;
};

let loggedOnce = false;
function logOnce(where: string, err: unknown) {
  if (!__DEV__ || loggedOnce) return;
  loggedOnce = true;
  console.log(`[install] ${where}: ${err instanceof Error ? err.message : String(err)}`);
}

function randomId(): string {
  const hex = '0123456789abcdef';
  let out = '';
  for (let i = 0; i < 32; i += 1) out += hex[Math.floor(Math.random() * 16)];
  return `${out.slice(0, 8)}-${out.slice(8, 12)}-4${out.slice(13, 16)}-${out.slice(16, 20)}-${out.slice(20)}`;
}

let cachedInstallId: string | null = null;

/** This install's id, minted on first run. Null when storage is unusable. */
export async function getInstallId(): Promise<string | null> {
  if (cachedInstallId) return cachedInstallId;
  try {
    const { storage } = getConfig();
    const stored = await storage.get(KEY_INSTALL_ID);
    if (stored) {
      cachedInstallId = stored;
      return stored;
    }
    const minted = randomId();
    await storage.set(KEY_INSTALL_ID, minted);
    cachedInstallId = minted;
    return minted;
  } catch (err) {
    logOnce('install id', err);
    return null;
  }
}

/** What this device and this build are. */
export function deviceFacts(): InstallFacts {
  const c = (Platform.constants ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
  const fingerprint = (str(c.Fingerprint) ?? '').toLowerCase();
  const model = str(c.Model);
  const emulator =
    fingerprint.includes('generic') ||
    fingerprint.includes('emulator') ||
    (model ?? '').toLowerCase().includes('sdk_gphone');
  return {
    platform: Platform.OS,
    device_brand: str(c.Brand) ?? str(c.Manufacturer),
    device_model: model ?? (Platform.OS === 'ios' ? str(c.interfaceIdiom) : null),
    device_name: null,
    os_version: str(c.Release) ?? str(c.osVersion) ?? String(Platform.Version ?? ''),
    app_version: APP_VERSION,
    runtime_version: runtimeVersion(),
    is_physical_device: emulator ? 0 : 1,
    device_key: (getConfig().deviceKey ?? androidId)(),
  };
}

function rowIdKey(instanceUrl: string | null | undefined): string {
  return `${KEY_ROW_ID}:${instanceKeyOf(instanceUrl)}`;
}

/** The server row this device was last filed under on the current server, or null. */
export async function getRegisteredRowId(instanceUrl?: string | null): Promise<string | null> {
  try {
    return (await getConfig().storage.get(rowIdKey(instanceUrl))) || null;
  } catch {
    return null;
  }
}

let reportedLaunchThisProcess = false;
let lastForegroundAt = 0;


/**
 * Whether a launch / foreground report can be skipped: same account, same
 * build, and the last accepted report is inside the interval. A login is never
 * skipped, and a changed version or account always reports.
 */
export function shouldSkipReport(a: {
  reason: InstallReason;
  account: string | null;
  lastUser: string | null;
  lastVersion: string | null;
  versionKey: string;
  last: number;
  now: number;
}): boolean {
  if (a.reason === 'login') return false;
  const sameUser = !a.account || !a.lastUser || a.lastUser === a.account;
  const sameVersion = a.lastVersion === a.versionKey;
  const interval = a.reason === 'foreground' ? FOREGROUND_INTERVAL_MS : LAUNCH_INTERVAL_MS;
  // A stamp in the future (clock moved back) counts as due.
  return sameUser && sameVersion && !!a.last && a.last <= a.now && a.now - a.last < interval;
}

/** Test hook: forget the once-per-process throttles. */
export function resetReportState(): void {
  reportedLaunchThisProcess = false;
  lastForegroundAt = 0;
  cachedInstallId = null;
}

// Serialised, so a sign-in and the launch hook firing in the same tick don't
// both read the throttle before either writes it.
let chain: Promise<unknown> = Promise.resolve(null);
function serialised<T>(task: () => Promise<T>): Promise<T> {
  const run = chain.then(task, task);
  chain = run.then(
    () => null,
    () => null,
  );
  return run;
}

/**
 * Tell the server this device exists and which build this account is on.
 * Never rejects. `user` feeds the throttle only — the server files the row
 * under the session's account.
 *
 * Sign-ins are never throttled. A launch or foreground report is skipped
 * inside its interval for the same account on the same server — unless the version changed
 * since the last report, so an over-the-air update shows at once.
 */
export function reportInstall({
  reason = 'launch',
  user,
  instanceUrl,
}: { reason?: InstallReason; user?: string | null; instanceUrl?: string | null } = {}) {
  const now = Date.now();
  if (reason === 'launch') {
    if (reportedLaunchThisProcess) return Promise.resolve(null);
    reportedLaunchThisProcess = true;
  }
  if (reason === 'foreground') {
    if (now - lastForegroundAt < FOREGROUND_INTERVAL_MS) return Promise.resolve(null);
    lastForegroundAt = now;
  }

  return serialised(async () => {
    try {
      const account = user || null;
      const facts = deviceFacts();
      // The throttle is per server: each server keeps its own register, so a
      // report to one says nothing about another.
      const { storage, api, appName, endpoints } = getConfig();
      const server = instanceKeyOf(instanceUrl);
      const keyLastReport = `${KEY_LAST_REPORT}:${server}`;
      const keyLastUser = `${KEY_LAST_USER}:${server}`;
      const keyLastVersion = `${KEY_LAST_VERSION}:${server}`;

      if (reason !== 'login') {
        const [last, lastUser, lastVersion] = await Promise.all([
          storage.get(keyLastReport).then((v) => Number(v) || 0),
          storage.get(keyLastUser).catch(() => null),
          storage.get(keyLastVersion).catch(() => null),
        ]);
        const versionKey = `${facts.app_version}|${facts.runtime_version ?? ''}`;
        if (shouldSkipReport({ reason, account, lastUser, lastVersion, versionKey, last, now })) return null;
      }

      const installId = await getInstallId();
      if (!installId) return null;

      const result = await api<{ message?: { install_id?: string } }>({
        method: 'POST',
        url: endpoints.registerInstall,
        data: { install_id: installId, app: appName, reason, ...facts },
      });

      // Only after the server accepted it, so a failed send retries next time.
      await Promise.all([
        storage.set(keyLastReport, String(now)).catch(() => {}),
        storage.set(keyLastVersion, `${facts.app_version}|${facts.runtime_version ?? ''}`).catch(() => {}),
        account ? storage.set(keyLastUser, account).catch(() => {}) : null,
        result?.message?.install_id ? storage.set(`${KEY_ROW_ID}:${server}`, result.message.install_id).catch(() => {}) : null,
      ]);
      return result;
    } catch (err) {
      logOnce('report', err);
      return null;
    }
  });
}
