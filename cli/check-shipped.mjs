/**
 * Pre-publish gate: lists exactly what `npm pack` would ship and fails if any
 * file contains a hostname that is not on the allow-list, an email address,
 * or something shaped like a credential. This package goes to public npm:
 * everything site-specific must come from configureMobileKit().
 *
 * Names this repo must never contain (a company, a customer, a person) are not
 * written here, because this file is public too. Put them in the environment:
 *
 *   KIT_DENY_PATTERNS='acme-internal;someone'   regexes, separated by ;
 *
 *   node cli/check-shipped.mjs         (npm run check:pack)
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);

/** Hosts that may appear in shipped text. */
export const ALLOWED_HOSTS = new Set([
  'github.com',
  'api.github.com',
  'docs.expo.dev',
  'expo.dev',
  'npmjs.com',
  'www.npmjs.com',
  'example.com',
  'example.invalid',
  'your.site',
  'localhost',
  '10.0.2.2', // the Android emulator's alias for the host machine
  'schemas.android.com',
]);

/** Shapes that must never ship (matched case-insensitively). */
export const FORBIDDEN = [
  [/[\w-]+\.github\.io\/[\w-]+/i, 'a concrete GitHub Pages URL'],
  [/\b(?!dev@upande\.com\b)[\w.+-]+@(?!example\.(?:com|org|net|invalid)\b)[A-Za-z0-9-]+\.[A-Za-z.-]+/, 'email address'],
  [/\b(?!10\.0\.2\.2\b)(?:10|192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d+\.\d+(?:\.\d+)?\b/, 'private IP address'],
  [/[\w-]+\.local\b(?![\w.])/, 'local dev host (name.local)'],
  [/\bghp_[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}/, 'GitHub token'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'AWS key id'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key'],
  [/\bBearer\s+[A-Za-z0-9._-]{20,}/, 'bearer token'],
  [/\b(?:api[_-]?key|api[_-]?secret|secret[_-]?key)\s*[:=]\s*['"][^'"\s]{8,}['"]/i, 'credential assignment'],
  [/['"][0-9a-f]{32,}['"]/i, 'long hex literal (key/secret shaped)'],
];

/** Extra deny patterns from KIT_DENY_PATTERNS (regex sources separated by `;`). */
export function denyPatternsFromEnv(value = process.env.KIT_DENY_PATTERNS) {
  return String(value ?? '')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((src) => [new RegExp(src, 'i'), 'matches KIT_DENY_PATTERNS']);
}

/** Problems found in one file's text. */
export function scanText(file, text, extra = []) {
  const problems = [];
  for (const [re, what] of [...FORBIDDEN, ...extra]) {
    const m = re.exec(text);
    if (m) problems.push(`${file}: ${what} → ${JSON.stringify(m[0].slice(0, 60))}`);
  }
  for (const m of text.matchAll(/https?:\/\/([A-Za-z0-9.-]+)/g)) {
    const host = m[1].toLowerCase().replace(/\.$/, '');
    if (!ALLOWED_HOSTS.has(host) && !/^<|^\$/.test(host)) problems.push(`${file}: host not on the allow-list → ${host}`);
  }
  return problems;
}

export function shippedFiles(root = ROOT) {
  const out = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return JSON.parse(out)[0].files.map((f) => f.path);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  const files = shippedFiles();
  const extra = denyPatternsFromEnv();
  const problems = [];
  for (const f of files) {
    if (/^(?:\.env|.*\.(?:pem|key|keystore|jks|p12))$/i.test(f)) problems.push(`${f}: credential-like file name`);
    let text;
    try {
      text = readFileSync(resolve(ROOT, f), 'utf8');
    } catch {
      continue;
    }
    if (text.includes('\u0000')) continue;
    problems.push(...scanText(f, text, extra));
  }
  console.log(`${files.length} files would be published.`);
  if (problems.length) {
    console.error(problems.join('\n'));
    process.exit(1);
  }
  console.log(`No stray hostnames, emails or credentials found in the shipped files${extra.length ? ` (plus ${extra.length} custom pattern${extra.length === 1 ? '' : 's'})` : ''}.`);
}
