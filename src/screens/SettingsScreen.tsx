import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Alert, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { CONFIG_GAP_MESSAGES, DEFAULT_DEVICES_ROUTE, getConfig, getConfigGaps, type KitTheme } from '../config';
import { describeMissing, missingAdvice, missingModules } from '../modules';
import { registerKitScreen } from '../route-guard';
import * as Biometric from '../biometric';
import { ApkUpdateSection } from '../updates/ApkUpdateSection';
import { useApkUpdate } from '../updates/UpdateProvider';
import { compareVersions } from '../updates/releases';
import { APP_VERSION, codeLine, getServerVersions } from '../version';
import { fontSize, spacing, ui } from '../ui/primitives';
import { VaultRow } from '../vault/VaultRow';
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
  const s = useMemo(() => styles(cfg.theme), [cfg.theme]);

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
          await auth.forgetDevice?.();
          goToLogin();
        },
      },
    ]);
  };

  return (
    <Screen title="Settings">
      <Card>
        <View style={s.avatarRow}>
          <Pressable style={s.avatar} onLongPress={cfg.onAvatarLongPress} delayLongPress={2000}>
            <Text style={s.avatarInitials}>{(name || '?').slice(0, 1).toUpperCase()}</Text>
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={s.userName}>{name || 'Signed in'}</Text>
            {auth.email ? <Text style={s.userEmail}>{auth.email}</Text> : null}
            {auth.instanceUrl ? <Text style={s.userMeta}>{auth.instanceUrl}</Text> : null}
          </View>
        </View>
        {profileExtra}
      </Card>

      {gaps.length ? (
        <Card title="Dev notice">
          {gaps.map((g) => (
            <Text key={g} style={s.rowHint}>
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
          <View style={s.row}>
            <View style={{ flex: 1 }}>
              <Text style={s.rowLabel}>Biometric unlock</Text>
              <Text style={s.rowHint}>
                {!moduleReady
                  ? 'Install latest build to enable'
                  : !hardwareReady
                    ? 'Enroll fingerprint/face in device settings'
                    : hostOwnsLock
                      ? 'Lock the app with fingerprint or face when you come back to it'
                      : 'Skip the password with fingerprint or face'}
              </Text>
            </View>
            <Toggle value={auth.biometricEnabled} onChange={onToggleBiometric} styles={s} />
          </View>
            </>
          )}
        </Card>
      ) : null}

      <SupportCard />

      {showMonitorRow ? (
        <Card title="Diagnostics">
          <View style={s.row}>
            <View style={{ flex: 1 }}>
              <Text style={s.rowLabel}>Send crash reports</Text>
              <Text style={s.rowHint}>Helps fix problems: errors, failed requests and device details (no passwords).</Text>
            </View>
            <Toggle value={sendReports} onChange={onToggleReports} styles={s} />
          </View>
          {showTestActions ? (
            <>
              <View style={{ height: spacing.sm }} />
              <Button label="Send test error" variant="outline" onPress={onTestError} iconLeft="bug-outline" />
            </>
          ) : null}
        </Card>
      ) : null}

      <Card title="App & Server">
        <InfoRow label="App" value={cfg.appName} styles={s} />
        <InfoRow label="Site" value={auth.instanceUrl ? auth.instanceUrl.replace(/^https?:\/\//, '') : '—'} styles={s} />
        {siteApps === null ? (
          <InfoRow label="Apps" value="Loading…" styles={s} />
        ) : siteApps.length === 0 ? (
          <InfoRow label="Apps" value="Not available" styles={s} />
        ) : (
          siteApps.map((a) => <InfoRow key={a.label} label={a.label} value={`v${a.version}`} styles={s} />)
        )}
        <InfoRow label="Installed" value={`v${APP_VERSION}`} styles={s} />
        <InfoRow label="Latest" value={`v${latest}`} styles={s} />
        <InfoRow label="Code" value={codeLine()} styles={s} />
        <View style={{ height: spacing.md }} />
        <ApkUpdateSection />
      </Card>

      {missing.length ? (
        <Card title="Not available in this build">
          {missing.map((m) => (
            <View key={m.pkg} style={s.missingRow}>
              <Text style={s.rowLabel}>{describeMissing(m)}</Text>
              <Text style={s.rowHint}>{m.pkg}</Text>
            </View>
          ))}
          <Text style={[s.rowHint, { marginTop: spacing.sm }]}>
            {missingAdvice(missing)}
          </Text>
        </Card>
      ) : null}

      {extraSections}

      {auth.isSystemManager ? (
        <Card>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push((cfg.devicesRoute ?? DEFAULT_DEVICES_ROUTE) as never)}
            style={({ pressed }) => [s.row, pressed && { opacity: 0.7 }]}
          >
            <Ionicons name="phone-portrait-outline" size={20} color={cfg.theme.textSecondary} />
            <Text style={[s.rowLabel, { flex: 1 }]}>Devices</Text>
            <Ionicons name="chevron-forward" size={18} color={cfg.theme.textMuted} />
          </Pressable>
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
              color={cfg.theme.danger}
              onPress={onForgetDevice}
              iconLeft="trash-outline"
            />
          ) : null}
        </Card>
      ) : null}
    </Screen>
  );
}

type S = ReturnType<typeof styles>;

function InfoRow({ label, value, styles: s }: { label: string; value: string; styles: S }) {
  return (
    <View style={s.infoRow}>
      <Text style={[s.rowLabel, s.infoLabel]}>{label}</Text>
      <Text style={s.infoValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function Toggle({ value, onChange, styles: s }: { value: boolean; onChange: () => void; styles: S }) {
  return (
    <TouchableOpacity
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      onPress={onChange}
      activeOpacity={0.8}
      style={[s.toggle, value && s.toggleOn]}
    >
      <View style={[s.toggleDot, value && s.toggleDotOn]} />
    </TouchableOpacity>
  );
}

const styles = (t: KitTheme) =>
  StyleSheet.create({
    avatarRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    avatar: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: t.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarInitials: { fontFamily: t.fontBold || undefined, fontSize: fontSize.md, color: t.textOnPrimary, fontWeight: '700' },
    userName: { fontFamily: t.fontSemiBold || undefined, fontSize: fontSize.md, color: t.text, fontWeight: '600' },
    userEmail: { fontFamily: t.fontRegular || undefined, fontSize: fontSize.sm, color: t.textSecondary, marginTop: 2 },
    userMeta: { fontFamily: t.fontBold || undefined, fontSize: fontSize.xs, color: t.text, marginTop: 2 },
    row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    missingRow: { paddingVertical: 4 },
    infoRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.md,
      paddingVertical: 4,
    },
    infoLabel: { flexShrink: 1 },
    infoValue: { flexShrink: 1, fontFamily: t.fontRegular || undefined, fontSize: fontSize.sm, color: t.textSecondary },
    rowLabel: { fontFamily: t.fontSemiBold || undefined, fontSize: fontSize.sm, color: t.text, fontWeight: '600' },
    rowHint: { fontFamily: t.fontRegular || undefined, fontSize: fontSize.xs, color: t.textMuted, marginTop: 2 },
    toggle: { width: 46, height: 26, borderRadius: 13, backgroundColor: '#E5E5E5', padding: 3, justifyContent: 'center' },
    toggleOn: { backgroundColor: t.text },
    toggleDot: { width: 20, height: 20, borderRadius: 10, backgroundColor: t.surface },
    toggleDotOn: { transform: [{ translateX: 20 }] },
  });
