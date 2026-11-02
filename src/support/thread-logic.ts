import type { Tone } from '../ui/primitives';
import type { ChatMessage, ThreadEvent, ThreadSummary } from './support-api';

/** Pure helpers behind "My reports" and the conversation timeline. No React, no network. */

/** The tone of a status chip: waiting on support is amber, answered is dark, done is green, closed is grey. */
export function statusTone(status: string): Tone {
  switch (status) {
    case 'Open':
      return 'warning';
    case 'Replied':
      return 'info';
    case 'Resolved':
      return 'success';
    default:
      return 'neutral';
  }
}

/** A line under the status that says what it means for the person. */
export function statusHint(status: string): string {
  switch (status) {
    case 'Open':
      return 'Waiting for support to look at this.';
    case 'Replied':
      return 'Support has answered. Reply below if you need more.';
    case 'Resolved':
      return 'Marked as resolved. Reply below to reopen it.';
    case 'Closed':
      return 'This conversation is closed.';
    case 'On Hold':
      return 'Support has put this on hold.';
    default:
      return '';
  }
}

/** Whether the person can still write on a conversation. Closed ones refuse replies. */
export function canReply(status: string): boolean {
  return status !== 'Closed';
}

/** A status change in plain words. The server sends `label`; this is the same wording for older servers. */
export function eventText(e: ThreadEvent): string {
  if (e.label) return e.label;
  if (e.kind === 'created') return 'Report sent';
  if (e.status === 'Open') return e.previous && e.previous !== 'Open' ? 'Reopened' : 'Opened';
  if (e.status === 'Replied') return 'Replied';
  if (e.status === 'Resolved') return 'Marked resolved';
  if (e.status === 'Closed') return 'Closed';
  if (e.status === 'On Hold') return 'Put on hold';
  return `Status changed to ${e.status}`;
}

export type TimelineItem =
  | { kind: 'message'; id: string; at: string; message: ChatMessage }
  | { kind: 'event'; id: string; at: string; event: ThreadEvent; text: string };

/**
 * Words and status changes in one list, oldest first. The filing event is dropped when the person's own first
 * message is there (it says the same thing); equal times keep messages before the status change they caused.
 */
export function buildTimeline(messages: ChatMessage[], events: ThreadEvent[]): TimelineItem[] {
  const items: TimelineItem[] = [];
  for (const m of messages) items.push({ kind: 'message', id: `m:${m.id}`, at: m.sent_at, message: m });
  for (const e of events) {
    if (e.kind === 'created' && messages.length > 0) continue;
    items.push({ kind: 'event', id: `e:${e.id}`, at: e.sent_at, event: e, text: eventText(e) });
  }
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => (a.item.at < b.item.at ? -1 : a.item.at > b.item.at ? 1 : a.index - b.index))
    .map((x) => x.item);
}

/** Adds events the screen has not seen: no duplicates. */
export function mergeEvents(current: ThreadEvent[], incoming: ThreadEvent[]): ThreadEvent[] {
  const byId = new Map<string, ThreadEvent>();
  for (const e of [...current, ...incoming]) byId.set(e.id, e);
  return [...byId.values()].sort((a, b) => (a.sent_at < b.sent_at ? -1 : a.sent_at > b.sent_at ? 1 : 0));
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * "17:13" for today, "2 Nov" for this year, "2 Nov 2025" otherwise. Server times carry no zone, so they are read
 * as written instead of being pushed through a Date (which would shift them).
 */
export function formatWhen(at: string | null | undefined, now: Date = new Date()): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(at ?? '');
  if (!m) return '';
  const [, y, mo, d, hh, mm] = m;
  const sameDay = Number(y) === now.getFullYear() && Number(mo) === now.getMonth() + 1 && Number(d) === now.getDate();
  if (sameDay) return `${hh}:${mm}`;
  const day = `${Number(d)} ${MONTHS[Number(mo) - 1] ?? ''}`;
  return Number(y) === now.getFullYear() ? day : `${day} ${y}`;
}

/** The numbers on the "My reports" row. */
export function reportsSummary(threads: ThreadSummary[], unreadIds: string[]): { open: number; total: number; unread: number } {
  const done = new Set(['Resolved', 'Closed']);
  return { open: threads.filter((t) => !done.has(t.status)).length, total: threads.length, unread: unreadIds.length };
}

/** The hint on the "My reports" row. */
export function reportsHint(sum: { open: number; total: number; unread: number }): string {
  if (sum.total === 0) return 'Nothing sent yet. Your reports and support answers will show here.';
  const parts = [];
  if (sum.unread) parts.push(`${sum.unread} new ${sum.unread === 1 ? 'reply' : 'replies'}`);
  parts.push(`${sum.open} open`);
  parts.push(`${sum.total} in total`);
  return parts.join(' · ');
}
