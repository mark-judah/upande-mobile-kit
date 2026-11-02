import { getConfig } from '../config';
import { appBuildFacts, collectDeviceFacts } from '../monitor/device';
import { recentApiCalls } from '../monitor/core';
import { peekCrash, type StoredCrash } from './crash-store';

/** What a problem report carries besides the person's words. The person sees this list before sending. */
export type Diagnostics = {
  captured_at: string;
  app: { name: string; version: string; runtime_version?: string; update_id?: string };
  user: { id: string | null; full_name: string | null; server: string | null };
  device: Record<string, unknown>;
  recent_calls: { ts: string; method: string; url: string; status: number | null; ms: number }[];
  last_crash: StoredCrash | null;
};

export async function collectDiagnostics(who: { user?: string | null; fullName?: string | null; server?: string | null }): Promise<Diagnostics> {
  const facts = (await collectDeviceFacts().catch(() => ({}))) as Record<string, unknown>;
  const { device_key: _key, install_id: _id, ...device } = facts;
  return {
    captured_at: new Date().toISOString(),
    app: (({ app_version, ...rest }) => ({ name: getConfig().appName, version: app_version, ...rest }))(appBuildFacts()),
    user: { id: who.user ?? null, full_name: who.fullName ?? null, server: who.server ?? null },
    device,
    recent_calls: safe(() => recentApiCalls(15)) ?? [],
    last_crash: await peekCrash(),
  };
}

/** The short lines shown under "What will be sent". */
export function summarizeDiagnostics(d: Diagnostics, hasScreenshot: boolean): string[] {
  const dev = d.device as Record<string, string | number | boolean | undefined>;
  const lines = [
    `App ${d.app.name} ${d.app.version}${d.app.runtime_version ? ` (runtime ${d.app.runtime_version})` : ''}`,
    [dev.brand, dev.model].filter(Boolean).join(' ') + (dev.os_version ? `, ${dev.platform ?? ''} ${dev.os_version}`.trimEnd() : ''),
    dev.battery_level != null ? `Battery ${Math.round(Number(dev.battery_level) * 100)}%` : '',
    dev.network_type ? `Network ${dev.network_type}${dev.wifi_ssid ? ` (${dev.wifi_ssid})` : ''}${dev.latency_ms != null ? `, ${dev.latency_ms} ms to the server` : ''}` : '',
    d.user.id ? `Signed in as ${d.user.id}` : '',
    d.recent_calls.length ? `The last ${d.recent_calls.length} requests (addresses and results only)` : '',
    d.last_crash ? `The last crash: ${d.last_crash.message.slice(0, 80)}` : '',
    hasScreenshot ? 'A screenshot of the screen you were on' : '',
  ];
  return lines.filter(Boolean);
}

function safe<T>(f: () => T): T | undefined {
  try {
    return f();
  } catch {
    return undefined;
  }
}
