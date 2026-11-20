**English** | [简体中文](../publishing.md)

# Publishing Guide

This guide covers plugin directory structure, manifest fields, version bumping, platform targets, drafts, and revocation. The authoritative schema is [`plugin.schema.json`](../../packages/ztools-plugins-spec/plugin.schema.json).

After a PR is merged, the official team publishes approved plugins to the plugin marketplace.

## Plugin Directory

Each plugin lives in its own directory named after its plugin ID:

```text
extensions/<id>/
├── plugin.json        Manifest
├── package.json       Minimal metadata such as { "type": "module" }; no dependencies
├── tsconfig.json      TypeScript config
├── icon.svg           Icon (svg / png / jpg / webp / ico)
├── screenshots/       Optional store detail screenshots (PNG); see Screenshots
├── src/               Source code
├── tests/             Tests (*.test.mjs)
└── README.md          Plugin documentation
```

`dist/` is generated at build time and must not be committed—CI builds from source. `npm run create-plugin` scaffolds this exact layout; see [Getting Started](getting-started.md).

## Manifest Fields

### Required Fields

| Field | Description |
| --- | --- |
| `id` | Plugin ID: starts with a lowercase letter, uses only lowercase letters, digits, and hyphens, length 2–64, matches directory name, unique across the repo. Never change after publication |
| `name` | Display name, max 50 characters |
| `version` | Semver `major.minor.patch` (e.g., `1.2.0`), optional prerelease suffix such as `-beta.1`. See [Versioning](#versioning) |
| `description` | One-line summary of what the plugin does, max 500 characters |
| `author` | Plugin author. Official plugins use `ZTools Team`; community plugins should use a GitHub username or real team name without `ZTools Community`. Accepts a string or `{ "name": "...", "email": "...", "url": "..." }`. See [Author Attribution](#author-attribution) |
| `category` | Marketplace categories array (1–2 items, primary first): `办公效率`, `系统工具`, `文件管理`, `图像媒体`, `开发工具`, `网络工具`, `安全隐私` |
| `entry` | Compiled entry point, typically `dist/index.js`. Must be a relative path inside the plugin directory |
| `icon` | Relative path to the icon file, e.g. `icon.svg` |
| `permissions` | Required permissions (see [API Reference · Permissions](api.md#permissions)); use `[]` if none |
| `targets` | Supported platforms; see [Platform Targets](#platform-targets) |
| `nativeComponents` | Always `[]` for declarative plugins |

### Common Optional Fields

| Field | Description |
| --- | --- |
| `mode` | `view` (default, has UI) or `no-view` (headless command returning a status message) |
| `features` | Multi-command plugins: array of `{ "code": "...", "explain": "Command Name" }` with optional `mode`, `icon`, `alias`. Export matching functions by `code` from the entry module—see [API Reference · Entry Structure](api.md#entry-structure) |
| `alias` | Short search alias, max 32 characters |
| `keywords` | Additional search keywords array |
| `draft` / `draftReason` | Draft status; see [Drafts](#drafts) |
| `revoked` / `revokedReason` | Revocation status; see [Revocation](#revocation) |
| `minAppVersion` | Minimum ZTools client version; see [Minimum Client Version](#minimum-client-version) |
| `screenshots` | Marketplace detail screenshots; see [Screenshots](#screenshots) |

Other schema fields (such as `homepage` or `license`) may not be consumed by the client; verify actual support before relying on them.

## Author Attribution

`author` identifies who authored or maintains the plugin, independent of open-source status or who reviews and publishes it.

- **Official plugins**: Use `ZTools Team` and are registered by maintainers in `packages/ztools-plugins-spec/official-ids.json`. The marketplace's official badge is driven solely by that list.
- **Independent community submissions**: Use your GitHub username (e.g., `"author": "octocat"`) or your real team/organization name. Do not write `ZTools Community`, `ZTools Community / octocat`, or leave the scaffold placeholder `ZTools Developer`.
- **Contributing to existing plugins**: Keep the original `author` when fixing bugs, adding features, or adding platform support; contributions are credited via PR and Git history. Maintainer handoffs require confirmation from the original author and maintainers.

During review, maintainers verify attribution against the submitter's GitHub account or declared team. Third-party works must preserve original attribution and license notices. Review, merge, and publication by the ZTools team does not transfer authorship to the official team.

Official names (`ZTools`, `ZTools Team`, `ZTools 官方`, `Official`, etc.) are reserved for plugins in `official-ids.json` and are rejected by CI outside that list.

## Versioning

**You must bump `version` whenever modifying an existing plugin**, or pre-merge CI will fail.

Why: release archives are named `<id>-<version>.zip` and cached on CDN for 30 days. Changing contents under the same version causes clients to download stale cached packages and fail checksum verification.

Rules:

| Change | Version Bump Required? |
| --- | --- |
| Any file in the plugin directory other than `.md`, `.txt`, or `LICENSE` (source, manifest, icon, tests) | Yes—`major.minor.patch` must strictly increase (changing only a prerelease suffix does not count) |
| Only `.md`, `.txt`, or `LICENSE` inside the plugin directory | No |
| Marking a plugin as revoked (`revoked: true`) | No |
| Editing shared source in `extensions/shared/` | Every plugin copying that file must sync its copy and bump `version` |
| Editing shared tooling (`scripts/`, `packages/`, workflows) | All plugins are re-verified, no version bump required |

New plugins start at `1.0.0`.

## Platform Targets

`targets` declares which operating systems a plugin supports. The client hides unsupported plugins, and the marketplace displays "Cross-platform", "Windows only", or "macOS only" accordingly.

**Declare only platforms you have actually tested.** Plugins relying on Windows-only commands or APIs must list Windows only, and vice versa for macOS.

Cross-platform:

```json
"targets": [
  { "id": "windows-electron-any", "platform": "windows", "runtime": "electron", "arch": "any" },
  { "id": "macos-electron-any", "platform": "macos", "runtime": "electron", "arch": "any" }
]
```

Keep only the relevant entry for single-platform plugins. `npm run create-plugin` generates this via `--platform cross` / `windows` / `macos`.

## Minimum Client Version

When a user's client is older than `minAppVersion` in the catalog, the marketplace withholds updates and prompts the user to upgrade ZTools before installing.

You rarely need to set this manually: the release script scans compiled `dist/` code for newer host APIs and infers the minimum version using `packages/ztools-plugins-spec/src/host-requirements.js`. If your plugin depends on a new capability not yet in that table, specify `minAppVersion` (e.g., `"1.1.8.3"`) in `plugin.json`; the higher of the two is used. (`minZToolsVersion` refers to the plugin API version and is not used for client install gating.)

When a plugin uses a newer API that can safely fall back on older clients (e.g., falling back from `LocalStorage.updateItem` to read-then-write), prefer handling compatibility in the plugin (see `extensions/shared/host-compat.ts`) so older clients can still receive updates.

## Screenshots

Optional screenshots displayed on the client and website plugin detail pages (up to 5):

```json
"screenshots": [
  { "path": "screenshots/01.png", "title": "Instant expression evaluation" },
  { "path": "screenshots/02.png", "title": "Calculation history" }
]
```

- Place files under `screenshots/` inside the plugin directory; `path` must be relative with no `..` or absolute paths.
- PNG only (verified by file header, not extension), max 1 MB each, width 640–2560 px, height 400–1600 px.
- `title` is an optional one-line caption (max 60 characters).
- Must show the real UI of the current version in light theme, with zero personal data (no real names, accounts, local paths, private IPs, etc.—use synthetic sample data).

Screenshots are not bundled into the plugin `.zip`. During release they are uploaded to CDN under `<author>/<id>/screenshots/<version>/` and linked in the catalog with dimensions and captions. Updating screenshots counts as a plugin change and requires a version bump; unreferenced files in `screenshots/` are neither published nor allowed in the repo.

## Drafts

To merge work-in-progress code (e.g., placeholder data or incomplete actions) without publishing it, add:

```json
"draft": true,
"draftReason": "Real data source is not wired yet; currently renders sample items"
```

Draft plugins are still built, scanned, and tested in CI, but skipped during packaging and omitted from the marketplace catalog. Remove both fields and bump `version` when ready to ship.

## Revocation

**Never delete a plugin directory.** Deleting it leaves installed users unnotified and is blocked by pre-merge CI.

To retire a plugin, keep its directory and add:

```json
"revoked": true,
"revokedReason": "Upstream service has shut down; use xxx instead"
```

`revokedReason` is shown to installed users—explain why and suggest an alternative. Once revoked:

- The catalog retains only a revocation record and stops serving downloads;
- Clients automatically disable installed copies on the next catalog refresh;
- CI skips building, scanning, and testing the plugin.

## Shared Source

Files in `extensions/shared/` (`hash.ts`, `native-ipc.ts`, `volume-ipc.ts`, `host-compat.ts`, `qr-encoder.ts`) are **copied** into individual plugins' `src/` directories. Each copy must match `extensions/shared/` byte-for-byte, or compilation fails.

When updating shared source: edit the canonical file in `extensions/shared/`, copy it to every plugin that uses it, and bump those plugins' versions. `extensions/shared/test-harness.mjs` is imported directly via relative path in tests and does not need to be copied.

## Pre-Merge Checks

PR CI runs `scripts/verify-changed-plugins.mjs` (see [What CI Checks](review.md#what-ci-checks)). Run the exact same check locally:

```bash
# Fetch upstream main to refs/remotes/upstream/main (works in forks too)
git fetch https://github.com/ZToolsTeam/ZTools-extensions.git main:refs/remotes/upstream/main
node scripts/verify-changed-plugins.mjs --base refs/remotes/upstream/main

# Or verify every plugin
node scripts/verify-changed-plugins.mjs --all
```

- The script determines affected plugins from **committed diffs** between the base ref and `HEAD`, while building, scanning, and testing the working tree. Commit your changes and keep the working tree clean before running.
- `npm test` runs the same script against `origin/main` (only suitable when `origin` points to the upstream repo).

## Release Pipeline

After a PR is merged, the official team publishes updates to the plugin marketplace. The release pipeline:

1. Compiles all plugins from source;
2. Scans and packages each into `<id>-<version>.zip` and computes its SHA-256 digest;
3. Generates the catalog (excluding drafts and keeping revocation records for revoked plugins) and uploads packages, screenshots, and catalog to CDN.

If any single plugin fails to build or scan, the entire release aborts and the live catalog remains untouched. Once published, clients pick up new versions on the next catalog refresh.
