/**
 * Expo config plugin: let the app open Android's package installer.
 *
 * Installing the APK it just downloaded needs `android.permission.REQUEST_INSTALL_PACKAGES` in the manifest. Without
 * it Android 8+ never offers the "Install unknown apps" switch for the app, and tapping Install does nothing at all
 * (no error, no screen). The permission is declared once here so no app has to remember it.
 *
 * `{ "installPermission": false }` opts out (an app that is only ever delivered through a store).
 */
const PERMISSION = 'android.permission.REQUEST_INSTALL_PACKAGES';

function withInstallPermission(config, props = {}) {
  if (props && props.installPermission === false) return config;
  const android = config.android ?? {};
  const permissions = Array.isArray(android.permissions) ? android.permissions : [];
  if (permissions.includes(PERMISSION)) return config;
  return { ...config, android: { ...android, permissions: [...permissions, PERMISSION] } };
}

module.exports = withInstallPermission;
module.exports.PERMISSION = PERMISSION;
