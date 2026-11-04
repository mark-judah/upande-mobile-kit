const mockProbe = jest.fn();
jest.mock('../src/native-probe', () => ({ hasNativeModule: (n: string) => mockProbe(n) }));
jest.mock('expo-sensors', () => ({ Accelerometer: { setUpdateInterval: () => {}, addListener: () => ({ remove: () => {} }) } }), { virtual: true });

import { isShakeSupported } from '../src/ui/useShake';

describe('shake support', () => {
  it('is supported only once the accelerometer is compiled into the build', () => {
    mockProbe.mockReturnValue(true);
    expect(isShakeSupported()).toBe(true);
    mockProbe.mockReturnValue(false);
    expect(isShakeSupported()).toBe(false);
  });
});
