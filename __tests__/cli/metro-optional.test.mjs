import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import ts from 'typescript';

/**
 * A package the app may not have installed can only be `require`d in a shape Metro skips when it is missing: the
 * call must sit directly in a `try` block (at most three statements deep, the rule in Metro's collectDependencies).
 * Any other shape, for example under an `if` or inside an arrow function, fails the WHOLE bundle with "Unable to
 * resolve module" in apps that lack the package. That broke an app's release once.
 */

const root = join(import.meta.dirname, '../..');
const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(e.name) ? [p] : [];
  });

function metroTreatsAsOptional(node) {
  let statements = 0;
  for (let cur = node.parent; cur && statements < 3; cur = cur.parent) {
    if (ts.isBlock(cur)) return !!cur.parent && ts.isTryStatement(cur.parent) && cur.parent.tryBlock === cur && !!cur.parent.catchClause;
    if (ts.isStatement(cur)) statements += 1;
  }
  return false;
}

test('every require of a package (not a relative file) sits directly in a try block', () => {
  const bad = [];
  for (const file of walk(join(root, 'src'))) {
    const src = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const visit = (n) => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'require') {
        const arg = n.arguments[0];
        if (arg && ts.isStringLiteral(arg) && !arg.text.startsWith('.') && !metroTreatsAsOptional(n)) {
          bad.push(`${relative(root, file)}:${src.getLineAndCharacterOfPosition(n.getStart()).line + 1} require('${arg.text}')`);
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(src);
  }
  assert.deepEqual(bad, []);
});

test('the check itself rejects the shapes that broke the build', () => {
  const check = (code) => {
    const sf = ts.createSourceFile('x.ts', code, ts.ScriptTarget.Latest, true);
    let ok;
    const visit = (n) => {
      if (ts.isCallExpression(n) && n.expression.getText(sf) === 'require') ok = metroTreatsAsOptional(n);
      ts.forEachChild(n, visit);
    };
    visit(sf);
    return ok;
  };
  assert.equal(check("function f(){ try { const m = require('a'); return m; } catch { return null; } }"), true);
  assert.equal(check("function f(){ try { return require('a'); } catch { return null; } }"), true);
  assert.equal(check("function f(){ try { if (x) { const m = require('a'); } } catch {} }"), false);
  assert.equal(check("const load = () => require('a');"), false);
  assert.equal(check("function f(){ try { x(); } catch { require('a'); } }"), false);
});
