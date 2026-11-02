/**
 * The native-module install step every `init` path shares (plain flags, wizard, --yes): run the SDK-aware
 * `npx expo install` for the kit modules the app lacks, and when that cannot happen (--no-install, or the
 * command failed) say loudly that the setup is incomplete and name the one command that finishes it.
 */
import { execFileSync } from 'node:child_process';
import { detectPackageManager, expoInstallArgv, FIX_COMMAND, missingModules, skipFor } from './native-modules.mjs';

const INSTALL_TIMEOUT_MS = 10 * 60 * 1000;

/** `expo install` in the app root; never waits for input (CI=1) and never runs forever. */
export const defaultNativeExec = (argv, { cwd }) =>
  execFileSync(argv[0], argv.slice(1), { cwd, stdio: 'inherit', env: { ...process.env, CI: '1' }, timeout: INSTALL_TIMEOUT_MS });

/** The block that cannot be mistaken for a quiet "last steps" line. */
export function incompleteBlock(missing, why) {
  return [
    `✗ SETUP INCOMPLETE: ${why}${missing.length ? `: ${missing.join(', ')}` : ''}.`,
    `  Run  ${FIX_COMMAND}  to finish: it installs them with the version that fits your Expo SDK.`,
    '  Until then these features are off, and `expo prebuild` and CI builds stop.',
  ].join('\n');
}

/**
 * @param {string} root app root
 * @param {{ exec?: Function, noInstall?: boolean, biometric?: string }} opts
 * @returns {{ missing: string[], ran: boolean, ok: boolean, argv?: string[], lines: string[] }}
 *   `ok` is false only when modules are missing and could not be installed.
 */
export function installNativeModules(root, { exec = defaultNativeExec, noInstall = false, biometric = 'kit' } = {}) {
  const skip = skipFor({ biometricHost: biometric === 'host' });
  const missing = missingModules(root, { skip }).map((s) => s.pkg);
  if (missing.length === 0) return { missing, ran: false, ok: true, lines: ['ok     native modules already installed'] };
  const argv = expoInstallArgv(detectPackageManager(root), missing);
  if (noInstall) return { missing, ran: false, ok: false, argv, lines: [incompleteBlock(missing, 'the native modules were NOT installed (--no-install)')] };
  const lines = [`run    ${argv.join(' ')}   # native modules`];
  try {
    exec(argv, { cwd: root });
  } catch (e) {
    lines.push(incompleteBlock(missing, `the native install failed (${String(e?.message ?? e).split('\n')[0]})`));
    return { missing, ran: true, ok: false, argv, lines };
  }
  return { missing, ran: true, ok: true, argv, lines };
}
