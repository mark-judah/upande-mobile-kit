import { useMemo } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getConfig } from '../config';
import { useTheme } from '../ui/primitives';
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
}: {
  version: string;
  busy: boolean;
  error: { kind: InstallErrorKind | null; message: string } | null;
  onInstall: () => void;
}) {
  const t = useTheme();
  const s = useMemo(() => styles(t), [t]);
  const appName = getConfig().appName;
  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={() => {}}>
      <View style={s.scrim}>
        <View style={s.card} accessibilityViewIsModal>
          <View style={s.icon}>
            <Ionicons name="cloud-download-outline" size={30} color={t.primary} />
          </View>
          <Text style={s.title}>Update required</Text>
          <Text style={s.body}>
            Version {version} of {appName} is ready. Install it to keep using the app; this can't be skipped.
          </Text>
          {error ? <Text style={s.error}>{error.message}</Text> : null}
          {error?.kind === 'blocked' ? (
            <Pressable accessibilityRole="button" onPress={() => void openUnknownAppSourcesSettings()} style={s.secondary}>
              <Text style={s.secondaryText}>Allow installs from this app</Text>
            </Pressable>
          ) : null}
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={onInstall}
            style={({ pressed }) => [s.primary, (pressed || busy) && { opacity: 0.7 }]}
          >
            <Text style={s.primaryText}>{busy ? 'Opening installer…' : 'Install now'}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = (t: ReturnType<typeof useTheme>) =>
  StyleSheet.create({
    scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: 24 },
    card: { width: '100%', maxWidth: 420, backgroundColor: t.surface, borderRadius: 16, padding: 24, alignItems: 'center', gap: 12 },
    icon: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: t.background },
    title: { fontSize: 20, fontWeight: '600', color: t.text },
    body: { fontSize: 14, color: t.textMuted, textAlign: 'center', lineHeight: 20 },
    error: { fontSize: 13, color: t.danger, textAlign: 'center' },
    primary: { alignSelf: 'stretch', alignItems: 'center', paddingVertical: 14, borderRadius: 12, backgroundColor: t.primary, marginTop: 4 },
    primaryText: { color: t.textOnPrimary, fontSize: 16, fontWeight: '600' },
    secondary: { paddingVertical: 8 },
    secondaryText: { color: t.primary, fontSize: 14, fontWeight: '500' },
  });
