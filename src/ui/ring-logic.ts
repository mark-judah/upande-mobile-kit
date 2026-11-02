/** Geometry of the dotted progress ring around the Settings button, free of React so it can be tested. */

export const RING_DOTS = 28;

export type RingDot = { left: number; top: number };

/** Dot centres on a circle of `size`, clockwise from 12 o'clock; each dot is `dot` wide. */
export function ringDots(size: number, dot: number, count: number = RING_DOTS): RingDot[] {
  const c = size / 2;
  const r = c - dot / 2;
  return Array.from({ length: count }, (_v, i) => {
    const a = (i / count) * 2 * Math.PI;
    return { left: c + r * Math.sin(a) - dot / 2, top: c - r * Math.cos(a) - dot / 2 };
  });
}

/** How many dots are lit for a 0-1 fraction; at least one once anything is under way, all only at 100%. */
export function litDots(fraction: number | null | undefined, count: number = RING_DOTS): number {
  if (fraction == null || !Number.isFinite(fraction)) return 0;
  const f = Math.min(1, Math.max(0, fraction));
  if (f <= 0) return 1;
  return Math.min(count, Math.max(1, Math.round(f * count)));
}

export type UpdateActivity = { kind: 'apk' | 'ota'; fraction: number | null } | null;

/** What the ring shows: an APK download with its fraction, else a JS update (no fraction is known), else nothing. */
export function activityOf(a: { apkDownloading: boolean; apkFraction: number | null | undefined; otaDownloading: boolean }): UpdateActivity {
  if (a.apkDownloading) return { kind: 'apk', fraction: a.apkFraction ?? null };
  if (a.otaDownloading) return { kind: 'ota', fraction: null };
  return null;
}
