import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { detectHost, detectHostBiometric, buildAdapters, buildAuthAdapter, importPath } from '../../cli/adapters.mjs';
import { backupNote, createBackup } from '../../cli/backup.mjs';
import { NATIVE_MODULES } from '../../cli/constants.mjs';
import { rebuildBlock, run as init } from '../../cli/init.mjs';
import {
  configuredRoutes,
  describeCollision,
  findCollisions,
  findNavigators,
  insertNavEntry,
  linkedFrom,
  navSnippet,
  routeFileFor,
  routeOfFile,
  screenNameFor,
  validateRoute,
} from '../../cli/routes.mjs';
import { reachabilityChecks, sitesFrom } from '../../cli/site-checks.mjs';
import { check as doctor } from '../../cli/doctor.mjs';
import { main } from '../../cli/wizard.mjs';
import { verify } from '../../cli/verify.mjs';

const REPO = join(import.meta.dirname, '..', '..');
const KIT_RE = "export { SettingsRoute as default } from '@upande/mobile-kit';\n";
const ROOT_LAYOUT = `import { Stack } from 'expo-router';

export default function RootLayout() {
  return <Stack />;
}
`;

/** A throwaway Expo app. `files` are written relative to its root. */
function makeApp(files = {}, { expo = {}, deps = {}, git = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'kit-fb-'));
  const w = (rel, body) => {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), typeof body === 'string' ? body : JSON.stringify(body));
  };
  w('app.json', { expo: { name: 'My App', version: '1.0.0', android: { package: 'com.example.myapp' }, ...expo } });
  w('package.json', { name: 'my-app', scripts: {}, dependencies: deps });
  for (const [rel, body] of Object.entries(files)) w(rel, body);
  if (git) {
    execFileSync('git', ['init', '-q'], { cwd: root });
    execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/acme/my-app.git'], { cwd: root });
  }
  return { root, w };
}
const flags = ['--repo', 'acme/my-app', '--site', 'https://erp.example.com'];

/** Scripted prompt layer, same shape as the wizard's own. */
function scripted(answers = [], { interactive = true, exec } = {}) {
  const asked = [];
  const said = [];
  const ran = [];
  const next = () => answers.shift();
  return {
    interactive,
    asked,
    said,
    ran,
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
      exec?.(argv, o);
    },
  };
}
const doctorStub = async () => ({ text: '✓ doctor says fine\n', ok: true });
async function withHome(fn) {
  const old = process.env.HOME;
  process.env.HOME = mkdtempSync(join(tmpdir(), 'kit-home-'));
  try {
    return await fn();
  } finally {
    process.env.HOME = old;
  }
}

/* ───────────── 1. route collisions ───────────── */

test('routeOfFile: groups are transparent, index collapses, special files are not pages', () => {
  assert.equal(routeOfFile('settings.tsx'), '/settings');
  assert.equal(routeOfFile('(tabs)/settings.tsx'), '/settings');
  assert.equal(routeOfFile('(a)/(b)/settings.js'), '/settings');
  assert.equal(routeOfFile('settings/index.tsx'), '/settings');
  assert.equal(routeOfFile('index.tsx'), '/');
  assert.equal(routeOfFile('admin/settings.ts'), '/admin/settings');
  assert.equal(routeOfFile('[id].tsx'), '/[id]');
  for (const f of ['_layout.tsx', '(tabs)/_layout.tsx', '+not-found.tsx', '+html.tsx', 'hello+api.ts', 'styles.css', 'readme.md']) {
    assert.equal(routeOfFile(f), null, f);
  }
});

test('validateRoute accepts plain paths and refuses groups, dynamic segments and junk', () => {
  for (const ok of ['/kit-settings', '/admin/kit_settings', '/a1']) assert.equal(validateRoute(ok), '', ok);
  for (const bad of ['settings', '/', '/(tabs)/x', '/[id]', '/a b', '/a//b', '']) assert.notEqual(validateRoute(bad), '', bad);
});

test('findCollisions: a page in a (tabs) group, a folder index and a folder layout all take the URL', () => {
  const { root } = makeApp({
    'app/(tabs)/settings.tsx': 'export default () => null;',
    'app/devices/index.tsx': 'export default () => null;',
    'app/profile/_layout.tsx': 'export default () => null;',
  });
  assert.deepEqual(findCollisions(root, '/settings').map((c) => c.file), ['app/(tabs)/settings.tsx']);
  assert.deepEqual(findCollisions(root, '/devices').map((c) => c.file), ['app/devices/index.tsx']);
  assert.deepEqual(findCollisions(root, '/profile').map((c) => c.file), ['app/profile/_layout.tsx']);
  assert.deepEqual(findCollisions(root, '/kit-settings'), []);
});

test('findCollisions ignores the kit\'s own files, dynamic routes (static wins), nested paths and special files', () => {
  const { root } = makeApp({
    'app/settings.tsx': KIT_RE,
    'app/[id].tsx': 'export default () => null;',
    'app/settings/[id].tsx': 'export default () => null;',
    'app/+not-found.tsx': 'export default () => null;',
    'app/devices+api.ts': 'export function GET() {}',
  });
  assert.deepEqual(findCollisions(root, '/settings'), []);
  assert.deepEqual(findCollisions(root, '/devices'), []);
});

test('findCollisions also reads src/app when that is where the routes live', () => {
  const { root } = makeApp({ 'src/app/(tabs)/settings.tsx': 'export default () => null;' });
  assert.deepEqual(findCollisions(root, '/settings').map((c) => c.file), ['src/app/(tabs)/settings.tsx']);
  assert.equal(routeFileFor(root, '/kit-settings'), 'src/app/kit-settings.tsx');
});

test('describeCollision names the files and the three ways out, with the flag to pass', () => {
  const msg = describeCollision('/settings', [{ file: 'app/(tabs)/settings.tsx', url: '/settings' }], '--settings-route');
  assert.match(msg, /\/settings is already served by:\n {2}- app\/\(tabs\)\/settings\.tsx/);
  assert.match(msg, /--settings-route \/kit-settings/);
  assert.match(msg, /rename or remove/);
  assert.match(msg, /export \{ SettingsRoute as default \} from '@upande\/mobile-kit'/);
});

test('init stops on a collision BEFORE writing anything, naming the flag', () => {
  const { root } = makeApp({ 'app/(tabs)/settings.tsx': 'export default () => null;', 'app/_layout.tsx': ROOT_LAYOUT });
  assert.throws(() => init(flags, root), /\/settings is already served by:\n\s+- app\/\(tabs\)\/settings\.tsx[\s\S]*--settings-route/);
  for (const f of ['app/devices.tsx', 'src/mobile-kit.ts', '.github/workflows/release.yml']) assert.ok(!existsSync(join(root, f)), `${f} must not exist`);
  assert.equal(readFileSync(join(root, 'app/_layout.tsx'), 'utf8'), ROOT_LAYOUT);
  assert.equal(JSON.parse(readFileSync(join(root, 'app.json'), 'utf8')).expo.plugins, undefined);
});

test('--settings-route / --devices-route write the pages there and set settingsRoute / devicesRoute in the config', () => {
  const { root } = makeApp({ 'app/(tabs)/settings.tsx': 'export default () => null;', 'app/devices/index.tsx': 'export default () => null;' });
  const out = init([...flags, '--settings-route', '/kit-settings', '--devices-route', '/admin/kit-devices'], root);
  assert.ok(existsSync(join(root, 'app/kit-settings.tsx')));
  assert.ok(existsSync(join(root, 'app/admin/kit-devices.tsx')));
  assert.ok(!existsSync(join(root, 'app/settings.tsx')));
  const cfg = readFileSync(join(root, 'src/mobile-kit.ts'), 'utf8');
  assert.match(cfg, /^ {2}settingsRoute: '\/kit-settings',$/m);
  assert.match(cfg, /^ {2}devicesRoute: '\/admin\/kit-devices',$/m);
  assert.deepEqual(configuredRoutes(root), { settings: '/kit-settings', devices: '/admin/kit-devices' });
  assert.match(out, /Open \/kit-settings in the app \(rendered by app\/kit-settings\.tsx\)/);
  // the default paths write no route keys at all
  const { root: plain } = makeApp();
  init(flags, plain);
  assert.doesNotMatch(readFileSync(join(plain, 'src/mobile-kit.ts'), 'utf8'), /^ {2}(settingsRoute|devicesRoute):/m);
});

test('the alternative path is collision-checked too, and must be a valid, different route', () => {
  const { root } = makeApp({ 'app/(tabs)/settings.tsx': 'x', 'app/kit-settings.tsx': 'export default () => null;' });
  assert.throws(() => init([...flags, '--settings-route', '/kit-settings'], root), /\/kit-settings is already served by/);
  assert.throws(() => init([...flags, '--settings-route', 'nope'], root), /--settings-route: A route starts with \//);
  const { root: r2 } = makeApp();
  assert.throws(() => init([...flags, '--settings-route', '/same', '--devices-route', '/same'], r2), /must differ/);
});

test('wizard: on a collision it offers the alternative path (default /kit-settings) and uses it', () =>
  withHome(async () => {
    const { root } = makeApp({ 'app/(tabs)/settings.tsx': 'x', 'app/_layout.tsx': ROOT_LAYOUT });
    // production, dev, [route choice: alt], backend?, native?, auth skip, apply
    const io = scripted(['https://prod.example.com', '', 'alt', false, false, '', true]);
    const out = await main(['--no-install'], root, { io, doctor: doctorStub });
    assert.ok(io.asked.some((q) => /^\/settings is taken\. What now\?/.test(q)));
    assert.ok(existsSync(join(root, 'app/kit-settings.tsx')));
    assert.ok(existsSync(join(root, 'app/devices.tsx')));
    assert.match(readFileSync(join(root, 'src/mobile-kit.ts'), 'utf8'), /settingsRoute: '\/kit-settings'/);
    assert.match(out, /Open \/kit-settings in the app \(rendered by app\/kit-settings\.tsx\)/);
    assert.ok(io.said.some((t) => /Settings at \/kit-settings, Devices at \/devices/.test(t)));
  }));

test('wizard: "type another path" is validated and re-checked; "stop" writes nothing', () =>
  withHome(async () => {
    const { root } = makeApp({ 'app/(tabs)/settings.tsx': 'x', 'app/mine.tsx': 'x' });
    // choice 'type', a taken path, then a bad one, then a free one
    const io = scripted(['https://prod.example.com', '', 'type', '/mine', 'type', 'nope', '/my-settings', false, false, '', true]);
    await main(['--no-install'], root, { io, doctor: doctorStub });
    assert.ok(existsSync(join(root, 'app/my-settings.tsx')));
    assert.ok(io.said.some((t) => /\/mine is already served by/.test(t)));
    assert.ok(io.said.some((t) => /A route starts with \//.test(t)));

    const { root: r2 } = makeApp({ 'app/(tabs)/settings.tsx': 'x' });
    await assert.rejects(
      main(['--no-install'], r2, { io: scripted(['https://prod.example.com', '', 'stop']), doctor: doctorStub }),
      /Stopped before writing anything[\s\S]*\/settings is already served by/,
    );
    assert.ok(!existsSync(join(r2, 'src/mobile-kit.ts')));
  }));

test('wizard --yes on a collision fails with the flags to pass (it never guesses a path)', () =>
  withHome(async () => {
    const { root } = makeApp({ 'app/(tabs)/settings.tsx': 'x' });
    await assert.rejects(
      main(['--yes', '--no-install', '--site', 'https://prod.example.com'], root, { io: scripted([], { interactive: false }), doctor: doctorStub }),
      /--settings-route \/kit-settings/,
    );
    await main(['--yes', '--no-install', '--site', 'https://prod.example.com', '--settings-route', '/kit-settings'], root, { io: scripted([], { interactive: false }), doctor: doctorStub });
    assert.ok(existsSync(join(root, 'app/kit-settings.tsx')));
  }));

test('doctor fails a collision with the fix, and fails a route file that does not re-export the kit', async () => {
  const { root } = makeApp({ 'app/(tabs)/settings.tsx': 'x' });
  init([...flags, '--settings-route', '/kit-settings'], root);
  // now something else grabs /kit-settings too
  writeFileSync(join(root, 'app/(tabs)/kit-settings.tsx'), 'export default () => null;');
  const res = await doctor(root, {});
  const bad = res.find((r) => r.level === 'fail' && /\/kit-settings is also served by app\/\(tabs\)\/kit-settings\.tsx/.test(r.msg));
  assert.ok(bad, JSON.stringify(res.filter((r) => r.level === 'fail')));
  assert.match(bad.msg, /--settings-route/);
  // the kit's own file gone stale (not a re-export)
  const { root: r2 } = makeApp();
  init(flags, r2);
  writeFileSync(join(r2, 'app/devices.tsx'), 'export default () => null;');
  const res2 = await doctor(r2, {});
  assert.ok(res2.some((r) => r.level === 'fail' && /\/devices is also served by app\/devices\.tsx/.test(r.msg)));
});

/* ───────────── 2. make the page findable ───────────── */

const DRAWER = `import { Drawer } from 'expo-router/drawer';

export default function Layout() {
  return (
    <Drawer>
      <Drawer.Screen name="index" options={{ title: 'Home' }} />
      <Drawer.Screen name="orders" options={{ title: 'Orders' }} />
    </Drawer>
  );
}
`;
const TABS = `import { Tabs } from 'expo-router';

export default function TabLayout() {
  return (
    <Tabs screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="index" options={{ title: 'Home' }} />
    </Tabs>
  );
}
`;

test('insertNavEntry adds one line before the closing tag, leaves every other line alone, and is idempotent', () => {
  for (const [src, kind] of [[DRAWER, 'Drawer'], [TABS, 'Tabs']]) {
    const r = insertNavEntry(src, kind, 'settings', 'Settings');
    assert.equal(r.status, 'inserted');
    const before = src.split('\n');
    const after = r.source.split('\n');
    assert.equal(after.length, before.length + 1);
    const added = after.filter((l, i) => l !== before[i - (after.indexOf(l) < i ? 1 : 0)] && !before.includes(l));
    assert.deepEqual(added.map((l) => l.trim()), [`<${kind}.Screen name="settings" options={{ title: 'Settings' }} />`]);
    assert.ok(r.source.includes(`\n      <${kind}.Screen name="settings"`), 'indented like its siblings');
    assert.equal(insertNavEntry(r.source, kind, 'settings').status, 'already');
    assert.equal(insertNavEntry(r.source, kind, 'settings').source, r.source);
  }
});

test('insertNavEntry refuses shapes it does not recognise', () => {
  assert.equal(insertNavEntry("export default () => <Drawer screenOptions={{}} />;", 'Drawer', 'settings').status, 'unrecognised');
  assert.equal(insertNavEntry('<Tabs><Tabs.Screen name="a" /></Tabs>', 'Tabs', 'settings').status, 'unrecognised'); // closing tag not on its own line
  assert.equal(insertNavEntry('<Tabs>\n</Tabs>\n<Tabs>\n</Tabs>', 'Tabs', 'settings').status, 'unrecognised'); // two navigators
});

test('findNavigators / screenNameFor: only a navigator in the kit page\'s own folder can hold it', () => {
  const { root } = makeApp({ 'app/_layout.tsx': DRAWER, 'app/(tabs)/_layout.tsx': TABS });
  const navs = findNavigators(root);
  assert.deepEqual(navs.map((n) => [n.file, n.kind]).sort(), [['app/(tabs)/_layout.tsx', 'Tabs'], ['app/_layout.tsx', 'Drawer']]);
  assert.equal(screenNameFor('app', 'app/settings.tsx'), 'settings');
  assert.equal(screenNameFor('app', 'app/admin/kit-settings.tsx'), 'admin/kit-settings');
  assert.equal(screenNameFor('app/(tabs)', 'app/settings.tsx'), null);
});

test('wizard offers a Settings entry in the Drawer, inserts it with a backup, and says where to open the page', () =>
  withHome(async () => {
    const { root } = makeApp({ 'app/_layout.tsx': DRAWER });
    // production, dev, backend?, native?, auth skip, apply, add nav entry?
    const io = scripted(['https://prod.example.com', '', false, false, '', true, true]);
    const out = await main(['--no-install'], root, { io, doctor: doctorStub });
    assert.ok(io.asked.some((q) => /Add a "Settings" entry to the Drawer in app\/_layout\.tsx\?/.test(q)));
    const layout = readFileSync(join(root, 'app/_layout.tsx'), 'utf8');
    assert.match(layout, /<Drawer\.Screen name="settings" options=\{\{ title: 'Settings' \}\} \/>/);
    assert.match(out, /edit {3}app\/_layout\.tsx \(added a "Settings" Drawer\.Screen entry\)/);
    assert.match(out, /the navigator entry above links to it/);
    const stamp = readdirSync(join(root, '.upande-mobile-kit/backup'))[0];
    assert.equal(readFileSync(join(root, '.upande-mobile-kit/backup', stamp, 'app/_layout.tsx'), 'utf8'), DRAWER);
  }));

test('wizard: declining the navigator entry leaves the layout alone and prints the snippet', () =>
  withHome(async () => {
    const { root } = makeApp({ 'app/_layout.tsx': TABS });
    const io = scripted(['https://prod.example.com', '', false, false, '', true, false]);
    const out = await main(['--no-install'], root, { io, doctor: doctorStub });
    assert.ok(!/name="settings"/.test(readFileSync(join(root, 'app/_layout.tsx'), 'utf8')));
    assert.match(out, /Nothing in your app links to it yet/);
    assert.match(out, /<Tabs\.Screen name="settings"/);
    assert.match(out, /router\.push\('\/settings'\)/);
    assert.match(out, /<Link href="\/settings">/);
  }));

test('plain init prints the open-this-URL block with a snippet; navSnippet names the navigator', () => {
  const { root } = makeApp({ 'app/_layout.tsx': DRAWER });
  const out = init(flags, root);
  assert.match(out, /Open \/settings in the app \(rendered by app\/settings\.tsx\)/);
  assert.match(out, /In app\/_layout\.tsx, inside <Drawer>:\n\s+<Drawer\.Screen name="settings"/);
  assert.match(navSnippet('/kit-settings', { file: 'app/_layout.tsx', kind: 'Tabs', dir: 'app' }), /<Tabs\.Screen name="kit-settings"/);
});

test('linkedFrom finds a link by string, or a navigator screen of that name; the kit\'s own files do not count', () => {
  const { root } = makeApp({
    'app/settings.tsx': KIT_RE,
    'src/mobile-kit.ts': "settingsRoute: '/settings',",
    'app/home.tsx': "router.push('/settings')",
    'app/_layout.tsx': DRAWER.replace('"orders"', '"settings"'),
  });
  assert.deepEqual(linkedFrom(root, '/settings').sort(), ['app/_layout.tsx', 'app/home.tsx']);
  const { root: lone } = makeApp({ 'app/settings.tsx': KIT_RE, 'src/mobile-kit.ts': "settingsRoute: '/settings',", 'app/home.tsx': 'export default () => null;' });
  assert.deepEqual(linkedFrom(lone, '/settings'), []);
});

/* ───────────── 3. wire useAuth / api / storage ───────────── */

const STORE = `type State = {
  roles: string[];
  fullName: string | null;
  email: string | null;
  instanceUrl: string | null;
  biometricEnabled: boolean;
  setBiometricEnabled: (v: boolean) => Promise<void>;
  logout: () => Promise<void>;
  forgetDevice: () => Promise<void>;
};
declare const state: State;
export function useAuthStore<T>(selector: (s: State) => T): T {
  return selector(state);
}
`;
const API = `export async function api<T = unknown>(config: { method: string; url: string; params?: unknown; data?: unknown }): Promise<T> {
  void config;
  return {} as T;
}
`;
const STORAGE = `export const storage = {
  get: async (key: string): Promise<string | null> => (key ? null : null),
  set: async (key: string, value: string): Promise<void> => void (key + value),
  remove: async (key: string): Promise<void> => void key,
};
`;
const HOST = { 'src/core/auth/store.ts': STORE, 'src/core/api/client.ts': API, 'src/core/storage/index.ts': STORAGE };

test('detectHost finds a zustand-style useAuthStore, an api client and a storage module', () => {
  const { root } = makeApp(HOST);
  assert.deepEqual(detectHost(root), {
    auth: { file: 'src/core/auth/store.ts', exportName: 'useAuthStore', mode: 'store' },
    api: { file: 'src/core/api/client.ts', exportName: 'api' },
    storage: { file: 'src/core/storage/index.ts', exportName: 'storage' },
  });
  assert.deepEqual(detectHost(makeApp().root), { auth: null, api: null, storage: null });
  assert.equal(importPath('src/core/storage/index.ts'), './core/storage');
  assert.equal(importPath('src/store/auth.ts'), './store/auth');
  assert.equal(importPath('store/auth.ts'), '../store/auth');
});

test('buildAuthAdapter maps what the store has, leaves the rest unset, and refuses when it cannot tell who is an admin', () => {
  const built = buildAuthAdapter({ source: STORE, exportName: 'useAuthStore', mode: 'store' });
  assert.deepEqual(built.wired, ['roles', 'isSystemManager', 'fullName', 'email', 'instanceUrl', 'biometricEnabled', 'setBiometricEnabled', 'logout', 'forgetDevice']);
  assert.match(built.code, /const roles = useAuthStore\(\(s\) => s\.roles\);/);
  assert.match(built.code, /isSystemManager: \(roles \?\? \[\]\)\.includes\('System Manager'\)/);
  assert.match(built.code, /user: email \?\? null/);
  assert.match(built.code, /await setBiometricEnabled\(enabled\);/);
  const partial = buildAuthAdapter({ source: 'export const useAuthStore = create(() => ({ isSystemManager: false, email: null }));', exportName: 'useAuthStore', mode: 'store' });
  assert.match(partial.code, /biometricEnabled: false,/);
  assert.ok(partial.missing.includes('logout'));
  assert.equal(buildAuthAdapter({ source: 'export const useAuthStore = create(() => ({ token: "" }));', exportName: 'useAuthStore', mode: 'store' }), null);
  const hook = buildAuthAdapter({ source: 'export function useAuth() { return { roles: [], email: "" }; }', exportName: 'useAuth', mode: 'hook' });
  assert.match(hook.code, /const auth = useAuth\(\);\n\s+const roles = auth\.roles;/);
});

test('init wires the app\'s own modules into src/mobile-kit.ts and reports what is wired and what is on stand-ins', () => {
  const { root } = makeApp(HOST);
  const out = init(flags, root);
  const cfg = readFileSync(join(root, 'src/mobile-kit.ts'), 'utf8');
  assert.match(cfg, /import \{ useAuthStore \} from '\.\/core\/auth\/store';/);
  assert.match(cfg, /import \{ api as hostApi \} from '\.\/core\/api\/client';/);
  assert.match(cfg, /import \{ storage as hostStorage \} from '\.\/core\/storage';/);
  assert.match(cfg, /^ {2}api: hostApi,/m);
  assert.match(cfg, /^ {2}storage: hostStorage,/m);
  assert.match(cfg, /^ {2}useAuth: \(\) => \{$/m);
  assert.match(out, /Wiring:\n {2}✓ useAuth <- src\/core\/auth\/store\.ts \(useAuthStore: roles, isSystemManager/);
  assert.match(out, /✓ api <- src\/core\/api\/client\.ts/);
  assert.match(out, /✓ storage <- src\/core\/storage\/index\.ts/);
  assert.doesNotMatch(out, /stand-in/);
  // nothing found: loud about it
  const { root: bare } = makeApp();
  const out2 = init(flags, bare);
  assert.match(out2, /! useAuth runs on the kit's stand-in: sign-out, the biometric switch and the device register are NOT connected to your session/);
  assert.match(out2, /! api runs on the kit's stand-in/);
  assert.match(readFileSync(join(bare, 'src/mobile-kit.ts'), 'utf8'), /\/\/ useAuth: \(\) => \(\{ isSystemManager/);
  // --no-adapters opts out
  const { root: off } = makeApp(HOST);
  init([...flags, '--no-adapters'], off);
  assert.doesNotMatch(readFileSync(join(off, 'src/mobile-kit.ts'), 'utf8'), /hostApi/);
});

test('the generated src/mobile-kit.ts type-checks against the kit\'s own KitApi / KitStorage / KitAuth types', () => {
  const tsc = join(REPO, 'node_modules/typescript/bin/tsc');
  if (!existsSync(tsc)) return;
  const { root } = makeApp(HOST);
  init([...flags, '--settings-route', '/kit-settings'], root);
  // The three types are lifted from the kit's source, so this stays in step with it.
  const cfgSrc = readFileSync(join(REPO, 'src/config.ts'), 'utf8');
  const grab = (re) => {
    const m = re.exec(cfgSrc);
    assert.ok(m, `${re} not found in src/config.ts`);
    return m[0].replace(/^export /, 'export ');
  };
  const types = [
    grab(/export type KitApi = [\s\S]*?Promise<T>;\n/),
    grab(/export type KitStorage = \{[\s\S]*?\n\};\n/),
    grab(/export type KitAuth = \{[\s\S]*?\n\};\n/),
  ].join('\n');
  writeFileSync(
    join(root, 'kit-stub.d.ts'),
    `declare module '@upande/mobile-kit' {\n${types}\n  export function configureMobileKit(config: { appName: string; githubRepo: string; site?: string | { production: string; development?: string }; settingsRoute?: string; devicesRoute?: string; biometric?: 'kit' | 'host'; apk?: unknown; monitor?: unknown; theme?: unknown; api?: KitApi; storage?: KitStorage; useAuth?: () => KitAuth }): void;\n}\n`,
  );
  writeFileSync(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, noEmit: true, skipLibCheck: true, module: 'esnext', moduleResolution: 'bundler', target: 'es2020', types: [] }, include: ['kit-stub.d.ts', 'src/**/*.ts'] }));
  const r = spawnSync('node', [tsc, '-p', root], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('wizard asks for the auth hook when it cannot find it, validates the answer, and remembers it', () =>
  withHome(async () => {
    const { root } = makeApp({ 'src/store/session.ts': STORE.replace('useAuthStore', 'useSession') });
    // production, dev, backend?, native?, [auth file wrong, then right (+ export)], apply
    const io = scripted(['https://prod.example.com', '', false, false, 'src/nope.ts', 'useSession', 'src/store/session.ts', 'useSession', true]);
    const out = await main(['--no-install'], root, { io, doctor: doctorStub });
    assert.ok(io.asked.some((q) => /File exporting your auth store hook/.test(q)));
    assert.ok(io.said.some((t) => /src\/nope\.ts does not exist/.test(t)));
    const cfg = readFileSync(join(root, 'src/mobile-kit.ts'), 'utf8');
    assert.match(cfg, /import \{ useSession \} from '\.\/store\/session';/);
    assert.match(cfg, /useSession\(\(s\) => s\.roles\)/);
    assert.match(out, /✓ useAuth <- src\/store\/session\.ts/);
    assert.match(readFileSync(join(root, 'upande-mobile-kit.json'), 'utf8'), /"authFile": "src\/store\/session\.ts"/);
  }));

test('wizard --yes never asks: unwired parts are listed loudly as stand-ins', () =>
  withHome(async () => {
    const { root } = makeApp();
    const io = scripted([], { interactive: false });
    const out = await main(['--yes', '--no-install', '--site', 'https://prod.example.com'], root, { io, doctor: doctorStub });
    assert.deepEqual(io.asked, []);
    assert.match(out, /! useAuth runs on the kit's stand-in/);
  }));

/* ───────────── 4. biometric ownership ───────────── */

test('detectHostBiometric finds an existing expo-local-authentication lock, ignoring the kit\'s own config', () => {
  const { root } = makeApp({
    'src/core/biometric/index.ts': "import * as LocalAuthentication from 'expo-local-authentication';\nexport const lock = () => LocalAuthentication.authenticateAsync();",
    'src/mobile-kit.ts': "// uses expo-local-authentication? no, the kit does",
  });
  assert.deepEqual(detectHostBiometric(root), ['src/core/biometric/index.ts']);
  assert.deepEqual(detectHostBiometric(makeApp().root), []);
});

test('init writes biometric: \'host\' when the app already locks itself, and says which one owns the lock', () => {
  const { root } = makeApp({ 'src/lock.ts': "import { authenticateAsync } from 'expo-local-authentication';\nexport const lock = authenticateAsync;" });
  const out = init(flags, root);
  assert.match(readFileSync(join(root, 'src/mobile-kit.ts'), 'utf8'), /^ {2}biometric: 'host',/m);
  assert.match(out, /biometric lock: owned by YOUR app \(it uses expo-local-authentication in src\/lock\.ts\); the kit adds no lock and hides its switch/);
  const { root: plain } = makeApp();
  const out2 = init(flags, plain);
  assert.doesNotMatch(readFileSync(join(plain, 'src/mobile-kit.ts'), 'utf8'), /^ {2}biometric:/m);
  assert.match(out2, /biometric lock: owned by the kit/);
  const { root: forced } = makeApp();
  init([...flags, '--biometric', 'host'], forced);
  assert.match(readFileSync(join(forced, 'src/mobile-kit.ts'), 'utf8'), /biometric: 'host'/);
  assert.throws(() => init([...flags, '--biometric', 'both'], makeApp().root), /--biometric must be host or kit/);
});

test('wizard summary states who owns the biometric lock before anything is written', () =>
  withHome(async () => {
    const { root } = makeApp({ 'src/lock.ts': "import * as L from 'expo-local-authentication';\nexport const x = L.authenticateAsync;" });
    const io = scripted(['https://prod.example.com', '', false, false, '', false]); // decline at Apply
    await main(['--no-install'], root, { io, doctor: doctorStub });
    assert.ok(io.said.some((t) => /Biometric lock: owned by YOUR app/.test(t)));
    assert.ok(!existsSync(join(root, 'src/mobile-kit.ts')));
  }));

/* ───────────── 6. needs a native build ───────────── */

test('rebuildBlock lists exactly what needs a native build, and is empty when nothing does', () => {
  assert.equal(rebuildBlock({}), '');
  const b = rebuildBlock({ added: ['expo-device', 'expo-battery'], changed: [['expo-constants', '~17.0.0', '~18.0.0']], pluginAdded: true, updatesChanged: true });
  assert.match(b, /^These changes need a NEW NATIVE BUILD \(an OTA update will not deliver them\):/);
  assert.match(b, /packages added: expo-device, expo-battery/);
  assert.match(b, /expo-constants ~17\.0\.0 -> ~18\.0\.0/);
  assert.match(b, /@upande\/mobile-kit plugin entry/);
  assert.match(b, /expo\.updates\.url and runtimeVersion/);
});

test('wizard ends with the native-build block computed from what expo install really added', () =>
  withHome(async () => {
    const { root } = makeApp({ 'app/_layout.tsx': ROOT_LAYOUT }, { deps: { 'expo-constants': '~17.0.0', react: '19.0.0' } });
    const install = () => {
      const p = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
      p.dependencies['expo-device'] = '~8.0.0';
      p.dependencies['expo-battery'] = '~10.0.0';
      p.dependencies['expo-constants'] = '~18.0.0';
      writeFileSync(join(root, 'package.json'), JSON.stringify(p));
    };
    const io = scripted(['https://prod.example.com', '', false, true, '', true], { exec: (argv) => argv[1] === 'expo' && install() });
    const out = await main([], root, { io, doctor: doctorStub });
    assert.match(out, /Dependency changes:\n {2}\+ expo-device ~8\.0\.0\n {2}\+ expo-battery ~10\.0\.0\n {2}~ expo-constants: ~17\.0\.0 -> ~18\.0\.0/);
    assert.match(out, /These changes need a NEW NATIVE BUILD \(an OTA update will not deliver them\):/);
    assert.match(out, /packages added: expo-device, expo-battery/);
    assert.match(out, /packages whose version changed: expo-constants ~17\.0\.0 -> ~18\.0\.0/);
    assert.match(out, /@upande\/mobile-kit plugin entry/);
    // the summary announced the dependency story before applying
    assert.ok(io.said.some((t) => /expo install adds: .*expo-device/.test(t)));
    assert.ok(io.said.some((t) => /expo install may CHANGE the versions of: expo-constants ~17\.0\.0/.test(t)));
  }));

test('with --no-install the block lists the packages still to install; plain init lists them too', async () => {
  const { root } = makeApp();
  const out = init(flags, root);
  assert.match(out, /NEW NATIVE BUILD/);
  assert.match(out, new RegExp(`still to install \\(expo install adds them\\): ${NATIVE_MODULES[0]}`));
  await withHome(async () => {
    const { root: r2 } = makeApp();
    const text = await main(['--yes', '--no-install', '--site', 'https://prod.example.com'], r2, { io: scripted([], { interactive: false }), doctor: doctorStub });
    assert.match(text, /packages still to install \(expo install adds them\): expo-updates/);
  });
});

/* ───────────── 7. safe to review ───────────── */

test('backups live outside app/ under .upande-mobile-kit/backup/<timestamp>/, once per file', () => {
  const { root } = makeApp({ 'app/_layout.tsx': ROOT_LAYOUT });
  const b = createBackup(root, true, new Date('2026-11-01T10:20:30.456Z'));
  assert.equal(b.relDir, '.upande-mobile-kit/backup/2026-11-01T10-20-30-456Z');
  b.save('app/_layout.tsx');
  writeFileSync(join(root, 'app/_layout.tsx'), 'changed');
  b.save('app/_layout.tsx'); // second save keeps the first copy
  b.save('does/not/exist.ts');
  assert.deepEqual(b.files, ['app/_layout.tsx']);
  assert.equal(readFileSync(join(root, b.relDir, 'app/_layout.tsx'), 'utf8'), ROOT_LAYOUT);
  assert.match(backupNote(b), /Backups of 1 changed file are in \.upande-mobile-kit\/backup\/.*\(outside app\/\)\. Add \.upande-mobile-kit\/ to \.gitignore/);
  assert.equal(backupNote(createBackup(root, false)), '');
});

test('init backs up every existing file it changes, never inside app/; --no-backup writes none', () => {
  const { root } = makeApp({ 'app/_layout.tsx': ROOT_LAYOUT });
  init(flags, root);
  const stamp = readdirSync(join(root, '.upande-mobile-kit/backup'))[0];
  const dir = join(root, '.upande-mobile-kit/backup', stamp);
  assert.equal(readFileSync(join(dir, 'app/_layout.tsx'), 'utf8'), ROOT_LAYOUT);
  assert.ok(existsSync(join(dir, 'app.json')));
  assert.ok(existsSync(join(dir, 'package.json')));
  assert.ok(!readdirSync(join(root, 'app')).some((f) => /\.bak$|backup/i.test(f)), 'nothing backup-like inside app/');
  const { root: nb } = makeApp({ 'app/_layout.tsx': ROOT_LAYOUT });
  const out = init([...flags, '--no-backup'], nb);
  assert.ok(!existsSync(join(nb, '.upande-mobile-kit')));
  assert.doesNotMatch(out, /Backups of/);
  withHome(async () => {
    const { root: w } = makeApp({ 'app/_layout.tsx': ROOT_LAYOUT });
    await main(['--yes', '--no-install', '--no-backup', '--site', 'https://prod.example.com'], w, { io: scripted([], { interactive: false }), doctor: doctorStub });
    assert.ok(!existsSync(join(w, '.upande-mobile-kit')));
  });
});

test('the layout edit adds the import and two tags and leaves every other line untouched (paren form)', () =>
  withHome(async () => {
    const layout = `import { Stack } from 'expo-router';
import { useFonts } from 'expo-font';

export default function RootLayout() {
  const [loaded] = useFonts({});
  if (!loaded) return null;
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
    </Stack>
  );
}
`;
    const { root } = makeApp({ 'app/_layout.tsx': layout });
    await main(['--yes', '--no-install', '--site', 'https://prod.example.com'], root, { io: scripted([], { interactive: false }), doctor: doctorStub });
    const after = readFileSync(join(root, 'app/_layout.tsx'), 'utf8').split('\n');
    const before = layout.split('\n');
    // plain init prepends the config import; the wizard adds the provider import and the two tags; nothing else moves
    const added = after.filter((l) => !before.includes(l) || (l.trim() === '' && false));
    assert.deepEqual(added.map((l) => l.trim()).sort(), ["import '../src/mobile-kit';", "import { MobileKitProvider } from '@upande/mobile-kit';", '<MobileKitProvider>', '</MobileKitProvider>'].sort());
    const rest = after.filter((l) => before.includes(l));
    assert.deepEqual(rest, before);
  }));

/* ───────────── extra.mobileKit.sites ───────────── */

test('init records the sites under expo.extra.mobileKit.sites without disturbing the offsets already there', () => {
  const { root } = makeApp({}, { expo: { extra: { mobileKit: { versionCodeBase: 100000, runtimeMajorBase: 100 }, other: 1 } } });
  init([...flags, '--dev-site', 'http://localhost:8000'], root);
  const extra = JSON.parse(readFileSync(join(root, 'app.json'), 'utf8')).expo.extra;
  assert.deepEqual(extra.mobileKit, { versionCodeBase: 100000, runtimeMajorBase: 100, sites: { production: 'https://erp.example.com', development: 'http://localhost:8000' } });
  assert.equal(extra.other, 1);
  const { root: prodOnly } = makeApp();
  init(flags, prodOnly);
  assert.deepEqual(JSON.parse(readFileSync(join(prodOnly, 'app.json'), 'utf8')).expo.extra.mobileKit.sites, { production: 'https://erp.example.com' });
});

/* ───────────── 8. verify ───────────── */

const ALL_DEPS = Object.fromEntries([...NATIVE_MODULES, 'expo-router', '@upande/mobile-kit'].map((m) => [m, '*']));
const OK_PROBE = async () => ({ status: 204, headers: { get: (k) => (k === 'expo-protocol-version' ? '1' : null) } });

/** A fully set-up app: init, an installed node_modules, a link to the page, an app-owned lock. */
function goodApp({ dev = false } = {}) {
  const { root, w } = makeApp(
    { ...HOST, 'app/_layout.tsx': ROOT_LAYOUT, 'src/lock.ts': "import * as L from 'expo-local-authentication';\nexport const x = L.authenticateAsync;", 'app/home.tsx': "import { router } from 'expo-router';\nrouter.push('/settings');" },
    { deps: ALL_DEPS },
  );
  init([...flags, ...(dev ? ['--dev-site', 'http://localhost:8000'] : [])], root);
  w('app/_layout.tsx', readFileSync(join(root, 'app/_layout.tsx'), 'utf8').replace('<Stack />', '<MobileKitProvider><Stack /></MobileKitProvider>').replace("import '../src/mobile-kit';", "import '../src/mobile-kit';"));
  for (const m of Object.keys(ALL_DEPS)) mkdirSync(join(root, 'node_modules', m), { recursive: true });
  return root;
}

test('verify: a fully set-up app has no failures and every line is ✓/!/✗ with a fix on the non-✓ ones', async () => {
  const root = goodApp();
  const res = await verify(root, { fetchImpl: OK_PROBE });
  assert.deepEqual(res.filter((r) => r.level === 'fail'), [], JSON.stringify(res.filter((r) => r.level === 'fail')));
  assert.deepEqual(res.filter((r) => r.level === 'warn').map((r) => r.msg), []);
  for (const r of res.filter((x) => x.level !== 'ok')) assert.ok(r.fix, r.msg);
  assert.ok(res.some((r) => r.level === 'ok' && /route \/settings -> app\/settings\.tsx/.test(r.msg)));
  assert.ok(res.some((r) => r.level === 'ok' && /production site OTA endpoint answers 204/.test(r.msg)));
  assert.ok(res.some((r) => r.level === 'ok' && /biometric lock is owned by your app/.test(r.msg)));
});

test('verify: route collision, missing provider, config not first, stand-ins and two locks each fail or warn with a fix', async () => {
  const root = goodApp();
  writeFileSync(join(root, 'app/(tabs)-settings-placeholder.tsx'), '');
  mkdirSync(join(root, 'app/(tabs)'), { recursive: true });
  writeFileSync(join(root, 'app/(tabs)/devices.tsx'), 'export default () => null;');
  writeFileSync(join(root, 'app/_layout.tsx'), "import { Stack } from 'expo-router';\nimport '../src/mobile-kit';\nexport default function L() {\n  return <Stack />;\n}\n");
  writeFileSync(join(root, 'src/mobile-kit.ts'), "import { configureMobileKit } from '@upande/mobile-kit';\nconfigureMobileKit({ appName: 'My App', githubRepo: 'acme/my-app', site: 'https://erp.example.com' });\n");
  writeFileSync(join(root, 'app/home.tsx'), 'export default () => null;');
  const res = await verify(root, { fetchImpl: OK_PROBE });
  const by = (re) => res.find((r) => re.test(r.msg));
  assert.equal(by(/route \/devices is also served by app\/\(tabs\)\/devices\.tsx/).level, 'fail');
  assert.match(by(/route \/devices is also served by/).fix, /--devices-route \/kit-devices/);
  assert.equal(by(/does not mount <MobileKitProvider>/).level, 'fail');
  assert.equal(by(/imports the kit config, but not first/).level, 'warn');
  assert.equal(by(/config: useAuth is on the kit's stand-in/).level, 'warn');
  assert.equal(by(/config: api is on the kit's stand-in/).level, 'warn');
  assert.equal(by(/two biometric locks/).level, 'warn');
  assert.match(by(/two biometric locks/).fix, /biometric: 'host'/);
  assert.equal(by(/nothing in your app links to \/settings/).level, 'warn');
  for (const r of res.filter((x) => x.level !== 'ok')) assert.ok(r.fix, r.msg);
});

test('verify: native modules missing from package.json or node_modules are reported with the install command and the rebuild note', async () => {
  const root = goodApp();
  const p = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  delete p.dependencies['expo-device'];
  delete p.dependencies['expo-updates'];
  writeFileSync(join(root, 'package.json'), JSON.stringify(p));
  const res = await verify(root, { fetchImpl: OK_PROBE });
  const dev = res.find((r) => /expo-device is not installed: Battery\/device info unavailable/.test(r.msg));
  assert.equal(dev.level, 'warn');
  assert.match(dev.fix, /npx expo install expo-device, then make a new native build/);
  const upd = res.find((r) => /expo-updates is missing from package\.json/.test(r.msg));
  assert.equal(upd.level, 'fail');
  assert.match(upd.fix, /npx expo install expo-updates/);
  // listed but not installed
  const root2 = goodApp();
  execFileSync('rm', ['-rf', join(root2, 'node_modules/expo-network')]);
  const res2 = await verify(root2, { fetchImpl: OK_PROBE });
  assert.ok(res2.some((r) => r.level === 'fail' && /expo-network is in package\.json but not installed/.test(r.msg) && r.fix === 'npm install'));
});

test('verify: an http dev site needs cleartext on Android (and an ATS exception on iOS); .local names never resolve from phones', async () => {
  const sites = { production: 'https://erp.example.com', development: 'http://localhost:8000' };
  // the kit plugin + extra.mobileKit.sites covers the host
  const covered = reachabilityChecks({ plugins: ['@upande/mobile-kit'], extra: { mobileKit: { sites } } }, sites);
  assert.ok(covered.some((r) => r.level === 'ok' && /Android cleartext traffic is enabled for localhost \(by the kit plugin; needs a new native build\)/.test(r.msg)));
  assert.ok(!covered.some((r) => r.level === 'fail'));
  // nothing enables it
  const bare = reachabilityChecks({}, sites);
  const fail = bare.find((r) => r.level === 'fail');
  assert.match(fail.msg, /Android blocks http:\/\/ traffic, so the app cannot reach localhost/);
  assert.match(fail.fix, /expo\.extra\.mobileKit\.sites/);
  assert.match(fail.fix, /usesCleartextTraffic/);
  // expo-build-properties does it too
  assert.ok(!reachabilityChecks({ plugins: [['expo-build-properties', { android: { usesCleartextTraffic: true } }]] }, sites).some((r) => r.level === 'fail'));
  // iOS only when the app has an iOS config
  const ios = reachabilityChecks({ ios: { bundleIdentifier: 'x' }, plugins: [['expo-build-properties', { android: { usesCleartextTraffic: true } }]] }, sites);
  assert.match(ios.find((r) => r.level === 'fail').msg, /iOS \(App Transport Security\) blocks http:\/\/ to localhost/);
  const iosOk = reachabilityChecks({ ios: { infoPlist: { NSAppTransportSecurity: { NSAllowsLocalNetworking: true } } }, plugins: [['expo-build-properties', { android: { usesCleartextTraffic: true } }]] }, sites);
  assert.ok(!iosOk.some((r) => r.level === 'fail'));
  // https needs nothing; an http production site is a warning on top
  assert.deepEqual(reachabilityChecks({}, { production: 'https://erp.example.com' }).map((r) => r.level), ['ok']);
  assert.ok(reachabilityChecks({ plugins: ['@upande/mobile-kit'], extra: { mobileKit: { sites: { production: 'http://erp.example.com' } } } }, { production: 'http://erp.example.com' }).some((r) => r.level === 'warn' && /production site erp\.example\.com uses plain http/.test(r.msg)));
  // .local
  const local = reachabilityChecks({}, { production: 'https://erp.example.com', development: 'http://dev-box.local:8000' });
  const l = local.find((r) => /\.local/.test(r.msg));
  assert.equal(l.level, 'warn');
  assert.match(l.fix, /computer's LAN IP/);
  assert.match(l.fix, /bench use <site>/);
});

test('sitesFrom: flags win, then app.json extra.mobileKit.sites, then the site line of src/mobile-kit.ts', () => {
  const { root } = makeApp({ 'src/mobile-kit.ts': "configureMobileKit({\n  site: { production: 'https://a.example.com', development: 'http://localhost:8000' },\n});" });
  assert.deepEqual(sitesFrom(root, {}, {}), { production: 'https://a.example.com', development: 'http://localhost:8000' });
  assert.deepEqual(sitesFrom(root, {}, { extra: { mobileKit: { sites: { production: 'https://b.example.com' } } } }), { production: 'https://b.example.com', development: undefined });
  assert.deepEqual(sitesFrom(root, { site: 'https://c.example.com' }, {}), { production: 'https://c.example.com', development: undefined });
  const { root: one } = makeApp({ 'src/mobile-kit.ts': "configureMobileKit({\n  site: 'https://d.example.com',\n});" });
  assert.deepEqual(sitesFrom(one, {}, {}), { production: 'https://d.example.com' });
});

test('verify probes both sites; an http dev site without cleartext fails the run, and an unreachable dev site only warns', async () => {
  const root = goodApp({ dev: true });
  const app = JSON.parse(readFileSync(join(root, 'app.json'), 'utf8'));
  app.expo.plugins = []; // the kit plugin (which covers cleartext) is gone
  writeFileSync(join(root, 'app.json'), JSON.stringify(app));
  const seen = [];
  const res = await verify(root, {
    fetchImpl: async (url) => {
      seen.push(url);
      if (url.startsWith('http://localhost')) throw new Error('ECONNREFUSED');
      return OK_PROBE();
    },
  });
  assert.equal(seen.length, 2);
  assert.ok(res.some((r) => r.level === 'fail' && /Android blocks http:\/\/ traffic/.test(r.msg)));
  assert.ok(res.some((r) => r.level === 'warn' && /could not reach the development site/.test(r.msg)));
  assert.ok(!res.some((r) => r.level === 'fail' && /could not reach/.test(r.msg)));
});

test('verify via the binary: one line per check, a fix on every ✗ and !, exit code 1 on a failure', () => {
  const bin = join(REPO, 'bin/upande-mobile-kit.mjs');
  const { root } = makeApp({}, { deps: { '@upande/mobile-kit': '*' } });
  const r = spawnSync('node', [bin, 'verify'], { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 1);
  const lines = r.stdout.split('\n').filter((l) => /^[✓!✗] /.test(l));
  assert.ok(lines.length >= 8, r.stdout);
  for (const l of lines.filter((x) => !x.startsWith('✓'))) assert.match(l, / — fix: /, l);
  assert.match(r.stdout, /\d+ failed, \d+ to look at, \d+ fine\./);
  assert.match(execFileSync('node', [bin, '--help'], { encoding: 'utf8' }), /verify {8}self-test/);
});

test('buildAdapters with nothing found leaves the config hints and lists the three stand-ins', () => {
  const { root } = makeApp();
  const a = buildAdapters({ root });
  assert.deepEqual(a.standIns, ['api', 'storage', 'useAuth'].sort((x, y) => ['useAuth', 'api', 'storage'].indexOf(x) - ['useAuth', 'api', 'storage'].indexOf(y)));
  assert.deepEqual(a.imports, []);
  assert.ok(a.hints.some((h) => /useAuth/.test(h)));
});
