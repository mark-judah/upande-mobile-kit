import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { getConfig } from '../config';
import { fontSize, spacing, ui, useTheme } from '../ui/primitives';
import { clearVault, enrolVault, isVaultEnrolled, isVaultSupported } from './index';
import { VaultPasswordModal } from './VaultPasswordModal';

/** The Settings switch for `biometric: 'vault'`: keeps the sign-in behind the fingerprint, or forgets it. */
export function VaultRow() {
  const cfg = getConfig();
  const auth = cfg.useAuth();
  const t = useTheme();
  const { useToast } = ui();
  const { showSuccess, showError } = useToast();
  const s = useMemo(() => styles(t), [t]);
  const [supported] = useState(() => isVaultSupported());
  const [on, setOn] = useState(false);
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    isVaultEnrolled().then(setOn);
  }, []);

  const turnOff = async () => {
    await clearVault();
    await auth.setBiometricEnabled(false).catch(() => {});
    setOn(false);
    showSuccess('Fingerprint sign-in turned off.');
  };

  const enrol = async (password: string): Promise<string | null> => {
    if (!auth.user) return 'Sign in first.';
    const ok = await enrolVault({ server: auth.instanceUrl ?? cfg.site ?? '', user: auth.user, password });
    if (!ok) return 'Fingerprint was not confirmed. Nothing was saved.';
    await auth.setBiometricEnabled(true).catch(() => {});
    setOn(true);
    setAsking(false);
    showSuccess('Fingerprint sign-in is on.');
    return null;
  };

  const toggle = () => {
    if (!supported) {
      showError('This build cannot keep a sign-in behind the fingerprint. Update the app to a build that includes expo-secure-store.');
      return;
    }
    if (on) void turnOff();
    else setAsking(true);
  };

  return (
    <>
      <View style={s.row}>
        <View style={{ flex: 1 }}>
          <Text style={s.label}>Fingerprint sign-in</Text>
          <Text style={s.hint}>{supported ? 'Skip the password with your fingerprint or face' : 'Needs a newer build of the app'}</Text>
        </View>
        <TouchableOpacity accessibilityRole="switch" accessibilityState={{ checked: on }} onPress={toggle} activeOpacity={0.8} style={[s.toggle, on && { backgroundColor: t.primary }]}>
          <View style={[s.dot, on && { alignSelf: 'flex-end' }]} />
        </TouchableOpacity>
      </View>
      {asking ? <VaultPasswordModal user={auth.user ?? ''} onSubmit={enrol} onClose={() => setAsking(false)} /> : null}
    </>
  );
}

const styles = (t: ReturnType<typeof useTheme>) =>
  StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    label: { fontSize: fontSize.sm, fontWeight: '600', color: t.text },
    hint: { fontSize: fontSize.xs, color: t.textMuted, marginTop: 2 },
    toggle: { width: 46, height: 26, borderRadius: 13, backgroundColor: t.border, padding: 2, justifyContent: 'center' },
    dot: { width: 22, height: 22, borderRadius: 11, backgroundColor: '#fff', alignSelf: 'flex-start' },
  });
