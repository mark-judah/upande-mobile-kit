import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Keyboard, PanResponder, Pressable, StyleSheet, Text, Vibration, View, useWindowDimensions } from 'react-native';
import { usePathname } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { DEFAULT_DEVICES_ROUTE, DEFAULT_SETTINGS_ROUTE, getConfig, KitKeys } from '../config';
import { openKitSettings } from '../open-settings';
import { useInsets } from './insets';
import { ProgressRing } from './ProgressRing';
import { openReportProblem } from '../support/controller';
import { rememberScreen } from '../support/screenshot';
import { useUpdateActivity } from '../updates/useUpdateActivity';
import {
  clampBottom, decodePlacement, encodePlacement, FAB_LONG_PRESS_MS, FAB_SIZE, fabVisible, HOLD_TICK_MS, holdFraction, isTap, leftFor,
  placementAfterDrag, resolveFab,
  topFor, type FabPlacement,
} from './fab-logic';

/**
 * The floating Settings button. Rendered by `MobileKitProvider` over the whole app so the page is reachable
 * whatever the host's navigation looks like. Small and translucent, it hides on the kit's own pages and while the
 * keyboard is open, can be dragged to either screen edge, and remembers where it was left.
 */

export function KitFab() {
  const cfg = getConfig();
  const settings = resolveFab(cfg.fab, __DEV__);
  return settings.enabled ? <FabOverlay /> : null;
}

function FabOverlay() {
  const cfg = getConfig();
  const settings = resolveFab(cfg.fab, __DEV__);
  const pathname = usePathname();
  // Only the host's own auth can say 'signed out'; on the kit's stand-in the button always shows.
  const auth = cfg.useAuth();
  const signedOut = !cfg.standIns.useAuth && !auth.user;
  const activity = useUpdateActivity();
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

  const pressedAt = useRef(0);
  // The long press: a ring fills while the button is held, the button shrinks under the finger, and at the end it
  // buzzes and pulses once, so the person knows it registered before the report opens.
  const [hold, setHold] = useState<number | null>(null);
  const [opening, setOpening] = useState(false);
  const holdTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const triggered = useRef(false);
  const press = useRef(new Animated.Value(1)).current;
  const stopHold = useCallback(() => {
    if (holdTimer.current) clearInterval(holdTimer.current);
    holdTimer.current = null;
    setHold(null);
    Animated.spring(press, { toValue: 1, useNativeDriver: true, bounciness: 14, speed: 20 }).start();
  }, [press]);
  useEffect(() => () => { if (holdTimer.current) clearInterval(holdTimer.current); }, []);
  const startHold = useCallback(() => {
    triggered.current = false;
    if (holdTimer.current) clearInterval(holdTimer.current);
    setHold(0);
    Animated.timing(press, { toValue: 0.88, duration: FAB_LONG_PRESS_MS, useNativeDriver: true }).start();
    holdTimer.current = setInterval(() => {
      const f = holdFraction(Date.now() - pressedAt.current);
      if (f < 1) {
        setHold(f);
        return;
      }
      // Held long enough: confirm it, then open the report while the finger may still be down.
      triggered.current = true;
      if (holdTimer.current) clearInterval(holdTimer.current);
      holdTimer.current = null;
      setHold(1);
      try {
        Vibration.vibrate(35);
      } catch {
        /* no vibrator */
      }
      Animated.sequence([
        Animated.timing(press, { toValue: 1.18, duration: 110, useNativeDriver: true }),
        Animated.spring(press, { toValue: 1, useNativeDriver: true, bounciness: 12 }),
      ]).start();
      setOpening(true);
      void openReportProblem()
        .then((opened) => (opened ? undefined : openKitSettings()))
        .finally(() => {
          setOpening(false);
          setHold(null);
        });
    }, HOLD_TICK_MS);
  }, [press]);
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
          pressedAt.current = Date.now();
          startHold();
          pos.setOffset({ x: current.current.left, y: current.current.top });
          pos.setValue({ x: 0, y: 0 });
        },
        onPanResponderMove: (e, g) => {
          // Dragging cancels the hold; the button is being moved, not pressed.
          if (!isTap(g.dx, g.dy) && holdTimer.current) stopHold();
          Animated.event([null, { dx: pos.x, dy: pos.y }], { useNativeDriver: false })(e, g);
        },
        onPanResponderRelease: (_e, g) => {
          pos.flattenOffset();
          const wasLong = triggered.current;
          if (!wasLong) stopHold();
          if (isTap(g.dx, g.dy)) {
            pos.setValue({ x: current.current.left, y: current.current.top });
            // A tap opens Settings (a long press already opened "Report a problem" while held). The screenshot is
            // taken of THIS screen first, before anything covers it.
            if (!wasLong) void rememberScreen().finally(openKitSettings);
          } else settle({ dx: g.dx, dy: g.dy });
        },
        onPanResponderTerminate: () => {
          stopHold();
          pos.flattenOffset();
          pos.setValue({ x: current.current.left, y: current.current.top });
        },
      }),
    [pos, settle, startHold, stopHold],
  );

  if (!fabVisible({ settings, pathname, routes, keyboardOpen, signedOut })) return null;

  return (
    <View pointerEvents="box-none" style={styles.layer}>
      <Animated.View
        {...responder.panHandlers}
        accessible
        accessibilityRole="button"
        accessibilityLabel={activityLabel(activity)}
        style={[styles.fab, { backgroundColor: cfg.theme.primary, opacity: hold != null ? 1 : 0.9, transform: [...pos.getTranslateTransform(), { scale: press }] }]}
      >
        <Ionicons name={opening ? 'camera' : hold != null && hold > 0.25 ? 'camera-outline' : 'settings-outline'} size={22} color={cfg.theme.textOnPrimary} />
        {hold != null ? (
          <View pointerEvents="none" style={styles.ringHost}>
            <ProgressRing size={RING_SIZE} fraction={Math.max(hold, 0.02)} color={cfg.theme.primary} trackColor={cfg.theme.border} dot={5} />
          </View>
        ) : activity ? (
          <View pointerEvents="none" style={styles.ringHost}>
            <ProgressRing size={RING_SIZE} fraction={activity.fraction} color={cfg.theme.primary} trackColor={cfg.theme.border} />
          </View>
        ) : null}
      </Animated.View>
    </View>
  );
}

const RING_GAP = 5;
const RING_SIZE = FAB_SIZE + RING_GAP * 2 + 8;

function activityLabel(a: ReturnType<typeof useUpdateActivity>): string {
  if (!a) return 'Open settings';
  const what = a.kind === 'apk' ? 'Downloading app update' : 'Downloading update';
  return a.fraction == null ? `${what}. Open settings` : `${what}, ${Math.round(a.fraction * 100)} percent. Open settings`;
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
  // Centred on the button; dots sit just outside its edge.
  ringHost: { position: 'absolute', left: (FAB_SIZE - RING_SIZE) / 2, top: (FAB_SIZE - RING_SIZE) / 2, width: RING_SIZE, height: RING_SIZE },
  button: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, paddingHorizontal: 12 },
});
