import type { ApkAutoDownload } from '../config';
import { mayAutoDownload, type NetworkKind } from './network';

/**
 * The decisions behind "download in the background, then ask to install",
 * kept free of React so they can be tested on their own.
 */

export type AutoDownloadDeps = {
  /** The APK is already complete on disk (no network needed to offer it). */
  onDisk: () => Promise<boolean>;
  mode: () => Promise<ApkAutoDownload>;
  network: () => Promise<NetworkKind>;
  /** Fetch the file without opening the installer. */
  download: () => Promise<unknown>;
};

export type AutoDownloadResult = 'on-disk' | 'downloaded' | 'skipped';

export async function runAutoDownload(deps: AutoDownloadDeps): Promise<AutoDownloadResult> {
  // Already complete: the provider's own on-disk lookup marks it downloaded and
  // the install prompt follows; calling download here would open the installer.
  if (await deps.onDisk()) return 'on-disk';
  if (!mayAutoDownload(await deps.mode(), await deps.network())) return 'skipped';
  await deps.download();
  return 'downloaded';
}

/** Whether the "Install now" prompt should open for a finished download. */
export function shouldPromptInstall(s: {
  availableVersion: string | null;
  downloadedVersion: string | null;
  /** The person drove this download themselves from Settings. */
  manual: boolean;
  /** Already prompted for this version in this run. */
  promptedVersion: string | null;
  /** The version they chose "Later" for. */
  dismissedVersion: string | null;
  canInstallInApp: boolean;
}): boolean {
  const v = s.availableVersion;
  return (
    !!v &&
    s.canInstallInApp &&
    s.downloadedVersion === v &&
    !s.manual &&
    s.promptedVersion !== v &&
    s.dismissedVersion !== v
  );
}
