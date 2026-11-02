#!/usr/bin/env node
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const HELP = `upande-mobile-kit <command>

  init          set this Expo app up: asks a few questions, then does the rest   [--yes] [--no-install]
                (value flags like --site/--dev-site/--bench/--settings-route run the plain, non-interactive init;
                 --no-backup skips the copies of changed files, --no-adapters skips wiring your auth/api/storage)
  fix           install/repair the native modules the kit needs (SDK-aware, via expo install)   [--dry-run] [--align] [--yes]
  verify        self-test: routes, provider, wiring, native modules, sites; a fix per failure   [--site ...] [--dev-site ...]
  doctor        check the app is set up correctly   [--site https://your.site] [--dev-site http://localhost:8000]
  version       odometer versioning                 [--apply --json --notes --bump --set --keep-version]
  release       tag a release of the KIT itself (run in the kit repo)   [patch|minor|major|x.y.z] [--push --dry-run --list --skip-checks]
  publish-ota   build the JS-only update into ./ota [--out dir]

Run from the app root (the folder with app.json); "release" runs in the kit repository.
`;

const [cmd, ...rest] = process.argv.slice(2);
const cli = join(dirname(fileURLToPath(import.meta.url)), '..', 'cli');
const load = (f) => import(pathToFileURL(join(cli, f)).href);

try {
  if (cmd === 'init') process.stdout.write(await (await load('wizard.mjs')).main(rest));
  else if (cmd === 'version') process.stdout.write((await load('version.mjs')).run(rest));
  else if (cmd === 'release') process.stdout.write((await load('release.mjs')).run(rest));
  else if (cmd === 'publish-ota') (await load('publish-ota.mjs')).run(rest);
  else if (cmd === 'fix') {
    const { text, ok } = (await load('fix.mjs')).run(rest);
    process.stdout.write(text);
    process.exitCode = ok ? 0 : 1;
  } else if (cmd === 'verify') {
    const { text, ok } = await (await load('verify.mjs')).run(rest);
    process.stdout.write(text);
    process.exitCode = ok ? 0 : 1;
  } else if (cmd === 'doctor') {
    const { text, ok } = await (await load('doctor.mjs')).run(rest);
    process.stdout.write(text);
    process.exitCode = ok ? 0 : 1;
  } else {
    process.stdout.write(HELP);
    process.exitCode = cmd && cmd !== '--help' && cmd !== '-h' ? 1 : 0;
  }
} catch (err) {
  process.stderr.write(`upande-mobile-kit ${cmd ?? ''}: ${err.message}\n`);
  process.exitCode = 1;
}
