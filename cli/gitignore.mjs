/**
 * Keep the kit's local-only files out of git: the remembered wizard answers (they hold a path on this machine)
 * and the backups of files init changed. Idempotent, never reorders or rewrites existing lines, keeps the
 * file's own line endings, and creates .gitignore when there is none.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const IGNORE_ENTRIES = ['upande-mobile-kit.json', '.upande-mobile-kit/'];
const COMMENT = '# @upande/mobile-kit: local answers and backups (not for git)';

/** The same ignore rule, however it was written: `x`, `/x`, `x/`, `/x/`, `x/*`, `x/**`. */
const norm = (line) => line.trim().replace(/^\//, '').replace(/\/\*{1,2}$/, '').replace(/\/$/, '');

/** @returns {{added: string[], created: boolean}} */
export function ensureGitignore(root, entries = IGNORE_ENTRIES) {
  const file = join(root, '.gitignore');
  const existed = existsSync(file);
  const text = existed ? readFileSync(file, 'utf8') : '';
  const have = new Set(text.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith('#')).map(norm));
  const added = entries.filter((e) => !have.has(norm(e)));
  if (!added.length) return { added: [], created: false };
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lead = !existed || text === '' ? '' : text.endsWith('\n') ? eol : eol + eol;
  writeFileSync(file, `${text}${lead}${COMMENT}${eol}${added.join(eol)}${eol}`);
  return { added, created: !existed };
}

/** One line for the init report. */
export const gitignoreNote = ({ added, created }) =>
  added.length ? `${created ? 'create' : 'edit  '} .gitignore (${added.join(', ')})` : '';
