import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { DEFAULT_DEVICES_ROUTE, DEFAULT_SETTINGS_ROUTE, getConfig } from './config';
import { UpdateProvider } from './updates/UpdateProvider';
import { reportInstall } from './devices/install-register';
import { createForegroundGate, DEFAULT_FOREGROUND_REPORT_MIN_MS } from './devices/foreground-gate';
import { watchKitRoute } from './route-guard';
import { usePathname } from 'expo-router';
import { KitFab } from './ui/KitFab';
import { addBreadcrumb, MonitorErrorBoundary, setMonitorContext, startMonitor } from './monitor';

/**
 * Mount once, inside the host's providers and below its auth gate:
 *
 *   <MobileKitProvider>{children}</MobileKitProvider>
 *
 * It also floats a small Settings button over the app (`fab` in the config), the one entry point that works in
 * any app whatever its navigation looks like.
 *
 * It owns the update state (OTA applied on opening, the daily APK check, the
 * download/install) and keeps the device register current: a report on launch,
 * on every return to the foreground (throttled), and on sign-in.
 */
export function MobileKitProvider({ children }: { children: ReactNode }) {
  const monitor = getConfig().monitor;
  const monitoring = monitor?.enabled !== false;
  return (
    <UpdateProvider>
      <DeviceReporter />
      {__DEV__ ? <RouteWatcher /> : null}
      {monitoring ? <MonitorBridge /> : null}
      {monitoring && monitor?.errorBoundary ? <MonitorErrorBoundary>{children}</MonitorErrorBoundary> : children}
      <KitFab />
    </UpdateProvider>
  );
}

/** Development only: says so when the kit's Settings / Devices route is rendered by some other screen. */
function RouteWatcher() {
  const pathname = usePathname();
  useEffect(() => {
    const cfg = getConfig();
    return watchKitRoute(pathname, { settings: cfg.settingsRoute ?? DEFAULT_SETTINGS_ROUTE, devices: cfg.devicesRoute ?? DEFAULT_DEVICES_ROUTE });
  }, [pathname]);
  return null;
}

/** Starts crash / API monitoring, tells it who is signed in, and records screen changes as breadcrumbs. */
function MonitorBridge() {
  const auth = getConfig().useAuth();
  const pathname = usePathname();
  const roles = auth.roles ?? (auth.isSystemManager ? ['System Manager'] : []);
  const rolesKey = roles.join('|');

  useEffect(() => {
    startMonitor();
  }, []);

  useEffect(() => {
    setMonitorContext({
      user: auth.user ? { id: auth.user, full_name: auth.fullName ?? undefined, roles: rolesKey ? rolesKey.split('|') : [] } : null,
    });
  }, [auth.user, auth.fullName, rolesKey]);

  useEffect(() => {
    if (!pathname) return;
    setMonitorContext({ screen: pathname });
    addBreadcrumb({ type: 'navigation', message: pathname });
  }, [pathname]);

  return null;
}

function DeviceReporter() {
  const { user, instanceUrl } = getConfig().useAuth();
  const seenUser = useRef<string | null | undefined>(undefined);
  const foregroundMinMs = getConfig().foregroundReportMinMs ?? DEFAULT_FOREGROUND_REPORT_MIN_MS;
  const allowForeground = useMemo(() => createForegroundGate(foregroundMinMs), [foregroundMinMs]);

  // First signed-in value is a launch; a later change of account is a sign-in.
  useEffect(() => {
    if (!user) {
      // Signed out: the next account to appear is a sign-in, not a launch.
      seenUser.current = null;
      return;
    }
    const reason = seenUser.current === undefined || seenUser.current === user ? 'launch' : 'login';
    seenUser.current = user;
    reportInstall({ reason, user, instanceUrl });
  }, [user, instanceUrl]);

  useEffect(() => {
    if (!user) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && allowForeground()) reportInstall({ reason: 'foreground', user, instanceUrl });
    });
    return () => sub.remove();
  }, [user, instanceUrl, allowForeground]);

  return null;
}
