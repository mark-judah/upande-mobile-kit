/**
 * Device identifiers, cleaned. Free of React Native so it can be tested on its own.
 *
 * Android 10+ and iOS keep the MAC address and the serial number away from apps and hand back placeholders instead
 * (a fixed 02:00:00:00:00:00, "unknown", "0"). A placeholder is not a fact about the phone, so it is dropped rather than
 * reported; the server applies the same rules again.
 */

const NO_SERIAL = new Set(['unknown', 'null', 'none', 'n/a', 'na', '0', 'undefined', 'not available', 'to be filled by o.e.m.']);

export function cleanMac(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim().toUpperCase().replace(/-/g, ':');
  if (!/^[0-9A-F]{2}(:[0-9A-F]{2}){5}$/.test(text)) return undefined;
  return text === '00:00:00:00:00:00' || text === '02:00:00:00:00:00' ? undefined : text;
}

export function cleanIp(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
  if (v4) {
    if ([v4[1], v4[2], v4[3], v4[4]].some((p) => Number(p) > 255)) return undefined;
    return text === '0.0.0.0' ? undefined : text;
  }
  // IPv6: hex groups and colons, at least two colons; "::" alone means none.
  if (/^[0-9a-f:.]+$/i.test(text) && (text.match(/:/g) ?? []).length >= 2) return text === '::' ? undefined : text.toLowerCase();
  return undefined;
}

export function cleanSerial(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim().slice(0, 64);
  if (!text || NO_SERIAL.has(text.toLowerCase()) || !/^[A-Za-z0-9._:/ -]+$/.test(text)) return undefined;
  return text;
}

export function cleanBuildNumber(value: unknown): string | undefined {
  const text = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim().slice(0, 20) : '';
  return /^[0-9][0-9A-Za-z._-]*$/.test(text) ? text : undefined;
}
