import { useEffect, useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getConfig } from '../config';
import { Sheet } from '../ui/Sheet';
import { KitButton, fontSize, radius, spacing, type, useTheme } from '../ui/primitives';
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
        <View style={{ marginTop: spacing.md }}>
          <KitButton label="Send report" iconLeft="paper-plane-outline" loading={sending} disabled={!diag} onPress={send} />
        </View>
      }
    >
      <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 480 }}>
        <Text style={s.label}>Subject</Text>
        <TextInput style={s.input} value={subject} onChangeText={setSubject} placeholder="What went wrong, in one line" placeholderTextColor={t.textMuted} maxLength={140} editable={!sending} />
        <Text style={[s.label, { marginTop: spacing.md }]}>Details</Text>
        <TextInput style={[s.input, { minHeight: 96, textAlignVertical: 'top' }]} value={what} onChangeText={setWhat} multiline placeholder="What you were doing and what happened" placeholderTextColor={t.textMuted} editable={!sending} />
        <View style={s.shotRow}>
          {shot ? <Image source={{ uri: `data:image/jpeg;base64,${shot}` }} style={s.thumb} /> : <View style={[s.thumb, s.noThumb]}><Ionicons name="image-outline" size={18} color={t.textMuted} /></View>}
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={s.shotTitle}>{shot ? 'Screenshot attached' : 'No screenshot'}</Text>
            <Text style={s.hint}>{shot ? 'The screen you were on is sent with your report.' : 'No screenshot of the previous screen is available.'}</Text>
          </View>
        </View>
        <Pressable onPress={() => setShowDetails((v) => !v)} accessibilityRole="button" style={s.detailsToggle}>
          <Ionicons name={showDetails ? 'chevron-down' : 'chevron-forward'} size={14} color={t.text} />
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

const styles = (t: ReturnType<typeof useTheme>) => {
  const tx = type(t);
  return StyleSheet.create({
    label: { ...tx.caption, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 },
    input: { borderWidth: 1, borderColor: t.border, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 11, ...tx.body, fontSize: fontSize.sm, backgroundColor: t.background },
    shotRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.lg, backgroundColor: t.surfaceAlt, borderRadius: radius.md, padding: spacing.md },
    thumb: { width: 44, height: 78, borderRadius: radius.sm, backgroundColor: t.surface, alignItems: 'center', justifyContent: 'center' },
    noThumb: { borderWidth: 1, borderColor: t.border, borderStyle: 'dashed' },
    shotTitle: { ...tx.label },
    hint: { ...tx.small, fontSize: fontSize.xs, lineHeight: 17 },
    detailsToggle: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: spacing.md },
    link: { ...tx.label, fontSize: fontSize.xs },
    details: { backgroundColor: t.surfaceAlt, borderRadius: radius.md, padding: spacing.md, gap: 2 },
    error: { ...tx.small, color: t.danger, marginTop: spacing.sm },
  });
};
