import { getConfig } from '../config';
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
