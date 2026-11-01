import { useCallback, useEffect, useState } from 'react';
import { getConfig, KitKeys, type ApkAutoDownload } from '../config';

export const AUTO_DOWNLOAD_MODES: ApkAutoDownload[] = ['wifi', 'always', 'never'];

const isMode = (v: unknown): v is ApkAutoDownload => AUTO_DOWNLOAD_MODES.includes(v as ApkAutoDownload);

/** The person's choice, else the app's default, else Wi-Fi only. */
export async function getAutoDownloadMode(): Promise<ApkAutoDownload> {
  const { storage, apk } = getConfig();
  try {
    const stored = await storage.get(KitKeys.apkAutoDownload);
    if (isMode(stored)) return stored;
  } catch {
    // fall through to the default
  }
  return apk?.autoDownload ?? 'wifi';
}

export async function setAutoDownloadMode(mode: ApkAutoDownload): Promise<void> {
  await getConfig().storage.set(KitKeys.apkAutoDownload, mode);
}

/** [mode, setMode] for the Settings control; `null` until read. */
export function useAutoDownloadMode(): [ApkAutoDownload | null, (m: ApkAutoDownload) => void] {
  const [mode, setMode] = useState<ApkAutoDownload | null>(null);
  useEffect(() => {
    let live = true;
    getAutoDownloadMode().then((m) => live && setMode(m));
    return () => {
      live = false;
    };
  }, []);
  const set = useCallback((m: ApkAutoDownload) => {
    setMode(m);
    setAutoDownloadMode(m).catch(() => {});
  }, []);
  return [mode, set];
}
