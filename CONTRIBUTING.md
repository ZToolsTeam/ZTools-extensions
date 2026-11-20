**English** | [简体中文](CONTRIBUTING.zh-CN.md)

# Contributing Guide

Issues and Pull Requests that improve plugins or developer tooling are welcome. If this is your first plugin, start with [Getting Started](docs/en/getting-started.md).

## Pre-Submit Checklist

- [ ] Plugin lives in `extensions/<id>/`, directory name matches `plugin.json` `id`, and the ID is unique across the repository.
- [ ] `author` follows [Author Attribution](docs/en/publishing.md#author-attribution): use your GitHub username (or real team name) for new community plugins without `ZTools Community`; preserve the original author when contributing to an existing plugin.
- [ ] Committed `src/`, manifest, icon, and tests; excluded `dist/`, local machine paths, credentials, and build caches.
- [ ] UI uses only `@ztools/declarative-ui` components and passes all 6 items in the [UI Guidelines Pre-Submit Checklist](docs/en/ui-guidelines.md#pre-submit-checklist).
- [ ] Declared only required permissions and documented each permission's purpose in the PR ([Permissions](docs/en/api.md#permissions)).
- [ ] `targets` lists only platforms actually tested, and normal, empty, and error states were verified in the real ZTools client on each target OS ([Try in ZTools](docs/en/getting-started.md#7-try-it-in-the-ztools-client)).
- [ ] Bumped `version` when modifying an existing plugin; marked unfinished work with `draft`; used `revoked` instead of deleting a plugin directory ([Publishing Guide](docs/en/publishing.md)).
- [ ] Any file copied from `extensions/shared/` matches the original verbatim.
- [ ] All local checks below pass.

See [Review Standards](docs/en/review.md) for what maintainers check during review.

## Local Verification

For a single plugin during development:

```bash
node scripts/build-declarative.mjs <id>
node scripts/scan-plugin-security.mjs extensions/<id>
node --test extensions/<id>/tests/*.test.mjs
```

After committing to your branch, run the same pre-merge checks that CI runs:

```bash
# Fetch upstream main to refs/remotes/upstream/main (works in forks too)
git fetch https://github.com/ZToolsTeam/ZTools-extensions.git main:refs/remotes/upstream/main
node scripts/verify-changed-plugins.mjs --base refs/remotes/upstream/main
node --test packages/ztools-plugins-spec/tests/*.test.mjs
```

`verify-changed-plugins.mjs` inspects committed diffs only—commit your changes and keep the working tree clean before running it. See [Pre-Merge Checks](docs/en/publishing.md#pre-merge-checks).

## Submitting a Pull Request

Fill out the PR template: what changed, affected plugins, tested platforms, checks executed, and why each permission is needed. Once approved and merged by maintainers, the official team publishes the release to the plugin marketplace.

If your PR modifies shared tooling (`scripts/`, `packages/`), CI re-verifies every plugin—clearly describe the blast radius in your PR. For desktop client bugs, submit them to the [ZTools repository](https://github.com/ZToolsTeam/ZTools).
