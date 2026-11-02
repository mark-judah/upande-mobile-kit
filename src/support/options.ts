/** Which support tools the app turned on (`support` in the config): both by default. */
export function supportOptions(v: boolean | { report?: boolean; chat?: boolean } | undefined): { report: boolean; chat: boolean } {
  if (v === false) return { report: false, chat: false };
  const o = typeof v === 'object' && v ? v : {};
  return { report: o.report !== false, chat: o.chat !== false };
}
