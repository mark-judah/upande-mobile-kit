/** Wire + config types for crash and API monitoring (see README "Crash & API monitoring"). */

export type MonitorKind = 'crash' | 'error' | 'api' | 'log';
export type MonitorLevel = 'fatal' | 'error' | 'warning' | 'info';

export type Breadcrumb = {
  ts: string;
  type: 'navigation' | 'api' | 'console' | 'user' | 'log';
  message: string;
  data?: Record<string, unknown>;
};

export type DeviceFacts = {
  platform?: string;
  os_version?: string;
  os_build?: string;
  brand?: string;
  model?: string;
  device_name?: string;
  is_physical_device?: boolean;
  battery_level?: number;
  battery_state?: string;
  low_power_mode?: boolean;
  storage_free_bytes?: number;
  storage_total_bytes?: number;
  memory_total_bytes?: number;
  network_type?: string;
  is_connected?: boolean;
  is_internet_reachable?: boolean;
  carrier?: string;
  locale?: string;
  timezone?: string;
  screen?: { width: number; height: number; scale: number; font_scale: number };
  orientation?: 'portrait' | 'landscape';
  app_state?: string;
  color_scheme?: string;
  js_engine?: string;
  build_type?: 'embedded' | 'ota' | 'dev';
  install_id?: string;
  device_key?: string;
  /** Optional native modules this build was compiled without (a rebuild is needed to get them). */
  missing_modules?: string[];
};

export type ApiRecord = {
  method: string;
  url: string;
  status: number | null;
  duration_ms: number;
  request_headers?: Record<string, string>;
  request_body?: string;
  response_headers?: Record<string, string>;
  response_body?: string;
  truncated?: boolean;
  error?: string;
};

export type MonitorUser = { id: string; full_name?: string; roles?: string[] };

export type MonitorEvent = {
  id: string;
  kind: MonitorKind;
  level: MonitorLevel;
  ts: string;
  message: string;
  name?: string;
  stack?: string;
  fatal?: boolean;
  count?: number;
  screen?: string;
  session_id: string;
  app_version: string;
  runtime_version?: string;
  update_id?: string;
  breadcrumbs: Breadcrumb[];
  request?: ApiRecord;
  device: DeviceFacts;
  user?: MonitorUser;
  extra?: Record<string, unknown>;
};

export type MonitorPayload = {
  app: string;
  install_id: string;
  sent_at: string;
  events: MonitorEvent[];
};

export type MonitorOptions = {
  /** Master switch. `false` installs nothing. Default true. */
  enabled?: boolean;
  /** Record request/response bodies of failed calls. Default true. */
  captureBodies?: boolean;
  /** Extra key names (case-insensitive substrings) to redact on top of the built-in list. */
  redactKeys?: string[];
  /** Bodies longer than this many bytes are truncated. Default 8192. */
  maxBodyBytes?: number;
  /** How many breadcrumbs to keep and attach. Default 30. */
  breadcrumbs?: number;
  /** URLs containing any of these strings (or matching a RegExp) are never recorded. */
  ignoreUrls?: (string | RegExp)[];
  /** Fraction (0-1) of successful calls recorded as metadata only. Default 0. */
  sampleSuccess?: number;
  /** Record console.warn / console.error as breadcrumbs. Default false. */
  consoleBreadcrumbs?: boolean;
  /**
   * Report `console.error(err)` calls that carry an Error (or error-like object), which apps often use for errors
   * they catch and log. Plain-string errors (React render warnings and the like) are never reported. Default true.
   */
  captureConsoleErrors?: boolean;
  /** Hard cap of events per app session. Default 200. */
  maxEventsPerSession?: number;
  /** Seconds between flushes while events wait. Default 30. */
  flushIntervalSec?: number;
  /** Show the "Send crash reports" row in Settings. Default true. */
  showToggle?: boolean;
  /** Show "send test error" buttons in Settings. Default `__DEV__`. */
  showTestActions?: boolean;
  /** Wrap the app in an error boundary that reports render errors. Default false. */
  errorBoundary?: boolean;
};

export const MONITOR_DEFAULTS = {
  enabled: true,
  captureBodies: true,
  maxBodyBytes: 8192,
  breadcrumbs: 30,
  sampleSuccess: 0,
  consoleBreadcrumbs: false,
  maxEventsPerSession: 200,
  flushIntervalSec: 30,
} as const;

/** Limits shared by the queue and the wire. */
export const LIMITS = {
  maxEventsPerRequest: 50,
  maxRequestBytes: 512 * 1024,
  maxQueuedEvents: 100,
  maxQueuedBytes: 1024 * 1024,
  flushAtCount: 20,
  rawBufferSize: 200,
  dedupeWindowMs: 60_000,
  deviceTimeoutMs: 1000,
  deviceCacheMs: 30_000,
  backoffBaseMs: 30_000,
  backoffMaxMs: 15 * 60_000,
} as const;
