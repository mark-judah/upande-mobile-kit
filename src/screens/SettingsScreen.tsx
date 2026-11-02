import { useEffect, useState, type ReactNode } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { CONFIG_GAP_MESSAGES, DEFAULT_DEVICES_ROUTE, getConfig, getConfigGaps } from '../config';
import { describeMissing, missingAdvice, missingModules } from '../modules';
import { registerKitScreen } from '../route-guard';
import * as Biometric from '../biometric';
import { ApkUpdateSection } from '../updates/ApkUpdateSection';
import { useApkUpdate } from '../updates/UpdateProvider';
import { compareVersions } from '../updates/releases';
import { APP_VERSION, INSTALLED_APK_KNOWN, INSTALLED_APK_VERSION, codeLine, getServerVersions } from '../version';
import { KIT_VERSION } from '../kit-version';
import { font, fontSize, InfoRow, Row, spacing, Toggle, type, ui } from '../ui/primitives';
import { VaultRow } from '../vault/VaultRow';
import { cacheCredentials } from '../session/recovery';
import { unregisterToken } from '../push';
import { SupportCard } from '../support/SupportCard';
import { captureApiCall, captureException, flushNow, isMonitoringEnabled, monitoringReady, setMonitoringEnabled } from '../monitor';

/**
 * The shared Settings page: who is signed in, biometric unlock, the app and
 * server versions with the update controls, the device register (System
 * Managers) and the session buttons.
 *
 * `profileExtra` / `extraSections` let an app add its own rows without forking
 * the screen; `extraSections` render after the App & Server card.
 */
export function SettingsScreen({
  extraSections,
  profileExtra,
}: {
  extraSections?: ReactNode;
  profileExtra?: ReactNode;
}) {
  const cfg = getConfig();
  const { Screen, Card, Button, useToast } = ui();
  const auth = cfg.useAuth();
  const { showSuccess, showError } = useToast();
  const t = cfg.theme;
  const tx = type(t);

  const name = (auth.fullName ?? '').trim();
  // The route guard learns the kit's page is what renders here (dev collision warning).
  useEffect(() => registerKitScreen('settings'), []);
  // `biometric: 'host'`: the app owns the lock; the kit shows no switch and never prompts.
  const hostOwnsLock = cfg.biometric === 'host';
  // The switch shows unless the app owns the lock AND has not wired its own `useAuth`: then there is no real flag for
  // the switch to set. With `useAuth` wired (even with `biometric: 'host'`) it flips the app's own setting, so the
  // person finds the fingerprint option here whoever enforces the lock.
  const vaultMode = cfg.biometric === 'vault';
  const showBiometricRow = !hostOwnsLock || !cfg.standIns.useAuth;
  const [missing] = useState(() => missingModules(hostOwnsLock ? ['expo-local-authentication'] : []));
  const gaps = __DEV__ ? getConfigGaps() : [];
  const [moduleReady] = useState(() => Biometric.isModuleAvailable());
  const [hardwareReady, setHardwareReady] = useState(false);
  const [siteApps, setSiteApps] = useState<{ label: string; version: string }[] | null>(null);

  // The newest version known: the newest GitHub release of any kind, or this
  // app once a JS update has put it past that — so Latest bumps with every
  // update and never trails Installed.
  const newestRelease = useApkUpdate().check?.latestVersion ?? null;
  const latest = newestRelease && compareVersions(newestRelease, APP_VERSION) > 0 ? newestRelease : APP_VERSION;

  useEffect(() => {
    Biometric.isAvailable().then(setHardwareReady);
    getServerVersions().then(setSiteApps);
  }, []);

  // Crash reports: the person's own switch. Hidden when the app turned monitoring off or hid the row.
  const monitorCfg = cfg.monitor ?? {};
  const showMonitorRow = monitorCfg.enabled !== false && monitorCfg.showToggle !== false;
  const showTestActions = monitorCfg.showTestActions ?? __DEV__;
  const [sendReports, setSendReports] = useState(() => isMonitoringEnabled());
  useEffect(() => {
    monitoringReady().then(() => setSendReports(isMonitoringEnabled()));
  }, []);
  const onToggleReports = async () => {
    const next = !sendReports;
    setSendReports(next);
    try {
      await setMonitoringEnabled(next);
      showSuccess(next ? 'Crash reports will be sent.' : 'Crash reports turned off.');
    } catch (err) {
      setSendReports(!next);
      showError(err instanceof Error ? err.message : 'Could not update setting.');
    }
  };
  const onTestError = () => {
    captureException(new Error('Test error from Settings'), { test: true });
    captureApiCall({ method: 'POST', url: '/api/method/test.failing_call', status: 500, durationMs: 123, requestBody: { sample: 1, password: 'x' }, responseBody: '{"exc_type":"TestError"}' });
    void flushNow({ urgent: true }).then(() => showSuccess('Test report queued.'));
  };

  const goToLogin = () => router.replace((cfg.loginRoute ?? '/login') as never);

  const onToggleBiometric = async () => {
    if (!auth.biometricEnabled) {
      if (!moduleReady) {
        Alert.alert('Update needed', 'Install the latest build to enable biometric unlock.');
        return;
      }
      if (!hardwareReady) {
        Alert.alert('Biometric unavailable', 'Enroll a fingerprint or face in your device settings, then try again.');
        return;
      }
      const res = await Biometric.authenticate({
        promptMessage: 'Confirm biometric unlock',
        cancelLabel: 'Cancel',
        disableDeviceFallback: true,
      });
      if (!res.success) return;
    }
    try {
      await auth.setBiometricEnabled(!auth.biometricEnabled);
      showSuccess(auth.biometricEnabled ? 'Biometric unlock disabled.' : 'Biometric unlock enabled.');
    } catch (err) {
      showError(cfg.errorMessage ? cfg.errorMessage(err) : err instanceof Error ? err.message : 'Could not update setting.');
    }
  };

  const onSignOut = () => {
    Alert.alert('Sign out?', 'You can sign back in with biometrics or your password.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: async () => {
          cacheCredentials(null); // a signed-out phone must not sign itself back in
          await unregisterToken(); // and must stop receiving the signed-out person's replies
          await auth.logout?.();
          goToLogin();
        },
      },
    ]);
  };

  const onForgetDevice = () => {
    Alert.alert('Forget this device?', 'Clears your session and disables biometric unlock.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Forget',
        style: 'destructive',
        onPress: async () => {
          cacheCredentials(null);
          await unregisterToken();
          await auth.forgetDevice?.();
          goToLogin();
        },
      },
    ]);
  };

  return (
    <Screen title="Settings">
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <Pressable
            onLongPress={cfg.onAvatarLongPress}
            delayLongPress={2000}
            style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: t.primary, alignItems: 'center', justifyContent: 'center' }}
          >
            <Text style={[font(t, 'bold'), { fontSize: fontSize.lg, color: t.textOnPrimary }]}>{(name || '?').slice(0, 1).toUpperCase()}</Text>
          </Pressable>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[tx.h3, { letterSpacing: 0 }]} numberOfLines={1}>{name || 'Signed in'}</Text>
            {auth.email ? <Text style={tx.small} numberOfLines={1}>{auth.email}</Text> : null}
            {auth.instanceUrl ? <Text style={[tx.caption, { marginTop: 2 }]} numberOfLines={1}>{auth.instanceUrl.replace(/^https?:\/\//, '')}</Text> : null}
          </View>
        </View>
        {profileExtra}
      </Card>

      {gaps.length ? (
        <Card title="Dev notice">
          {gaps.map((g) => (
            <Text key={g} style={tx.small}>
              {CONFIG_GAP_MESSAGES[g]}
            </Text>
          ))}
        </Card>
      ) : null}

      {showBiometricRow ? (
        <Card title="Security">
          {vaultMode ? (
            <VaultRow />
          ) : (
            <>
          <Row
            icon="finger-print-outline"
            last
            label="Biometric unlock"
            hint={
              !moduleReady
                ? 'Install latest build to enable'
                : !hardwareReady
                  ? 'Enroll fingerprint/face in device settings'
                  : hostOwnsLock
                    ? 'Lock the app with fingerprint or face when you come back to it'
                    : 'Skip the password with fingerprint or face'
            }
            right={<Toggle value={auth.biometricEnabled} onChange={onToggleBiometric} />}
          />
            </>
          )}
        </Card>
      ) : null}

      <SupportCard />

      {showMonitorRow ? (
        <Card title="Diagnostics">
          <Row
            icon="pulse-outline"
            last={!showTestActions}
            label="Send crash reports"
            hint="Helps fix problems: errors, failed requests and device details (no passwords)."
            right={<Toggle value={sendReports} onChange={onToggleReports} />}
          />
          {showTestActions ? (
            <>
              <View style={{ height: spacing.xs }} />
              <Button label="Send test error" variant="outline" onPress={onTestError} iconLeft="bug-outline" />
            </>
          ) : null}
        </Card>
      ) : null}

      <Card title="App & Server">
        <InfoRow label="App" value={cfg.appName} strong />
        <InfoRow label="Site" value={auth.instanceUrl ? auth.instanceUrl.replace(/^https?:\/\//, '') : '—'} />
        {siteApps === null ? (
          <InfoRow label="Apps" value="Loading…" />
        ) : siteApps.length === 0 ? (
          <InfoRow label="Apps" value="Not available" />
        ) : (
          siteApps.map((a) => <InfoRow key={a.label} label={a.label} value={/^\d/.test(a.version) ? `v${a.version}` : a.version} />)
        )}
        <InfoRow label="Upande Mobile Kit" value={`v${KIT_VERSION}`} />
        <InfoRow label="Installed" value={`v${APP_VERSION}`} />
        {INSTALLED_APK_KNOWN ? <InfoRow label="APK" value={`v${INSTALLED_APK_VERSION}`} /> : null}
        <InfoRow label="Latest" value={`v${latest}`} />
        <InfoRow label="Code" value={codeLine()} last />
        <View style={{ height: spacing.md }} />
        <ApkUpdateSection />
      </Card>

      {missing.length ? (
        <Card title="Not available in this build">
          {missing.map((m) => (
            <View key={m.pkg} style={{ paddingVertical: 4 }}>
              <Text style={tx.label}>{describeMissing(m)}</Text>
              <Text style={tx.caption}>{m.pkg}</Text>
            </View>
          ))}
          <Text style={[tx.small, { marginTop: spacing.sm }]}>
            {missingAdvice(missing)}
          </Text>
        </Card>
      ) : null}

      {extraSections}

      {auth.isSystemManager ? (
        <Card title="Administration">
          <Row
            icon="phone-portrait-outline"
            last
            label="Devices"
            hint="Every phone running this app"
            onPress={() => router.push((cfg.devicesRoute ?? DEFAULT_DEVICES_ROUTE) as never)}
          />
        </Card>
      ) : null}

      {auth.logout || auth.forgetDevice ? (
        <Card title="Session">
          {auth.logout ? <Button label="Sign out" variant="outline" onPress={onSignOut} /> : null}
          {auth.logout && auth.forgetDevice ? <View style={{ height: spacing.sm }} /> : null}
          {auth.forgetDevice ? (
            <Button
              label="Forget this device"
              variant="outline"
              color={t.danger}
              onPress={onForgetDevice}
              iconLeft="trash-outline"
            />
          ) : null}
        </Card>
      ) : null}
    </Screen>
  );
}
