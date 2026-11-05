/* eslint-disable @typescript-eslint/no-require-imports -- the plugin files are plain CommonJS */
const withInstallPermission = require('../plugins/withInstallPermission');

const PERM = 'android.permission.REQUEST_INSTALL_PACKAGES';

describe('withInstallPermission', () => {
  it('adds the permission the installer needs', () => {
    const out = withInstallPermission({ android: { package: 'a.b', permissions: ['android.permission.CAMERA'] } });
    expect(out.android.permissions).toEqual(['android.permission.CAMERA', PERM]);
    expect(out.android.package).toBe('a.b');
  });
  it('works when the app declares no permissions at all', () => {
    expect(withInstallPermission({}).android.permissions).toEqual([PERM]);
  });
  it('does not add it twice', () => {
    const once = withInstallPermission({ android: { permissions: [PERM] } });
    expect(once.android.permissions).toEqual([PERM]);
  });
  it('can be opted out of', () => {
    const cfg = { android: { permissions: [] as string[] } };
    expect(withInstallPermission(cfg, { installPermission: false })).toBe(cfg);
  });
});
