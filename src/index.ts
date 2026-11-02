export {
  configureMobileKit,
  getConfig,
  isConfigured,
  DEFAULT_THEME,
  DEFAULT_ENDPOINTS,
  defaultInstanceKey,
  DEFAULT_SETTINGS_ROUTE,
  DEFAULT_DEVICES_ROUTE,
  resolveSite,
  getConfigGaps,
  CONFIG_GAP_MESSAGES,
} from './config';
export type {
  MobileKitConfig,
  KitApi,
  KitAuth,
  KitStorage,
  KitTheme,
  KitUi,
  KitEndpoints,
  KitSites,
  KitFabOptions,
  KitEnvironment,
  ConfigGap,
  KitDialogButton,
  KitDialogIcon,
} from './config';

export { MobileKitProvider } from './MobileKitProvider';
export { openKitSettings } from './open-settings';
export { KitSettingsButton } from './ui/KitFab';
export { SettingsScreen } from './screens/SettingsScreen';
export { DevicesScreen } from './screens/DevicesScreen';
// Route-file aliases: `export { SettingsRoute as default } from '@upande/mobile-kit';`
export { SettingsScreen as SettingsRoute } from './screens/SettingsScreen';
export { DevicesScreen as DevicesRoute } from './screens/DevicesScreen';

export { UpdateProvider, useApkUpdate } from './updates/UpdateProvider';
export { ApkUpdateSection } from './updates/ApkUpdateSection';
export { useUpdatePrompt } from './updates/useUpdatePrompt';
export {
  autoCheckForApk,
  checkForApk,
  compareVersions,
  formatBytes,
  releasesPageUrl,
  summarizeReleases,
  UpdateCheckError,
} from './updates/releases';
export type { ApkCheck, ApkRelease, UpdateErrorKind } from './updates/releases';
export { canInstallInApp, downloadApk, findDownloadedApk, launchInstaller, InstallError } from './updates/install-apk';

export * as Biometric from './biometric';
export { APP_VERSION, INSTALLED_APK_VERSION, INSTALLED_APK_BUILD, getServerVersions, runtimeVersion } from './version';

export { reportInstall, getInstallId, getRegisteredRowId, deviceFacts, shouldSkipReport } from './devices/install-register';
export { fetchInstalls, mergeInstallRows, parseServerTime } from './devices/devices-api';
export type { InstallRow, InstallsReply, InstallStatus, InstallUser } from './devices/devices-api';

export {
  startMonitor, stopMonitor, captureException, captureMessage, captureApiCall, addBreadcrumb, attachAxios, withMonitoring,
  setMonitoringEnabled, isMonitoringEnabled, flushNow as flushMonitor, MonitorErrorBoundary,
} from './monitor';
export type { Breadcrumb, DeviceFacts, MonitorEvent, MonitorKind, MonitorLevel, MonitorOptions, MonitorPayload, MonitorUser } from './monitor';

export { useBiometricVault, isVaultSupported, isVaultEnrolled, enrolVault, unlockVault, clearVault } from './vault';
export type { VaultCredentials } from './vault';
export { BiometricSignIn } from './vault/BiometricSignIn';
export { fetchWhatsNew } from './whats-new/WhatsNew';
export { parseReleaseNotes } from './whats-new/notes';
export type { NoteSection } from './whats-new/notes';
export { peekCrash } from './support/crash-store';
export type { StoredCrash } from './support/crash-store';

export { restartForInstance, consumeInstanceSwitched } from './restart';
