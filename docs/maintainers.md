# For maintainers

Only for people who change the kit itself.

The kit is installed from this repository, so a release is a git tag. Commit to `main`, then from the kit checkout:

```bash
npx upande-mobile-kit release --dry-run   # show what would happen
npx upande-mobile-kit release patch       # patch (default) | minor | major | 1.4.0
npx upande-mobile-kit release --push      # same, and push the branch and the tag
npx upande-mobile-kit release --list      # tags that exist
```

`release` refuses to run on a dirty tree, off `main` (override with `--allow-branch`), or when the tag already exists. It runs typecheck, tests and `check:pack` (skip with `--skip-checks`), sets `"version"` in `package.json`, commits `chore(release): <version>`, and creates the annotated tag `v<version>`. It never pushes unless you pass `--push`, and never moves or replaces a tag. It prints the line apps use to install that version.

- **Tests:** `npm test` runs jest, the web jest config and the CLI tests; `npm run typecheck` runs the type check.
- **Shipping check:** `check:pack` verifies what would be published and also reads `KIT_DENY_PATTERNS` (regexes separated by `;`), so names that must never ship do not have to be written into this repo.
- **Workflows:** the files `init` writes into apps call this repo's reusable `release.yml` and `upgrade.yml`, pinned to the tag with the kit's own version (`WORKFLOW_REF` in `cli/constants.mjs` is `v` plus the version in `package.json`). So every release must be tagged with exactly `v<version>`. Apps move to a new version by merging the upgrade pull request.
- **Publishing:** the package is `"private": false` with public access, so it can be published to npm; installs today use the GitHub tag. A first publish needs an npm account that owns the `@upande` scope.
- **Forks** change `KIT_REPO` and `BACKEND_REPO_URL` in `cli/constants.mjs` and the URLs in `package.json`.
