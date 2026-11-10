#!/usr/bin/env node
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const HELP = `upande-mobile-kit init

  init   set this Expo app up, once: asks a few questions, then does the rest   [--yes] [--no-install]
         (value flags like --site/--dev-site/--bench/--settings-route run the plain, non-interactive init;
          --no-backup skips the copies of changed files, --no-adapters skips wiring your auth/api/storage)

Everything else is automatic: pushes release by themselves (APK or OTA, decided from what changed), and a pull request
upgrades the kit when a new one is out. Settings live in app.json under expo.extra.mobileKit.

Run from the app root (the folder with app.json).

Used by the workflows and kept for them (not part of the day-to-day): fix, verify, doctor, version, publish-ota; and
"release", which tags a release of the kit itself, in the kit repository.
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
