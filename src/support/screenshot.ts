import { hasNativeModule } from '../native-probe';

/**
 * The screen the person was on when they opened Settings, for "Report a problem". Needs `react-native-view-shot` in
 * the build; without it there is simply no screenshot. Captured as a small JPEG when the floating button is tapped
 * (before the Settings page covers the screen) and kept in memory only until it is used or goes stale.
 */

const MAX_BASE64 = 1_500_000;
const FRESH_MS = 10 * 60_000;
const CAPTURE_TIMEOUT_MS = 600;

type Shot = { data: string; at: number };
let last: Shot | null = null;

type ViewShot = { captureScreen: (o: { format: 'jpg'; quality: number; result: 'base64' }) => Promise<string> };
function viewShot(): ViewShot | null {
  try {
    if (!hasNativeModule('RNViewShot')) return null;
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- optional, only once its native side exists
    const m = require('react-native-view-shot');
    return typeof m?.captureScreen === 'function' ? (m as ViewShot) : null;
  } catch {
    return null;
  }
}

export function isScreenshotSupported(): boolean {
  return viewShot() !== null;
}

/** Capture now and remember it. Resolves (never rejects) within a fraction of a second even if the capture hangs. */
export async function rememberScreen(now: () => number = Date.now): Promise<void> {
  const m = viewShot();
  if (!m) return;
  await Promise.race([
    m
      .captureScreen({ format: 'jpg', quality: 0.5, result: 'base64' })
      .then((data) => {
        last = typeof data === 'string' && data.length > 0 && data.length <= MAX_BASE64 ? { data, at: now() } : null;
      })
      .catch(() => {
        last = null;
      }),
    new Promise<void>((resolve) => setTimeout(resolve, CAPTURE_TIMEOUT_MS)),
  ]);
}

/** The remembered screenshot (base64 JPEG), unless it is old. Kept so the report sheet can show and resend it. */
export function recentScreen(now: () => number = Date.now): string | null {
  return last && now() - last.at < FRESH_MS ? last.data : null;
}

export function forgetScreen(): void {
  last = null;
}
