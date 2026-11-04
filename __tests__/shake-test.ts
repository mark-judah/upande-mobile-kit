import { SHAKE_COOLDOWN_MS, SHAKE_G, SHAKE_HITS, SHAKE_WINDOW_MS, detectShake, forceOf, newShakeState } from '../src/ui/shake';

const still = { x: 0, y: 0, z: 1 }; // a phone lying flat reads 1 g
const jolt = { x: 2.6, y: 0.4, z: 1 };

/** Feeds readings one after another; returns the times at which a shake was recognised. */
function run(readings: [number, { x: number; y: number; z: number }][]): number[] {
  let state = newShakeState();
  const shakes: number[] = [];
  for (const [t, a] of readings) {
    const r = detectShake(state, a, t);
    state = r.state;
    if (r.shaken) shakes.push(t);
  }
  return shakes;
}

describe('shake detection', () => {
  it('reads the force of a reading in g', () => {
    expect(forceOf(still)).toBeCloseTo(1);
    expect(forceOf({ x: 3, y: 4, z: 0 })).toBe(5);
  });
  it('a phone that is moved gently or carried is not a shake', () => {
    const readings: [number, typeof still][] = [];
    for (let i = 0; i < 40; i += 1) readings.push([i * 100, { x: 0.3, y: 0.2, z: 1.2 }]);
    expect(run(readings)).toEqual([]);
  });
  it(`a few hard jolts close together are a shake (${SHAKE_HITS} above ${SHAKE_G} g within ${SHAKE_WINDOW_MS} ms)`, () => {
    expect(run([[0, jolt], [150, still], [300, jolt], [450, still], [600, jolt]])).toEqual([600]);
  });
  it('two jolts are not enough', () => {
    expect(run([[0, jolt], [200, still], [400, jolt], [600, still], [1500, still]])).toEqual([]);
  });
  it('jolts spread too far apart do not add up', () => {
    expect(run([[0, jolt], [500, jolt], [1000, jolt], [1500, jolt]])).toEqual([]);
  });
  it('one jolt seen in several quick readings counts once', () => {
    expect(run([[0, jolt], [40, jolt], [80, jolt], [100, jolt]])).toEqual([]);
  });
  it('one shake of the hand is one shake: it goes quiet afterwards, then listens again', () => {
    const shake: [number, typeof jolt][] = [[0, jolt], [150, jolt], [300, jolt]];
    const again: [number, typeof jolt][] = [[400, jolt], [550, jolt], [700, jolt]];
    expect(run([...shake, ...again])).toEqual([300]);
    const later = [0, 150, 300].map((t) => [t + 300 + SHAKE_COOLDOWN_MS + 50, jolt] as [number, typeof jolt]);
    expect(run([...shake, ...later])).toEqual([300, 300 + SHAKE_COOLDOWN_MS + 350]);
  });
});
