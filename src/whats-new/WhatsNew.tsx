import { useEffect, useMemo, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { getConfig, KitKeys } from '../config';
import { Sheet } from '../ui/Sheet';
import { KitButton, font, fontSize, spacing, type as typeStyles, useTheme } from '../ui/primitives';
import { APP_VERSION } from '../version';
import { parseReleaseNotes, shouldShowWhatsNew, splitNotes, type NoteSection } from './notes';

/** The notes of the GitHub release for this version (tag `v<version>`), or null when there are none. */
export async function fetchWhatsNew(version: string = APP_VERSION, fetchImpl: typeof fetch = fetch): Promise<NoteSection[] | null> {
  try {
    const res = await fetchImpl(`https://api.github.com/repos/${getConfig().githubRepo}/releases/tags/v${version}`, {
      headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { body?: string };
    const sections = parseReleaseNotes(json.body);
    return sections.length ? sections : null;
  } catch {
    return null;
  }
}

/** The sheet itself: used by the one-time prompt and by the Settings row. */
export function WhatsNewSheet({ version, sections, loading, onClose }: { version: string; sections: NoteSection[] | null; loading?: boolean; onClose: () => void }) {
  const t = useTheme();
  const s = useMemo(() => styles(t), [t]);
  const [showTechnical, setShowTechnical] = useState(false);
  // Notes written for users ("Note:" lines in commits) come first and alone; the developer sections hide behind a link.
  const { highlights, technical } = useMemo(() => splitNotes(sections ?? []), [sections]);
  const friendly = highlights.length > 0;
  const shown = friendly ? (showTechnical ? technical : []) : technical;

  return (
    <Sheet title={`What's new in v${version}`} onClose={onClose}>
      {loading ? (
        <ActivityIndicator color={t.text} style={{ marginVertical: 24 }} />
      ) : (
        <ScrollView style={{ maxHeight: 420 }}>
          {friendly ? (
            <View style={s.highlights}>
              {highlights.map((i) => (
                <View key={i} style={s.bulletRow}>
                  <View style={s.dot} />
                  <Text style={s.highlight}>{i}</Text>
                </View>
              ))}
            </View>
          ) : null}
          {shown.map((sec) => (
            <View key={sec.title} style={{ marginBottom: spacing.lg }}>
              <Text style={s.heading}>{sec.title}</Text>
              {sec.items.map((i) => (
                <View key={i} style={s.bulletRow}>
                  <View style={[s.dot, s.dotQuiet]} />
                  <Text style={s.item}>{i}</Text>
                </View>
              ))}
            </View>
          ))}
          {!friendly && !technical.length ? <Text style={s.item}>No release notes were published for this version.</Text> : null}
          {friendly && technical.length ? (
            <Pressable accessibilityRole="button" onPress={() => setShowTechnical((v) => !v)} style={s.linkRow}>
              <Ionicons name={showTechnical ? 'chevron-up' : 'chevron-down'} size={14} color={t.text} />
              <Text style={s.link}>{showTechnical ? 'Hide technical changes' : 'Show technical changes'}</Text>
            </Pressable>
          ) : null}
        </ScrollView>
      )}
      <View style={{ marginTop: spacing.md }}>
        <KitButton label="Got it" onPress={onClose} />
      </View>
    </Sheet>
  );
}

/**
 * Mounted once by the provider. After the app has been updated (the version differs from the one seen on the last
 * launch) it shows the new version's notes once. First installs and versions without notes show nothing.
 */
export function WhatsNewGate({ suppressed }: { suppressed: boolean }) {
  const [shown, setShown] = useState<{ version: string; sections: NoteSection[] } | null>(null);

  useEffect(() => {
    if (getConfig().whatsNew === false || __DEV__) return;
    let alive = true;
    (async () => {
      const { storage } = getConfig();
      const stored = await storage.get(KitKeys.lastSeenVersion).catch(() => null);
      await storage.set(KitKeys.lastSeenVersion, APP_VERSION).catch(() => {});
      if (!shouldShowWhatsNew(stored, APP_VERSION)) return;
      const sections = await fetchWhatsNew();
      if (alive && sections) setShown({ version: APP_VERSION, sections });
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (!shown || suppressed) return null;
  return <WhatsNewSheet version={shown.version} sections={shown.sections} onClose={() => setShown(null)} />;
}

const styles = (t: ReturnType<typeof useTheme>) => {
  const tx = typeStyles(t);
  return StyleSheet.create({
    highlights: { backgroundColor: t.surfaceAlt, borderRadius: 10, padding: spacing.md, marginBottom: spacing.lg, gap: 6 },
    heading: { ...tx.section, marginBottom: spacing.sm },
    bulletRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
    dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: t.text, marginTop: 7 },
    dotQuiet: { backgroundColor: t.textMuted },
    highlight: { ...font(t, 'medium'), flex: 1, fontSize: fontSize.md, color: t.text, lineHeight: 22 },
    linkRow: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44 },
    link: { ...font(t, 'semiBold'), color: t.text, fontSize: fontSize.sm },
    item: { ...font(t, 'regular'), flex: 1, fontSize: fontSize.sm, color: t.textSecondary, lineHeight: 20, marginBottom: 4 },
  });
};
