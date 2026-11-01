/**
 * Redaction and truncation. Runs at flush time only, never on the request path.
 * The server redacts again; this is the first line, so secrets never leave the phone.
 */

const BUILTIN_KEYS = [
  'authorization', 'cookie', 'set-cookie', 'token', 'secret', 'password', 'passwd', 'pwd',
  'api_key', 'apikey', 'api-key', 'session', 'sid', 'otp', 'pin', 'cvv', 'card',
];
/** Short keys must match whole words, or "pin" would hide "shipping" and "sid" would hide "inside". */
const WHOLE_WORD = new Set(['sid', 'pin', 'otp', 'pwd', 'cvv']);
export const REDACTED = '[redacted]';

export function makeKeyMatcher(extra: string[] = []): (key: string) => boolean {
  const subs = [...BUILTIN_KEYS.filter((k) => !WHOLE_WORD.has(k)), ...extra.map((k) => k.toLowerCase())];
  return (key: string) => {
    const k = key.toLowerCase();
    if (subs.some((s) => k.includes(s))) return true;
    return k.split(/[^a-z0-9]+/).some((w) => WHOLE_WORD.has(w));
  };
}

export function redactValue(value: unknown, isSecret: (k: string) => boolean, depth = 0): unknown {
  if (depth > 8) return '[depth]';
  if (Array.isArray(value)) return value.slice(0, 200).map((v) => redactValue(v, isSecret, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = isSecret(k) ? REDACTED : redactValue(v, isSecret, depth + 1);
    }
    return out;
  }
  return value;
}

export function redactHeaders(h: Record<string, string> | undefined, isSecret: (k: string) => boolean): Record<string, string> | undefined {
  if (!h) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(h)) out[k] = isSecret(k) ? REDACTED : String(v);
  return out;
}

/** Turn whatever a caller passed as headers (Headers, array pairs, plain object) into a plain object. */
export function headersToObject(h: unknown): Record<string, string> | undefined {
  if (!h) return undefined;
  const out: Record<string, string> = {};
  try {
    const anyH = h as { forEach?: (cb: (v: string, k: string) => void) => void };
    if (Array.isArray(h)) {
      for (const pair of h) if (Array.isArray(pair) && pair.length >= 2) out[String(pair[0])] = String(pair[1]);
    } else if (typeof (h as { toJSON?: unknown }).toJSON === 'function' && typeof anyH.forEach !== 'function') {
      for (const [k, v] of Object.entries((h as { toJSON: () => Record<string, unknown> }).toJSON())) out[k] = String(v);
    } else if (typeof anyH.forEach === 'function') {
      anyH.forEach!((v, k) => {
        out[k] = String(v);
      });
    } else if (typeof h === 'object') {
      for (const [k, v] of Object.entries(h as Record<string, unknown>)) out[k] = String(v);
    }
  } catch {
    return undefined;
  }
  return out;
}

export function byteLength(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    n += c < 0x80 ? 1 : c < 0x800 ? 2 : c >= 0xd800 && c <= 0xdbff ? (i += 1, 4) : 3;
  }
  return n;
}

/** Cut `s` to at most `max` bytes, on a character boundary. */
export function cutBytes(s: string, max: number): string {
  if (byteLength(s) <= max) return s;
  let lo = 0;
  let hi = Math.min(s.length, max);
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (byteLength(s.slice(0, mid)) <= max) lo = mid;
    else hi = mid - 1;
  }
  return s.slice(0, lo);
}

export type BodyResult = { text: string; truncated: boolean };

/**
 * A body as redacted text. JSON (and form-encoded) bodies are redacted by key;
 * anything else is truncated as plain text. Binary / multipart bodies become a size note.
 */
export function bodyToText(body: unknown, maxBytes: number, isSecret: (k: string) => boolean): BodyResult | undefined {
  if (body === undefined || body === null || body === '') return undefined;
  if (typeof body !== 'string') {
    const tag = Object.prototype.toString.call(body);
    if (/FormData|Blob|ArrayBuffer|Uint8Array|File|URLSearchParams/.test(tag)) {
      if (tag.includes('URLSearchParams')) return bodyToText(String(body), maxBytes, isSecret);
      const size = (body as { size?: number; byteLength?: number }).size ?? (body as { byteLength?: number }).byteLength;
      return { text: `[${tag.slice(8, -1)} body${size != null ? `, ${size} bytes` : ''} not recorded]`, truncated: false };
    }
    try {
      body = JSON.stringify(body);
    } catch {
      return { text: '[unserialisable body]', truncated: false };
    }
  }
  const raw = body as string;
  let text = raw;
  const t = raw.trimStart();
  if (t.startsWith('{') || t.startsWith('[')) {
    try {
      text = JSON.stringify(redactValue(JSON.parse(raw), isSecret));
    } catch {
      text = raw; // truncated or not JSON: fall through to plain-text handling
      text = redactLooseText(text, isSecret);
    }
  } else if (/^[^\s=&]+=[^&]*(&[^\s=&]+=[^&]*)*$/.test(raw)) {
    text = raw
      .split('&')
      .map((pair) => {
        const i = pair.indexOf('=');
        return i > 0 && isSecret(decodeURIComponentSafe(pair.slice(0, i))) ? `${pair.slice(0, i)}=${REDACTED}` : pair;
      })
      .join('&');
  } else {
    text = redactLooseText(text, isSecret);
  }
  if (byteLength(text) <= maxBytes) return { text, truncated: false };
  return { text: cutBytes(text, maxBytes) + '…[truncated]', truncated: true };
}

function decodeURIComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s.replace(/\+/g, ' '));
  } catch {
    return s;
  }
}

/** Non-JSON text (HTML error pages, broken JSON): blank out `"key": "value"` pairs with secret keys. */
function redactLooseText(text: string, isSecret: (k: string) => boolean): string {
  return text.replace(/"([^"\\]{1,64})"\s*:\s*"((?:[^"\\]|\\.)*)"/g, (m, k) => (isSecret(k) ? `"${k}":"${REDACTED}"` : m));
}

/** Query strings can carry secrets too: redact by key, keep the rest of the URL. */
export function redactUrl(url: string, isSecret: (k: string) => boolean): string {
  const q = url.indexOf('?');
  if (q < 0) return url;
  const hash = url.indexOf('#', q);
  const query = url.slice(q + 1, hash < 0 ? undefined : hash);
  const redacted = query
    .split('&')
    .map((pair) => {
      const i = pair.indexOf('=');
      return i > 0 && isSecret(decodeURIComponentSafe(pair.slice(0, i))) ? `${pair.slice(0, i)}=${REDACTED}` : pair;
    })
    .join('&');
  return url.slice(0, q + 1) + redacted + (hash < 0 ? '' : url.slice(hash));
}
