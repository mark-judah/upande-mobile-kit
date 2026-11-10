/**
 * The app's release workflow (.github/workflows/release.yml): a small caller of the kit's reusable workflow.
 *
 * It is pinned to the kit version that wrote it (`@v<version>`), because a floating tag never carries
 * workflow fixes to apps that already have the file. `init --update-workflow` rewrites only this file to the
 * installed kit's version, keeping the app's own values.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { backupNote, createBackup } from './backup.mjs';
import { ensureGitignore } from './gitignore.mjs';
import { KIT_REPO, KIT_VERSION, WORKFLOW_REF } from './constants.mjs';

export const WORKFLOW_FILE = '.github/workflows/release.yml';
export const UPGRADE_FILE = '.github/workflows/upgrade-kit.yml';
export const UPDATE_FIX = 'npx upande-mobile-kit init --update-workflow';
const TEMPLATE = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'templates', 'release-caller.yml');
const UPGRADE_TEMPLATE = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'templates', 'upgrade-caller.yml');

/** The caller that opens a pull request when a newer kit is out. */
export function renderUpgradeCaller({ kitRepo = KIT_REPO, ref = WORKFLOW_REF } = {}) {
  return readFileSync(UPGRADE_TEMPLATE, 'utf8').replaceAll('__KIT_REPO__', kitRepo).replaceAll('__WORKFLOW_REF__', ref);
}

/** The caller file for these values (the template, filled in). */
export function renderCaller({ kitRepo = KIT_REPO, ref = WORKFLOW_REF, appName, apkName, branch = 'main' }) {
  return readFileSync(TEMPLATE, 'utf8')
    .replaceAll('__KIT_REPO__', kitRepo)
    .replaceAll('__WORKFLOW_REF__', ref)
    .replaceAll('__APP_NAME__', appName)
    .replaceAll('__APK_NAME__', apkName)
    .replace('branches: [main]', `branches: [${branch}]`);
}

const unquote = (v) => String(v ?? '').trim().replace(/^["']|["']$/g, '');

/** What an existing caller says. Understands the one-line `with: { ... }` form older kits wrote and the block form. */
export function parseCaller(text) {
  const uses = /uses:\s*([^\s@]+?)\/\.github\/workflows\/release\.yml@(\S+)/.exec(text);
  const appName = /app-name:\s*("[^"]*"|'[^']*'|[^,}\n]+)/.exec(text);
  const apkName = /apk-name:\s*("[^"]*"|'[^']*'|[^,}\s]+)/.exec(text);
  const branches = /branches:\s*\[([^\]]*)\]/.exec(text);
  return {
    kitRepo: uses?.[1] ?? null,
    ref: uses?.[2] ?? null,
    appName: appName ? unquote(appName[1]) : null,
    apkName: apkName ? unquote(apkName[1]) : null,
    branch: branches ? branches[1].split(',')[0].trim().replace(/^["']|["']$/g, '') : null,
    hasBuildApk: /build_apk/.test(text),
  };
}

const semver = (ref) => /^v(\d+)\.(\d+)\.(\d+)$/.exec(ref ?? '')?.slice(1).map(Number) ?? null;
const older = (a, b) => {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i];
  return false;
};

/**
 * Checks for verify and doctor: `[{ level, msg, fix }]`. Silent when there is no workflow file (callers report that
 * themselves).
 */
export function workflowChecks(root) {
  const file = join(root, WORKFLOW_FILE);
  if (!existsSync(file)) return [];
  const c = parseCaller(readFileSync(file, 'utf8'));
  const out = [];
  const pinned = semver(c.ref);
  const installed = semver(WORKFLOW_REF);
  if (!c.ref) {
    out.push({ level: 'warn', msg: `${WORKFLOW_FILE} does not call the kit's release workflow (no \`uses: <owner>/<repo>/.github/workflows/release.yml@<ref>\` line)`, fix: UPDATE_FIX });
  } else if (!pinned) {
    out.push({ level: 'warn', msg: `${WORKFLOW_FILE} calls the kit's release workflow at the floating ref @${c.ref}: fixes to the workflow never reach this app`, fix: UPDATE_FIX });
  } else if (installed && older(pinned, installed)) {
    out.push({ level: 'warn', msg: `${WORKFLOW_FILE} is pinned to @${c.ref}, the installed kit is v${KIT_VERSION}: newer release features (commit markers, build_apk) may be missing`, fix: UPDATE_FIX });
  } else {
    out.push({ level: 'ok', msg: `release workflow pinned to @${c.ref}.` });
  }
  if (c.ref && !c.hasBuildApk) {
    out.push({ level: 'warn', msg: `${WORKFLOW_FILE} has no build_apk input, so "Run workflow" cannot build an APK by hand`, fix: UPDATE_FIX });
  }
  return out;
}

/**
 * `init --update-workflow`: rewrite ONLY the release workflow from the template, keeping the app-name, apk-name
 * and branch of the existing file. The old file is backed up (unless --no-backup).
 * @returns {string} text for the terminal
 */
export function updateWorkflow(root, argv = []) {
  const flag = (n) => {
    const i = argv.indexOf(`--${n}`);
    return i === -1 ? undefined : argv[i + 1];
  };
  const file = join(root, WORKFLOW_FILE);
  if (!existsSync(file)) throw new Error(`${WORKFLOW_FILE} does not exist: run \`npx upande-mobile-kit init\` first.`);
  const old = readFileSync(file, 'utf8');
  const c = parseCaller(old);
  if (!c.appName || !c.apkName) throw new Error(`Could not read app-name and apk-name from ${WORKFLOW_FILE}: edit it by hand or re-run init with --force.`);
  const next = renderCaller({
    kitRepo: flag('kit-repo') ?? c.kitRepo ?? KIT_REPO,
    ref: WORKFLOW_REF,
    appName: c.appName,
    apkName: c.apkName,
    branch: flag('branch') ?? c.branch ?? 'main',
  });
  // The upgrade caller is pinned the same way, and is added to apps that predate it.
  const upgradeFile = join(root, UPGRADE_FILE);
  const upgradeNext = renderUpgradeCaller({ kitRepo: flag('kit-repo') ?? c.kitRepo ?? KIT_REPO });
  const upgradeOld = existsSync(upgradeFile) ? readFileSync(upgradeFile, 'utf8') : null;
  if (next === old && upgradeNext === upgradeOld) return `${WORKFLOW_FILE} is already up to date (pinned to @${WORKFLOW_REF}).\n`;
  const backup = createBackup(root, !argv.includes('--no-backup'));
  backup.save(WORKFLOW_FILE);
  mkdirSync(dirname(file), { recursive: true });
  if (next !== old) writeFileSync(file, next);
  if (upgradeNext !== upgradeOld) {
    if (upgradeOld !== null) backup.save(UPGRADE_FILE);
    writeFileSync(upgradeFile, upgradeNext);
  }
  ensureGitignore(root); // the backup folder stays out of git
  const lines = [...(upgradeNext !== upgradeOld ? [`${upgradeOld === null ? 'create' : 'update'} ${UPGRADE_FILE} (opens a pull request when a newer kit is out)`] : []), `update ${WORKFLOW_FILE}: @${c.ref ?? '?'} -> @${WORKFLOW_REF}${c.hasBuildApk ? '' : ', added the build_apk input'}`, `       kept: app-name "${c.appName}", apk-name ${c.apkName}, branch ${flagBranch(c, flag)}`];
  if (backup.files.length) lines.push('', backupNote(backup));
  lines.push('', 'Commit and push it for the new workflow to take effect.');
  return lines.join('\n') + '\n';
}

const flagBranch = (c, flag) => flag('branch') ?? c.branch ?? 'main';
