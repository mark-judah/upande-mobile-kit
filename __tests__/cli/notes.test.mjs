import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCommit, releaseNotes, userNotes } from '../../cli/version-lib.mjs';

const commit = (subject, body = '', hash = 'abcdef1234567') => parseCommit({ hash, subject, body });

test('userNotes: Note: and What’s new: lines, any case, several per commit; nothing else', () => {
  assert.deepEqual(userNotes({ body: "Note: Scanning is twice as fast\nsome detail\nwhat's new: You can report from any screen\nNOTES: Shorter login" }), [
    'Scanning is twice as fast',
    'You can report from any screen',
    'Shorter login',
  ]);
  assert.deepEqual(userNotes({ body: 'A note about nothing\nnotebook: no' }), []);
  assert.deepEqual(userNotes({ body: '' }), []);
  assert.deepEqual(userNotes({}), []);
});

test('the release notes lead with a What’s new section built from those lines, above the technical sections', () => {
  const md = releaseNotes('1.3.0', [commit('feat(scan): batch the reads', 'Note: Scanning is twice as fast'), commit('fix: crash on login')], 'v1.2.9', 'o/r');
  const lines = md.split('\n');
  assert.equal(lines[0], '## v1.3.0');
  assert.equal(lines[2], "### What's new");
  assert.equal(lines[4], '- Scanning is twice as fast');
  assert.ok(md.indexOf("### What's new") < md.indexOf('### Features'));
  assert.match(md, /### Features\n\n- \*\*scan:\*\* batch the reads \(abcdef1\)/);
});

test('with no user-facing lines there is no What’s new section', () => {
  assert.doesNotMatch(releaseNotes('1.3.0', [commit('fix: crash on login')], 'v1.2.9', 'o/r'), /What's new/);
});
