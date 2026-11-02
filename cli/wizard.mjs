/**
 * `upande-mobile-kit init`, interactive. Asks only what it cannot detect, shows
 * a summary, and after "Apply?" does everything: writes the files, wraps the
 * root layout in <MobileKitProvider>, installs the native modules and the Frappe
 * backend, then runs `doctor`. Answers are remembered in upande-mobile-kit.json,
 * so running it again is Enter, Enter, Enter.
 *
 *   init                 wizard (in a terminal)
 *   init --yes           no questions: remembered answers + detected values + flags
 *   init --site ...      any value flag without --yes: the plain, non-interactive init (CI)
 *   --no-install         never run commands (expo install, bench); print them instead
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { buildAdapters, detectHost, detectHostBiometric, inferMode } from './adapters.mjs';
import { backupNote, createBackup } from './backup.mjs';
import { NATIVE_MODULES } from './constants.mjs';
import { detectPackageManager, FIX_COMMAND, missingModules, skipFor, METRO_NOTE } from './native-modules.mjs';
import { installNativeModules } from './native-install.mjs';
import { openBlock, rebuildBlock, repoFromRemote, run as plainInit, wiringReport } from './init.mjs';
import {
  appDir,
  DEFAULT_ROUTES,
  describeCollision,
  findCollisions,
  findLegacyKitFiles,
  routeFileFor,
  validateRoute,
} from './routes.mjs';

export { NATIVE_MODULES };

export const SAVED_FILE = 'upande-mobile-kit.json';
const URL_RE = /^https?:\/\/[^/\s]+/;
const IMPORT_LINE = "import { MobileKitProvider } from '@upande/mobile-kit';";

/* ───────────────────────────── root layout codemod ───────────────────────────── */

/** Index of the bracket matching the one at `open`, skipping strings and comments; -1 if unbalanced. */
function matchBracket(src, open) {
  const pairs = { '(': ')', '{': '}', '[': ']' };
  const stack = [];
  for (let i = open; i < src.length; i += 1) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i += 1;
    } else if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      if (end === -1) return -1;
      i = end + 1;
    } else if (c === '"' || c === "'" || c === '`') {
      i += 1;
      while (i < src.length && src[i] !== c) i += src[i] === '\\' ? 2 : 1;
      if (i >= src.length) return -1;
    } else if (pairs[c]) stack.push(pairs[c]);
    else if (c === ')' || c === '}' || c === ']') {
      if (stack.pop() !== c) return -1;
      if (stack.length === 0) return i;
    }
  }
  return -1;
}

/** Brackets in the whole file balance (strings and comments skipped). */
function balanced(src) {
  const pairs = { '(': ')', '{': '}', '[': ']' };
  const stack = [];
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i += 1;
    } else if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      if (end === -1) return false;
      i = end + 1;
    } else if (c === '"' || c === "'" || c === '`') {
      i += 1;
      while (i < src.length && src[i] !== c) i += src[i] === '\\' ? 2 : 1;
      if (i >= src.length) return false;
    } else if (pairs[c]) stack.push(pairs[c]);
    else if (c === ')' || c === '}' || c === ']') {
      if (stack.pop() !== c) return false;
    }
  }
  return stack.length === 0;
}

/** The default-exported function: { start (of its `function` keyword) } or null. */
function findRootFunction(src) {
  let m = /export\s+default\s+function\s*\w*\s*\(/.exec(src);
  if (m) return { paren: m.index + m[0].length - 1 };
  m = /export\s+default\s+(\w+)\s*;?\s*$/m.exec(src);
  if (m) {
    const f = new RegExp(`function\\s+${m[1]}\\s*\\(`).exec(src);
    if (f) return { paren: f.index + f[0].length - 1 };
  }
  return null;
}

/**
 * Wrap what the root layout returns in <MobileKitProvider>, and import it.
 * Conservative: returns `{ status: 'unrecognised', source }` (source untouched)
 * unless the file has a default-exported function component whose last
 * top-level `return` yields JSX. Idempotent.
 * @returns {{ status: 'wrapped' | 'already' | 'unrecognised', source: string }}
 */
export function wrapLayout(source) {
  if (/MobileKitProvider/.test(source)) return { status: 'already', source };
  const fail = { status: 'unrecognised', source };
  if (!balanced(source)) return fail;
  const fn = findRootFunction(source);
  if (!fn) return fail;
  const paramsEnd = matchBracket(source, fn.paren);
  if (paramsEnd === -1) return fail;
  const bodyOpen = source.indexOf('{', paramsEnd);
  if (bodyOpen === -1) return fail;
  const bodyClose = matchBracket(source, bodyOpen);
  if (bodyClose === -1) return fail;

  // The last `return` that sits directly in the function body (not in a nested function).
  let ret = -1;
  let depth = 0;
  for (let i = bodyOpen; i < bodyClose; i += 1) {
    const c = source[i];
    if (c === '/' && source[i + 1] === '/') {
      while (i < bodyClose && source[i] !== '\n') i += 1;
    } else if (c === '/' && source[i + 1] === '*') {
      i = source.indexOf('*/', i + 2) + 1;
    } else if (c === '"' || c === "'" || c === '`') {
      i += 1;
      while (i < bodyClose && source[i] !== c) i += source[i] === '\\' ? 2 : 1;
    } else if (c === '{' || c === '(' || c === '[') depth += 1;
    else if (c === '}' || c === ')' || c === ']') depth -= 1;
    else if (depth === 1 && source.startsWith('return', i) && !/\w/.test(source[i - 1] ?? ' ') && !/\w/.test(source[i + 6] ?? ' ')) ret = i;
  }
  if (ret === -1) return fail;

  let p = ret + 6;
  while (/\s/.test(source[p])) p += 1;
  let exprStart;
  let exprEnd; // exclusive
  let tail; // what follows the expression in the original (")" or ";" or "")
  if (source[p] === '(') {
    const close = matchBracket(source, p);
    if (close === -1 || close > bodyClose) return fail;
    exprStart = p + 1;
    exprEnd = close;
    tail = ')';
  } else {
    exprStart = p;
    let q = p;
    let d = 0;
    while (q < bodyClose) {
      const c = source[q];
      if (c === '"' || c === "'" || c === '`') {
        q += 1;
        while (q < bodyClose && source[q] !== c) q += source[q] === '\\' ? 2 : 1;
      } else if (c === '(' || c === '{' || c === '[') d += 1;
      else if (c === ')' || c === '}' || c === ']') d -= 1;
      else if (c === ';' && d === 0) break;
      q += 1;
    }
    exprEnd = q;
    tail = '';
  }
  const inner = source.slice(exprStart, exprEnd);
  if (!inner.trim().startsWith('<')) return fail;

  const lineStart = source.lastIndexOf('\n', ret) + 1;
  const ind = /^[ \t]*/.exec(source.slice(lineStart, ret))[0];
  let out;
  if (tail === ')' && /^[ \t]*\r?\n/.test(inner)) {
    // `return (\n  <Stack />\n)`: the JSX already sits on its own lines, so add one line before and one after
    // and leave every existing line exactly as it is (no re-indenting, a small diff).
    const childInd = /\n([ \t]*)\S/.exec(inner)[1];
    const trailing = /\s*$/.exec(inner)[0];
    out = `${source.slice(0, p + 1)}\n${childInd}<MobileKitProvider>${inner.replace(/\s*$/, '')}\n${childInd}</MobileKitProvider>${trailing})${source.slice(exprEnd + 1)}`;
  } else {
    // `return <Stack />;` or `return (<Stack />);`: the expression has to move onto its own line.
    const replaceFrom = tail === ')' ? p : exprStart;
    const replaceTo = tail === ')' ? exprEnd + 1 : exprEnd;
    out = `${source.slice(0, replaceFrom)}(\n${ind}  <MobileKitProvider>\n${ind}    ${inner.trim()}\n${ind}  </MobileKitProvider>\n${ind})${source.slice(replaceTo)}`;
  }

  // The import goes after the last top-level import statement.
  const importRe = /^import\s+(?:[\s\S]*?\s+from\s+)?['"][^'"]+['"];?[ \t]*$/gm;
  let last = null;
  for (let m = importRe.exec(out); m; m = importRe.exec(out)) last = m;
  out = last ? `${out.slice(0, last.index + last[0].length)}\n${IMPORT_LINE}${out.slice(last.index + last[0].length)}` : `${IMPORT_LINE}\n${out}`;

  const opens = (out.match(/<MobileKitProvider>/g) ?? []).length;
  const closes = (out.match(/<\/MobileKitProvider>/g) ?? []).length;
  if (!balanced(out) || opens !== 1 || closes !== 1) return fail;
  return { status: 'wrapped', source: out };
}

export const manualLayoutEdit = () =>
  [
    `  ${IMPORT_LINE}`,
    '  // in the root layout component, wrap whatever it returns:',
    '  <MobileKitProvider> …your <Stack /> or <Slot /> … </MobileKitProvider>',
  ].join('\n');

/* ───────────────────────────── detection helpers ───────────────────────────── */

export { detectPackageManager };

const isBench = (dir) => existsSync(join(dir, 'sites', 'apps.txt'));
const isDir = (p) => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};

/** Frappe benches near here: this folder or a parent, ~/frappe-bench, and siblings / home children named like a bench. */
export function findBenches({ cwd = process.cwd(), home = homedir() } = {}) {
  const found = [];
  const add = (d) => {
    const abs = resolve(d);
    if (isBench(abs) && !found.includes(abs)) found.push(abs);
  };
  for (let d = resolve(cwd); ; d = dirname(d)) {
    add(d);
    if (dirname(d) === d) break;
  }
  add(join(home, 'frappe-bench'));
  add(join(home, 'bench'));
  const scan = (parent) => {
    try {
      for (const e of readdirSync(parent)) if (isDir(join(parent, e))) add(join(parent, e));
    } catch {
      /* unreadable */
    }
  };
  scan(dirname(resolve(cwd))); // siblings of the app folder (and of its parent when nested one deep)
  try {
    for (const e of readdirSync(home)) if (/bench/i.test(e)) add(join(home, e));
  } catch {
    /* no home */
  }
  return found;
}

/** Site folders of a bench (a folder with site_config.json). */
export function listBenchSites(bench) {
  try {
    return readdirSync(join(bench, 'sites'))
      .filter((e) => e !== 'assets' && existsSync(join(bench, 'sites', e, 'site_config.json')))
      .sort();
  } catch {
    return [];
  }
}

export function loadSaved(root) {
  try {
    const v = JSON.parse(readFileSync(join(root, SAVED_FILE), 'utf8'));
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

export function saveAnswers(root, answers) {
  const clean = Object.fromEntries(Object.entries(answers).filter(([, v]) => v !== undefined && v !== '' && v !== null));
  writeFileSync(join(root, SAVED_FILE), `${JSON.stringify(clean, null, 2)}\n`);
}

/* ───────────────────────────── terminal I/O ───────────────────────────── */

/** The real prompt layer (tests pass their own with the same shape). */
export async function createIo() {
  const { createInterface } = await import('node:readline/promises');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = async (q, def = '') => {
    const a = (await rl.question(`${q}${def ? ` [${def}]` : ''}: `)).trim();
    return a === '' ? def : a;
  };
  return {
    interactive: !!(process.stdin.isTTY && process.stdout.isTTY),
    say: (t = '') => process.stdout.write(`${t}\n`),
    ask,
    async confirm(q, def = true) {
      const a = (await rl.question(`${q} [${def ? 'Y/n' : 'y/N'}]: `)).trim().toLowerCase();
      return a === '' ? def : a.startsWith('y');
    },
    async choose(q, options, defIndex = 0) {
      process.stdout.write(`${q}\n`);
      options.forEach((o, i) => process.stdout.write(`  ${i + 1}) ${o.label}\n`));
      for (;;) {
        const a = (await rl.question(`Choose 1-${options.length} [${defIndex + 1}]: `)).trim();
        if (a === '') return options[defIndex].value;
        const n = Number(a);
        if (Number.isInteger(n) && n >= 1 && n <= options.length) return options[n - 1].value;
        process.stdout.write('  Enter one of the numbers.\n');
      }
    },
    exec: (argv, { cwd } = {}) => execFileSync(argv[0], argv.slice(1), { cwd, stdio: 'inherit' }),
    close: () => rl.close(),
  };
}

/* ───────────────────────────── the wizard ───────────────────────────── */

const VALUE_FLAGS = ['site', 'dev-site', 'bench', 'bench-site', 'backend-repo', 'kit-repo', 'name', 'repo', 'ota-base-url', 'apk-name', 'branch', 'settings-route', 'devices-route', 'biometric'];

const sh = (root, ...args) => {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
};

const cleanUrl = (u) => String(u ?? '').trim().replace(/\/+$/, '');
const urlError = (u) => (URL_RE.test(u) ? '' : 'That is not a URL. Start with http:// or https://');

/** Replace the `site:` line of a generated src/mobile-kit.ts; null when the file is not in the generated shape. */
export function updateSiteLine(source, site, devSite) {
  const value = devSite ? `{ production: '${site}', development: '${devSite}' }` : `'${site}'`;
  const re = /^([ \t]*site:[ \t]*).*,[ \t]*(?:\/\/.*)?$/m;
  return re.test(source) ? source.replace(re, (_m, pre) => `${pre}${value},`) : null;
}

const doctorFlags = (a) => ['--site', a.site, ...(a.devSite ? ['--dev-site', a.devSite] : [])];

/**
 * Entry point for `init`. Returns the text to print.
 * @param {string[]} argv
 * @param {string} root
 * @param {{ io?: object, doctor?: Function, env?: object }} [opts]
 */
export async function main(argv, root = process.cwd(), opts = {}) {
  const flag = (n) => {
    const i = argv.indexOf(`--${n}`);
    return i === -1 ? undefined : argv[i + 1];
  };
  const yes = argv.includes('--yes') || argv.includes('-y');
  const noInstall = argv.includes('--no-install');
  const flagged = VALUE_FLAGS.some((f) => argv.includes(`--${f}`));

  // Plain init, exactly as before: any value flag without --yes.
  if (flagged && !yes) {
    const exec = opts.exec ?? (opts.io ? (a, o) => opts.io.exec(a, o) : undefined);
    const text = plainInit(argv, root, exec ? { exec } : {});
    return text;
  }

  const io = opts.io ?? (await createIo());
  try {
    return await wizard({ argv, root, flag, yes, noInstall, io, doctorFn: opts.doctor });
  } finally {
    io.close?.();
  }
}

/** Dependency map of the app's package.json (dependencies + devDependencies). */
const readDeps = (root) => {
  try {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    return { ...pkg.devDependencies, ...pkg.dependencies };
  } catch {
    return {};
  }
};
const readExpo = (root) => {
  try {
    return JSON.parse(readFileSync(join(root, 'app.json'), 'utf8')).expo ?? {};
  } catch {
    return {};
  }
};

/** Does `file` exist and export `name`? '' when yes, otherwise what is wrong. */
function checkExport(root, file, name) {
  const full = join(root, file);
  if (!existsSync(full) || !statSync(full).isFile()) return `${file} does not exist.`;
  const src = readFileSync(full, 'utf8');
  return new RegExp(`export\\s+(?:const|function|async function)\\s+${name}\\b|export\\s*\\{[^}]*\\b${name}\\b`).test(src) ? '' : `${file} does not export ${name}.`;
}

async function wizard({ argv, root, flag, yes, noInstall, io, doctorFn }) {
  const appJsonPath = join(root, 'app.json');
  if (!existsSync(appJsonPath)) throw new Error('No app.json here — run this from the root of an Expo app.');
  const expoName = JSON.parse(readFileSync(appJsonPath, 'utf8')).expo?.name ?? '';
  const saved = loadSaved(root);
  const prompting = io.interactive && !yes;

  if (!prompting && !yes) {
    throw new Error(
      'init needs a terminal to ask its questions. Run it in one, or pass the answers:\n' +
        '  npx upande-mobile-kit init --yes --site https://your.site [--dev-site http://localhost:8000] [--bench /path/to/bench --bench-site my.site]\n' +
        '(--yes uses remembered answers and detected values; values passed as flags win.)',
    );
  }
  const say = (t = '') => io.say?.(t);

  /** Ask until `validate` passes. Without prompting: the flag, else the default, validated once. */
  const resolveValue = async ({ flagValue, def = '', question, validate, optional = false }) => {
    if (flagValue !== undefined) {
      const err = flagValue || optional ? (flagValue ? validate?.(flagValue) : '') : 'is required';
      if (err) throw new Error(`${question}: ${err}`);
      return flagValue;
    }
    if (!prompting) {
      if (!def && !optional) throw new Error(`${question}: no value yet. Pass it as a flag (see: npx upande-mobile-kit init --yes --site https://your.site).`);
      const err = def ? validate?.(def) : '';
      if (err) throw new Error(`${question}: ${err}`);
      return def;
    }
    for (;;) {
      const a = cleanUrlIfNeeded(await io.ask(question, def), validate);
      if (!a && !optional) {
        say('  This one is required.');
        continue;
      }
      const err = a ? validate?.(a) : '';
      if (!err) return a;
      say(`  ${err}`);
    }
  };
  const cleanUrlIfNeeded = (a, validate) => (validate === urlError ? cleanUrl(a) : a);

  // Detected, so never asked (a flag or the summary can still change them).
  const name = flag('name') ?? expoName;
  if (!name) throw new Error('app.json has no expo.name. Add one, or pass --name "My App".');
  let repo = flag('repo') ?? saved.repo ?? repoFromRemote(sh(root, 'remote', 'get-url', 'origin'));
  if (!repo) {
    repo = await resolveValue({
      question: 'GitHub repo that will publish releases (owner/repo)',
      validate: (v) => (/^[\w.-]+\/[\w.-]+$/.test(v) ? '' : 'Use the form owner/repo'),
    });
  }

  say(`\nSetting up ${name} (${repo}).\n`);
  const site = cleanUrl(
    await resolveValue({
      flagValue: flag('site'),
      def: saved.site,
      question: 'Production site URL (release builds use this)',
      validate: urlError,
    }),
  );
  const devSite = cleanUrl(
    await resolveValue({
      flagValue: flag('dev-site'),
      def: saved.devSite ?? '',
      question: 'Local/dev site URL (dev builds use this; blank = same as production, try http://localhost:8000)',
      validate: urlError,
      optional: true,
    }),
  );

  // The kit's pages live under /mobile-kit/, so nothing of the app's collides: no choices to make. A page
  // already served there (it should not happen) is the only thing that stops us, before anything is written.
  const routes = {};
  for (const key of ['settings', 'devices']) {
    const flagName = `--${key}-route`;
    // A saved route from an older version is ignored on purpose: the pages move to the default under /mobile-kit/.
    const route = flag(`${key}-route`) ?? DEFAULT_ROUTES[key];
    const bad = validateRoute(route);
    if (bad) throw new Error(`${flagName}: ${bad}`);
    const taken = findCollisions(root, route);
    if (taken.length) throw new Error(describeCollision(route, taken, flagName));
    routes[key] = route;
  }
  if (routes.settings === routes.devices) throw new Error('The Settings and Devices pages need different paths (--settings-route / --devices-route).');
  const settingsFile = routeFileFor(root, routes.settings);
  const devicesFile = routeFileFor(root, routes.devices);

  // Backend on a bench on this machine?
  const benches = findBenches({ cwd: root });
  let bench = flag('bench') ?? '';
  let benchSite = flag('bench-site') ?? '';
  let installBackend = bench !== '';
  if (!installBackend) {
    const def = saved.installBackend ?? benches.length > 0;
    installBackend = prompting ? await io.confirm('Install the Frappe backend (upande_mobile) on a bench on this machine now?', def) : yes && saved.installBackend === true;
  }
  if (installBackend && !bench) {
    const candidates = [...new Set([saved.bench, ...benches].filter((b) => b && isBench(b)))];
    if (prompting) {
      const options = [...candidates.map((c) => ({ label: c, value: c })), { label: 'Another folder…', value: '' }];
      bench = await io.choose('Which bench?', options, 0);
      while (!bench || !isBench(resolve(bench))) {
        if (bench) say('  That folder has no sites/apps.txt, so it is not a bench.');
        bench = await io.ask('Path to the bench folder', '');
        if (!bench) say('  This one is required.');
      }
    } else {
      bench = candidates[0] ?? '';
      if (!bench) throw new Error('--yes needs a bench: pass --bench /path/to/bench (or remember one by running the wizard once).');
    }
  }
  if (installBackend && !benchSite) {
    const sites = listBenchSites(bench);
    const host = (u) => {
      try {
        return new URL(u).hostname;
      } catch {
        return '';
      }
    };
    const preferred = [host(devSite), saved.benchSite, host(site)].find((h) => h && sites.includes(h));
    if (prompting) {
      if (sites.length) {
        const options = sites.map((s) => ({ label: s, value: s }));
        benchSite = await io.choose('Which bench site?', options, Math.max(0, sites.indexOf(preferred)));
      } else benchSite = await io.ask('Bench site name', host(devSite || site));
    } else benchSite = preferred ?? sites[0] ?? host(devSite || site);
  }
  // The native modules are not optional: the app is incomplete without them, so there is no question to answer.

  // The app's own session, API client and storage: used when found, asked about when not.
  const cfgKept = existsSync(join(root, 'src/mobile-kit.ts')) && !argv.includes('--force');
  const hostLocks = detectHostBiometric(root);
  const biometric = flag('biometric') ?? (hostLocks.length ? 'host' : 'kit');
  const wire = argv.includes('--no-adapters') ? { auth: null, api: null, storage: null } : detectHost(root);
  if (!cfgKept && prompting && !argv.includes('--no-adapters')) {
    if (!wire.auth) {
      say('\nI could not find your app\'s sign-in state. Without it, sign-out, the biometric switch and the device register run on stand-ins.');
      for (;;) {
        const file = (await io.ask("File exporting your auth store hook, e.g. src/store/auth.ts (blank = skip)", saved.authFile ?? '')).trim();
        if (!file) break;
        const exportName = (await io.ask('Name of the exported hook', saved.authExport ?? 'useAuthStore')).trim();
        const err = checkExport(root, file, exportName);
        if (!err) {
          wire.auth = { file, exportName, mode: inferMode(readFileSync(join(root, file), 'utf8'), exportName) };
          break;
        }
        say(`  ${err}`);
      }
    }
    if (!wire.api && 'axios' in readDeps(root)) {
      for (;;) {
        const file = (await io.ask('File exporting your API client function `api` (blank = use the kit\'s fetch client)', saved.apiFile ?? '')).trim();
        if (!file) break;
        const err = checkExport(root, file, 'api');
        if (!err) {
          wire.api = { file, exportName: 'api' };
          break;
        }
        say(`  ${err}`);
      }
    }
  }
  const adapters = buildAdapters({ root, ...wire });

  const doBackend = installBackend && !noInstall;
  const doNative = !noInstall;
  const backup = createBackup(root, !argv.includes('--no-backup'));

  // What will change, before anything does.
  const depsBefore = readDeps(root);
  // Only what is really missing is installed (idempotent); one that is in package.json but not in node_modules is re-installed and may be re-pinned.
  const missingNow = missingModules(root, { skip: skipFor({ biometricHost: biometric === 'host' }) }).map((m) => m.pkg);
  const toAdd = missingNow.filter((m) => !depsBefore[m]);
  const present = missingNow.filter((m) => depsBefore[m]);
  const layoutRel = ['tsx', 'jsx', 'js'].map((e) => `${appDir(root)}/_layout.${e}`).find((r) => existsSync(join(root, r)));
  const fileLine = (rel, what) => `  • ${rel}  (${existsSync(join(root, rel)) ? what[1] : what[0]})`;

  say('\nThis will:');
  say('  Files');
  for (const l of findLegacyKitFiles(root).filter((x) => routes[x.key] === DEFAULT_ROUTES[x.key])) say(`  • ${l.file}  (moved to ${routeFileFor(root, DEFAULT_ROUTES[l.key])}: it is the kit's own page from an older version)`);
  say(fileLine(settingsFile, ['create', 'exists, kept']));
  say(fileLine(devicesFile, ['create', 'exists, kept']));
  say(fileLine('src/mobile-kit.ts', ['create', 'exists, kept; only the site line is updated']));
  say(fileLine('.github/workflows/release.yml', ['create', 'exists, kept']));
  say('  • app.json  (edit: plugin, updates.url, runtimeVersion, extra.otaBaseUrl, extra.mobileKit.sites)');
  say('  • package.json  (edit: helper scripts)');
  say(layoutRel ? `  • ${layoutRel}  (edit: import the kit config, wrap in <MobileKitProvider>; the original is backed up to ${backup.relDir}/)` : '  • no root layout found: you add <MobileKitProvider> by hand');
  say(`  • ${SAVED_FILE}  (remembered answers)`);
  say('  Dependencies');
  say(doNative ? `  • native modules (always installed, SDK-aware via expo install): ${missingNow.length ? 'expo install adds: ' + (toAdd.join(', ') || '(nothing new)') : 'all present, nothing to install'}` : `  • NOT installing the native modules (--no-install); the app is incomplete until you run ${FIX_COMMAND}. Missing: ${missingNow.join(', ') || 'nothing'}`);
  if (doNative && present.length) say(`  • expo install may CHANGE the versions of: ${present.map((m) => `${m} ${depsBefore[m]}`).join(', ')} (the diff is printed afterwards)`);
  say(`  Sites: production ${site}${devSite ? `, dev ${devSite}` : ''}`);
  say(`  Pages: Settings at ${routes.settings}, Devices at ${routes.devices}`);
  say(`  Biometric lock: owned by ${biometric === 'host' ? 'YOUR app (it already uses expo-local-authentication; the kit adds none)' : 'the kit'}`);
  say(
    cfgKept
      ? '  Wiring: src/mobile-kit.ts exists, so it is kept as it is (pass --force to regenerate it)'
      : `  Wiring: ${adapters.wired.length ? adapters.wired.map((w) => w.split(' <- ')[0]).join(', ') + ' from your app' : 'nothing found'}${adapters.standIns.length ? `; stand-ins: ${adapters.standIns.join(', ')}` : ''}`,
  );
  say(
    installBackend
      ? doBackend
        ? `  Backend: install on ${bench} (site ${benchSite})`
        : `  Backend: print the commands for ${bench} (site ${benchSite}); --no-install`
      : '  Backend: print the commands (no bench chosen)',
  );
  say('  Entry point: a floating Settings button appears in your app (nothing in your navigation is edited)');
  say('  • then run doctor\n');

  const ok = prompting ? await io.confirm('Apply?', true) : true;
  if (!ok) return 'Nothing was changed.\n';

  /* ── apply ── */
  const expoBefore = readExpo(root);
  const initArgs = ['--name', name, '--repo', repo, '--site', site, '--settings-route', routes.settings, '--devices-route', routes.devices, '--biometric', biometric];
  if (devSite) initArgs.push('--dev-site', devSite);
  for (const f of ['ota-base-url', 'apk-name', 'branch', 'kit-repo', 'backend-repo']) if (flag(f)) initArgs.push(`--${f}`, flag(f));
  if (installBackend) {
    initArgs.push('--bench-site', benchSite);
    if (doBackend) initArgs.push('--bench', bench);
  }
  if (argv.includes('--force')) initArgs.push('--force');
  const log = [plainInit(initArgs, root, { exec: (a) => io.exec(a, { cwd: bench }), lastSteps: false, wiring: wire, backup })];

  // the site line of an existing src/mobile-kit.ts follows a changed answer
  const cfgPath = join(root, 'src/mobile-kit.ts');
  if (existsSync(cfgPath) && !argv.includes('--force')) {
    const cur = readFileSync(cfgPath, 'utf8');
    const next = updateSiteLine(cur, site, devSite);
    if (next && next !== cur && (!prompting || (await io.confirm('src/mobile-kit.ts already exists with other sites. Update its site line?', true)))) {
      backup.save('src/mobile-kit.ts');
      writeFileSync(cfgPath, next);
      log.push('edit   src/mobile-kit.ts (site line updated)');
    }
  }

  if (layoutRel) {
    const layoutPath = join(root, layoutRel);
    const r = wrapLayout(readFileSync(layoutPath, 'utf8'));
    if (r.status === 'wrapped') {
      backup.save(layoutRel);
      writeFileSync(layoutPath, r.source);
      log.push(`edit   ${layoutRel} (import + <MobileKitProvider> added; other lines untouched)`);
    } else if (r.status === 'already') log.push(`skip   ${layoutRel} (already has <MobileKitProvider>)`);
    else log.push(`note   ${layoutRel} was not recognised, so it was left alone. Add this yourself:\n${manualLayoutEdit()}`);
  } else log.push('note   no app/_layout file found. Wrap your root component in <MobileKitProvider>:\n' + manualLayoutEdit());

  // Same step, same words, as the plain flag-driven init: installs what is missing; --no-install or a failure is a loud "incomplete".
  const native = installNativeModules(root, { exec: (a, o) => io.exec(a, o), noInstall, biometric });
  log.push('', ...native.lines, '');

  // What `expo install` really changed.
  const depsAfter = readDeps(root);
  const added = NATIVE_MODULES.filter((m) => !depsBefore[m] && depsAfter[m]);
  const changed = Object.keys(depsBefore)
    .filter((k) => depsAfter[k] && depsAfter[k] !== depsBefore[k])
    .map((k) => [k, depsBefore[k], depsAfter[k]]);
  if (added.length || changed.length) {
    log.push('', 'Dependency changes:');
    for (const m of added) log.push(`  + ${m} ${depsAfter[m]}`);
    for (const [k, a, b] of changed) log.push(`  ~ ${k}: ${a} -> ${b}`);
  }

  saveAnswers(root, {
    site,
    devSite,
    repo: flag('repo') ? repo : saved.repo,
    installBackend,
    bench: installBackend ? bench : saved.bench,
    benchSite: installBackend ? benchSite : saved.benchSite,
    authFile: wire.auth && !detectHost(root).auth ? wire.auth.file : saved.authFile,
    authExport: wire.auth && !detectHost(root).auth ? wire.auth.exportName : saved.authExport,
  });
  log.push(`write  ${SAVED_FILE} (remembered; run init again to change anything)`);

  const doctor = doctorFn ?? (await import('./doctor.mjs')).run;
  let report = '';
  try {
    const d = await doctor(doctorFlags({ site, devSite }), root);
    report = `\nDoctor:\n${d.text}`;
  } catch (e) {
    report = `\nDoctor could not run: ${e.message}\n`;
  }
  log.push(report);

  if (!cfgKept) log.push(wiringReport({ adapters, biometric, hostLocks }), '');
  const expoAfter = readExpo(root);
  const plugins = (e) => (e.plugins ?? []).map((p) => (Array.isArray(p) ? p[0] : p));
  const block = rebuildBlock({
    added,
    changed: changed.filter(([k]) => NATIVE_MODULES.includes(k)),
    pending: native.ok ? [] : missingNow,
    pluginAdded: !plugins(expoBefore).includes('@upande/mobile-kit') && plugins(expoAfter).includes('@upande/mobile-kit'),
    updatesChanged: expoBefore.updates?.url !== expoAfter.updates?.url || expoBefore.runtimeVersion !== expoAfter.runtimeVersion,
  });
  if (block) log.push(block, '');
  log.push(openBlock({ root, route: routes.settings, file: settingsFile }), '', METRO_NOTE);
  if (backup.files.length) log.push('', backupNote(backup));
  log.push('', 'Next:', `  • npx upande-mobile-kit verify   (checks routes, provider, wiring, native modules, sites and cleartext, with a fix per failure)`, '  • enable GitHub Pages for the gh-pages branch of ' + repo + ' once the first release creates it');
  if (!native.ok) log.push('', native.lines[native.lines.length - 1]); // last thing printed, so it cannot be missed
  return `${log.join('\n')}\n`;
}
