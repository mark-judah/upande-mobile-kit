import { createForegroundGate, DEFAULT_FOREGROUND_REPORT_MIN_MS } from '../src/devices/foreground-gate';

describe('foreground report gate', () => {
  beforeEach(() => jest.useFakeTimers().setSystemTime(1_000_000));
  afterEach(() => jest.useRealTimers());

  it('lets the first through and holds repeats for the interval', () => {
    const allow = createForegroundGate(30_000);
    expect(allow()).toBe(true);
    // a lock screen / permission prompt fires several "active" events in a row
    for (let i = 0; i < 5; i += 1) {
      jest.advanceTimersByTime(2000);
      expect(allow()).toBe(false);
    }
    jest.advanceTimersByTime(30_000);
    expect(allow()).toBe(true);
    expect(allow()).toBe(false);
  });

  it('defaults to 30 seconds', () => {
    expect(DEFAULT_FOREGROUND_REPORT_MIN_MS).toBe(30_000);
  });

  it('counts a clock that moved backwards as due', () => {
    const allow = createForegroundGate(30_000);
    expect(allow()).toBe(true);
    jest.setSystemTime(500_000);
    expect(allow()).toBe(true);
  });

  it('a zero interval never holds anything back', () => {
    const allow = createForegroundGate(0);
    expect(allow()).toBe(true);
    expect(allow()).toBe(true);
  });
});
