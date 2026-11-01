import { useEffect, useRef, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { getConfig } from './config';
import { UpdateProvider } from './updates/UpdateProvider';
import { reportInstall } from './devices/install-register';
import { usePathname } from 'expo-router';
import { addBreadcrumb, MonitorErrorBoundary, setMonitorContext, startMonitor } from './monitor';

/**
 * Mount once, inside the host's providers and below its auth gate:
 *
 *   <MobileKitProvider>{children}</MobileKitProvider>
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
      {monitoring ? <MonitorBridge /> : null}
      {monitoring && monitor?.errorBoundary ? <MonitorErrorBoundary>{children}</MonitorErrorBoundary> : children}
    </UpdateProvider>
  );
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
      if (state === 'active') reportInstall({ reason: 'foreground', user, instanceUrl });
    });
    return () => sub.remove();
  }, [user, instanceUrl]);

  return null;
}
