import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getConfig } from '../config';
import { Sheet } from '../ui/Sheet';
import { EmptyState, fontSize, radius, spacing, type, useTheme } from '../ui/primitives';
import { fetchChat, mergeMessages, sendChat, type ChatMessage } from './support-api';

const POLL_MS = 6000;

/** The person's conversation with support. Polls while open and the app is in the foreground. */
export function ChatModal({ onClose }: { onClose: () => void }) {
  const cfg = getConfig();
  const t = useTheme();
  const s = useMemo(() => styles(t), [t]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const newest = useRef<string | null>(null);
  const list = useRef<FlatList<ChatMessage>>(null);

  const pull = useCallback(async () => {
    try {
      const r = await fetchChat(newest.current);
      if (r.messages.length) {
        setMessages((cur) => {
          const next = mergeMessages(cur, r.messages);
          newest.current = next[next.length - 1]?.sent_at ?? newest.current;
          return next;
        });
      }
      setError(null);
    } catch (err) {
      setError(cfg.errorMessage ? cfg.errorMessage(err) : "Couldn't reach support. We'll keep trying.");
    } finally {
      setLoading(false);
    }
  }, [cfg]);

  useEffect(() => {
    void pull();
    const id = setInterval(() => {
      if (AppState.currentState === 'active') void pull();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [pull]);

  const send = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setDraft('');
    try {
      const m = await sendChat(text);
      setMessages((cur) => {
        const next = mergeMessages(cur, [m]);
        newest.current = next[next.length - 1]?.sent_at ?? newest.current;
        return next;
      });
    } catch (err) {
      setDraft(text);
      setError(cfg.errorMessage ? cfg.errorMessage(err) : "Couldn't send. Try again.");
    } finally {
      setSending(false);
    }
  };

  return (
    <Sheet title="Chat with support" tall onClose={onClose}>
      <View style={{ flex: 1 }}>
        {loading ? (
          <ActivityIndicator style={{ marginTop: 40 }} color={t.text} />
        ) : (
          <FlatList
            ref={list}
            data={messages}
            keyExtractor={(m) => m.id}
            contentContainerStyle={{ gap: 6, paddingVertical: 8 }}
            onContentSizeChange={() => list.current?.scrollToEnd({ animated: false })}
            ListEmptyComponent={<EmptyState icon="chatbubbles-outline" title="Say hello" subtitle="Someone from the team will reply here." />}
            renderItem={({ item }) => (
              <View style={[s.row, !item.from_staff && s.mine]}>
                <View style={[s.bubble, item.from_staff ? s.theirs : s.myBubble]}>
                  <Text style={[s.text, !item.from_staff && { color: t.textOnPrimary }]}>{item.text}</Text>
                </View>
              </View>
            )}
          />
        )}
        {error ? <Text style={s.error}>{error}</Text> : null}
        <View style={s.composer}>
          <TextInput style={s.input} value={draft} onChangeText={setDraft} placeholder="Type a message" placeholderTextColor={t.textMuted} multiline editable={!sending} />
          <Pressable accessibilityRole="button" accessibilityLabel="Send" disabled={!draft.trim() || sending} onPress={send} style={[s.sendBtn, (!draft.trim() || sending) && { opacity: 0.5 }]}>
            <Ionicons name="arrow-up" size={18} color={t.textOnPrimary} />
          </Pressable>
        </View>
      </View>
    </Sheet>
  );
}

const styles = (t: ReturnType<typeof useTheme>) => {
  const tx = type(t);
  return StyleSheet.create({
    row: { flexDirection: 'row', justifyContent: 'flex-start' },
    mine: { justifyContent: 'flex-end' },
    bubble: { maxWidth: '84%', borderRadius: radius.lg, paddingHorizontal: 13, paddingVertical: 9 },
    theirs: { backgroundColor: t.surfaceAlt, borderTopLeftRadius: 4 },
    myBubble: { backgroundColor: t.primary, borderTopRightRadius: 4 },
    text: { ...tx.body, fontSize: fontSize.sm, lineHeight: 19 },
    error: { ...tx.small, color: t.danger, marginVertical: 4 },
    composer: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, paddingTop: spacing.sm },
    input: { flex: 1, maxHeight: 110, borderWidth: 1, borderColor: t.border, borderRadius: radius.xl, paddingHorizontal: 14, paddingVertical: 9, ...tx.body, fontSize: fontSize.sm, backgroundColor: t.background },
    sendBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: t.primary, alignItems: 'center', justifyContent: 'center' },
  });
};
