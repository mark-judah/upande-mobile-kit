import { useState } from 'react';
import { ActivityIndicator, Pressable, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getConfig } from '../config';
import { useBiometricVault, type VaultCredentials } from './index';

/**
 * A ready-made "Sign in with fingerprint" button for the app's login screen. Renders nothing unless a sign-in is
 * stored on this phone. On press it asks for the fingerprint and hands the stored sign-in to `onCredentials`, which
 * runs the app's normal login (and may throw; the message is shown under the button).
 */
export function BiometricSignIn({
  onCredentials,
  label = 'Sign in with fingerprint',
}: {
  onCredentials: (c: VaultCredentials) => Promise<void> | void;
  label?: string;
}) {
  const { enrolled, signIn } = useBiometricVault();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const t = getConfig().theme;
  if (!enrolled) return null;

  const press = async () => {
    setBusy(true);
    setError(null);
    try {
      const creds = await signIn(label);
      if (creds) await onCredentials(creds);
      else setError('Fingerprint not recognised. Use your password.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sign in. Use your password.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Pressable
        accessibilityRole="button"
        disabled={busy}
        onPress={press}
        style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 12, backgroundColor: t.primary, opacity: pressed || busy ? 0.7 : 1 })}
      >
        {busy ? <ActivityIndicator color={t.textOnPrimary} /> : <Ionicons name="finger-print" size={22} color={t.textOnPrimary} />}
        <Text style={{ color: t.textOnPrimary, fontSize: 16, fontWeight: '600' }}>{label}</Text>
      </Pressable>
      {error ? <Text style={{ color: t.danger, fontSize: 13, marginTop: 6, textAlign: 'center' }}>{error}</Text> : null}
    </>
  );
}
