import { requireOptionalNativeModule } from 'expo';
import type { ApkAutoDownload } from '../config';

/**
 * Which kind of connection the phone is on, for "download updates on Wi-Fi
 * only". expo-network is optional: it is a native module, so it is only
 * required once the native side is known to exist (an OTA bundle must never
 * load it on an APK built without it). Without it the answer is `unknown`,
 * which the Wi-Fi-only mode treats as "not Wi-Fi".
 */
export type NetworkKind = 'wifi' | 'cellular' | 'none' | 'unknown';

type NetworkModule = typeof import('expo-network');

let mod: NetworkModule | null | undefined;
function network(): NetworkModule | null {
  if (mod !== undefined) return mod;
  try {
    mod = requireOptionalNativeModule('ExpoNetwork')
      ? // eslint-disable-next-line @typescript-eslint/no-require-imports -- must not load without the native module
        (require('expo-network') as NetworkModule)
      : null;
  } catch {
    mod = null;
  }
  return mod;
}

export async function currentNetwork(): Promise<NetworkKind> {
  const m = network();
  if (!m) return 'unknown';
  try {
    const state = await m.getNetworkStateAsync();
    if (state.isConnected === false || state.isInternetReachable === false) return 'none';
    if (state.type === m.NetworkStateType.WIFI || state.type === m.NetworkStateType.ETHERNET) return 'wifi';
    if (state.type === m.NetworkStateType.CELLULAR) return 'cellular';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

/** Whether a background APK download may start on this connection. */
export function mayAutoDownload(mode: ApkAutoDownload, net: NetworkKind): boolean {
  if (mode === 'never' || net === 'none') return false;
  if (mode === 'always') return true;
  return net === 'wifi';
}
