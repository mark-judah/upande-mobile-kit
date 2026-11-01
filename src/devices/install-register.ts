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

/**
 * Marks a stored report as one that carried the full device snapshot. Reports sent by older kit versions lack
 * it, so the first launch after an update re-reports once and the server gets battery, storage and the rest.
 */
const HEALTH_MARK = 'h1';
/** How long a report waits for the device probes before sending whatever is already known. */
const HEALTH_WAIT_MS = 1000;
/** How long the monitor waits for the launch report before sending anyway. */
const LAUNCH_WAIT_MS = 5000;

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

/** The device's own name ("OnePlus Nord CE5") when expo-device is there to say it. */
function knownDeviceName(): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy: monitor/device imports this file
    const name = require('../monitor/device').readStaticFacts()?.device_name;
    return typeof name === 'string' && name ? name : null;
  } catch {
    return null;
  }
}

/**
 * The full device snapshot (battery, storage, memory, network, locale, screen, build, missing modules ...) as
 * the JSON the server stores as this device's health. Whatever the probes have not answered within a second is
 * left out rather than delaying the report; never throws.
 */
export async function collectHealth(): Promise<string | undefined> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy: monitor/device imports this file
    const dev = require('../monitor/device') as typeof import('../monitor/device');
    const known = (): Record<string, unknown> => {
      try {
        return dev.peekDeviceFacts() as Record<string, unknown>;
      } catch {
        return {};
      }
    };
    const facts = await new Promise<Record<string, unknown>>((resolve) => {
      let done = false;
      const finish = (get: () => Record<string, unknown>) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(get());
      };
      const timer = setTimeout(() => finish(known), HEALTH_WAIT_MS);
      try {
        Promise.resolve(dev.collectDeviceFacts()).then(
          (f) => finish(() => (f ?? {}) as Record<string, unknown>),
          () => finish(known),
        );
      } catch {
        finish(known);
      }
    });
    // The hardware key and install id travel as their own fields; the snapshot never repeats them.
    const { device_key: _key, install_id: _id, ...rest } = facts;
    return Object.keys(rest).length ? JSON.stringify(rest) : undefined;
  } catch {
    return undefined;
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
    device_name: knownDeviceName(),
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
/** The launch report while it is running; null when there is none (or it has finished). */
let launchInflight: Promise<void> | null = null;

/**
 * Resolves once the launch report has finished, or after a few seconds. Resolves at once when none is running.
 * The crash monitor waits on this before its first send, so a server that learns about an app from its first
 * device report already has the app when the first crash report arrives.
 */
export function waitForLaunchRegistration(timeoutMs: number = LAUNCH_WAIT_MS): Promise<void> {
  const gate = launchInflight;
  if (!gate) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    gate.then(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}


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
  launchInflight = null;
  chain = Promise.resolve(null); // a report that hung in one test must not hold up the next
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

  const run = serialised(async () => {
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
        const versionKey = `${facts.app_version}|${facts.runtime_version ?? ''}|${HEALTH_MARK}`;
        if (shouldSkipReport({ reason, account, lastUser, lastVersion, versionKey, last, now })) return null;
      }

      const installId = await getInstallId();
      if (!installId) return null;

      const health = await collectHealth();
      const result = await api<{ message?: { install_id?: string } }>({
        method: 'POST',
        url: endpoints.registerInstall,
        data: { install_id: installId, app: appName, reason, ...facts, ...(health ? { device_info: health } : {}) },
      });

      // Only after the server accepted it, so a failed send retries next time.
      await Promise.all([
        storage.set(keyLastReport, String(now)).catch(() => {}),
        storage.set(keyLastVersion, `${facts.app_version}|${facts.runtime_version ?? ''}|${HEALTH_MARK}`).catch(() => {}),
        account ? storage.set(keyLastUser, account).catch(() => {}) : null,
        result?.message?.install_id ? storage.set(`${KEY_ROW_ID}:${server}`, result.message.install_id).catch(() => {}) : null,
      ]);
      return result;
    } catch (err) {
      logOnce('report', err);
      return null;
    }
  });
  if (reason === 'launch') {
    const gate: Promise<void> = run.then(
      () => undefined,
      () => undefined,
    );
    launchInflight = gate;
    gate.then(() => {
      if (launchInflight === gate) launchInflight = null;
    });
  }
  return run;
}
