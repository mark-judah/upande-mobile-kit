/**
 * The release notes the workflow writes (`## v1.2.8`, `### Features`, `- text (abc1234)`) turned into sections a
 * phone can show. Commit hashes are dropped; empty sections vanish; chores sort last.
 */

export type NoteSection = { title: string; items: string[] };

const ORDER = ['features', 'feature', 'fixes', 'bug fixes', 'improvements', 'performance', 'documentation', 'docs', 'chores', 'other'];

export function parseReleaseNotes(body: string | null | undefined): NoteSection[] {
  const sections: NoteSection[] = [];
  let current: NoteSection | null = null;
  for (const raw of String(body ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    const heading = /^#{2,4}\s+(.+)$/.exec(line);
    if (heading) {
      // `## v1.2.8` is the release title, not a section.
      if (/^v?\d+\.\d+\.\d+/.test(heading[1])) {
        current = null;
        continue;
      }
      current = { title: heading[1].trim(), items: [] };
      sections.push(current);
      continue;
    }
    const item = /^[-*]\s+(.+)$/.exec(line);
    if (!item) continue;
    const text = item[1]
      .replace(/\s*\(\[?[0-9a-f]{7,40}\]?(\([^)]*\))?\)\s*$/i, '')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .trim();
    if (!text) continue;
    if (!current) {
      current = { title: 'What changed', items: [] };
      sections.push(current);
    }
    current.items.push(text);
  }
  const rank = (t: string) => {
    const i = ORDER.indexOf(t.toLowerCase());
    return i === -1 ? ORDER.length - 1.5 : i;
  };
  return sections.filter((s) => s.items.length).sort((a, b) => rank(a.title) - rank(b.title));
}

/** Whether to show "What's new": only when the version changed since the last launch, and never on a first install. */
export function shouldShowWhatsNew(stored: string | null | undefined, current: string): boolean {
  return !!stored && stored !== current;
}
