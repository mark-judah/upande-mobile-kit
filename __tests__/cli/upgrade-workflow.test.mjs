import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { WORKFLOW_REF } from '../../cli/constants.mjs';
import { renderCaller, renderUpgradeCaller, updateWorkflow, UPGRADE_FILE, WORKFLOW_FILE } from '../../cli/workflow.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const yaml = await import('yaml').then((m) => m.default ?? m).catch(() => null); // dev-only parser: the parse tests skip without it
const reusable = yaml ? yaml.parse(readFileSync(join(ROOT, '.github/workflows/upgrade.yml'), 'utf8')) : null;

test('the caller is valid YAML, runs weekly and by hand, and calls the kit workflow at the installed version', { skip: !yaml }, () => {
  const text = renderUpgradeCaller();
  assert.ok(!text.includes('__'), 'every placeholder is filled');
  const c = yaml.parse(text);
  assert.equal(c.on.schedule.length, 1);
  assert.ok('workflow_dispatch' in c.on);
  assert.deepEqual(c.permissions, { contents: 'write', 'pull-requests': 'write' });
  assert.equal(c.jobs.upgrade.uses, `mark-judah/upande-mobile-kit/.github/workflows/upgrade.yml@${WORKFLOW_REF}`);
  assert.equal(c.jobs.upgrade.secrets, 'inherit');
});

test('the reusable workflow finds a newer tag, installs it by name, repairs native modules and opens a PR', { skip: !yaml }, () => {
  assert.ok(reusable.on.workflow_call);
  const steps = reusable.jobs.upgrade.steps;
  const names = steps.map((s) => s.name ?? s.uses);
  assert.deepEqual(names.slice(2), [
    'Find the newest kit release', 'Install the new kit', 'Install or remove the native modules the new kit needs',
    'Move the workflow pins', 'Open the pull request',
  ]);
  const text = JSON.stringify(steps);
  assert.match(text, /git ls-remote --tags --refs/);
  assert.match(text, /npm install --no-audit --no-fund \\"github:/);
  assert.match(text, /upande-mobile-kit fix --yes/);
  assert.match(text, /peter-evans\/create-pull-request@v7/);
  // nothing happens when the app is already on the newest tag
  for (const s of steps.slice(3)) assert.match(s.if, /steps\.kit\.outputs\.upgrade == 'true'/);
  // the pins move only when a token that may edit workflow files exists
  assert.match(steps.find((s) => s.name === 'Move the workflow pins').if, /HAS_TOKEN == 'true'/);
});

function app() {
  const dir = mkdtempSync(join(tmpdir(), 'kit-upg-'));
  mkdirSync(join(dir, '.github/workflows'), { recursive: true });
  writeFileSync(join(dir, WORKFLOW_FILE), renderCaller({ appName: 'My App', apkName: 'my_app', ref: 'v0.1.0' }));
  return dir;
}

test('update-workflow adds the upgrade caller to an app that has none, pins it, and is idempotent', () => {
  const dir = app();
  const out = updateWorkflow(dir, ['--no-backup']);
  assert.match(out, /create \.github\/workflows\/upgrade-kit\.yml/);
  assert.equal(readFileSync(join(dir, UPGRADE_FILE), 'utf8'), renderUpgradeCaller());
  assert.match(readFileSync(join(dir, WORKFLOW_FILE), 'utf8'), new RegExp(`release\\.yml@${WORKFLOW_REF}`));
  assert.match(updateWorkflow(dir, ['--no-backup']), /already up to date/);
});

test('update-workflow moves an old upgrade pin to the installed version and keeps a backup', () => {
  const dir = app();
  writeFileSync(join(dir, UPGRADE_FILE), renderUpgradeCaller({ ref: 'v0.1.0' }));
  const out = updateWorkflow(dir, []);
  assert.match(out, /update \.github\/workflows\/upgrade-kit\.yml/);
  assert.equal(readFileSync(join(dir, UPGRADE_FILE), 'utf8'), renderUpgradeCaller());
  assert.ok(existsSync(join(dir, '.upande-mobile-kit/backup')));
});
