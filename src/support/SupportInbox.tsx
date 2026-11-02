import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getConfig } from '../config';
import { Sheet } from '../ui/Sheet';
import { fontSize, spacing, useTheme } from '../ui/primitives';
import { ChatModal } from './ChatModal';
import { collectDiagnostics } from './diagnostics';
import { fetchThread, fetchThreads, markSeen, loadSeen, mergeMessages, replyThread, submitReport, unreadThreads, type ChatMessage, type ThreadSummary } from './support-api';

const POLL_MS = 6000;

type View_ = { kind: 'loading' } | { kind: 'legacy' } | { kind: 'list' } | { kind: 'thread'; id: string; subject: string } | { kind: 'new' };

/**
 * "Chat with support". On a site with Issues a conversation IS an Issue: the person's reports and questions are listed,
 * support answers with a Comment on the Issue (the way your team already works), and the answer shows here. Sites
 * without Issues use the single-thread chat instead.
 */
export function SupportInbox({ onClose }: { onClose: () => void }) {
  const cfg = getConfig();
  const t = useTheme();
  const s = useMemo(() => styles(t), [t]);
  const [view, setView] = useState<View_>({ kind: 'loading' });
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [seen, setSeen] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

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

  if (view.kind === 'legacy') return <ChatModal onClose={onClose} />;

  const back = () => {
    setView({ kind: 'list' });
    void loadList();
  };

  if (view.kind === 'thread') return <ThreadView id={view.id} subject={view.subject} onBack={back} onClose={onClose} />;
  if (view.kind === 'new') return <NewMessage onBack={() => setView({ kind: 'list' })} onClose={onClose} onCreated={(id, subject) => setView({ kind: 'thread', id, subject })} />;

  const unread = new Set(unreadThreads(threads, seen));
  return (
    <Sheet
      title="Chat with support"
      tall
      onClose={onClose}
      footer={
        <Pressable accessibilityRole="button" onPress={() => setView({ kind: 'new' })} style={s.primary}>
          <Text style={s.primaryText}>New message</Text>
        </Pressable>
      }
    >
      {view.kind === 'loading' ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={t.primary} />
      ) : (
        <ScrollView>
          {error ? <Text style={s.error}>{error}</Text> : null}
          {threads.length === 0 && !error ? <Text style={s.empty}>No conversations yet. Send a message and someone from the team will reply here.</Text> : null}
          {threads.map((th) => (
            <Pressable key={th.id} accessibilityRole="button" onPress={() => setView({ kind: 'thread', id: th.id, subject: th.subject })} style={s.row}>
              <View style={{ flex: 1 }}>
                <Text style={[s.subject, unread.has(th.id) && { fontWeight: '700' }]} numberOfLines={1}>
                  {th.subject}
                </Text>
                <Text style={s.preview} numberOfLines={1}>
                  {th.preview || '—'}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 4 }}>
                <Text style={s.status}>{th.status}</Text>
                {unread.has(th.id) ? <View style={s.dot} /> : null}
              </View>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </Sheet>
  );
}

function ThreadView({ id, subject, onBack, onClose }: { id: string; subject: string; onBack: () => void; onClose: () => void }) {
  const cfg = getConfig();
  const t = useTheme();
  const s = useMemo(() => styles(t), [t]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState('');
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const list = useRef<FlatList<ChatMessage>>(null);

  const pull = useCallback(async () => {
    try {
      const r = await fetchThread(id);
      setStatus(r.thread.status);
      setMessages((cur) => mergeMessages(cur, r.messages));
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
    } catch (err) {
      setDraft(text);
      setError(cfg.errorMessage ? cfg.errorMessage(err) : "Couldn't send. Try again.");
    } finally {
      setSending(false);
    }
  };

  const closed = status === 'Closed';
  return (
    <Sheet title={subject} tall onClose={onClose}>
      <Pressable accessibilityRole="button" onPress={onBack} style={{ paddingBottom: spacing.sm }}>
        <Text style={s.link}>‹ All conversations{status ? ` · ${status}` : ''}</Text>
      </Pressable>
      <View style={{ flex: 1 }}>
        {loading ? (
          <ActivityIndicator style={{ marginTop: 40 }} color={t.primary} />
        ) : (
          <FlatList
            ref={list}
            data={messages}
            keyExtractor={(m) => m.id}
            contentContainerStyle={{ gap: 6, paddingVertical: 8 }}
            onContentSizeChange={() => list.current?.scrollToEnd({ animated: false })}
            renderItem={({ item }) => (
              <View style={[s.bubbleRow, !item.from_staff && { justifyContent: 'flex-end' }]}>
                <View style={[s.bubble, item.from_staff ? s.theirs : s.mine]}>
                  <Text style={[s.text, !item.from_staff && { color: t.textOnPrimary }]}>{item.text}</Text>
                </View>
              </View>
            )}
          />
        )}
        {error ? <Text style={s.error}>{error}</Text> : null}
        {closed ? (
          <Text style={s.empty}>This conversation is closed. Start a new message if you need more help.</Text>
        ) : (
          <View style={s.composer}>
            <TextInput style={s.input} value={draft} onChangeText={setDraft} placeholder="Type a message" placeholderTextColor={t.textMuted} multiline editable={!sending} />
            <Pressable accessibilityRole="button" accessibilityLabel="Send" disabled={!draft.trim() || sending} onPress={send} style={[s.send, (!draft.trim() || sending) && { opacity: 0.5 }]}>
              <Ionicons name="arrow-up" size={18} color={t.textOnPrimary} />
            </Pressable>
          </View>
        )}
      </View>
    </Sheet>
  );
}

function NewMessage({ onBack, onClose, onCreated }: { onBack: () => void; onClose: () => void; onCreated: (id: string, subject: string) => void }) {
  const cfg = getConfig();
  const auth = cfg.useAuth();
  const t = useTheme();
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
    } catch (err) {
      setError(cfg.errorMessage ? cfg.errorMessage(err) : "Couldn't send. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      title="New message"
      onClose={busy ? () => {} : onClose}
      footer={
        <Pressable accessibilityRole="button" disabled={busy} onPress={send} style={[s.primary, busy && { opacity: 0.6 }]}>
          {busy ? <ActivityIndicator color={t.textOnPrimary} /> : <Text style={s.primaryText}>Send</Text>}
        </Pressable>
      }
    >
      <Pressable accessibilityRole="button" onPress={onBack} style={{ paddingBottom: spacing.sm }}>
        <Text style={s.link}>‹ All conversations</Text>
      </Pressable>
      <TextInput style={s.field} value={subject} onChangeText={setSubject} placeholder="Subject" placeholderTextColor={t.textMuted} maxLength={140} editable={!busy} />
      <TextInput style={[s.field, { minHeight: 100, textAlignVertical: 'top', marginTop: spacing.md }]} value={text} onChangeText={setText} multiline placeholder="What would you like to ask?" placeholderTextColor={t.textMuted} editable={!busy} />
      {error ? <Text style={s.error}>{error}</Text> : null}
    </Sheet>
  );
}

const styles = (t: ReturnType<typeof useTheme>) =>
  StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.border },
    subject: { fontSize: fontSize.sm, fontWeight: '600', color: t.text },
    preview: { fontSize: fontSize.xs, color: t.textMuted, marginTop: 2 },
    status: { fontSize: fontSize.xs, color: t.textMuted },
    dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: t.danger },
    empty: { textAlign: 'center', color: t.textMuted, fontSize: fontSize.sm, marginTop: 32, marginBottom: 12 },
    error: { color: t.danger, fontSize: fontSize.xs, marginVertical: 4 },
    link: { color: t.primary, fontSize: fontSize.sm, fontWeight: '500' },
    primary: { marginTop: spacing.md, alignItems: 'center', paddingVertical: 14, borderRadius: 12, backgroundColor: t.primary },
    primaryText: { color: t.textOnPrimary, fontSize: 16, fontWeight: '600' },
    bubbleRow: { flexDirection: 'row', justifyContent: 'flex-start' },
    bubble: { maxWidth: '82%', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 8 },
    theirs: { backgroundColor: t.surfaceAlt },
    mine: { backgroundColor: t.primary },
    text: { fontSize: fontSize.sm, color: t.text },
    composer: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, paddingTop: spacing.sm },
    input: { flex: 1, maxHeight: 110, borderWidth: 1, borderColor: t.border, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 8, fontSize: fontSize.sm, color: t.text, backgroundColor: t.background },
    send: { width: 38, height: 38, borderRadius: 19, backgroundColor: t.primary, alignItems: 'center', justifyContent: 'center' },
    field: { borderWidth: 1, borderColor: t.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: fontSize.sm, color: t.text, backgroundColor: t.background },
  });
