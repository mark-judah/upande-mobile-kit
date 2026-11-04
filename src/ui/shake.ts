/**
 * Shake detection, free of React Native and of the sensor library so each rule is tested on its own.
 *
 * The accelerometer reports force in g with gravity included, so a phone lying still reads about 1 g. A shake is a
 * few hard jolts close together: `SHAKE_HITS` readings above `SHAKE_G` inside `SHAKE_WINDOW_MS`. After one is
 * recognised the detector goes quiet for `SHAKE_COOLDOWN_MS`, so one shake of the hand is one shake and not three.
 */

export const SHAKE_G = 2.3;
export const SHAKE_HITS = 3;
export const SHAKE_WINDOW_MS = 900;
/** Readings closer together than this belong to the same jolt. */
export const SHAKE_MIN_GAP_MS = 120;
export const SHAKE_COOLDOWN_MS = 1500;

export type ShakeState = { hits: number[]; quietUntil: number };
export const newShakeState = (): ShakeState => ({ hits: [], quietUntil: 0 });

export type Accel = { x: number; y: number; z: number };
export const forceOf = (a: Accel): number => Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);

/** Feed one accelerometer reading. Returns the next state and whether this reading completed a shake. */
export function detectShake(state: ShakeState, a: Accel, now: number): { state: ShakeState; shaken: boolean } {
  if (now < state.quietUntil) return { state, shaken: false };
  if (!(forceOf(a) >= SHAKE_G)) {
    // Not a jolt: just forget the ones that are too old to count.
    const recent = state.hits.filter((t) => now - t <= SHAKE_WINDOW_MS);
    return { state: recent.length === state.hits.length ? state : { ...state, hits: recent }, shaken: false };
  }
  const last = state.hits[state.hits.length - 1];
  const hits = [...state.hits.filter((t) => now - t <= SHAKE_WINDOW_MS), ...(last !== undefined && now - last < SHAKE_MIN_GAP_MS ? [] : [now])];
  if (hits.length >= SHAKE_HITS) return { state: { hits: [], quietUntil: now + SHAKE_COOLDOWN_MS }, shaken: true };
  return { state: { ...state, hits }, shaken: false };
}
