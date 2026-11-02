/**
 * Where this package and its backend app live on GitHub. Forks override per run
 * with `--kit-repo` / `--backend-repo`; a value containing REPLACE-ME is refused.
 */
export const KIT_REPO = 'mark-judah/upande-mobile-kit';
export const BACKEND_REPO_URL = 'https://github.com/mark-judah/upande-mobile.git';
export const BACKEND_APP = 'upande_mobile';
import { readFileSync } from 'node:fs';

/** This kit's own version (package.json): the release workflow is pinned to the tag with the same number. */
export const KIT_VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
/** The ref the generated release workflow calls: this exact kit version, never a floating tag. */
export const WORKFLOW_REF = `v${KIT_VERSION}`;

export const isPlaceholder = (value) => /REPLACE-ME/.test(String(value ?? ''));

/** Native modules the kit uses (one list, shared/native-modules.json). Newly added ones need a new native build, which an OTA update cannot deliver. */
export { NAMES as NATIVE_MODULES } from './native-modules.mjs';
