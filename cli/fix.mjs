/**
 * `upande-mobile-kit fix` — install and align the native modules the kit needs.
 *
 * Runs `npx expo install <modules>` (the only thing that knows which version fits
 * the app's Expo SDK) for every kit module that is missing from package.json or
 * from node_modules, prints what changed, re-checks, and says when a new native
 * build is needed.
 *
 *   --dry-run   print the command and why, change nothing
 *   --align     also re-pin the modules already installed to the SDK's versions
 *   --yes       accepted for scripts; the command never prompts
 *
 * Idempotent: with everything in place it changes nothing and says so. It never
 * waits for input (CI=1, a time limit) and never installs outside the kit's own list.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { detectPackageManager, expoInstallArgv, FIX_COMMAND, hostOwnsBiometric, moduleStatus, skipFor, METRO_NOTE } from './native-modules.mjs';

const INSTALL_TIMEOUT_MS = 10 * 60 * 1000;

const defaultExec = (argv, { cwd }) =>
  execFileSync(argv[0], argv.slice(1), { cwd, stdio: 'inherit', env: { ...process.env, CI: '1' }, timeout: INSTALL_TIMEOUT_MS });

const isMissing = (s) => !s.inPackageJson || !s.installed;

/** The new-native-build note for what `fix` added or re-versioned. */
export function rebuildNote(changedPkgs) {
  return [
    'These changes need a NEW NATIVE BUILD (an OTA update will not deliver them):',
    ...changedPkgs.map((p) => `  • ${p}`),
    'Make a development build or an APK. Expo Go already includes these modules, so there it works as soon as they are installed.',
  ].join('\n');
}

/** @returns {{text: string, ok: boolean, argv?: string[]}} */
export function run(argv, root = process.cwd(), opts = {}) {
  if (!existsSync(join(root, 'package.json'))) throw new Error('No package.json here: run this from the app root.');
  const dry = argv.includes('--dry-run');
  const align = argv.includes('--align');
  const exec = opts.exec ?? defaultExec;
  const skip = skipFor({ biometricHost: hostOwnsBiometric(root) });
  const lines = [];

  const before = moduleStatus(root, { skip });
  const missing = before.filter(isMissing);
  const targets = before.filter((s) => isMissing(s) || align).map((s) => s.pkg);

  if (skip.length) lines.push(`! ${skip.join(', ')} skipped: your app owns the biometric lock (biometric: 'host').`);
  if (targets.length === 0) {
    lines.push(`✓ all ${before.length} native modules are installed (${before.map((s) => s.pkg).join(', ')}). Nothing to do.`);
    return { text: lines.join('\n') + '\n', ok: true };
  }

  const cmd = expoInstallArgv(detectPackageManager(root), targets);
  for (const s of missing) lines.push(`✗ ${s.pkg}: ${s.inPackageJson ? 'in package.json but not installed' : 'not installed'}`);
  if (align) lines.push(`  --align: re-pinning ${targets.length - missing.length} installed module(s) to this SDK's versions`);

  if (dry) {
    lines.push('', 'Would run (nothing was changed):', `  ${cmd.join(' ')}`);
    return { text: lines.join('\n') + '\n', ok: true, argv: cmd };
  }

  lines.push('', `run    ${cmd.join(' ')}`);
  try {
    exec(cmd, { cwd: root });
  } catch (e) {
    lines.push(`✗ the install failed: ${String(e?.message ?? e).split('\n')[0]}`, `  fix: run it yourself from the app root:  ${cmd.join(' ')}`);
    return { text: lines.join('\n') + '\n', ok: false, argv: cmd };
  }

  const after = moduleStatus(root, { skip });
  const was = new Map(before.map((s) => [s.pkg, s]));
  const added = after.filter((s) => !was.get(s.pkg).inPackageJson && s.inPackageJson).map((s) => s.pkg);
  const revised = after.filter((s) => was.get(s.pkg).inPackageJson && s.installed && was.get(s.pkg).version && s.version !== was.get(s.pkg).version);
  if (added.length || revised.length) {
    lines.push('', 'Changes:');
    for (const p of added) lines.push(`  + ${p} ${after.find((s) => s.pkg === p).spec ?? ''}`.trimEnd());
    for (const s of revised) lines.push(`  ~ ${s.pkg}: ${was.get(s.pkg).version} -> ${s.version}`);
  }

  const still = after.filter(isMissing);
  if (still.length) {
    for (const s of still) lines.push(`✗ ${s.pkg} is still ${s.inPackageJson ? 'not in node_modules' : 'not in package.json'}`);
    lines.push(`  fix: run  ${cmd.join(' ')}  yourself and read its output, then re-run ${FIX_COMMAND}`);
    return { text: lines.join('\n') + '\n', ok: false, argv: cmd };
  }
  lines.push(`✓ all ${after.length} native modules are installed.`);
  const needBuild = [...added, ...revised.map((s) => s.pkg)];
  if (needBuild.length) lines.push('', rebuildNote(needBuild));
  if (added.length || revised.length) lines.push('', METRO_NOTE);
  return { text: lines.join('\n') + '\n', ok: true, argv: cmd };
}
