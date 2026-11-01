import { configureMobileKit, resetMobileKit, type KitAuth } from '../src/config';

export const store = new Map<string, string>();
export const apiMock = jest.fn();

export const auth: KitAuth = {
  isSystemManager: true,
  fullName: 'Test User',
  email: 'test@example.com',
  user: 'test@example.com',
  instanceUrl: 'https://site-one.example.com',
  biometricEnabled: false,
  setBiometricEnabled: async () => {},
  logout: async () => {},
  forgetDevice: async () => {},
};

/** Configure the kit with in-memory fakes. */
export function setup(overrides: Partial<Parameters<typeof configureMobileKit>[0]> = {}) {
  store.clear();
  apiMock.mockReset().mockResolvedValue({ message: { install_id: 'row-1' } });
  resetMobileKit();
  configureMobileKit({
    appName: 'Test App',
    githubRepo: 'acme/test-app',
    api: ((req: unknown) => apiMock(req)) as never,
    storage: {
      get: async (k) => store.get(k) ?? null,
      set: async (k, v) => void store.set(k, v),
      remove: async (k) => void store.delete(k),
    },
    useAuth: () => auth,
    ...overrides,
  });
}
