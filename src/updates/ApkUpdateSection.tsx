import { useCallback, useMemo, useState } from 'react';
import { Linking, Platform, StyleSheet, Text, View } from 'react-native';
import * as Updates from 'expo-updates';
import { Ionicons } from '@expo/vector-icons';
import { font, fontSize, Pill, radius, Segmented, spacing, type, ui, useTheme } from '../ui/primitives';
import { formatBytes, releasesPageUrl } from './releases';
import { openInBrowser, openUnknownAppSourcesSettings } from './install-apk';
import { useApkUpdate } from './UpdateProvider';
import type { ApkAutoDownload, KitTheme } from '../config';
import { useAutoDownloadMode } from './preferences';

const MODE_LABELS: [ApkAutoDownload, string, string][] = [
  ['wifi', 'Wi-Fi only', 'New versions download in the background on Wi-Fi.'],
  ['always', 'Any network', 'New versions download in the background on any connection, including mobile data.'],
  ['never', 'Off', 'Nothing downloads until you tap the button.'],
];

/**
 * The one "Check for updates" button in Settings → App. A new APK is checked
 * first, on GitHub Releases: it carries a new runtime, so it supersedes any OTA
 * bundle. Only when the APK is current does it ask expo-updates for a JS patch
 * on the installed runtime. With an APK available the same button downloads it.
 */
export function ApkUpdateSection() {
  const { check, checking, checkError, downloading, progress, downloaded, installError, refresh, install } =
    useApkUpdate();
  const apk = check?.apk ?? null;
  const available = !!check?.available;
  const ready = available && !!apk && downloaded === apk.version;
  const { Button, useToast, showDialog, useOnline } = ui();
  const t = useTheme();
  const s = useMemo(() => styles(t), [t]);
  const tx = type(t);
  const { showSuccess, showError } = useToast();
  const [otaChecking, setOtaChecking] = useState(false);
  const online = useOnline();
  const [mode, setMode] = useAutoDownloadMode();

  const label = useMemo(() => {
    if (downloading) {
      const written = formatBytes(progress?.written) ?? '0.0 MB';
      if (progress?.fraction == null) return `Downloading… ${written}`;
      return `Downloading ${Math.round(progress.fraction * 100)}% · ${written} of ${formatBytes(progress.total)}`;
    }
    if (checking || otaChecking) return 'Checking for updates…';
    if (ready && apk) return `Install v${apk.version}`;
    if (available && apk) {
      const size = formatBytes(apk.sizeBytes);
      return `Download v${apk.version}${size ? ` (${size})` : ''}`;
    }
    return 'Check for updates';
  }, [downloading, progress, checking, otaChecking, ready, available, apk]);

  /** A JS patch for the runtime this APK already has, through `updates.url`. */
  const checkOta = useCallback(async (apkChecked: boolean) => {
    if (__DEV__) {
      showSuccess('This APK is up to date. OTA updates are off in development.');
      return;
    }
    setOtaChecking(true);
    try {
      const result = await Updates.checkForUpdateAsync();
      const fetched = result.isAvailable ? await Updates.fetchUpdateAsync() : null;
      if (!fetched?.isNew) {
        // Without the APK check there may still be a newer APK; don't claim otherwise.
        showSuccess(apkChecked ? "You're on the latest version." : 'No JS update available.');
        return;
      }
      showDialog(
        'Update ready',
        'Reload now to apply it?',
        [
          { text: 'Later', style: 'cancel' },
          { text: 'Reload', onPress: () => Updates.reloadAsync() },
        ],
        { name: 'cloud-download-outline', tone: 'success' },
      );
    } catch (err) {
      // No manifest for this runtime yet (a fresh APK, before its first OTA):
      // nothing newer exists, so that is "up to date", not a failure.
      if (/\b404\b/.test(String((err as Error)?.message ?? err))) {
        showSuccess(apkChecked ? "You're on the latest version." : 'No JS update available.');
        return;
      }
      // expo-updates' own text ("Call to function … rejected → Caused by: …") is
      // for the logs; the person gets a plain sentence.
      if (__DEV__) console.warn('[update] JS update check failed:', err);
      showError("Couldn't check for updates. Try again in a moment.");
    } finally {
      setOtaChecking(false);
    }
  }, [showSuccess, showError]);

  const onPress = useCallback(async () => {
    if (downloading || checking || otaChecking) return;
    if (available) {
      // Failures surface through `installError` below.
      await install();
      return;
    }
    // No internet: say so, without trying -- "could not reach" is for a phone that
    // is online but cannot get to the update page.
    if (!online) {
      showError("You're offline. Connect to the internet to check for updates.");
      return;
    }
    const result = await refresh();
    // A newer APK turns this button into its download; the status line says so.
    if (result?.available) return;
    await checkOta(result !== null);
  }, [downloading, checking, otaChecking, available, install, refresh, checkOta, online, showError]);

  const onInstallErrorHelp = useCallback(() => {
    if (!installError) return;
    const blocked = installError.kind === 'blocked';
    showDialog(
      'Update failed',
      installError.message,
      [
        { text: 'Close', style: 'cancel' },
        blocked
          ? { text: 'Allow installs', onPress: () => openUnknownAppSourcesSettings().catch(() => {}) }
          : {
              text: 'Open in browser',
              onPress: () => openInBrowser(apk?.downloadUrl ?? releasesPageUrl()).catch(() => {}),
            },
      ],
      { name: 'alert-circle-outline', tone: 'warn' },
    );
  }, [installError, apk]);

  const waitingForWifi = available && !!apk && !ready && !downloading && mode === 'wifi';
  const waitingOff = available && !!apk && !ready && !downloading && mode === 'never';
  const fraction = progress?.fraction ?? null;

  return (
    <View style={{ gap: spacing.md }}>
      {check && available && apk ? (
        <View style={s.panel}>
          <View style={s.panelHead}>
            <View style={s.panelIcon}>
              <Ionicons name={ready ? 'checkmark-circle-outline' : downloading ? 'cloud-download-outline' : 'arrow-down-circle-outline'} size={18} color={t.text} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={tx.label}>{ready ? 'Ready to install' : downloading ? 'Downloading update' : 'Update available'}</Text>
              <Text style={[tx.small, { fontSize: fontSize.xs }]}>
                {`v${apk.version}${formatBytes(apk.sizeBytes) ? ` · ${formatBytes(apk.sizeBytes)}` : ''}`}
              </Text>
            </View>
            <Pill label={ready ? 'Downloaded' : downloading ? (fraction == null ? 'Working' : `${Math.round(fraction * 100)}%`) : 'New'} tone={ready ? 'success' : 'warning'} />
          </View>
          {downloading ? (
            <View style={s.track}>
              <View style={[s.fill, { width: `${Math.round((fraction ?? 0.04) * 100)}%` }]} />
            </View>
          ) : null}
          <Text style={[tx.small, { fontSize: fontSize.xs }]}>
            {ready
              ? 'It is downloaded. Install it to get the latest version.'
              : downloading
                ? 'Downloading in the background. The progress also shows around the settings button.'
                : waitingForWifi
                  ? 'It downloads by itself as soon as you are on Wi-Fi.'
                  : waitingOff
                    ? 'Automatic downloads are off. Tap the button to download it.'
                    : 'It starts downloading by itself.'}
          </Text>
        </View>
      ) : null}
      {checkError && !(checkError.kind === 'offline' && !online) ? (
        <Text style={s.error}>
          {checkError.message}
          {checkError.kind === 'rate_limited' ? (
            <Text style={s.link} onPress={() => Linking.openURL(releasesPageUrl())}>
              {'  '}Open releases
            </Text>
          ) : null}
        </Text>
      ) : null}
      {installError ? (
        <Text style={s.error} onPress={onInstallErrorHelp}>
          {installError.message} <Text style={s.link}>What now?</Text>
        </Text>
      ) : null}
      <Button
        label={label}
        variant={available || downloading ? 'primary' : 'outline'}
        onPress={onPress}
        loading={checking || otaChecking}
        disabled={downloading}
        iconLeft={ready ? 'checkmark-circle-outline' : available ? 'download-outline' : 'cloud-download-outline'}
      />
      {Platform.OS === 'android' && mode ? (
        <View style={{ gap: spacing.sm }}>
          <Text style={tx.section}>Download updates</Text>
          <Segmented value={mode} onChange={setMode} options={MODE_LABELS.map(([value, text]) => ({ value, label: text }))} />
          <Text style={[tx.small, { fontSize: fontSize.xs }]}>{MODE_LABELS.find(([v]) => v === mode)?.[2]} Android asks you to confirm each install.</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = (t: KitTheme) =>
  StyleSheet.create({
    panel: { backgroundColor: t.surfaceAlt, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
    panelHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    panelIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: t.surface, alignItems: 'center', justifyContent: 'center' },
    track: { height: 6, borderRadius: 3, backgroundColor: t.border, overflow: 'hidden' },
    fill: { height: 6, borderRadius: 3, backgroundColor: t.primary },
    error: { ...font(t, 'regular'), fontSize: fontSize.xs, color: t.danger },
    link: { ...font(t, 'semiBold'), color: t.text, textDecorationLine: 'underline' },
  });
