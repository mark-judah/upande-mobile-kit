import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { getConfig, KitKeys } from '../config';
import { Sheet } from '../ui/Sheet';
import { fontSize, spacing, useTheme } from '../ui/primitives';
import { APP_VERSION } from '../version';
import { parseReleaseNotes, shouldShowWhatsNew, type NoteSection } from './notes';

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
  return (
    <Sheet title={`What's new in v${version}`} onClose={onClose}>
      {loading ? (
        <ActivityIndicator color={t.primary} style={{ marginVertical: 24 }} />
      ) : (
        <ScrollView style={{ maxHeight: 420 }}>
          {sections?.length ? (
            sections.map((sec) => (
              <View key={sec.title} style={{ marginBottom: spacing.md }}>
                <Text style={s.heading}>{sec.title}</Text>
                {sec.items.map((i) => (
                  <Text key={i} style={s.item}>
                    • {i}
                  </Text>
                ))}
              </View>
            ))
          ) : (
            <Text style={s.item}>No release notes were published for this version.</Text>
          )}
        </ScrollView>
      )}
      <Pressable accessibilityRole="button" onPress={onClose} style={s.button}>
        <Text style={s.buttonText}>Got it</Text>
      </Pressable>
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

const styles = (t: ReturnType<typeof useTheme>) =>
  StyleSheet.create({
    heading: { fontSize: fontSize.sm, fontWeight: '700', color: t.text, marginBottom: 4 },
    item: { fontSize: fontSize.sm, color: t.textSecondary, lineHeight: 20, marginBottom: 2 },
    button: { marginTop: spacing.md, alignItems: 'center', paddingVertical: 14, borderRadius: 12, backgroundColor: t.primary },
    buttonText: { color: t.textOnPrimary, fontSize: 16, fontWeight: '600' },
  });
