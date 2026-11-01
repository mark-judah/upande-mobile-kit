import { useCallback, useMemo, useState } from 'react';
import { Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Updates from 'expo-updates';
import { ui, useTheme, spacing, fontSize } from '../ui/primitives';
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

  let status: string | null = null;
  if (check) {
    // Only news is shown: being up to date needs no line of its own.
    if (ready && apk) status = `v${apk.version} is downloaded and ready to install.`;
    else if (available && apk) status = `v${apk.version} is available as a new APK.`;
  }

  return (
    <View>
      {Platform.OS === 'android' && mode ? (
        <View style={s.modeBlock}>
          <Text style={s.modeTitle}>Download updates</Text>
          <View style={s.modeRow}>
            {MODE_LABELS.map(([value, text]) => (
              <Pressable
                key={value}
                accessibilityRole="radio"
                accessibilityState={{ selected: mode === value }}
                onPress={() => setMode(value)}
                style={[s.modeChip, mode === value && s.modeChipOn]}
              >
                <Text style={[s.modeChipText, mode === value && s.modeChipTextOn]}>{text}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={s.hint}>{MODE_LABELS.find(([v]) => v === mode)?.[2]} Android asks you to confirm each install.</Text>
        </View>
      ) : null}
      {status ? <Text style={[s.hint, available && s.accent]}>{status}</Text> : null}
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
      <View style={{ height: spacing.sm }} />
      <Button
        label={label}
        variant={available || downloading ? 'primary' : 'outline'}
        onPress={onPress}
        loading={checking || otaChecking}
        disabled={downloading}
        iconLeft={ready ? 'checkmark-circle-outline' : available ? 'download-outline' : 'cloud-download-outline'}
      />
    </View>
  );
}

const styles = (t: KitTheme) =>
  StyleSheet.create({
    hint: { fontFamily: t.fontRegular || undefined, fontSize: fontSize.xs, color: t.textMuted, marginTop: spacing.sm },
    accent: { fontFamily: t.fontSemiBold || undefined, color: t.primary },
    error: { fontFamily: t.fontRegular || undefined, fontSize: fontSize.xs, color: t.danger, marginTop: spacing.sm },
    modeBlock: { marginBottom: spacing.sm },
    modeTitle: { fontFamily: t.fontSemiBold || undefined, fontSize: fontSize.sm, color: t.text, fontWeight: '600' },
    modeRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm, flexWrap: 'wrap' },
    modeChip: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 16, borderWidth: 1, borderColor: t.border, backgroundColor: t.surface },
    modeChipOn: { backgroundColor: t.primary, borderColor: t.primary },
    modeChipText: { fontFamily: t.fontMedium || undefined, fontSize: fontSize.xs, color: t.textSecondary },
    modeChipTextOn: { color: t.textOnPrimary },
    link: { fontFamily: t.fontSemiBold || undefined, color: t.primary, textDecorationLine: 'underline' },
  });
