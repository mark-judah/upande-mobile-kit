import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  detectPackageManager,
  findBenches,
  listBenchSites,
  loadSaved,
  main,
  manualLayoutEdit,
  NATIVE_MODULES,
  SAVED_FILE,
  saveAnswers,
  updateSiteLine,
  wrapLayout,
} from '../../cli/wizard.mjs';

const ROOT_LAYOUT = `import { Stack } from 'expo-router';

export default function RootLayout() {
  return <Stack />;
}
`;

/** A parent folder holding the app (with a git origin) and, optionally, a sibling bench. */
function workspace({ bench = true, layout = ROOT_LAYOUT, origin = 'https://github.com/acme/my-app.git' } = {}) {
  const parent = mkdtempSync(join(tmpdir(), 'kit-wiz-'));
  const root = join(parent, 'my-app');
  mkdirSync(join(root, 'app'), { recursive: true });
  writeFileSync(join(root, 'app.json'), JSON.stringify({ expo: { name: 'My App', version: '1.0.0', android: { package: 'com.example.myapp' } } }));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'my-app', scripts: {}, dependencies: {} }));
  if (layout !== null) writeFileSync(join(root, 'app/_layout.tsx'), layout);
  if (origin) {
    execFileSync('git', ['init', '-q'], { cwd: root });
    execFileSync('git', ['remote', 'add', 'origin', origin], { cwd: root });
  }
  let benchDir = '';
  if (bench) {
    benchDir = join(parent, 'frappe-bench');
    mkdirSync(join(benchDir, 'sites/localhost'), { recursive: true });
    mkdirSync(join(benchDir, 'sites/assets'), { recursive: true });
    mkdirSync(join(benchDir, 'sites/other.local'), { recursive: true });
    writeFileSync(join(benchDir, 'sites/apps.txt'), 'frappe\n');
    writeFileSync(join(benchDir, 'sites/localhost/site_config.json'), '{}');
    writeFileSync(join(benchDir, 'sites/other.local/site_config.json'), '{}');
  }
  return { parent, root, benchDir };
}

/** Scripted prompt layer. `undefined` / '' = the person pressed Enter. */
function scripted(answers = [], { interactive = true } = {}) {
  const asked = [];
  const ran = [];
  const said = [];
  const next = () => answers.shift();
  return {
    interactive,
    asked,
    ran,
    said,
    say: (t = '') => said.push(t),
    ask: async (q, def = '') => {
      asked.push(q);
      const a = next();
      return a === undefined || a === '' ? def : a;
    },
    confirm: async (q, def = true) => {
      asked.push(q);
      const a = next();
      return a === undefined ? def : a;
    },
    choose: async (q, options, def = 0) => {
      asked.push(q);
      const a = next();
      return a === undefined ? options[def].value : typeof a === 'number' ? options[a].value : a;
    },
    exec: (argv, o = {}) => {
      ran.push({ argv, cwd: o.cwd });
    },
  };
}

const doctor = async () => ({ text: '✓ doctor says fine\n', ok: true });

/** HOME points at an empty folder so a real ~/frappe-bench never leaks into a test. */
async function withHome(fn) {
  const old = process.env.HOME;
  process.env.HOME = mkdtempSync(join(tmpdir(), 'kit-home-'));
  try {
    return await fn();
  } finally {
    process.env.HOME = old;
  }
}

/* ── the wizard ── */

test('wizard happy path: asks the few questions, then writes, wraps the layout, installs and runs doctor', () =>
  withHome(async () => {
    const { root, benchDir } = workspace();
    // production, dev, install backend?, which bench (1st), which site (default), native?, apply?
    const io = scripted(['https://prod.example.com/', 'http://localhost:8000', true, 0, undefined, true, '', true]);
    const out = await main([], root, { io, doctor });

    assert.deepEqual(io.asked.map((q) => q.split(/[?(:]/)[0].trim()), [
      'Production site URL',
      'Local/dev site URL',
      'Install the Frappe backend',
      'Which bench',
      'Which bench site',
      'Install the native modules',
      'File exporting your auth store hook, e.g. src/store/auth.ts',
      'Apply',
    ]);
    const cfg = readFileSync(join(root, 'src/mobile-kit.ts'), 'utf8');
    assert.match(cfg, /site: \{ production: 'https:\/\/prod\.example\.com', development: 'http:\/\/localhost:8000' \}/);
    for (const f of ['app/mobile-kit/settings.tsx', 'app/mobile-kit/devices.tsx', '.github/workflows/release.yml']) assert.ok(existsSync(join(root, f)), f);

    const layout = readFileSync(join(root, 'app/_layout.tsx'), 'utf8');
    assert.match(layout, /import \{ MobileKitProvider \} from '@upande\/mobile-kit';/);
    assert.match(layout, /<MobileKitProvider>\s*<Stack \/>\s*<\/MobileKitProvider>/);
    // the original is kept OUTSIDE app/ (a backup next to a layout would become a route)
    assert.ok(!existsSync(join(root, 'app/_layout.tsx.bak')));
    const stamp = readdirSync(join(root, '.upande-mobile-kit/backup'))[0];
    assert.equal(readFileSync(join(root, '.upande-mobile-kit/backup', stamp, 'app/_layout.tsx'), 'utf8'), ROOT_LAYOUT);
    assert.ok(existsSync(join(root, '.upande-mobile-kit/backup', stamp, 'app.json')));
    assert.match(out, /Backups of \d+ changed files are in \.upande-mobile-kit\/backup\//);

    const cmds = io.ran.map((r) => r.argv.join(' '));
    assert.ok(cmds.includes(`npx expo install ${NATIVE_MODULES.join(' ')}`), cmds.join('\n'));
    assert.ok(cmds.some((c) => /^bench get-app https:\/\/github\.com\/mark-judah\/upande-mobile\.git$/.test(c)));
    assert.ok(cmds.some((c) => c === 'bench --site localhost install-app upande_mobile'));
    assert.ok(cmds.some((c) => /^bench --site localhost execute upande_mobile\.api\.register_app --kwargs /.test(c)));
    assert.equal(io.ran.find((r) => r.argv[0] === 'bench').cwd, benchDir);
    assert.equal(io.ran.find((r) => r.argv[1] === 'expo').cwd, root);

    assert.match(out, /Doctor:\n✓ doctor says fine/);
    assert.match(out, /Open \/mobile-kit\/settings in the app \(rendered by app\/mobile-kit\/settings\.tsx\)/);
    assert.deepEqual(loadSaved(root), {
      site: 'https://prod.example.com',
      devSite: 'http://localhost:8000',
      installBackend: true,
      bench: benchDir,
      benchSite: 'localhost',
      installNative: true,
    });
  }));

test('running it again is Enter, Enter, Enter: remembered answers are the defaults and nothing is broken', () =>
  withHome(async () => {
    const { root, benchDir } = workspace();
    await main([], root, { io: scripted(['https://prod.example.com', 'http://localhost:8000', true, 0, undefined, false, '', true]), doctor });
    const before = readFileSync(join(root, 'src/mobile-kit.ts'), 'utf8');
    const layout = readFileSync(join(root, 'app/_layout.tsx'), 'utf8');

    const io = scripted([]); // Enter all the way
    const out = await main([], root, { io, doctor });
    assert.equal(readFileSync(join(root, 'src/mobile-kit.ts'), 'utf8'), before);
    assert.equal(readFileSync(join(root, 'app/_layout.tsx'), 'utf8'), layout, 'layout is not wrapped twice');
    assert.match(out, /already has <MobileKitProvider>/);
    assert.match(out, /skip   src\/mobile-kit\.ts/);
    const saved = loadSaved(root);
    assert.equal(saved.site, 'https://prod.example.com');
    assert.equal(saved.devSite, 'http://localhost:8000');
    assert.equal(saved.bench, benchDir);
    assert.equal(saved.installNative, false, 'the remembered "no" is the next default');
    assert.ok(io.ran.every((r) => r.argv[0] !== 'npx'), 'native modules were declined last time');
  }));

test('an invalid URL is explained and asked again', () =>
  withHome(async () => {
    const { root } = workspace({ bench: false });
    const io = scripted(['not a url', 'ftp://nope', 'https://prod.example.com', '', false, false, '', true]);
    await main([], root, { io, doctor });
    assert.equal(io.asked.filter((q) => q.startsWith('Production site URL')).length, 3);
    assert.ok(io.said.some((t) => /not a URL/.test(t)));
    assert.match(readFileSync(join(root, 'src/mobile-kit.ts'), 'utf8'), /site: 'https:\/\/prod\.example\.com'/);
    assert.equal(loadSaved(root).devSite, undefined, 'a blank dev site is not remembered');
  }));

test('the production site is required; blank is refused and asked again', () =>
  withHome(async () => {
    const { root } = workspace({ bench: false });
    const io = scripted(['', 'https://prod.example.com', '', false, false, '', true]);
    await main([], root, { io, doctor });
    assert.equal(io.asked.filter((q) => q.startsWith('Production site URL')).length, 2);
    assert.ok(io.said.some((t) => /required/.test(t)));
  }));

test('declining "Apply?" writes nothing at all', () =>
  withHome(async () => {
    const { root } = workspace();
    const io = scripted(['https://prod.example.com', '', false, false, '', false]);
    const out = await main([], root, { io, doctor });
    assert.equal(out, 'Nothing was changed.\n');
    assert.ok(!existsSync(join(root, 'src/mobile-kit.ts')));
    assert.ok(!existsSync(join(root, SAVED_FILE)));
    assert.equal(readFileSync(join(root, 'app/_layout.tsx'), 'utf8'), ROOT_LAYOUT);
    assert.deepEqual(io.ran, []);
  }));

test('a missing GitHub origin is asked for, and validated', () =>
  withHome(async () => {
    const { root } = workspace({ origin: '', bench: false });
    const io = scripted(['nonsense', 'acme/my-app', 'https://prod.example.com', '', false, false, '', true]);
    await main([], root, { io, doctor });
    assert.ok(io.asked[0].startsWith('GitHub repo'));
    assert.ok(io.said.some((t) => /owner\/repo/.test(t)));
    assert.match(readFileSync(join(root, 'src/mobile-kit.ts'), 'utf8'), /githubRepo: 'acme\/my-app'/);
  }));

test('without a terminal and without --yes it fails at once, naming the flags to pass', () =>
  withHome(async () => {
    const { root } = workspace();
    const io = scripted([], { interactive: false });
    await assert.rejects(main([], root, { io, doctor }), (e) => {
      assert.match(e.message, /needs a terminal/);
      assert.match(e.message, /init --yes --site https:\/\/your\.site/);
      assert.match(e.message, /--dev-site/);
      return true;
    });
    assert.deepEqual(io.asked, []);
    assert.ok(!existsSync(join(root, 'src/mobile-kit.ts')));
  }));

test('--yes asks nothing: flags, remembered answers and detected values do everything (--no-install runs nothing)', () =>
  withHome(async () => {
    const { root } = workspace({ bench: false });
    const io = scripted([], { interactive: false });
    const out = await main(['--yes', '--no-install', '--site', 'https://prod.example.com', '--dev-site', 'http://localhost:8000'], root, { io, doctor });
    assert.deepEqual(io.asked, []);
    assert.deepEqual(io.ran, []);
    assert.match(readFileSync(join(root, 'src/mobile-kit.ts'), 'utf8'), /development: 'http:\/\/localhost:8000'/);
    assert.match(readFileSync(join(root, 'app/_layout.tsx'), 'utf8'), /<MobileKitProvider>/);
    assert.match(out, /next   npx expo install/);
    assert.match(out, /bench get-app/, 'the backend commands are printed, not run');
    assert.equal(loadSaved(root).site, 'https://prod.example.com');

    // second run: remembered, so no flags needed
    const again = await main(['--yes', '--no-install'], root, { io: scripted([], { interactive: false }), doctor });
    assert.match(again, /already has <MobileKitProvider>/);
  }));

test('--yes without any site fails with the flag to pass', () =>
  withHome(async () => {
    const { root } = workspace({ bench: false });
    await assert.rejects(main(['--yes', '--no-install'], root, { io: scripted([], { interactive: false }), doctor }), /Production site URL.*Pass it as a flag/);
    assert.ok(!existsSync(join(root, 'src/mobile-kit.ts')));
  }));

test('--yes with a bench flag installs the backend there; the bench site defaults from the dev host', () =>
  withHome(async () => {
    const { root, benchDir } = workspace();
    const io = scripted([], { interactive: false });
    await main(['--yes', '--site', 'https://prod.example.com', '--dev-site', 'http://localhost:8000', '--bench', benchDir], root, { io, doctor });
    const cmds = io.ran.map((r) => r.argv.join(' '));
    assert.ok(cmds.includes('bench --site localhost install-app upande_mobile'), cmds.join('\n'));
  }));

test('value flags without --yes still run the plain, non-interactive init (no prompts, no layout edit)', () =>
  withHome(async () => {
    const { root } = workspace({ bench: false });
    const out = await main(['--site', 'https://prod.example.com'], root); // no io: it must not even create one
    assert.match(out, /Last steps/);
    assert.equal(readFileSync(join(root, 'app/_layout.tsx'), 'utf8').includes('<MobileKitProvider>'), false);
    assert.ok(!existsSync(join(root, SAVED_FILE)));
  }));

test('the package manager from the lockfile is passed to expo install', () =>
  withHome(async () => {
    const { root } = workspace({ bench: false });
    writeFileSync(join(root, 'pnpm-lock.yaml'), '');
    const io = scripted(['https://prod.example.com', '', false, true, '', true]);
    await main([], root, { io, doctor });
    const expo = io.ran.find((r) => r.argv[1] === 'expo').argv;
    assert.deepEqual(expo.slice(0, 4), ['npx', 'expo', 'install', '--pnpm']);
  }));

test('a failed native install is reported with the command, not fatal', () =>
  withHome(async () => {
    const { root } = workspace({ bench: false });
    const io = scripted(['https://prod.example.com', '', false, true, '', true]);
    io.exec = () => {
      throw new Error('network down');
    };
    const out = await main([], root, { io, doctor });
    assert.match(out, /did not install \(network down\)\. Run: npx expo install/);
    assert.ok(existsSync(join(root, SAVED_FILE)));
  }));

test('an unrecognised root layout is left untouched and the exact edit is printed', () =>
  withHome(async () => {
    const odd = "import { Slot } from 'expo-router';\nconst Layout = () => <Slot />;\nexport default Layout;\n";
    const { root } = workspace({ bench: false, layout: odd });
    const out = await main(['--yes', '--no-install', '--site', 'https://prod.example.com'], root, { io: scripted([], { interactive: false }), doctor });
    assert.equal(readFileSync(join(root, 'app/_layout.tsx'), 'utf8'), "import '../src/mobile-kit';\n" + odd);
    assert.ok(!existsSync(join(root, 'app/_layout.tsx.bak')));
    assert.match(out, /was not recognised, so it was left alone/);
    assert.ok(out.includes(manualLayoutEdit()));
  }));

test('doctor failing to run does not undo the setup', () =>
  withHome(async () => {
    const { root } = workspace({ bench: false });
    const out = await main(['--yes', '--no-install', '--site', 'https://prod.example.com'], root, {
      io: scripted([], { interactive: false }),
      doctor: async () => {
        throw new Error('boom');
      },
    });
    assert.match(out, /Doctor could not run: boom/);
    assert.ok(existsSync(join(root, 'src/mobile-kit.ts')));
  }));

test('re-running with a new site updates the site line of an existing src/mobile-kit.ts', () =>
  withHome(async () => {
    const { root } = workspace({ bench: false });
    await main(['--yes', '--no-install', '--site', 'https://prod.example.com'], root, { io: scripted([], { interactive: false }), doctor });
    await main(['--yes', '--no-install', '--site', 'https://prod.example.com', '--dev-site', 'http://localhost:8000'], root, { io: scripted([], { interactive: false }), doctor });
    assert.match(readFileSync(join(root, 'src/mobile-kit.ts'), 'utf8'), /site: \{ production: 'https:\/\/prod\.example\.com', development: 'http:\/\/localhost:8000' \},/);
  }));

/* ── the layout codemod ── */

test('wrapLayout: the expo-router default', () => {
  const r = wrapLayout(ROOT_LAYOUT);
  assert.equal(r.status, 'wrapped');
  // `return <Stack />;` has to move onto its own line; everything else is untouched
  assert.equal(
    r.source,
    `import { Stack } from 'expo-router';
import { MobileKitProvider } from '@upande/mobile-kit';

export default function RootLayout() {
  return (
    <MobileKitProvider>
      <Stack />
    </MobileKitProvider>
  );
}
`,
  );
});

/** The lines the edit added, and whether every other line is exactly as it was. */
function diffOf(before, after) {
  const a = before.split('\n');
  const b = after.split('\n');
  const added = [];
  let i = 0;
  for (const line of b) {
    if (a[i] === line) i += 1;
    else added.push(line.trim());
  }
  return { added, untouched: i === a.length };
}

test('wrapLayout: a fragment root in parentheses, hooks and an early return', () => {
  const src = `import '../src/mobile-kit';
import { Stack } from 'expo-router';
import { useFonts } from 'expo-font';

export default function RootLayout() {
  const [loaded] = useFonts({});
  if (!loaded) return null;
  const fn = () => { return 1; };
  return (
    <>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
      </Stack>
    </>
  );
}
`;
  const r = wrapLayout(src);
  assert.equal(r.status, 'wrapped');
  // minimal edit: no line is re-indented or reformatted; exactly the import and the two tags are new
  const d = diffOf(src, r.source);
  assert.equal(d.untouched, true);
  assert.deepEqual(d.added, ["import { MobileKitProvider } from '@upande/mobile-kit';", '<MobileKitProvider>', '</MobileKitProvider>']);
  assert.match(r.source, /return \(\n    <MobileKitProvider>\n    <>\n/);
  assert.match(r.source, /<\/>\n    <\/MobileKitProvider>\n  \);\n}/);
  assert.match(r.source, /if \(!loaded\) return null;/);
  assert.match(r.source, /import \{ useFonts \} from 'expo-font';\nimport \{ MobileKitProvider \}/);
  assert.equal((r.source.match(/<MobileKitProvider>/g) ?? []).length, 1);
});

test('wrapLayout: a named function exported at the end, and a multi-line import before it', () => {
  const src = `import {
  Stack,
  Slot,
} from 'expo-router';

function RootLayout() {
  return <Slot />;
}

export default RootLayout;
`;
  const r = wrapLayout(src);
  assert.equal(r.status, 'wrapped');
  assert.match(r.source, /\} from 'expo-router';\nimport \{ MobileKitProvider \}/);
  assert.match(r.source, /<MobileKitProvider>\s*<Slot \/>\s*<\/MobileKitProvider>/);
});

test('wrapLayout: already wrapped is left as it is, and wrapping twice changes nothing more', () => {
  const once = wrapLayout(ROOT_LAYOUT);
  const twice = wrapLayout(once.source);
  assert.equal(twice.status, 'already');
  assert.equal(twice.source, once.source);
  const mine = "export default function L() {\n  return <MobileKitProvider><Stack /></MobileKitProvider>;\n}\n";
  assert.deepEqual(wrapLayout(mine), { status: 'already', source: mine });
});

test('wrapLayout: shapes it does not understand come back untouched', () => {
  for (const src of [
    "const Layout = () => <Stack />;\nexport default Layout;\n", // arrow component
    'export default function L() {\n  return null;\n}\n', // not JSX
    'export default function L() {\n  return <Stack />;\n', // unbalanced
    'export const x = 1;\n', // no component
    'export default function L() {\n  doSomething();\n}\n', // no return
  ]) {
    const r = wrapLayout(src);
    assert.equal(r.status, 'unrecognised', src);
    assert.equal(r.source, src);
  }
});

/* ── detection helpers ── */

test('findBenches finds this folder or a parent, ~/frappe-bench, and siblings; ignores folders without sites/apps.txt', () => {
  const root = mkdtempSync(join(tmpdir(), 'kit-find-'));
  const mk = (rel, bench = true) => {
    mkdirSync(join(root, rel, 'sites'), { recursive: true });
    if (bench) writeFileSync(join(root, rel, 'sites/apps.txt'), 'frappe\n');
    return join(root, rel);
  };
  const home = mk('home', false);
  const homeBench = mk('home/frappe-bench');
  const named = mk('home/my-bench');
  mk('home/not-a-bench-folder', false);
  const proj = mk('work', false);
  const sibling = mk('work/erp');
  mkdirSync(join(proj, 'app'), { recursive: true });
  const parentBench = mk('up');
  mkdirSync(join(parentBench, 'apps/myapp'), { recursive: true });

  const found = findBenches({ cwd: join(proj, 'app'), home });
  assert.ok(found.includes(sibling));
  assert.ok(found.includes(homeBench));
  assert.ok(found.includes(named));
  assert.ok(!found.some((f) => f.endsWith('not-a-bench-folder')));
  assert.equal(new Set(found).size, found.length, 'no duplicates');

  assert.equal(findBenches({ cwd: join(parentBench, 'apps/myapp'), home })[0], parentBench, 'a parent that is a bench comes first');
  assert.deepEqual(findBenches({ cwd: join(root, 'home'), home: join(root, 'nowhere') }).filter((b) => b === homeBench), []);
});

test('listBenchSites lists folders holding site_config.json, not assets', () => {
  const { benchDir } = workspace();
  assert.deepEqual(listBenchSites(benchDir), ['localhost', 'other.local']);
  assert.deepEqual(listBenchSites(join(benchDir, 'missing')), []);
});

test('remembered answers round trip and drop empty values', () => {
  const root = mkdtempSync(join(tmpdir(), 'kit-saved-'));
  assert.deepEqual(loadSaved(root), {});
  saveAnswers(root, { site: 'https://a.example.com', devSite: '', bench: undefined, installNative: false });
  assert.deepEqual(loadSaved(root), { site: 'https://a.example.com', installNative: false });
  writeFileSync(join(root, SAVED_FILE), 'not json');
  assert.deepEqual(loadSaved(root), {}, 'a damaged file is ignored, not fatal');
  assert.ok(!/secret|token|password/i.test(JSON.stringify(loadSaved(root))));
});

test('detectPackageManager reads the lockfile', () => {
  assert.equal(detectPackageManager(mkdtempSync(join(tmpdir(), 'kit-pm-'))), null);
  for (const [file, pm] of [['package-lock.json', 'npm'], ['yarn.lock', 'yarn'], ['bun.lockb', 'bun'], ['bun.lock', 'bun'], ['pnpm-lock.yaml', 'pnpm']]) {
    const root = mkdtempSync(join(tmpdir(), 'kit-pm-'));
    writeFileSync(join(root, file), '');
    assert.equal(detectPackageManager(root), pm, file);
  }
});

test('updateSiteLine rewrites the generated site line only', () => {
  const src = "configureMobileKit({\n  appName: 'A',\n  site: 'https://old.example.com', // note\n  // site: 'commented',\n});\n";
  assert.match(updateSiteLine(src, 'https://p.example.com', 'http://localhost:8000'), /^  site: \{ production: 'https:\/\/p\.example\.com', development: 'http:\/\/localhost:8000' \},$/m);
  assert.match(updateSiteLine(src, 'https://p.example.com', ''), /^  site: 'https:\/\/p\.example\.com',$/m);
  assert.equal(updateSiteLine('no site here', 'https://p.example.com', ''), null);
});
