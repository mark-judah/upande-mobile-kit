import { useMemo, useState } from 'react';
import { StyleSheet, Text, TextInput } from 'react-native';
import { Sheet } from '../ui/Sheet';
import { KitButton, font, fontSize, radius, spacing, useTheme } from '../ui/primitives';

/** Asks for the password once, to keep it behind the fingerprint (Alert.prompt does not exist on Android). */
export function VaultPasswordModal({
  user,
  onSubmit,
  onClose,
}: {
  user: string;
  onSubmit: (password: string) => Promise<string | null>;
  onClose: () => void;
}) {
  const t = useTheme();
  const s = useMemo(() => styles(t), [t]);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const go = async () => {
    if (!password) return;
    setBusy(true);
    setError(null);
    const problem = await onSubmit(password);
    setBusy(false);
    if (problem) setError(problem);
  };

  return (
    <Sheet title="Turn on fingerprint sign-in" onClose={busy ? () => {} : onClose}>
      <Text style={s.hint}>
        Enter the password for {user}. It stays on this phone, locked behind your fingerprint or face, and is used only to sign you in.
      </Text>
      <TextInput
        style={s.input}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="current-password"
        placeholder="Password"
        placeholderTextColor={t.textMuted}
        editable={!busy}
        onSubmitEditing={go}
      />
      {error ? <Text style={s.error}>{error}</Text> : null}
      <KitButton label="Turn on" onPress={go} loading={busy} disabled={!password} style={{ marginTop: spacing.lg }} />
    </Sheet>
  );
}

const styles = (t: ReturnType<typeof useTheme>) =>
  StyleSheet.create({
    hint: { ...font(t, 'regular'), fontSize: fontSize.sm, color: t.textSecondary, lineHeight: 20, marginBottom: spacing.md },
    input: {
      ...font(t, 'regular'),
      borderWidth: 1,
      borderColor: t.border,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      minHeight: 46,
      fontSize: fontSize.md,
      color: t.text,
      backgroundColor: t.surface,
    },
    error: { ...font(t, 'regular'), color: t.danger, fontSize: fontSize.sm, marginTop: spacing.sm },
  });
