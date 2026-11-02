import { useMemo } from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getConfig } from '../config';
import { KitButton, font, fontSize, radius, shadow, spacing, tint, useTheme } from '../ui/primitives';
import { openUnknownAppSourcesSettings, type InstallErrorKind } from './install-apk';

/**
 * The "Update required" screen: a modal that cannot be dismissed (the Android back button does nothing) and
 * covers the whole app (mount it only while it applies) until the new version is installed. Android replaces the running app when the installer
 * finishes, so there is no "done" state to handle; if the person cancels the installer, they land back here.
 */
export function ForceUpdateGate({
  version,
  busy,
  error,
  onInstall,
  progress,
}: {
  version: string;
  busy: boolean;
  error: { kind: InstallErrorKind | null; message: string } | null;
  onInstall: () => void;
  /** 0 to 1 while the installer is being prepared, when known: shown as a bar under the message. */
  progress?: number | null;
}) {
  const t = useTheme();
  const s = useMemo(() => styles(t), [t]);
  const appName = getConfig().appName;
  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={() => {}}>
      <View style={s.scrim}>
        <View style={s.card} accessibilityViewIsModal>
          <View style={s.icon}>
            <Ionicons name="cloud-download-outline" size={30} color={t.text} />
          </View>
          <Text style={s.title}>Update required</Text>
          <Text style={s.body}>
            Version {version} of {appName} is ready. Install it to keep using the app; this can't be skipped.
          </Text>
          {progress != null ? (
            <View style={s.track} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(progress * 100) }}>
              <View style={[s.fill, { width: `${Math.round(Math.max(0, Math.min(1, progress)) * 100)}%` }]} />
            </View>
          ) : null}
          {error ? (
            <View style={s.errorBox}>
              <Ionicons name="alert-circle-outline" size={16} color={t.danger} />
              <Text style={s.error}>{error.message}</Text>
            </View>
          ) : null}
          {error?.kind === 'blocked' ? (
            <KitButton label="Allow installs from this app" variant="outline" onPress={() => void openUnknownAppSourcesSettings()} style={s.full} />
          ) : null}
          <KitButton label={busy ? 'Opening installer…' : 'Install now'} onPress={onInstall} disabled={busy} iconLeft="download-outline" style={s.full} />
        </View>
      </View>
    </Modal>
  );
}

const styles = (t: ReturnType<typeof useTheme>) =>
  StyleSheet.create({
    scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
    card: { width: '100%', maxWidth: 360, backgroundColor: t.surface, borderRadius: radius.lg, padding: spacing.xl, alignItems: 'center', gap: spacing.sm, ...shadow.md },
    icon: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', backgroundColor: t.surfaceAlt, marginBottom: spacing.sm },
    title: { ...font(t, 'bold'), fontSize: fontSize.xl, color: t.text, textAlign: 'center' },
    body: { ...font(t, 'regular'), fontSize: fontSize.sm, color: t.textSecondary, textAlign: 'center', lineHeight: 20, marginBottom: spacing.sm },
    track: { alignSelf: 'stretch', height: 6, borderRadius: 3, backgroundColor: t.surfaceAlt, overflow: 'hidden' },
    fill: { height: 6, borderRadius: 3, backgroundColor: t.primary },
    errorBox: { alignSelf: 'stretch', flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: tint(t.danger, 0.08) },
    error: { ...font(t, 'regular'), flex: 1, fontSize: fontSize.xs, color: t.danger, lineHeight: 17 },
    full: { alignSelf: 'stretch' },
  });
