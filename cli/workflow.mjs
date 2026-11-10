/**
 * The app's release workflow (.github/workflows/release.yml): a small caller of the kit's reusable workflow.
 *
 * It is pinned to the kit version that wrote it (`@v<version>`), because a floating tag never carries
 * workflow fixes to apps that already have the file. `init --update-workflow` rewrites only this file to the
 * installed kit's version, keeping the app's own values.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { backupNote, createBackup } from './backup.mjs';
import { ensureGitignore } from './gitignore.mjs';
import { defaultOtaBaseUrl, KIT_REPO, KIT_VERSION, REPO_RE, WORKFLOW_REF } from './constants.mjs';

export const WORKFLOW_FILE = '.github/workflows/release.yml';
export const UPGRADE_FILE = '.github/workflows/upgrade-kit.yml';
export const UPDATE_FIX = 'npx upande-mobile-kit init --update-workflow';
const TEMPLATE = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'templates', 'release-caller.yml');
const UPGRADE_TEMPLATE = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'templates', 'upgrade-caller.yml');

/** The caller that opens a pull request when a newer kit is out. */
export function renderUpgradeCaller({ kitRepo = KIT_REPO, ref = WORKFLOW_REF } = {}) {
  return readFileSync(UPGRADE_TEMPLATE, 'utf8').replaceAll('__KIT_REPO__', kitRepo).replaceAll('__WORKFLOW_REF__', ref);
}

/** The template's commented-out `release-repo` line (it stays a comment until a release repo is set). */
const RELEASE_REPO_COMMENT = /^([ \t]*)# release-repo:.*$/m;
/** A set `release-repo:` line, in the block form or inside a one-line `with: { ... }`. */
const RELEASE_REPO_LINE = /(^[ \t]*|[{,][ \t]*)release-repo:[ \t]*("[^"]*"|'[^']*'|[^\s#,}]*)/m;

export function checkReleaseRepo(repo, what = '--release-repo') {
  if (repo && !REPO_RE.test(repo)) throw new Error(`${what} must look like owner/repo (got "${repo}").`);
  return repo;
}

/** The caller file for these values (the template, filled in). */
export function renderCaller({ kitRepo = KIT_REPO, ref = WORKFLOW_REF, appName, apkName, branch = 'main', releaseRepo = '' }) {
  const text = readFileSync(TEMPLATE, 'utf8')
    .replaceAll('__KIT_REPO__', kitRepo)
    .replaceAll('__WORKFLOW_REF__', ref)
    .replaceAll('__APP_NAME__', appName)
    .replaceAll('__APK_NAME__', apkName)
    .replace('branches: [main]', `branches: [${branch}]`);
  return releaseRepo ? text.replace(RELEASE_REPO_COMMENT, (_m, ind) => `${ind}release-repo: ${checkReleaseRepo(releaseRepo)}`) : text;
}

/**
 * The same caller with `release-repo` set to `repo` ('' removes it), every other line as it was. Null when the file has
 * no place to put it (an old one-line `with: { ... }`): `init --update-workflow --release-repo` rewrites that one.
 */
export function withReleaseRepo(text, repo) {
  checkReleaseRepo(repo);
  const set = RELEASE_REPO_LINE.exec(text);
  if (set) {
    if (repo) return text.replace(RELEASE_REPO_LINE, (_m, lead) => `${lead}release-repo: ${repo}`);
    return /^[ \t]*$/.test(set[1]) ? text.replace(/^[ \t]*release-repo:.*\r?\n/m, '') : text.replace(RELEASE_REPO_LINE, '');
  }
  if (!repo) return text;
  if (RELEASE_REPO_COMMENT.test(text)) return text.replace(RELEASE_REPO_COMMENT, (_m, ind) => `${ind}release-repo: ${repo}`);
  // After the last input of the call (the `with:` under `uses:`), not the workflow_dispatch input of the same name.
  const call = text.search(/^[ \t]*uses:[^\n]*\/\.github\/workflows\/release\.yml@/m);
  if (call === -1 || /with:\s*\{/.test(text.slice(call))) return null;
  const rest = text.slice(call);
  const anchor = /^([ \t]+)build_apk:.*$/m.exec(rest) ?? /^([ \t]+)apk-name:.*$/m.exec(rest);
  if (!anchor) return null;
  const at = call + anchor.index + anchor[0].length;
  return `${text.slice(0, at)}\n${anchor[1]}release-repo: ${repo}${text.slice(at)}`;
}

const unquote = (v) => String(v ?? '').trim().replace(/^["']|["']$/g, '');

/** What an existing caller says. Understands the one-line `with: { ... }` form older kits wrote and the block form. */
export function parseCaller(text) {
  const uses = /uses:\s*([^\s@]+?)\/\.github\/workflows\/release\.yml@(\S+)/.exec(text);
  const appName = /app-name:\s*("[^"]*"|'[^']*'|[^,}\n]+)/.exec(text);
  const apkName = /apk-name:\s*("[^"]*"|'[^']*'|[^,}\s]+)/.exec(text);
  const branches = /branches:\s*\[([^\]]*)\]/.exec(text);
  const releaseRepo = RELEASE_REPO_LINE.exec(text);
  return {
    kitRepo: uses?.[1] ?? null,
    ref: uses?.[2] ?? null,
    appName: appName ? unquote(appName[1]) : null,
    apkName: apkName ? unquote(apkName[1]) : null,
    branch: branches ? branches[1].split(',')[0].trim().replace(/^["']|["']$/g, '') : null,
    hasBuildApk: /build_apk/.test(text),
    releaseRepo: releaseRepo ? unquote(releaseRepo[2]) || null : null,
  };
}

/** `{ releaseRepo, branch }` from the app's caller, or null when there is no caller. */
export function callerReleaseRepo(root) {
  const file = join(root, WORKFLOW_FILE);
  if (!existsSync(file)) return null;
  const c = parseCaller(readFileSync(file, 'utf8'));
  return { releaseRepo: c.releaseRepo, branch: c.branch };
}

const gitOrigin = (root) => {
  try {
    const url = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return /github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(url)?.[1] ?? '';
  } catch {
    return '';
  }
};

/** `githubRepo` from src/mobile-kit.ts, or ''. */
export function configGithubRepo(root) {
  try {
    return /^[ \t]*githubRepo:[ \t]*['"]([^'"]+)['"]/m.exec(readFileSync(join(root, 'src/mobile-kit.ts'), 'utf8'))?.[1] ?? '';
  } catch {
    return '';
  }
}

/**
 * Does the app look for releases where the workflow puts them? `[{ level, msg, fix }]`, for verify and doctor. Silent
 * when there is no workflow file, and when nothing disagrees and no release repo is set (the usual single-repo app).
 */
export function releaseRepoChecks(root) {
  const caller = callerReleaseRepo(root);
  if (!caller) return [];
  const out = [];
  const cfgRepo = configGithubRepo(root);
  const origin = gitOrigin(root);
  let ota = '';
  try {
    ota = JSON.parse(readFileSync(join(root, 'app.json'), 'utf8')).expo?.extra?.otaBaseUrl ?? '';
  } catch {
    /* doctor reports app.json itself */
  }
  const R = caller.releaseRepo;
  if (R) {
    const fix = `npx upande-mobile-kit init --release-repo ${R}`;
    if (!REPO_RE.test(R)) {
      out.push({ level: 'fail', msg: `${WORKFLOW_FILE}: release-repo "${R}" is not owner/repo`, fix: 'set release-repo to the owner/repo of the public releases repository' });
      return out;
    }
    out.push({ level: 'ok', msg: `releases are published to ${R}; tags in this repo are ${caller.branch ?? '<branch>'}/v<version>.` });
    if (origin && origin.toLowerCase() === R.toLowerCase()) {
      out.push({ level: 'warn', msg: `release-repo ${R} is this source repo itself, so it changes nothing but the tag names`, fix: 'point release-repo at a separate public repository, or remove the line' });
    }
    if (cfgRepo && cfgRepo !== R) {
      out.push({ level: 'warn', msg: `src/mobile-kit.ts has githubRepo '${cfgRepo}', but the release workflow publishes to ${R}: phones look for APKs in the wrong place`, fix: `set githubRepo: '${R}' in src/mobile-kit.ts (or run ${fix})` });
    }
    const pages = defaultOtaBaseUrl(R);
    if (ota && ota.replace(/\/+$/, '') !== pages) {
      out.push({ level: 'warn', msg: `app.json extra.otaBaseUrl is ${ota}, but the OTA bundles are published to the Pages of ${R} (${pages})`, fix: `set expo.extra.otaBaseUrl to ${pages}, and ota_base_url on the server (register_app)` });
    }
  } else if (cfgRepo && origin && cfgRepo.toLowerCase() !== origin.toLowerCase()) {
    out.push({ level: 'warn', msg: `src/mobile-kit.ts has githubRepo '${cfgRepo}', but ${WORKFLOW_FILE} has no release-repo, so releases land in ${origin}`, fix: `npx upande-mobile-kit init --update-workflow --release-repo ${cfgRepo}  (or set githubRepo: '${origin}')` });
  }
  return out;
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
  // A release repo already in the file is kept; --release-repo sets it ('' removes it).
  const releaseRepo = checkReleaseRepo(flag('release-repo') ?? c.releaseRepo ?? '');
  const next = renderCaller({
    kitRepo: flag('kit-repo') ?? c.kitRepo ?? KIT_REPO,
    ref: WORKFLOW_REF,
    appName: c.appName,
    apkName: c.apkName,
    branch: flag('branch') ?? c.branch ?? 'main',
    releaseRepo,
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
  const lines = [...(upgradeNext !== upgradeOld ? [`${upgradeOld === null ? 'create' : 'update'} ${UPGRADE_FILE} (opens a pull request when a newer kit is out)`] : []), `update ${WORKFLOW_FILE}: @${c.ref ?? '?'} -> @${WORKFLOW_REF}${c.hasBuildApk ? '' : ', added the build_apk input'}`, `       kept: app-name "${c.appName}", apk-name ${c.apkName}, branch ${flagBranch(c, flag)}${releaseRepo ? `, release-repo ${releaseRepo}` : ''}`];
  if (backup.files.length) lines.push('', backupNote(backup));
  lines.push('', 'Commit and push it for the new workflow to take effect.');
  return lines.join('\n') + '\n';
}

const flagBranch = (c, flag) => flag('branch') ?? c.branch ?? 'main';
