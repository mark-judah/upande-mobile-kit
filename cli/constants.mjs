/**
 * Where this package and its backend app live on GitHub. Forks override per run
 * with `--kit-repo` / `--backend-repo`; a value containing REPLACE-ME is refused.
 */
export const KIT_REPO = 'mark-judah/upande-mobile-kit';
export const BACKEND_REPO_URL = 'https://github.com/mark-judah/upande-mobile.git';
export const BACKEND_APP = 'upande_mobile';
export const WORKFLOW_REF = 'v0';

export const isPlaceholder = (value) => /REPLACE-ME/.test(String(value ?? ''));
