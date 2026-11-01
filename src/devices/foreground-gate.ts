/**
 * Lets at most one foreground report through per `minMs`. Lock screens,
 * permission prompts and system dialogs make the app go inactive -> active over
 * and over; each of those would otherwise reach the report path.
 */
export function createForegroundGate(minMs: number, now: () => number = Date.now): () => boolean {
  let last = -Infinity;
  return () => {
    const t = now();
    // A clock that moved backwards counts as due.
    if (t >= last && t - last < minMs) return false;
    last = t;
    return true;
  };
}

export const DEFAULT_FOREGROUND_REPORT_MIN_MS = 30_000;
