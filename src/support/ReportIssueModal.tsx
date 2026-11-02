import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { getConfig } from '../config';
import { Sheet } from '../ui/Sheet';
import { fontSize, spacing, useTheme } from '../ui/primitives';
import { collectDiagnostics, summarizeDiagnostics, type Diagnostics } from './diagnostics';
import { forgetCrash } from './crash-store';
import { forgetScreen, recentScreen } from './screenshot';
import { submitReport } from './support-api';

/**
 * "Report a problem": the person writes what went wrong; the kit adds a screenshot of the screen they came from,
 * the device, the last requests and the last crash, and shows exactly what will be sent before it goes.
 */
export function ReportIssueModal({ onClose, onSent }: { onClose: () => void; onSent: (reportId: string) => void }) {
  const cfg = getConfig();
  const auth = cfg.useAuth();
  const t = useTheme();
  const s = useMemo(() => styles(t), [t]);
  const [subject, setSubject] = useState('');
  const [what, setWhat] = useState('');
  const [diag, setDiag] = useState<Diagnostics | null>(null);
  const [shot] = useState(() => recentScreen());
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    let alive = true;
    collectDiagnostics({ user: auth.user, fullName: auth.fullName, server: auth.instanceUrl ?? cfg.site }).then((d) => alive && setDiag(d));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when the sheet opens
  }, []);

  const send = async () => {
    if (!subject.trim()) {
      setError('Add a short subject first.');
      return;
    }
    if (!diag) return;
    setSending(true);
    setError(null);
    try {
      const res = await submitReport({ subject, description: what, diagnostics: diag, screenshot: shot });
      if (diag.last_crash) await forgetCrash();
      forgetScreen();
      onSent(res.report);
    } catch (err) {
      setError(cfg.errorMessage ? cfg.errorMessage(err) : "Couldn't send. Check your connection and try again.");
    } finally {
      setSending(false);
    }
  };

  const lines = diag ? summarizeDiagnostics(diag, !!shot) : [];

  return (
    <Sheet
      title="Report a problem"
      onClose={sending ? () => {} : onClose}
      footer={
        <Pressable accessibilityRole="button" disabled={sending || !diag} onPress={send} style={({ pressed }) => [s.send, (pressed || sending || !diag) && { opacity: 0.6 }]}>
          {sending ? <ActivityIndicator color={t.textOnPrimary} /> : <Text style={s.sendText}>Send</Text>}
        </Pressable>
      }
    >
      <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 460 }}>
        <Text style={s.label}>Subject</Text>
        <TextInput style={s.input} value={subject} onChangeText={setSubject} placeholder="What went wrong, in one line" placeholderTextColor={t.textMuted} maxLength={140} editable={!sending} />
        <Text style={[s.label, { marginTop: spacing.md }]}>Details</Text>
        <TextInput style={[s.input, { minHeight: 90, textAlignVertical: 'top' }]} value={what} onChangeText={setWhat} multiline placeholder="What you were doing and what happened" placeholderTextColor={t.textMuted} editable={!sending} />
        <View style={s.shotRow}>
          {shot ? <Image source={{ uri: `data:image/jpeg;base64,${shot}` }} style={s.thumb} /> : <View style={[s.thumb, s.noThumb]} />}
          <Text style={s.hint}>{shot ? 'A screenshot of the screen you were on is attached.' : 'No screenshot of the previous screen is available.'}</Text>
        </View>
        <Pressable onPress={() => setShowDetails((v) => !v)} accessibilityRole="button" style={{ paddingVertical: spacing.sm }}>
          <Text style={s.link}>{showDetails ? 'Hide what will be sent' : 'What will be sent'}</Text>
        </Pressable>
        {showDetails ? (
          <View style={s.details}>
            {diag ? lines.map((l) => <Text key={l} style={s.hint}>• {l}</Text>) : <Text style={s.hint}>Gathering…</Text>}
            <Text style={[s.hint, { marginTop: 4 }]}>Passwords and tokens are never included.</Text>
          </View>
        ) : null}
        {error ? <Text style={s.error}>{error}</Text> : null}
      </ScrollView>
    </Sheet>
  );
}

const styles = (t: ReturnType<typeof useTheme>) =>
  StyleSheet.create({
    label: { fontSize: fontSize.xs, fontWeight: '600', color: t.textSecondary, marginBottom: 4 },
    input: { borderWidth: 1, borderColor: t.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: fontSize.sm, color: t.text, backgroundColor: t.background },
    shotRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.md },
    thumb: { width: 44, height: 78, borderRadius: 6, backgroundColor: t.surfaceAlt },
    noThumb: { borderWidth: 1, borderColor: t.border, borderStyle: 'dashed' },
    hint: { flex: 1, fontSize: fontSize.xs, color: t.textMuted, lineHeight: 17 },
    link: { color: t.primary, fontSize: fontSize.sm, fontWeight: '500' },
    details: { backgroundColor: t.surfaceAlt, borderRadius: 10, padding: spacing.md, gap: 2 },
    error: { color: t.danger, fontSize: fontSize.sm, marginTop: spacing.sm },
    send: { marginTop: spacing.md, alignItems: 'center', paddingVertical: 14, borderRadius: 12, backgroundColor: t.primary },
    sendText: { color: t.textOnPrimary, fontSize: 16, fontWeight: '600' },
  });
