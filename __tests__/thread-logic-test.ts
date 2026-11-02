import { buildTimeline, canReply, eventText, formatWhen, mergeEvents, reportsHint, reportsSummary, statusHint, statusTone } from '../src/support/thread-logic';

const msg = (id: string, at: string, from_staff = false) => ({ id, from_staff, text: id, sent_at: at });
const ev = (id: string, at: string, status: string, extra: object = {}) => ({ id, kind: 'status' as const, status, sent_at: at, ...extra });

describe('status words and tones', () => {
  it('colours only by what the status means', () => {
    expect(statusTone('Open')).toBe('warning');
    expect(statusTone('Replied')).toBe('info');
    expect(statusTone('Resolved')).toBe('success');
    expect(statusTone('Closed')).toBe('neutral');
    expect(statusTone('On Hold')).toBe('neutral');
  });
  it('says what each status means, and only Closed refuses a reply', () => {
    expect(statusHint('Open')).toMatch(/waiting/i);
    expect(statusHint('Mystery')).toBe('');
    expect(canReply('Closed')).toBe(false);
    expect(canReply('Resolved')).toBe(true);
  });
  it('uses the server wording and falls back to the same words for an older server', () => {
    expect(eventText(ev('a', 't', 'Resolved', { label: 'Marked resolved' }))).toBe('Marked resolved');
    expect(eventText(ev('a', 't', 'Resolved'))).toBe('Marked resolved');
    expect(eventText(ev('a', 't', 'Open', { previous: 'Resolved' }))).toBe('Reopened');
    expect(eventText(ev('a', 't', 'Open', { previous: null }))).toBe('Opened');
    expect(eventText(ev('a', 't', 'Waiting'))).toBe('Status changed to Waiting');
    expect(eventText({ id: 'c', kind: 'created', status: 'Open', sent_at: 't' })).toBe('Report sent');
  });
});

describe('the conversation timeline', () => {
  it('interleaves words and status changes by time, and drops the filing event next to the person’s first message', () => {
    const t = buildTimeline(
      [msg('first', '2026-11-02 09:00:00'), msg('answer', '2026-11-02 09:30:00', true)],
      [{ id: 'c', kind: 'created', status: 'Open', sent_at: '2026-11-02 09:00:00' }, ev('r', '2026-11-02 09:30:01', 'Replied'), ev('x', '2026-11-02 10:00:00', 'Resolved')],
    );
    expect(t.map((i) => i.id)).toEqual(['m:first', 'm:answer', 'e:r', 'e:x']);
  });
  it('keeps the filing event when there are no messages, and a message before the status change it caused', () => {
    expect(buildTimeline([], [{ id: 'c', kind: 'created', status: 'Open', sent_at: 't' }]).map((i) => i.id)).toEqual(['e:c']);
    const same = buildTimeline([msg('m', '2026-11-02 09:30:00')], [ev('e', '2026-11-02 09:30:00', 'Replied')]);
    expect(same.map((i) => i.id)).toEqual(['m:m', 'e:e']);
  });
  it('merges events without duplicates, oldest first', () => {
    const out = mergeEvents([ev('b', '2', 'Replied')], [ev('a', '1', 'Open'), ev('b', '2', 'Replied')]);
    expect(out.map((e) => e.id)).toEqual(['a', 'b']);
  });
});

describe('times and the My reports row', () => {
  const now = new Date(2026, 10, 2, 18, 0);
  it('reads server times as written: time today, day this year, day and year before', () => {
    expect(formatWhen('2026-11-02 17:13:30.717117', now)).toBe('17:13');
    expect(formatWhen('2026-10-31 08:00:00', now)).toBe('31 Oct');
    expect(formatWhen('2025-01-05 08:00:00', now)).toBe('5 Jan 2025');
    expect(formatWhen('', now)).toBe('');
    expect(formatWhen(null, now)).toBe('');
  });
  it('counts open reports (not resolved or closed) and says how many replies are new', () => {
    const th = (id: string, status: string) => ({ id, subject: id, status, last_activity: 't', last_staff_at: null, preview: '' });
    const sum = reportsSummary([th('a', 'Open'), th('b', 'Replied'), th('c', 'Resolved'), th('d', 'Closed')], ['b']);
    expect(sum).toEqual({ open: 2, total: 4, unread: 1 });
    expect(reportsHint(sum)).toBe('1 new reply · 2 open · 4 in total');
    expect(reportsHint({ open: 0, total: 0, unread: 0 })).toMatch(/nothing sent/i);
    expect(reportsHint({ open: 1, total: 1, unread: 2 })).toContain('2 new replies');
  });
});
