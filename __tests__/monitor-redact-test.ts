import { bodyToText, byteLength, cutBytes, headersToObject, makeKeyMatcher, redactHeaders, redactUrl, REDACTED } from '../src/monitor/redact';
import { RingBuffer } from '../src/monitor/buffer';

const secret = makeKeyMatcher();

describe('key matching', () => {
  it('hides the built-in secret names, any case, as substrings', () => {
    for (const k of ['Authorization', 'COOKIE', 'Set-Cookie', 'x-api-key', 'access_token', 'client_secret', 'Password', 'new_passwd', 'user_session', 'cardNumber']) {
      expect(secret(k)).toBe(true);
    }
  });
  it('matches short names only as whole words', () => {
    expect(secret('sid')).toBe(true);
    expect(secret('pin')).toBe(true);
    expect(secret('user_pin')).toBe(true);
    expect(secret('shipping')).toBe(false);
    expect(secret('inside')).toBe(false);
    expect(secret('spinner')).toBe(false);
  });
  it('adds the host app’s own keys', () => {
    expect(makeKeyMatcher(['national_id'])('National_ID')).toBe(true);
    expect(secret('national_id')).toBe(false);
  });
});

describe('headers', () => {
  it('redacts by name and keeps the rest', () => {
    expect(redactHeaders({ Authorization: 'token a:b', Accept: 'json', Cookie: 'sid=1' }, secret)).toEqual({ Authorization: REDACTED, Accept: 'json', Cookie: REDACTED });
  });
  it('accepts Headers-like, pair arrays and plain objects', () => {
    const map = new Map([['a', '1']]);
    expect(headersToObject(map)).toEqual({ a: '1' });
    expect(headersToObject([['b', '2']])).toEqual({ b: '2' });
    expect(headersToObject({ c: 3 })).toEqual({ c: '3' });
    expect(headersToObject({ toJSON: () => ({ d: 4 }) })).toEqual({ d: '4' });
    expect(headersToObject(undefined)).toBeUndefined();
  });
});

describe('bodies', () => {
  it('redacts nested JSON keys, including Frappe login fields', () => {
    const r = bodyToText(JSON.stringify({ usr: 'a@b.c', pwd: 'hunter2', nested: { api_key: 'k', ok: 1 }, list: [{ token: 't' }] }), 8192, secret)!;
    const o = JSON.parse(r.text);
    expect(o.pwd).toBe(REDACTED);
    expect(o.nested.api_key).toBe(REDACTED);
    expect(o.list[0].token).toBe(REDACTED);
    expect(o.nested.ok).toBe(1);
    expect(o.usr).toBe('a@b.c');
    expect(r.text).not.toContain('hunter2');
  });
  it('redacts form-encoded bodies', () => {
    const r = bodyToText('usr=a%40b.c&pwd=hunter2&x=1', 8192, secret)!;
    expect(r.text).toBe(`usr=a%40b.c&pwd=${REDACTED}&x=1`);
  });
  it('redacts secret-keyed pairs in broken JSON and HTML', () => {
    const r = bodyToText('{"token":"abc","a":"b" , "oops', 8192, secret)!;
    expect(r.text).not.toContain('abc');
  });
  it('truncates by bytes on a character boundary and says so', () => {
    const big = JSON.stringify({ a: 'é'.repeat(5000) });
    const r = bodyToText(big, 100, secret)!;
    expect(r.truncated).toBe(true);
    expect(byteLength(r.text.replace('…[truncated]', ''))).toBeLessThanOrEqual(100);
    expect(r.text.endsWith('…[truncated]')).toBe(true);
  });
  it('replaces binary and multipart bodies with a size note', () => {
    const blob = { size: 1234 };
    Object.defineProperty(blob, Symbol.toStringTag, { value: 'Blob' });
    expect(bodyToText(blob, 100, secret)!.text).toBe('[Blob body, 1234 bytes not recorded]');
    const fd = Object.defineProperty({}, Symbol.toStringTag, { value: 'FormData' });
    expect(bodyToText(fd, 100, secret)!.text).toMatch(/FormData body/);
  });
  it('serialises plain objects (axios data) and redacts them', () => {
    expect(JSON.parse(bodyToText({ password: 'p', a: 1 }, 100, secret)!.text)).toEqual({ password: REDACTED, a: 1 });
  });
  it('returns nothing for an empty body', () => {
    expect(bodyToText('', 10, secret)).toBeUndefined();
    expect(bodyToText(undefined, 10, secret)).toBeUndefined();
  });
});

describe('urls and helpers', () => {
  it('redacts secret query parameters only', () => {
    expect(redactUrl('https://x.test/a?api_key=1&page=2#h', secret)).toBe(`https://x.test/a?api_key=${REDACTED}&page=2#h`);
    expect(redactUrl('https://x.test/a', secret)).toBe('https://x.test/a');
  });
  it('cutBytes never splits a character', () => {
    expect(cutBytes('ééé', 3)).toBe('é');
    expect(cutBytes('abc', 10)).toBe('abc');
  });
});

describe('RingBuffer', () => {
  it('drops the oldest when full and drains oldest first', () => {
    const b = new RingBuffer<number>(3);
    [1, 2, 3, 4, 5].forEach((n) => b.push(n));
    expect(b.dropped).toBe(2);
    expect(b.peekLast(2)).toEqual([4, 5]);
    expect(b.drain()).toEqual([3, 4, 5]);
    expect(b.length).toBe(0);
    b.push(9);
    expect(b.drain()).toEqual([9]);
  });
});
