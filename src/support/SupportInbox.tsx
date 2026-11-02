import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getConfig } from '../config';
import { Sheet } from '../ui/Sheet';
import { EmptyState, KitButton, Pill, font, fontSize, radius, spacing, tint, type, ui, useTheme } from '../ui/primitives';
import { offerReplyNotifications } from '../push';
import { ChatModal } from './ChatModal';
import { collectDiagnostics } from './diagnostics';
import {
  fetchThread,
  fetchThreads,
  loadSeen,
  markSeen,
  mergeMessages,
  replyThread,
  submitReport,
  unreadThreads,
  type ChatMessage,
  type ThreadEvent,
  type ThreadInfo,
  type ThreadSummary,
} from './support-api';
import { buildTimeline, canReply, formatWhen, mergeEvents, statusHint, statusTone, type TimelineItem } from './thread-logic';

const POLL_MS = 6000;
const LIST_POLL_MS = 15000;

type View_ = { kind: 'loading' } | { kind: 'legacy' } | { kind: 'list' } | { kind: 'thread'; id: string; subject: string } | { kind: 'new' };

/**
 * "My reports". On a site with Issues a conversation IS an Issue: the person's reports and questions are listed with
 * their status, support answers with a Comment on the Issue (the way the team already works), and each answer and
 * each change of status shows in the conversation's timeline. Sites without Issues use the single-thread chat.
 */
export function SupportInbox({ onClose, initialThread, startNew }: { onClose: () => void; initialThread?: string; startNew?: boolean }) {
  const cfg = getConfig();
  const t = useTheme();
  const s = useMemo(() => styles(t), [t]);
  const [view, setView] = useState<View_>(initialThread ? { kind: 'thread', id: initialThread, subject: '' } : startNew ? { kind: 'new' } : { kind: 'loading' });
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [seen, setSeen] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadList = useCallback(async () => {
    try {
      const r = await fetchThreads();
      if (r.mode === 'chat') {
        setView({ kind: 'legacy' });
        return;
      }
      setThreads(r.threads);
      setSeen(await loadSeen());
      setView((cur) => (cur.kind === 'loading' ? { kind: 'list' } : cur));
      setError(null);
    } catch (err) {
      setError(cfg.errorMessage ? cfg.errorMessage(err) : "Couldn't reach support. Try again in a moment.");
      setView((cur) => (cur.kind === 'loading' ? { kind: 'list' } : cur));
    }
  }, [cfg]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  // Keep the list fresh while it is the open view: answers and status changes appear without a pull.
  const onList = view.kind === 'list';
  useEffect(() => {
    if (!onList) return;
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') void loadList();
    }, LIST_POLL_MS);
    return () => clearInterval(timer);
  }, [onList, loadList]);

  if (view.kind === 'legacy') return <ChatModal onClose={onClose} />;

  const back = () => {
    setView({ kind: 'list' });
    void loadList();
  };

  if (view.kind === 'thread') return <ThreadView id={view.id} subject={view.subject} onBack={back} onClose={onClose} />;
  if (view.kind === 'new') return <NewMessage onBack={() => setView({ kind: 'list' })} onClose={onClose} onCreated={(id, subject) => setView({ kind: 'thread', id, subject })} />;

  const unread = new Set(unreadThreads(threads, seen));
  return (
    <Sheet title="My reports" tall onClose={onClose} footer={<View style={{ marginTop: spacing.md }}><KitButton label="New message" iconLeft="create-outline" onPress={() => setView({ kind: 'new' })} /></View>}>
      {view.kind === 'loading' ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={t.text} />
      ) : (
        <FlatList
          data={threads}
          keyExtractor={(th) => th.id}
          contentContainerStyle={{ gap: spacing.sm, paddingBottom: spacing.sm }}
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            void loadList().finally(() => setRefreshing(false));
          }}
          ListHeaderComponent={error ? <Text style={s.error}>{error}</Text> : undefined}
          ListEmptyComponent={
            error ? undefined : (
              <EmptyState icon="chatbubbles-outline" title="No reports yet" subtitle="Send a report or a question and the answer, and every change of status, will show here." />
            )
          }
          renderItem={({ item: th }) => {
            const isUnread = unread.has(th.id);
            return (
              <Pressable accessibilityRole="button" onPress={() => setView({ kind: 'thread', id: th.id, subject: th.subject })} style={({ pressed }) => [s.card, pressed && { opacity: 0.7 }]}>
                <View style={s.cardTop}>
                  <Text style={[s.subject, isUnread && font(t, 'bold')]} numberOfLines={1}>
                    {th.subject}
                  </Text>
                  {isUnread ? <View style={s.dot} accessibilityLabel="New reply" /> : null}
                </View>
                <Text style={s.preview} numberOfLines={2}>
                  {th.preview || '—'}
                </Text>
                <View style={s.cardBottom}>
                  <Pill label={th.status} tone={statusTone(th.status)} />
                  <Text style={s.when}>{formatWhen(th.last_activity)}</Text>
                </View>
              </Pressable>
            );
          }}
        />
      )}
    </Sheet>
  );
}

function ThreadView({ id, subject, onBack, onClose }: { id: string; subject: string; onBack: () => void; onClose: () => void }) {
  const cfg = getConfig();
  const t = useTheme();
  const s = useMemo(() => styles(t), [t]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [events, setEvents] = useState<ThreadEvent[]>([]);
  const [info, setInfo] = useState<ThreadInfo | null>(null);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const list = useRef<FlatList<TimelineItem>>(null);

  const pull = useCallback(async () => {
    try {
      const r = await fetchThread(id);
      setInfo(r.thread);
      setMessages((cur) => mergeMessages(cur, r.messages));
      setEvents((cur) => mergeEvents(cur, r.events));
      const lastStaff = [...r.messages].reverse().find((m) => m.from_staff);
      if (lastStaff) void markSeen(id, lastStaff.sent_at);
      setError(null);
    } catch (err) {
      setError(cfg.errorMessage ? cfg.errorMessage(err) : "Couldn't load this conversation. We'll keep trying.");
    } finally {
      setLoading(false);
    }
  }, [id, cfg]);

  useEffect(() => {
    void pull();
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') void pull();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [pull]);

  const send = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setDraft('');
    try {
      const m = await replyThread(id, text);
      setMessages((cur) => mergeMessages(cur, [m]));
      void pull(); // a reply on an answered report reopens it: pick the new status up now
    } catch (err) {
      setDraft(text);
      setError(cfg.errorMessage ? cfg.errorMessage(err) : "Couldn't send. Try again.");
    } finally {
      setSending(false);
    }
  };

  const status = info?.status ?? '';
  const timeline = useMemo(() => buildTimeline(messages, events), [messages, events]);
  const open = !status || canReply(status);

  const header = info ? (
    <View style={s.statusCard}>
      <View style={s.statusTop}>
        <Pill label={status} tone={statusTone(status)} />
        <Text style={s.when}>{info.created ? `Sent ${formatWhen(info.created)}` : ''}</Text>
      </View>
      {statusHint(status) ? <Text style={s.hintText}>{statusHint(status)}</Text> : null}
      {info.has_screenshot ? (
        <View style={s.attach}>
          <Ionicons name="image-outline" size={14} color={t.textSecondary} />
          <Text style={s.hintText}>Screenshot attached to your report</Text>
        </View>
      ) : null}
    </View>
  ) : null;

  return (
    <Sheet title={info?.subject || subject || 'Conversation'} tall onClose={onClose}>
      <Pressable accessibilityRole="button" onPress={onBack} hitSlop={8} style={s.back}>
        <Ionicons name="chevron-back" size={16} color={t.text} />
        <Text style={s.backText}>All reports</Text>
      </Pressable>
      <View style={{ flex: 1 }}>
        {loading ? (
          <ActivityIndicator style={{ marginTop: 40 }} color={t.text} />
        ) : (
          <FlatList
            ref={list}
            data={timeline}
            keyExtractor={(i) => i.id}
            ListHeaderComponent={header ?? undefined}
            contentContainerStyle={{ gap: spacing.sm, paddingBottom: spacing.sm }}
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void pull().finally(() => setRefreshing(false));
            }}
            onContentSizeChange={() => list.current?.scrollToEnd({ animated: false })}
            renderItem={({ item, index }) => (item.kind === 'event' ? <EventLine item={item} s={s} t={t} /> : <Bubble message={item.message} first={index === 0 || timeline[index - 1].kind === 'event'} s={s} t={t} />)}
          />
        )}
        {error ? <Text style={s.error}>{error}</Text> : null}
        {open ? (
          <View style={s.composer}>
            <TextInput style={s.input} value={draft} onChangeText={setDraft} placeholder="Write a reply" placeholderTextColor={t.textMuted} multiline editable={!sending} />
            <Pressable accessibilityRole="button" accessibilityLabel="Send" disabled={!draft.trim() || sending} onPress={send} style={[s.send, (!draft.trim() || sending) && { opacity: 0.4 }]}>
              {sending ? <ActivityIndicator size="small" color={t.textOnPrimary} /> : <Ionicons name="arrow-up" size={18} color={t.textOnPrimary} />}
            </Pressable>
          </View>
        ) : (
          <View style={s.closedNote}>
            <Ionicons name="lock-closed-outline" size={15} color={t.textSecondary} />
            <Text style={[s.hintText, { flex: 1 }]}>This conversation is closed. Start a new message if you need more help.</Text>
          </View>
        )}
      </View>
    </Sheet>
  );
}

type S = ReturnType<typeof styles>;
type T = ReturnType<typeof useTheme>;

function Bubble({ message, first, s, t }: { message: ChatMessage; first: boolean; s: S; t: T }) {
  const staff = message.from_staff;
  return (
    <View style={{ alignItems: staff ? 'flex-start' : 'flex-end' }}>
      {first ? <Text style={s.who}>{`${staff ? 'Support' : 'You'} · ${formatWhen(message.sent_at)}`}</Text> : null}
      <View style={[s.bubble, staff ? s.theirs : s.mine]}>
        <Text style={[s.text, !staff && { color: t.textOnPrimary }]}>{message.text}</Text>
      </View>
      {!first ? <Text style={s.time}>{formatWhen(message.sent_at)}</Text> : null}
    </View>
  );
}

function EventLine({ item, s, t }: { item: Extract<TimelineItem, { kind: 'event' }>; s: S; t: T }) {
  const icon = item.event.status === 'Resolved' ? 'checkmark-circle-outline' : item.event.status === 'Closed' ? 'lock-closed-outline' : item.event.status === 'Replied' ? 'chatbubble-ellipses-outline' : 'ellipse-outline';
  return (
    <View style={s.event} accessibilityRole="text">
      <View style={s.eventRule} />
      <View style={s.eventChip}>
        <Ionicons name={icon} size={12} color={t.textSecondary} />
        <Text style={s.eventText}>{`${item.text} · ${formatWhen(item.at)}`}</Text>
      </View>
      <View style={s.eventRule} />
    </View>
  );
}

function NewMessage({ onBack, onClose, onCreated }: { onBack: () => void; onClose: () => void; onCreated: (id: string, subject: string) => void }) {
  const cfg = getConfig();
  const auth = cfg.useAuth();
  const t = useTheme();
  const { showDialog } = ui();
  const s = useMemo(() => styles(t), [t]);
  const [subject, setSubject] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    if (!subject.trim()) {
      setError('Add a short subject first.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const diagnostics = await collectDiagnostics({ user: auth.user, fullName: auth.fullName, server: auth.instanceUrl ?? cfg.site });
      const r = await submitReport({ subject, description: text || subject, diagnostics, screenshot: null });
      onCreated(r.report, subject.trim());
      void offerReplyNotifications(showDialog);
    } catch (err) {
      setError(cfg.errorMessage ? cfg.errorMessage(err) : "Couldn't send. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet title="New message" onClose={busy ? () => {} : onClose} footer={<View style={{ marginTop: spacing.md }}><KitButton label="Send" iconLeft="paper-plane-outline" loading={busy} onPress={send} /></View>}>
      <Pressable accessibilityRole="button" onPress={onBack} hitSlop={8} style={s.back}>
        <Ionicons name="chevron-back" size={16} color={t.text} />
        <Text style={s.backText}>All reports</Text>
      </Pressable>
      <Text style={s.label}>Subject</Text>
      <TextInput style={s.field} value={subject} onChangeText={setSubject} placeholder="What is it about?" placeholderTextColor={t.textMuted} maxLength={140} editable={!busy} />
      <Text style={[s.label, { marginTop: spacing.md }]}>Message</Text>
      <TextInput style={[s.field, { minHeight: 100, textAlignVertical: 'top' }]} value={text} onChangeText={setText} multiline placeholder="What would you like to ask?" placeholderTextColor={t.textMuted} editable={!busy} />
      {error ? <Text style={s.error}>{error}</Text> : null}
    </Sheet>
  );
}

const styles = (t: T) => {
  const tx = type(t);
  return StyleSheet.create({
    card: { backgroundColor: t.surface, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, borderColor: t.border, padding: spacing.md, gap: 6 },
    cardTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    cardBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 },
    subject: { ...tx.label, flex: 1 },
    preview: { ...tx.small, lineHeight: 18 },
    when: { ...tx.caption },
    dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: t.danger },
    error: { ...tx.small, color: t.danger, marginVertical: 4 },
    back: { flexDirection: 'row', alignItems: 'center', gap: 2, alignSelf: 'flex-start', paddingBottom: spacing.sm },
    backText: { ...tx.label, fontSize: fontSize.xs },
    statusCard: { backgroundColor: t.surfaceAlt, borderRadius: radius.md, padding: spacing.md, gap: 6, marginBottom: spacing.sm },
    statusTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    hintText: { ...tx.small, fontSize: fontSize.xs, lineHeight: 17 },
    attach: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    who: { ...tx.caption, marginBottom: 3 },
    time: { ...tx.caption, marginTop: 2 },
    bubble: { maxWidth: '84%', borderRadius: radius.lg, paddingHorizontal: 13, paddingVertical: 9 },
    theirs: { backgroundColor: t.surfaceAlt, borderTopLeftRadius: 4 },
    mine: { backgroundColor: t.primary, borderTopRightRadius: 4 },
    text: { ...tx.body, fontSize: fontSize.sm, lineHeight: 19 },
    event: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 4 },
    eventRule: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: t.border },
    eventChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 3, borderRadius: radius.full, backgroundColor: tint(t.border, 0.5) },
    eventText: { ...tx.caption, color: t.textSecondary },
    composer: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, paddingTop: spacing.sm },
    input: { flex: 1, maxHeight: 110, borderWidth: 1, borderColor: t.border, borderRadius: radius.xl, paddingHorizontal: 14, paddingVertical: 9, ...tx.body, fontSize: fontSize.sm, backgroundColor: t.background },
    send: { width: 40, height: 40, borderRadius: 20, backgroundColor: t.primary, alignItems: 'center', justifyContent: 'center' },
    closedNote: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: t.surfaceAlt, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.sm },
    label: { ...tx.caption, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 },
    field: { borderWidth: 1, borderColor: t.border, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 11, ...tx.body, fontSize: fontSize.sm, backgroundColor: t.background },
  });
};
