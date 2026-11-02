const mockProbe = jest.fn();
jest.mock('../src/native-probe', () => ({ hasNativeModule: (n: string) => mockProbe(n) }));
const mockCapture = jest.fn();
jest.mock('react-native-view-shot', () => ({ captureScreen: (o: unknown) => mockCapture(o) }), { virtual: true });

import { forgetScreen, isScreenshotSupported, recentScreen, rememberScreen } from '../src/support/screenshot';

beforeEach(() => {
  forgetScreen();
  mockProbe.mockReset().mockReturnValue(true);
  mockCapture.mockReset().mockResolvedValue('AAAA');
});

describe('screenshot of the previous screen', () => {
  it('captures a small JPEG and hands it back while fresh', async () => {
    await rememberScreen(() => 1000);
    expect(mockCapture).toHaveBeenCalledWith({ format: 'jpg', quality: 0.5, result: 'base64' });
    expect(recentScreen(() => 2000)).toBe('AAAA');
    expect(recentScreen(() => 1000 + 11 * 60_000)).toBeNull();
  });
  it('does nothing when the build has no view-shot', async () => {
    mockProbe.mockReturnValue(false);
    expect(isScreenshotSupported()).toBe(false);
    await rememberScreen();
    expect(mockCapture).not.toHaveBeenCalled();
    expect(recentScreen()).toBeNull();
  });
  it('drops a failed or oversized capture instead of throwing', async () => {
    mockCapture.mockRejectedValue(new Error('nope'));
    await rememberScreen();
    expect(recentScreen()).toBeNull();
    mockCapture.mockResolvedValue('x'.repeat(1_600_000));
    await rememberScreen();
    expect(recentScreen()).toBeNull();
  });
  it('never waits longer than a fraction of a second for a hung capture', async () => {
    jest.useFakeTimers();
    mockCapture.mockReturnValue(new Promise(() => {}));
    const p = rememberScreen();
    jest.advanceTimersByTime(700);
    await p;
    jest.useRealTimers();
    expect(recentScreen()).toBeNull();
  });
});
