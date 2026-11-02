import { getConfig } from '../config';
import { supportOptions } from './options';
import { rememberScreen } from './screenshot';

/**
 * Opens the support sheets from anywhere in the app, not only from Settings. `MobileKitProvider` mounts the host that
 * listens here, so `openReportProblem()` works from a header button, a shake handler or the floating button's
 * long-press. The screenshot is taken first, while the screen the person is looking at is still on screen.
 */

export type SupportSheet = 'report' | 'chat';
type Listener = (sheet: SupportSheet) => void;

const listeners = new Set<Listener>();

/** Used by the host component. Returns the unsubscribe function. */
export function onSupportRequest(l: Listener): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

function enabled(sheet: SupportSheet): boolean {
  try {
    return supportOptions(getConfig().support)[sheet];
  } catch {
    return false;
  }
}

/** Screenshot the current screen, then open "Report a problem". False when the tool is off or the kit is not mounted. */
export async function openReportProblem(): Promise<boolean> {
  if (!enabled('report') || listeners.size === 0) return false;
  await rememberScreen();
  listeners.forEach((l) => l('report'));
  return true;
}

/** Open "Chat with support" from anywhere. False when chat is off or the kit is not mounted. */
export function openSupportChat(): boolean {
  if (!enabled('chat') || listeners.size === 0) return false;
  listeners.forEach((l) => l('chat'));
  return true;
}
