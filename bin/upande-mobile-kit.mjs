#!/usr/bin/env node
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const HELP = `upande-mobile-kit <command>

  init          set this Expo app up: asks a few questions, then does the rest   [--yes] [--no-install]
                (value flags like --site/--dev-site/--bench run the plain, non-interactive init)
  doctor        check the app is set up correctly   [--site https://your.site] [--dev-site http://localhost:8000]
  version       odometer versioning                 [--apply --json --notes --bump --set --keep-version]
  publish-ota   build the JS-only update into ./ota [--out dir]

Run from the app root (the folder with app.json).
`;

const [cmd, ...rest] = process.argv.slice(2);
const cli = join(dirname(fileURLToPath(import.meta.url)), '..', 'cli');
const load = (f) => import(pathToFileURL(join(cli, f)).href);

try {
  if (cmd === 'init') process.stdout.write(await (await load('wizard.mjs')).main(rest));
  else if (cmd === 'version') process.stdout.write((await load('version.mjs')).run(rest));
  else if (cmd === 'publish-ota') (await load('publish-ota.mjs')).run(rest);
  else if (cmd === 'doctor') {
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
