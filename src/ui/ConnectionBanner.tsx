import { useEffect, useMemo, useState } from 'react';
import { AppState, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { getConfig } from '../config';
import { hasNativeModule } from '../native-probe';
import { lastLatencyMs, refreshLatency, getProbeSite } from '../monitor/net-stats';
import { isForcedOffline } from '../monitor/link-health';
import { Ionicons } from '@expo/vector-icons';
import { useInsets } from './insets';
import { font, fontSize, radius, shadow, spacing, tint } from './primitives';
import { bannerState, bannerText, isOffline, resolveBanner, type BannerState } from './connection-logic';

const POLL_MS = 5000;

function readLink(): Promise<{ connected: boolean | undefined; reachable: boolean | undefined }> {
  try {
    if (!hasNativeModule('ExpoNetwork')) return Promise.resolve({ connected: undefined, reachable: undefined });
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- optional, only once its native side exists
    const n = require('expo-network');
    return Promise.resolve(n.getNetworkStateAsync()).then(
      (s: { isConnected?: boolean; isInternetReachable?: boolean }) => ({ connected: s?.isConnected, reachable: s?.isInternetReachable }),
      () => ({ connected: undefined, reachable: undefined }),
    );
  } catch {
    return Promise.resolve({ connected: undefined, reachable: undefined });
  }
}

function openWifiSettings() {
  if (Platform.OS === 'android') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- sendIntent exists on Android only
    (Linking as any).sendIntent?.('android.settings.WIFI_SETTINGS')?.catch?.(() => Linking.openSettings().catch(() => {}));
  } else Linking.openSettings().catch(() => {});
}

/**
 * Tells the person when the phone has been offline for a while or the server is very slow, with a shortcut to the
 * Wi-Fi settings (an app cannot switch Wi-Fi itself on modern Android). Checks the link every 5 s while the app is in
 * the foreground; the check is one cheap native call.
 */
export function ConnectionBanner() {
  const cfg = getConfig();
  const opts = useMemo(() => resolveBanner(cfg.connectionBanner), [cfg.connectionBanner]);
  const insets = useInsets();
  const [state, setState] = useState<BannerState>('ok');

  useEffect(() => {
    if (!opts.enabled) return undefined;
    let offlineSince: number | null = null;
    let alive = true;
    const tick = async () => {
      if (AppState.currentState !== 'active') return;
      const link = await readLink();
      if (!alive) return;
      const now = Date.now();
      // The OS can say "connected" while nothing gets through (some handhelds do), so failed requests count too.
      const forced = isForcedOffline();
      if (isOffline(link) || forced) offlineSince ??= now;
      else offlineSince = null;
      // While offline, probe the server every tick so recovery is noticed at once.
      refreshLatency(getProbeSite() || getConfig().site, { force: forced });
      setState(bannerState({ offlineSince, now, staleAfterMs: opts.staleAfterMs, latencyMs: lastLatencyMs(), slowMs: opts.slowMs }));
    };
    void tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [opts]);

  if (!opts.enabled || state === 'ok') return null;
  const t = cfg.theme;
  const offline = state === 'offline';
  const tone = offline ? t.danger : t.warning;
  return (
    <View pointerEvents="box-none" style={[styles.wrap, { paddingTop: insets.top + spacing.xs }]}>
      <View
        accessibilityLiveRegion="polite"
        style={[styles.bar, { backgroundColor: t.surface, borderColor: tint(tone, 0.45), borderLeftColor: tone }]}
      >
        <Ionicons name={offline ? 'cloud-offline-outline' : 'speedometer-outline'} size={18} color={tone} />
        <Text style={[styles.text, font(t, 'medium'), { color: t.text }]}>{bannerText(state)}</Text>
        <Pressable accessibilityRole="button" onPress={openWifiSettings} hitSlop={8} style={styles.actionBox}>
          <Text style={[styles.action, font(t, 'semiBold'), { color: t.text }]}>Wi-Fi settings</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: spacing.md, zIndex: 9998, elevation: 9998 },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderLeftWidth: 3,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    ...shadow.md,
  },
  text: { flex: 1, fontSize: fontSize.sm },
  actionBox: { minHeight: 32, justifyContent: 'center' },
  action: { fontSize: fontSize.xs, textTransform: 'uppercase', letterSpacing: 0.4 },
});
