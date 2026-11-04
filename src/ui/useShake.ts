import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { hasNativeModule } from '../native-probe';
import { detectShake, newShakeState } from './shake';

/* eslint-disable @typescript-eslint/no-require-imports -- optional: only loaded once its native side is known to exist */
// `require` directly inside `try`, the only shape Metro accepts for a package that may be missing.
const loadSensors = () => {
  try {
    return require('expo-sensors');
  } catch {
    return null;
  }
};
/* eslint-enable @typescript-eslint/no-require-imports */

type Accelerometer = {
  setUpdateInterval: (ms: number) => void;
  addListener: (cb: (a: { x: number; y: number; z: number }) => void) => { remove: () => void };
};

function accelerometer(): Accelerometer | null {
  try {
    if (!hasNativeModule('ExponentAccelerometer')) return null;
    return (loadSensors()?.Accelerometer as Accelerometer | undefined) ?? null;
  } catch {
    return null;
  }
}

/** True when this build can feel a shake (`expo-sensors` is installed and compiled in). */
export const isShakeSupported = (): boolean => accelerometer() !== null;

const SAMPLE_MS = 100;

/**
 * Calls `onShake` when the phone is shaken. Listens only while `enabled` and the app is in front, so it costs nothing
 * in the background. Does nothing (and never throws) on a build without `expo-sensors`.
 */
export function useShake(onShake: () => void, enabled: boolean): void {
  const latest = useRef(onShake);
  latest.current = onShake;

  useEffect(() => {
    if (!enabled) return undefined;
    const sensor = accelerometer();
    if (!sensor) return undefined;
    let sub: { remove: () => void } | null = null;
    let state = newShakeState();
    const start = () => {
      if (sub) return;
      try {
        sensor.setUpdateInterval(SAMPLE_MS);
        sub = sensor.addListener((a) => {
          const r = detectShake(state, a, Date.now());
          state = r.state;
          if (r.shaken) latest.current();
        });
      } catch {
        sub = null;
      }
    };
    const stop = () => {
      try {
        sub?.remove();
      } catch {
        /* already gone */
      }
      sub = null;
      state = newShakeState();
    };
    if (AppState.currentState === 'active') start();
    const app = AppState.addEventListener('change', (s) => (s === 'active' ? start() : stop()));
    return () => {
      app.remove();
      stop();
    };
  }, [enabled]);
}
