import { AppState, Appearance, Dimensions, PixelRatio, Platform } from 'react-native';
import { hasNativeModule } from '../native-probe';
import * as Updates from 'expo-updates';
import { getInstallId } from '../devices/install-register';
import { androidId } from '../devices/device-key';
import { missingModuleNames } from '../modules';
import { getConfig, isConfigured } from '../config';
import { APP_VERSION, runtimeVersion } from '../version';
import { LIMITS, type DeviceFacts } from './types';
import { apiTimingSummary, getProbeSite, lastLatencyMs, refreshLatency } from './net-stats';

/**
 * Device facts for a report. Static facts are read once; dynamic ones (battery,
 * storage, network) are read when an event is built, off the hot path, each
 * probe with its own timeout, and cached for 30 s so an error storm costs one read.
 *
 * Every native module here is optional. Each is `require`d only after its native
 * side is known to exist, so an OTA bundle never loads one an APK was built
 * without. A missing module just leaves its fields out.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- optional modules, typed loosely on purpose
type AnyModule = any;

const cache = new Map<string, AnyModule | null>();
function optional(nativeName: string, load: () => AnyModule): AnyModule | null {
  if (cache.has(nativeName)) return cache.get(nativeName) ?? null;
  let mod: AnyModule | null = null;
  try {
    if (hasNativeModule(nativeName)) mod = load();
  } catch {
    mod = null;
  }
  cache.set(nativeName, mod);
  return mod;
}
/* eslint-disable @typescript-eslint/no-require-imports -- must not load without the native module */
const device = () => optional('ExpoDevice', () => require('expo-device'));
const battery = () => optional('ExpoBattery', () => require('expo-battery'));
const network = () => optional('ExpoNetwork', () => require('expo-network'));
const localization = () => optional('ExpoLocalization', () => require('expo-localization'));
/* eslint-enable @typescript-eslint/no-require-imports */

const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | undefined> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(undefined), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      () => {
        clearTimeout(t);
        resolve(undefined);
      },
    );
  });
}

let staticFacts: DeviceFacts | null = null;

export function readStaticFacts(): DeviceFacts {
  if (staticFacts) return staticFacts;
  const c = (Platform.constants ?? {}) as Record<string, unknown>;
  const d = device();
  const fingerprint = (str(c.Fingerprint) ?? '').toLowerCase();
  const model = str(d?.modelName) ?? str(c.Model);
  const emulator = fingerprint.includes('generic') || fingerprint.includes('emulator') || (model ?? '').toLowerCase().includes('sdk_gphone');
  const l = localization();
  const locale = str(l?.getLocales?.()?.[0]?.languageTag) ?? str(safe(() => Intl.DateTimeFormat().resolvedOptions().locale));
  const timezone = str(l?.getCalendars?.()?.[0]?.timeZone) ?? str(safe(() => Intl.DateTimeFormat().resolvedOptions().timeZone));
  const hermes = !!(globalThis as { HermesInternal?: unknown }).HermesInternal;
  const built: DeviceFacts = strip({
    platform: Platform.OS,
    os_version: str(d?.osVersion) ?? str(c.Release) ?? String(Platform.Version ?? ''),
    os_build: str(d?.osBuildId) ?? str(c.Incremental),
    brand: str(d?.brand) ?? str(c.Brand) ?? str(c.Manufacturer),
    model,
    device_name: str(d?.deviceName),
    is_physical_device: typeof d?.isDevice === 'boolean' ? d.isDevice : !emulator,
    memory_total_bytes: num(d?.totalMemory),
    locale,
    timezone,
    js_engine: hermes ? 'hermes' : 'jsc',
    build_type: (__DEV__ ? 'dev' : Updates.isEmbeddedLaunch ? 'embedded' : 'ota') as DeviceFacts['build_type'],
    device_key: safe(() => androidId()) ?? undefined,
    missing_modules: missingFor(),
  });
  staticFacts = built;
  return built;
}

/** Modules this build lacks, for the report (undefined when none). Biometric is skipped when the host owns the lock. */
function missingFor(): string[] | undefined {
  const skip = isConfigured() && getConfig().biometric === 'host' ? ['expo-local-authentication'] : [];
  const names = safe(() => missingModuleNames(skip)) ?? [];
  return names.length ? names : undefined;
}

function safe<T>(f: () => T): T | undefined {
  try {
    return f();
  } catch {
    return undefined;
  }
}

function strip<T extends object>(o: T): T {
  for (const k of Object.keys(o) as (keyof T)[]) if (o[k] === undefined || o[k] === null) delete o[k];
  return o;
}

function screenFacts(): Pick<DeviceFacts, 'screen' | 'orientation' | 'app_state' | 'color_scheme'> {
  const w = safe(() => Dimensions.get('window'));
  return strip({
    screen: w ? { width: w.width, height: w.height, scale: PixelRatio.get(), font_scale: PixelRatio.getFontScale() } : undefined,
    orientation: w ? (w.width > w.height ? ('landscape' as const) : ('portrait' as const)) : undefined,
    app_state: str(AppState.currentState),
    color_scheme: str(safe(() => Appearance.getColorScheme())),
  });
}

async function readDynamic(): Promise<DeviceFacts> {
  const t = LIMITS.deviceTimeoutMs;
  const b = battery();
  const n = network();
  const [level, state, lowPower, net, free, total] = await Promise.all([
    b ? withTimeout(Promise.resolve(b.getBatteryLevelAsync()), t) : undefined,
    b ? withTimeout(Promise.resolve(b.getBatteryStateAsync()), t) : undefined,
    b ? withTimeout(Promise.resolve(b.isLowPowerModeEnabledAsync?.()), t) : undefined,
    n ? withTimeout(Promise.resolve(n.getNetworkStateAsync()), t) : undefined,
    disk('free'),
    disk('total'),
  ]);
  const types = n?.NetworkStateType as Record<string | number, string> | undefined;
  // Background latency probe (answer shows up on a later read) and the optional link details; neither is waited on.
  refreshLatency(siteUrl());
  const link = await withTimeout(linkDetails(), t);
  return strip({
    ...link,
    latency_ms: lastLatencyMs(),
    ...apiTimingSummary(),
    battery_level: typeof level === 'number' && level >= 0 ? level : undefined,
    battery_state: state !== undefined ? (str(b?.BatteryState?.[state]) ?? String(state)).toLowerCase() : undefined,
    low_power_mode: typeof lowPower === 'boolean' ? lowPower : undefined,
    network_type: net ? (str(types?.[net.type]) ?? str(net.type))?.toLowerCase() : undefined,
    is_connected: typeof net?.isConnected === 'boolean' ? net.isConnected : undefined,
    is_internet_reachable: typeof net?.isInternetReachable === 'boolean' ? net.isInternetReachable : undefined,
    storage_free_bytes: free,
    storage_total_bytes: total,
  });
}

function siteUrl(): string | undefined {
  try {
    return getProbeSite() || getConfig().site || undefined;
  } catch {
    return undefined;
  }
}

/** Wi-Fi name / link speed / signal, when `@react-native-community/netinfo` is installed in the build. */
async function linkDetails(): Promise<Partial<DeviceFacts>> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- optional, only after its native side answers
  const ni = optional('RNCNetInfo', () => require('@react-native-community/netinfo'));
  const fetchState = ni?.fetch ?? ni?.default?.fetch;
  if (!fetchState) return {};
  const state = await fetchState.call(ni?.default ?? ni);
  const d = (state?.details ?? {}) as Record<string, unknown>;
  return strip({
    wifi_ssid: str(d.ssid) && d.ssid !== '<unknown ssid>' ? str(d.ssid) : undefined,
    wifi_signal_pct: num(d.strength),
    wifi_link_mbps: num(d.linkSpeed) ?? num(d.txLinkSpeed),
    wifi_frequency_mhz: num(d.frequency),
    cellular_generation: str(d.cellularGeneration),
    carrier: str(d.carrier),
  });
}

/** Disk space: the current expo-file-system `Paths` API, falling back to its legacy module. */
async function disk(which: 'free' | 'total'): Promise<number | undefined> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- peer dependency of the kit
    const fs = require('expo-file-system');
    const v = which === 'free' ? fs?.Paths?.availableDiskSpace : fs?.Paths?.totalDiskSpace;
    if (typeof v === 'number') return v;
  } catch {
    // fall through
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- legacy entry point
    const legacy = require('expo-file-system/legacy');
    return num(await withTimeout(Promise.resolve(which === 'free' ? legacy.getFreeDiskStorageAsync() : legacy.getTotalDiskCapacityAsync()), LIMITS.deviceTimeoutMs));
  } catch {
    return undefined;
  }
}

let dynamicCache: { at: number; facts: DeviceFacts } | null = null;
let dynamicInflight: Promise<DeviceFacts> | null = null;

/** Static + dynamic facts. Dynamic part cached for 30 s; one read in flight at a time. */
export async function collectDeviceFacts(now = Date.now()): Promise<DeviceFacts> {
  if (!dynamicCache || now - dynamicCache.at >= LIMITS.deviceCacheMs) {
    dynamicInflight ??= readDynamic().finally(() => {
      dynamicInflight = null;
    });
    const facts = await dynamicInflight;
    dynamicCache = { at: now, facts };
  }
  const installId = await getInstallId().catch(() => null);
  return { ...readStaticFacts(), ...dynamicCache.facts, ...screenFacts(), ...(installId ? { install_id: installId } : {}) };
}

/** What is already known without any async work: used when the app is about to die. */
export function peekDeviceFacts(): DeviceFacts {
  return { ...readStaticFacts(), ...(dynamicCache?.facts ?? {}), ...screenFacts() };
}

export function appBuildFacts(): { app_version: string; runtime_version?: string; update_id?: string } {
  const out: { app_version: string; runtime_version?: string; update_id?: string } = { app_version: APP_VERSION };
  const rt = runtimeVersion();
  if (rt) out.runtime_version = rt;
  const id = str(Updates.updateId);
  if (id) out.update_id = id;
  return out;
}

/** For tests. */
export function resetDeviceCache(): void {
  staticFacts = null;
  dynamicCache = null;
  dynamicInflight = null;
  cache.clear();
}
