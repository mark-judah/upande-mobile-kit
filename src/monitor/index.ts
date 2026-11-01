import { getConfig } from '../config';
import { bindAppState, initState, markStarted, monitorOptions } from './core';
import {
  installConsoleBreadcrumbs, installErrorHandler, installFetchInterceptor, installRejectionTracking,
} from './instrument';

export {
  addBreadcrumb, captureApiCall, captureException, captureMessage, flushNow, isMonitoringEnabled, monitoringReady, setMonitorContext,
  setMonitoringEnabled,
} from './core';
export { attachAxios, withMonitoring } from './instrument';
export type { AxiosLike } from './instrument';
export { MonitorErrorBoundary } from './ErrorBoundary';
export type {
  Breadcrumb, DeviceFacts, MonitorEvent, MonitorKind, MonitorLevel, MonitorOptions, MonitorPayload, MonitorUser,
} from './types';

let undo: (() => void)[] = [];

/**
 * Start monitoring: load the person's choice, hook errors / rejections / fetch,
 * and watch the app going to the background. Idempotent. `MobileKitProvider`
 * calls it; call it yourself only if you don't use the provider. Does nothing
 * when `monitor.enabled` is false.
 */
export function startMonitor(): void {
  const o = monitorOptions();
  if (o.enabled === false) return;
  if (markStarted(true)) return;
  getConfig(); // fail early, with the fix, when the kit is not configured
  void initState();
  undo = [installErrorHandler(), installRejectionTracking(), installFetchInterceptor()];
  if (o.consoleBreadcrumbs) undo.push(installConsoleBreadcrumbs());
  bindAppState();
}

export function stopMonitor(): void {
  undo.forEach((u) => u());
  undo = [];
  markStarted(false);
}
