import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const walk = (dir) =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx|js)$/.test(p) ? [p] : [];
  });

// Metro prints a warning on every bundle for a require of a React Native internal path that does not exist in
// the host's React Native version, and internal paths move between versions: never reach into them.
test('src never requires react-native internals (Libraries/...)', () => {
  const root = join(import.meta.dirname, '../../src');
  const bad = walk(root).filter((f) => /['"]react-native\/Libraries\//.test(readFileSync(f, 'utf8')));
  assert.deepEqual(bad, []);
});

// Every relative import (and JSON import) in the shipped source must point at a file the package ships.
test('every relative import in src resolves to a file inside the package files whitelist', () => {
  const root = join(import.meta.dirname, '../..');
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const shipped = (rel) => rel === 'package.json' || pkg.files.some((f) => !f.startsWith('!') && (rel === f || rel.startsWith(f + '/')));
  const exts = ['', '.ts', '.tsx', '.js', '.json', '/index.ts', '/index.tsx', '/index.js'];
  const bad = [];
  for (const file of walk(join(root, 'src'))) {
    for (const m of readFileSync(file, 'utf8').matchAll(/(?:from|import|require\()\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
      const base = join(file, '..', m[1]);
      const hit = exts.map((e) => base + e).find((p) => { try { return statSync(p).isFile(); } catch { return false; } });
      const rel = hit && hit.slice(root.length + 1);
      if (!hit || !shipped(rel)) bad.push(`${file.slice(root.length + 1)} -> ${m[1]}${hit ? ' (not in "files")' : ' (missing)'}`);
    }
  }
  assert.deepEqual(bad, []);
});
