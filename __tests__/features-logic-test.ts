import { setup, store } from './helpers';
import * as vault from '../src/vault/vault-core';
import { describeCrash, forgetCrash, peekCrash, rememberCrash } from '../src/support/crash-store';
import { parseReleaseNotes, shouldShowWhatsNew } from '../src/whats-new/notes';
import { bannerState, bannerText, isOffline, resolveBanner } from '../src/ui/connection-logic';
import { mergeMessages } from '../src/support/support-api';
import { summarizeDiagnostics, type Diagnostics } from '../src/support/diagnostics';
import { supportOptions } from '../src/support/options';
import { KitKeys } from '../src/config';

beforeEach(() => setup());

function fakeVault(over: Partial<vault.SecureStoreLike> = {}) {
  const secure = new Map<string, string>();
  const plain = new Map<string, string>();
  const deps: vault.VaultDeps = {
    secure: {
      setItemAsync: async (k, v) => void secure.set(k, v),
      getItemAsync: async (k) => secure.get(k) ?? null,
      deleteItemAsync: async (k) => void secure.delete(k),
      ...over,
    },
    marker: { get: async (k) => plain.get(k) ?? null, set: async (k, v) => void plain.set(k, v), remove: async (k) => void plain.delete(k) },
    secretKey: 'secret',
    markerKey: 'marker',
  };
  return { deps, secure, plain };
}
const creds = { server: 'https://s.example.com', user: 'a@b.c', password: 'pw' };

describe('fingerprint sign-in vault', () => {
  it('stores behind the secure store and a plain marker, and reads back', async () => {
    const { deps, secure, plain } = fakeVault();
    expect(await vault.isEnrolled(deps)).toBe(false);
    expect(await vault.unlock(deps)).toBeNull();
    expect(await vault.enrol(deps, creds)).toBe(true);
    expect(plain.get('marker')).toBe('1');
    expect(secure.get('secret')).not.toBeUndefined();
    expect(await vault.isEnrolled(deps)).toBe(true);
    expect(await vault.unlock(deps)).toEqual(creds);
  });
  it('asks the secure store to require authentication on write and read', async () => {
    const set = jest.fn(async (_k: string, _v: string, _o?: Record<string, unknown>) => {});
    const get = jest.fn(async (_k: string, _o?: Record<string, unknown>) => JSON.stringify(creds) as string | null);
    const { deps } = fakeVault({ setItemAsync: set, getItemAsync: get });
    await vault.enrol(deps, creds);
    expect(set.mock.calls[0][2]).toMatchObject({ requireAuthentication: true });
    await vault.unlock(deps);
    expect(get.mock.calls[0][1]).toMatchObject({ requireAuthentication: true });
  });
  it('saves nothing when the person cancels the fingerprint (the write throws)', async () => {
    const { deps, plain } = fakeVault({ setItemAsync: async () => { throw new Error('cancelled'); } });
    expect(await vault.enrol(deps, creds)).toBe(false);
    expect(plain.has('marker')).toBe(false);
  });
  it('returns null (not a throw) when the unlock is cancelled', async () => {
    const { deps } = fakeVault();
    await vault.enrol(deps, creds);
    deps.secure.getItemAsync = async () => { throw new Error('cancelled'); };
    expect(await vault.unlock(deps)).toBeNull();
  });
  it('refuses empty credentials and clears both stores', async () => {
    const { deps, secure, plain } = fakeVault();
    expect(await vault.enrol(deps, { ...creds, password: '' })).toBe(false);
    await vault.enrol(deps, creds);
    await vault.clear(deps);
    expect(secure.size + plain.size).toBe(0);
  });
  it('ignores a damaged blob', () => {
    expect(vault.parseCredentials('{nope')).toBeNull();
    expect(vault.parseCredentials(JSON.stringify({ user: 'a' }))).toBeNull();
  });
});

describe('last crash', () => {
  it('describes an Error with a capped stack', () => {
    const e = new TypeError('boom');
    e.stack = 'x'.repeat(9000);
    const c = describeCrash(e, { fatal: true, source: 'global', screen: '/orders' }, new Date('2026-11-02T10:00:00Z'));
    expect(c).toMatchObject({ message: 'boom', name: 'TypeError', fatal: true, source: 'global', screen: '/orders', at: '2026-11-02T10:00:00.000Z' });
    expect(c.stack?.length).toBe(4000);
  });
  it('copes with a thrown string', () => {
    expect(describeCrash('plain', { fatal: false, source: 'render' }).message).toBe('plain');
  });
  it('is kept until a report has carried it', async () => {
    rememberCrash(new Error('kaput'), { fatal: true, source: 'global' });
    await new Promise<void>((r) => setImmediate(() => r()));
    expect((await peekCrash())?.message).toBe('kaput');
    expect(store.get(KitKeys.lastCrash)).toBeTruthy();
    await forgetCrash();
    expect(await peekCrash()).toBeNull();
  });
});

describe('release notes', () => {
  const body = ['## v1.2.8', '', '### Chores', '', '- bump kit (fdbab91)', '', '### Features', '', '- **ui:** add `ring` to the button (a1b2c3d)', '- plain item', '', '### Fixes', '', '- stop the flicker ([abcdef1](https://x/y))'].join('\n');
  it('drops the title and hashes, puts features first and chores last', () => {
    const s = parseReleaseNotes(body);
    expect(s.map((x) => x.title)).toEqual(['Features', 'Fixes', 'Chores']);
    expect(s[0].items).toEqual(['ui: add ring to the button', 'plain item']);
    expect(s[1].items).toEqual(['stop the flicker']);
  });
  it('gives nothing for empty or free-form text without bullets', () => {
    expect(parseReleaseNotes('')).toEqual([]);
    expect(parseReleaseNotes(null)).toEqual([]);
    expect(parseReleaseNotes('Just words.')).toEqual([]);
  });
  it('collects loose bullets under one heading', () => {
    expect(parseReleaseNotes('- one\n- two')).toEqual([{ title: 'What changed', items: ['one', 'two'] }]);
  });
  it('shows after an update, never on a first install or the same version', () => {
    expect(shouldShowWhatsNew(null, '1.0.0')).toBe(false);
    expect(shouldShowWhatsNew('1.0.0', '1.0.0')).toBe(false);
    expect(shouldShowWhatsNew('1.0.0', '1.0.1')).toBe(true);
  });
});

describe('connection banner logic', () => {
  it('treats unknown as online and only the phone’s own "no" as offline', () => {
    expect(isOffline({ connected: undefined, reachable: undefined })).toBe(false);
    expect(isOffline({ connected: false, reachable: undefined })).toBe(true);
    expect(isOffline({ connected: true, reachable: false })).toBe(true);
  });
  const base = { staleAfterMs: 25_000, slowMs: 3000 };
  it('stays quiet for a short drop, then warns once it is clearly stuck', () => {
    expect(bannerState({ ...base, offlineSince: 1000, now: 20_000, latencyMs: undefined })).toBe('ok');
    expect(bannerState({ ...base, offlineSince: 1000, now: 26_000, latencyMs: undefined })).toBe('offline');
  });
  it('warns about a slow server only while online', () => {
    expect(bannerState({ ...base, offlineSince: null, now: 1, latencyMs: 3500 })).toBe('slow');
    expect(bannerState({ ...base, offlineSince: null, now: 1, latencyMs: 400 })).toBe('ok');
    expect(bannerState({ ...base, offlineSince: 1, now: 5, latencyMs: 9000 })).toBe('ok');
  });
  it('has text for each state and options with sane limits', () => {
    expect(bannerText('offline')).toMatch(/No connection/);
    expect(bannerText('slow')).toMatch(/slow/);
    expect(bannerText('ok')).toBe('');
    expect(resolveBanner(undefined)).toEqual({ enabled: true, staleAfterMs: 25_000, slowMs: 3000 });
    expect(resolveBanner(false).enabled).toBe(false);
    expect(resolveBanner({ staleAfterSec: 1, slowMs: 1 })).toEqual({ enabled: true, staleAfterMs: 5000, slowMs: 500 });
  });
});

describe('chat and support helpers', () => {
  it('merges messages without duplicates, oldest first', () => {
    const a = { id: '1', from_staff: false, text: 'hi', sent_at: '2026-11-02 10:00:00' };
    const b = { id: '2', from_staff: true, text: 'hello', sent_at: '2026-11-02 10:01:00' };
    expect(mergeMessages([b], [a, b]).map((m) => m.id)).toEqual(['1', '2']);
  });
  it('support options default to both on; false turns both off; one can be off', () => {
    expect(supportOptions(undefined)).toEqual({ report: true, chat: true });
    expect(supportOptions(false)).toEqual({ report: false, chat: false });
    expect(supportOptions({ chat: false })).toEqual({ report: true, chat: false });
  });
  it('lists what a report carries, in plain words', () => {
    const d: Diagnostics = {
      captured_at: 'x', app: { name: 'A', version: '1.0.0', runtime_version: '1.0' }, user: { id: 'a@b.c', full_name: null, server: null },
      device: { brand: 'Google', model: 'Pixel', platform: 'android', os_version: '14', battery_level: 0.5, network_type: 'wifi', wifi_ssid: 'Farm', latency_ms: 90 },
      recent_calls: [{ ts: 't', method: 'GET', url: '/x', status: 200, ms: 5 }], last_crash: { message: 'boom', fatal: true, source: 'global', at: 't' },
    };
    const lines = summarizeDiagnostics(d, true);
    expect(lines).toEqual(expect.arrayContaining(['Battery 50%', 'Network wifi (Farm), 90 ms to the server', 'Signed in as a@b.c', 'The last crash: boom', 'A screenshot of the screen you were on']));
    expect(lines.join(' ')).not.toMatch(/password|token/i);
  });
});

describe('versions shown in Settings', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { serverAppsToShow, KIT_SERVER_APP } = require('../src/version');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { KIT_VERSION } = require('../src/kit-version');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pkg = require('../package.json');
  it('the kit version is the package version', () => {
    expect(KIT_VERSION).toBe(pkg.version);
  });
  it('always lists the kit’s backend, after the app’s own list, once', () => {
    expect(serverAppsToShow(undefined).map((a: [string, string]) => a[0])).toEqual(['frappe', 'erpnext', KIT_SERVER_APP]);
    expect(serverAppsToShow([['frappe', 'Frappe']]).map((a: [string, string]) => a[0])).toEqual(['frappe', KIT_SERVER_APP]);
    expect(serverAppsToShow([[KIT_SERVER_APP, 'Mine']])).toEqual([[KIT_SERVER_APP, 'Mine']]);
  });
});
