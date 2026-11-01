import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Keyboard, PanResponder, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { usePathname } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { DEFAULT_DEVICES_ROUTE, DEFAULT_SETTINGS_ROUTE, getConfig, KitKeys } from '../config';
import { openKitSettings } from '../open-settings';
import {
  clampBottom, decodePlacement, encodePlacement, FAB_SIZE, fabVisible, isTap, leftFor, placementAfterDrag, resolveFab,
  topFor, type FabPlacement,
} from './fab-logic';

/**
 * The floating Settings button. Rendered by `MobileKitProvider` over the whole app so the page is reachable
 * whatever the host's navigation looks like. Small and translucent, it hides on the kit's own pages and while the
 * keyboard is open, can be dragged to either screen edge, and remembers where it was left.
 */

const ZERO = { top: 0, bottom: 0, left: 0, right: 0 };

/** Safe-area insets when `react-native-safe-area-context` is there (expo-router brings it), else none. */
function loadInsetsHook(): (() => typeof ZERO) | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- optional: expo-router depends on it
    const m = require('react-native-safe-area-context');
    return typeof m?.useSafeAreaInsets === 'function' ? m.useSafeAreaInsets : null;
  } catch {
    return null;
  }
}
let insetsHook: (() => typeof ZERO) | null | undefined;
function useInsets(): typeof ZERO {
  if (insetsHook === undefined) insetsHook = loadInsetsHook();
  if (!insetsHook) return ZERO;
  try {
    return insetsHook() ?? ZERO;
  } catch {
    return ZERO; // no provider above us
  }
}

export function KitFab() {
  const cfg = getConfig();
  const settings = resolveFab(cfg.fab, __DEV__);
  return settings.enabled ? <FabOverlay /> : null;
}

function FabOverlay() {
  const cfg = getConfig();
  const settings = resolveFab(cfg.fab, __DEV__);
  const pathname = usePathname();
  const win = useWindowDimensions();
  const insets = useInsets();
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [placement, setPlacement] = useState<FabPlacement>({ side: settings.initialSide, bottom: settings.bottom });

  const routes = { settings: cfg.settingsRoute ?? DEFAULT_SETTINGS_ROUTE, devices: cfg.devicesRoute ?? DEFAULT_DEVICES_ROUTE };

  // Where the person left it last time.
  useEffect(() => {
    let alive = true;
    cfg.storage
      .get(KitKeys.fabPosition)
      .then((raw) => {
        const saved = decodePlacement(raw);
        if (alive && saved) setPlacement(saved);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on mount
  }, []);

  useEffect(() => {
    try {
      const show = Keyboard.addListener('keyboardDidShow', () => setKeyboardOpen(true));
      const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardOpen(false));
      return () => {
        show.remove();
        hide.remove();
      };
    } catch {
      return undefined;
    }
  }, []);

  const pos = useRef(new Animated.ValueXY()).current;
  const current = useRef({ left: 0, top: 0 });
  const live = useRef({ win, insets, placement });
  live.current = { win, insets, placement };

  // Follow the placement, and the window when it rotates or resizes.
  useEffect(() => {
    const bottom = clampBottom(placement.bottom, win.height, insets);
    const target = { left: leftFor(placement.side, win.width), top: topFor(bottom, win.height) };
    current.current = target;
    pos.flattenOffset();
    Animated.spring(pos, { toValue: { x: target.left, y: target.top }, useNativeDriver: false, bounciness: 6 }).start();
  }, [placement, win.width, win.height, insets, pos]);

  const settle = useCallback(
    (move: { dx: number; dy: number }) => {
      const { win: w, insets: i } = live.current;
      const next = placementAfterDrag(current.current, move, w, i);
      // Snap now even when the placement ends up unchanged (the effect below only runs on a change).
      const target = { left: leftFor(next.side, w.width), top: topFor(next.bottom, w.height) };
      current.current = target;
      Animated.spring(pos, { toValue: { x: target.left, y: target.top }, useNativeDriver: false, bounciness: 6 }).start();
      setPlacement(next);
      cfg.storage.set(KitKeys.fabPosition, encodePlacement(next)).catch(() => {});
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- storage is stable for the app's life
    [pos],
  );

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          pos.setOffset({ x: current.current.left, y: current.current.top });
          pos.setValue({ x: 0, y: 0 });
        },
        onPanResponderMove: Animated.event([null, { dx: pos.x, dy: pos.y }], { useNativeDriver: false }),
        onPanResponderRelease: (_e, g) => {
          pos.flattenOffset();
          if (isTap(g.dx, g.dy)) {
            pos.setValue({ x: current.current.left, y: current.current.top });
            openKitSettings();
          } else settle({ dx: g.dx, dy: g.dy });
        },
        onPanResponderTerminate: () => {
          pos.flattenOffset();
          pos.setValue({ x: current.current.left, y: current.current.top });
        },
      }),
    [pos, settle],
  );

  if (!fabVisible({ settings, pathname, routes, keyboardOpen })) return null;

  return (
    <View pointerEvents="box-none" style={styles.layer}>
      <Animated.View
        {...responder.panHandlers}
        accessible
        accessibilityRole="button"
        accessibilityLabel="Open settings"
        style={[styles.fab, { backgroundColor: cfg.theme.primary, transform: pos.getTranslateTransform() }]}
      >
        <Ionicons name="settings-outline" size={22} color={cfg.theme.textOnPrimary} />
      </Animated.View>
    </View>
  );
}

/** A plain button that opens the Settings page, for hosts that prefer their own entry (set `fab: false`). */
export function KitSettingsButton({ label = 'Settings' }: { label?: string }) {
  const cfg = getConfig();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Open settings"
      onPress={openKitSettings}
      style={({ pressed }) => [styles.button, pressed && { opacity: 0.7 }]}
    >
      <Ionicons name="settings-outline" size={18} color={cfg.theme.text} />
      <Text style={{ color: cfg.theme.text, fontSize: 14 }}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  layer: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, zIndex: 9999, elevation: 9999 },
  fab: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: FAB_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.85,
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  button: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, paddingHorizontal: 12 },
});
