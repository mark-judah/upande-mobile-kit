import { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { litDots, RING_DOTS, ringDots } from './ring-logic';

/**
 * A ring of small dots drawn around something round. With a `fraction` the dots light up clockwise as it grows;
 * with `null` (size unknown) a short lit arc travels around instead. Plain Views, no SVG dependency.
 */
export function ProgressRing({
  size,
  fraction,
  color,
  trackColor,
  dot = 4,
}: {
  size: number;
  fraction: number | null;
  color: string;
  trackColor: string;
  dot?: number;
}) {
  const dots = useMemo(() => ringDots(size, dot), [size, dot]);
  const spin = useRef(new Animated.Value(0)).current;
  const indeterminate = fraction == null;

  useEffect(() => {
    if (!indeterminate) return undefined;
    spin.setValue(0);
    const loop = Animated.loop(Animated.timing(spin, { toValue: 1, duration: 1100, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [indeterminate, spin]);

  const lit = litDots(fraction);
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  return (
    <View pointerEvents="none" style={[styles.ring, { width: size, height: size }]}>
      {dots.map((p, i) => (
        <View
          key={i}
          style={{
            position: 'absolute',
            left: p.left,
            top: p.top,
            width: dot,
            height: dot,
            borderRadius: dot / 2,
            backgroundColor: !indeterminate && i < lit ? color : trackColor,
          }}
        />
      ))}
      {indeterminate ? (
        <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ rotate }] }]}>
          {dots.slice(0, Math.round(RING_DOTS / 4)).map((p, i) => (
            <View
              key={i}
              style={{ position: 'absolute', left: p.left, top: p.top, width: dot, height: dot, borderRadius: dot / 2, backgroundColor: color }}
            />
          ))}
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  ring: { position: 'absolute' },
});
