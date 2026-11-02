import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { ensureGitignore, IGNORE_ENTRIES } from '../../cli/gitignore.mjs';
import { run as realInit } from '../../cli/init.mjs';

const dir = () => mkdtempSync(join(tmpdir(), 'kit-ign-'));
const read = (d) => readFileSync(join(d, '.gitignore'), 'utf8');

test('creates .gitignore with both entries when there is none', () => {
  const d = dir();
  const r = ensureGitignore(d);
  assert.deepEqual(r, { added: IGNORE_ENTRIES, created: true });
  assert.match(read(d), /^# @upande\/mobile-kit.*\nupande-mobile-kit\.json\n\.upande-mobile-kit\/\n$/);
});

test('appends to an existing file without touching its lines, and is idempotent', () => {
  const d = dir();
  writeFileSync(join(d, '.gitignore'), 'node_modules/\n.expo/');
  const first = ensureGitignore(d);
  assert.equal(first.created, false);
  const text = read(d);
  assert.ok(text.startsWith('node_modules/\n.expo/\n\n# @upande/mobile-kit'));
  assert.deepEqual(ensureGitignore(d), { added: [], created: false });
  assert.equal(read(d), text);
});

test('recognises equivalent rules and only adds what is missing', () => {
  const d = dir();
  writeFileSync(join(d, '.gitignore'), '/.upande-mobile-kit/**\n');
  assert.deepEqual(ensureGitignore(d).added, ['upande-mobile-kit.json']);
  const e = dir();
  writeFileSync(join(e, '.gitignore'), '/upande-mobile-kit.json\n.upande-mobile-kit\n');
  assert.deepEqual(ensureGitignore(e), { added: [], created: false });
  const f = dir();
  writeFileSync(join(f, '.gitignore'), '# upande-mobile-kit.json\n');
  assert.deepEqual(ensureGitignore(f).added, IGNORE_ENTRIES); // a comment is not a rule
});

test('keeps CRLF line endings', () => {
  const d = dir();
  writeFileSync(join(d, '.gitignore'), 'dist/\r\n');
  ensureGitignore(d);
  const text = read(d);
  assert.ok(text.includes('\r\nupande-mobile-kit.json\r\n') && !/[^\r]\n/.test(text));
});

test('init writes the entries (flag-driven path), and a second run changes nothing', () => {
  const d = dir();
  writeFileSync(join(d, 'app.json'), JSON.stringify({ expo: { name: 'My App', version: '1.0.0', android: { package: 'com.example.myapp' } } }));
  writeFileSync(join(d, 'package.json'), JSON.stringify({ name: 'my-app', dependencies: {} }));
  const exec = () => {};
  const out = realInit(['--repo', 'acme/my-app', '--site', 'https://erp.example.com', '--no-install'], d, { exec });
  assert.ok(existsSync(join(d, '.gitignore')));
  assert.match(read(d), /upande-mobile-kit\.json/);
  assert.match(read(d), /\.upande-mobile-kit\//);
  assert.match(out, /\.gitignore \(upande-mobile-kit\.json, \.upande-mobile-kit\/\)/);
  const before = read(d);
  const again = realInit(['--repo', 'acme/my-app', '--site', 'https://erp.example.com', '--no-install'], d, { exec });
  assert.equal(read(d), before);
  assert.doesNotMatch(again, /(create|edit)\s+\.gitignore/);
});
