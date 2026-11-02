/**
 * Copies of the files init is about to change, kept OUTSIDE the routes folder
 * (a backup next to a layout would itself become a route):
 * `.upande-mobile-kit/backup/<timestamp>/<same relative path>`.
 */
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const BACKUP_ROOT = '.upande-mobile-kit/backup';

export function createBackup(root, enabled = true, now = new Date()) {
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const relDir = `${BACKUP_ROOT}/${stamp}`;
  const saved = [];
  return {
    enabled,
    relDir,
    /** Save the current copy of `rel` once; a file that does not exist yet has nothing to save. */
    save(rel) {
      if (!enabled || saved.includes(rel)) return;
      const from = join(root, rel);
      if (!existsSync(from)) return;
      mkdirSync(dirname(join(root, relDir, rel)), { recursive: true });
      copyFileSync(from, join(root, relDir, rel));
      saved.push(rel);
    },
    get files() {
      return [...saved];
    },
  };
}

/** The line init prints when something was backed up. */
export const backupNote = (b) =>
  b.files.length
    ? `Backups of ${b.files.length} changed file${b.files.length === 1 ? '' : 's'} are in ${b.relDir}/ (outside app/, and listed in .gitignore). Delete it once you have reviewed the diff.`
    : '';
