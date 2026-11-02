import { getConfig, KitKeys } from '../config';
import { getInstallId } from '../devices/install-register';

export type ChatMessage = { id: string; from_staff: boolean; text: string; sent_at: string };

type Body<T> = { message?: T } | T;
const unwrap = <T,>(b: Body<T>): T => ((b && typeof b === 'object' && 'message' in (b as object) ? (b as { message: T }).message : b) as T);

/** File a problem report on the site. Resolves with the report's id. */
export async function submitReport(input: { subject: string; description: string; diagnostics: unknown; screenshot?: string | null }): Promise<{ report: string }> {
  const { api, appName, endpoints } = getConfig();
  const res = await api<Body<{ report: string }>>({
    method: 'POST',
    url: endpoints.submitReport,
    data: {
      app: appName,
      subject: input.subject.trim().slice(0, 140),
      description: input.description.trim().slice(0, 5000),
      install_id: (await getInstallId().catch(() => null)) ?? '',
      diagnostics: JSON.stringify(input.diagnostics),
      ...(input.screenshot ? { screenshot: input.screenshot } : {}),
    },
  });
  return unwrap(res);
}

/** The person's conversation with support. `since` is the sent_at of the newest message already shown. */
export async function fetchChat(since?: string | null): Promise<{ messages: ChatMessage[]; unread: number }> {
  const { api, appName, endpoints } = getConfig();
  const res = await api<Body<{ messages?: ChatMessage[]; unread?: number }>>({
    method: 'GET',
    url: endpoints.chat,
    params: { app: appName, ...(since ? { since } : {}) },
  });
  const m = unwrap(res) ?? {};
  return { messages: Array.isArray(m.messages) ? m.messages : [], unread: Number(m.unread) || 0 };
}

/** How many support replies the person has not read yet, without marking them read. */
export async function fetchUnread(): Promise<number> {
  const { api, appName, endpoints } = getConfig();
  const res = await api<Body<{ unread?: number }>>({ method: 'GET', url: endpoints.chat, params: { app: appName, count_only: 1 } });
  return Number(unwrap(res)?.unread) || 0;
}

export async function sendChat(text: string): Promise<ChatMessage> {
  const { api, appName, endpoints } = getConfig();
  const res = await api<Body<ChatMessage>>({ method: 'POST', url: endpoints.chat, data: { app: appName, text: text.trim().slice(0, 2000) } });
  return unwrap(res);
}

/** Adds new messages to the list: no duplicates, oldest first. */
export function mergeMessages(current: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const byId = new Map<string, ChatMessage>();
  for (const m of [...current, ...incoming]) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => (a.sent_at < b.sent_at ? -1 : a.sent_at > b.sent_at ? 1 : 0));
}

/* ---- conversations as Issues ---- */

export type ThreadSummary = { id: string; subject: string; status: string; last_activity: string; last_staff_at: string | null; preview: string };

/** The person's conversations. `mode: 'chat'` means the site has no Issue doctype and the single-thread chat is used. */
export async function fetchThreads(): Promise<{ mode: 'issue' | 'chat'; threads: ThreadSummary[] }> {
  const { api, appName, endpoints } = getConfig();
  const res = await api<Body<{ mode?: string; threads?: ThreadSummary[] }>>({ method: 'GET', url: endpoints.supportThreads, params: { app: appName } });
  const m = unwrap(res) ?? {};
  return { mode: m.mode === 'chat' ? 'chat' : 'issue', threads: Array.isArray(m.threads) ? m.threads : [] };
}

export async function fetchThread(id: string): Promise<{ thread: { id: string; subject: string; status: string }; messages: ChatMessage[] }> {
  const { api, endpoints } = getConfig();
  const res = await api<Body<{ thread: { id: string; subject: string; status: string }; messages?: ChatMessage[] }>>({ method: 'GET', url: endpoints.supportThread, params: { issue: id } });
  const m = unwrap(res);
  return { thread: m.thread, messages: Array.isArray(m.messages) ? m.messages : [] };
}

export async function replyThread(id: string, text: string): Promise<ChatMessage> {
  const { api, endpoints } = getConfig();
  const res = await api<Body<ChatMessage>>({ method: 'POST', url: endpoints.supportReply, data: { issue: id, text: text.trim().slice(0, 2000) } });
  return unwrap(res);
}

/** Thread ids support has answered since the person last opened them. */
export function unreadThreads(threads: ThreadSummary[], seen: Record<string, string>): string[] {
  return threads.filter((t) => t.last_staff_at && t.last_staff_at > (seen[t.id] ?? '')).map((t) => t.id);
}

export async function loadSeen(): Promise<Record<string, string>> {
  try {
    const raw = await getConfig().storage.get(KitKeys.chatLastSeen);
    const v = raw ? JSON.parse(raw) : {};
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

/** Remember that the person has seen support's answers up to `at` on a thread. */
export async function markSeen(id: string, at: string | null): Promise<void> {
  if (!at) return;
  try {
    const seen = await loadSeen();
    if ((seen[id] ?? '') >= at) return;
    seen[id] = at;
    // Keep the map small: only the newest 50 threads.
    const keep = Object.fromEntries(Object.entries(seen).sort((a, b) => (a[1] < b[1] ? 1 : -1)).slice(0, 50));
    await getConfig().storage.set(KitKeys.chatLastSeen, JSON.stringify(keep));
  } catch {
    /* unread dots are a convenience */
  }
}

/** How many conversations have an answer the person has not opened. Works for both chat modes. */
export async function fetchUnreadCount(): Promise<number> {
  const { mode, threads } = await fetchThreads();
  if (mode === 'chat') return fetchUnread();
  return unreadThreads(threads, await loadSeen()).length;
}
