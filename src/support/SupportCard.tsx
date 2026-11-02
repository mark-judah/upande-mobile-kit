import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getConfig } from '../config';
import { fontSize, spacing, ui, useTheme } from '../ui/primitives';
import { APP_VERSION } from '../version';
import { fetchWhatsNew, WhatsNewSheet } from '../whats-new/WhatsNew';
import type { NoteSection } from '../whats-new/notes';
import { SupportInbox } from './SupportInbox';
import { ReportIssueModal } from './ReportIssueModal';
import { fetchUnreadCount } from './support-api';
import { supportOptions } from './options';

/** The "Help" card in Settings: report a problem, chat with support, and the notes of this version. */
export function SupportCard() {
  const cfg = getConfig();
  const { Card, useToast } = ui();
  const { showSuccess } = useToast();
  const t = useTheme();
  const s = useMemo(() => styles(t), [t]);
  const opts = supportOptions(cfg.support);
  const notes = cfg.whatsNew !== false;
  const [open, setOpen] = useState<'report' | 'chat' | 'notes' | null>(null);
  const [unread, setUnread] = useState(0);
  const [sections, setSections] = useState<NoteSection[] | null>(null);
  const [loadingNotes, setLoadingNotes] = useState(false);
  const signedIn = !!cfg.useAuth().user || cfg.standIns.useAuth;

  useEffect(() => {
    if (!opts.chat || !signedIn) return;
    fetchUnreadCount().then(setUnread, () => {});
  }, [opts.chat, signedIn, open]);

  if (!opts.report && !opts.chat && !notes) return null;

  const openNotes = () => {
    setOpen('notes');
    setLoadingNotes(true);
    fetchWhatsNew().then((r) => {
      setSections(r);
      setLoadingNotes(false);
    });
  };

  const Row = ({ icon, label, hint, onPress, badge }: { icon: 'bug-outline' | 'chatbubbles-outline' | 'sparkles-outline'; label: string; hint: string; onPress: () => void; badge?: number }) => (
    <Pressable accessibilityRole="button" onPress={onPress} style={s.row}>
      <Ionicons name={icon} size={20} color={t.primary} />
      <View style={{ flex: 1 }}>
        <Text style={s.label}>{label}</Text>
        <Text style={s.hint}>{hint}</Text>
      </View>
      {badge ? (
        <View style={s.badge}>
          <Text style={s.badgeText}>{badge > 9 ? '9+' : badge}</Text>
        </View>
      ) : null}
      <Ionicons name="chevron-forward" size={18} color={t.textMuted} />
    </Pressable>
  );

  return (
    <>
      <Card title="Help">
        {opts.report ? <Row icon="bug-outline" label="Report a problem" hint="Send us a screenshot and what went wrong" onPress={() => setOpen('report')} /> : null}
        {opts.chat ? <Row icon="chatbubbles-outline" label="Chat with support" hint="Ask a question and get a reply here" badge={unread} onPress={() => setOpen('chat')} /> : null}
        {notes ? <Row icon="sparkles-outline" label="What's new" hint={`Changes in v${APP_VERSION}`} onPress={openNotes} /> : null}
      </Card>
      {open === 'report' ? (
        <ReportIssueModal
          onClose={() => setOpen(null)}
          onSent={(id) => {
            setOpen(null);
            showSuccess(`Thanks. Your report ${id} was sent.`);
          }}
        />
      ) : null}
      {open === 'chat' ? <SupportInbox onClose={() => setOpen(null)} /> : null}
      {open === 'notes' ? <WhatsNewSheet version={APP_VERSION} sections={sections} loading={loadingNotes} onClose={() => setOpen(null)} /> : null}
    </>
  );
}

const styles = (t: ReturnType<typeof useTheme>) =>
  StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
    label: { fontSize: fontSize.sm, fontWeight: '600', color: t.text },
    hint: { fontSize: fontSize.xs, color: t.textMuted, marginTop: 2 },
    badge: { minWidth: 20, height: 20, borderRadius: 10, backgroundColor: t.danger, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
    badgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  });
