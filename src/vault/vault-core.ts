/**
 * The fingerprint sign-in vault, free of React and native modules so it can be tested: credentials are kept in
 * secure storage behind the phone's biometric, with a plain marker so "is there one?" never triggers a prompt.
 * (The marker lives in the app's storage, not in the secure store, for exactly that reason.)
 */

export type VaultCredentials = { server: string; user: string; password: string };

export type SecureStoreLike = {
  setItemAsync: (key: string, value: string, options?: Record<string, unknown>) => Promise<void>;
  getItemAsync: (key: string, options?: Record<string, unknown>) => Promise<string | null>;
  deleteItemAsync: (key: string) => Promise<void>;
};

export type VaultDeps = {
  secure: SecureStoreLike;
  /** Plain key/value store for the marker. */
  marker: { get: (k: string) => Promise<string | null>; set: (k: string, v: string) => Promise<void>; remove: (k: string) => Promise<void> };
  secretKey: string;
  markerKey: string;
};

const clean = (v: unknown) => (typeof v === 'string' ? v : '');

export function parseCredentials(raw: string | null): VaultCredentials | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<VaultCredentials>;
    const c = { server: clean(v.server), user: clean(v.user), password: clean(v.password) };
    return c.user && c.password ? c : null;
  } catch {
    return null;
  }
}

export async function isEnrolled(d: VaultDeps): Promise<boolean> {
  try {
    return (await d.marker.get(d.markerKey)) === '1';
  } catch {
    return false;
  }
}

/** Stores the sign-in; the secure store asks for the fingerprint on the write, which is the confirmation. False when cancelled or storage failed. */
export async function enrol(d: VaultDeps, c: VaultCredentials, prompt = 'Confirm to turn on fingerprint sign-in'): Promise<boolean> {
  if (!c.user || !c.password) return false;
  try {
    await d.secure.setItemAsync(d.secretKey, JSON.stringify(c), { requireAuthentication: true, authenticationPrompt: prompt });
    await d.marker.set(d.markerKey, '1');
    return true;
  } catch {
    await clear(d);
    return false;
  }
}

/** Reads the credentials back; the secure store itself shows the biometric prompt. Null when cancelled or gone. */
export async function unlock(d: VaultDeps, prompt = 'Sign in'): Promise<VaultCredentials | null> {
  if (!(await isEnrolled(d))) return null;
  try {
    return parseCredentials(await d.secure.getItemAsync(d.secretKey, { requireAuthentication: true, authenticationPrompt: prompt }));
  } catch {
    return null;
  }
}

export async function clear(d: VaultDeps): Promise<void> {
  await d.secure.deleteItemAsync(d.secretKey).catch(() => {});
  await d.marker.remove(d.markerKey).catch(() => {});
}
