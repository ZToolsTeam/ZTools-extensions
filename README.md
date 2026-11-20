<p align="center">
  <img src="assets/ztools-logo.png" width="96" alt="ZTools Logo">
</p>

<h1 align="center">ZTools Extensions</h1>

<p align="center">Plugin source code and developer tooling for ZTools</p>

<p align="center">
  <strong>English</strong> | <a href="README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <a href="https://www.ztools.cn">Website</a> ·
  <a href="https://github.com/ZToolsTeam/ZTools/releases">Download ZTools</a> ·
  <a href="https://github.com/ZToolsTeam/ZTools">Client Source</a> ·
  <a href="https://github.com/ZToolsTeam/ZTools-extensions/issues">Plugin Issues</a>
</p>

This repository hosts:

- Source code for ZTools plugins (with built-in English & Simplified Chinese localization support)
- The SDK, scaffolding, build, and security verification scripts for developing plugins

Plugins declare their UI with `List`, `Detail`, `Form`, `ActionPanel`, and related primitives, while the ZTools desktop client handles rendering, theming, and system capabilities.

> **Just want to install plugins?**
>
> Download the desktop client from [ZTools Releases](https://github.com/ZToolsTeam/ZTools/releases) and install plugins directly from the in-app marketplace.
>
> Presence of plugin source code in this repository does not mean it is published in the marketplace yet; the in-app marketplace catalog is the source of truth.

## Build Your First Plugin in 5 Minutes

With Node.js 24 and Git installed:

```bash
git clone https://github.com/ZToolsTeam/ZTools-extensions.git
cd ZTools-extensions
npm ci --ignore-scripts

# Scaffold extensions/my-tool/ (a runnable starter plugin)
npm run create-plugin -- my-tool "My Tool" "One-line description of what the plugin does" --author "your-github-handle"

# Build, scan, and test
node scripts/build-declarative.mjs my-tool
node scripts/scan-plugin-security.mjs extensions/my-tool
node --test extensions/my-tool/tests/*.test.mjs
```

Next, implement your logic in `extensions/my-tool/src/`, try it inside the ZTools client, and open a Pull Request. See [Getting Started](docs/en/getting-started.md) for the full walkthrough.

## Documentation

| Document | When to Read |
| --- | --- |
| [Getting Started](docs/en/getting-started.md) | First plugin: scaffold, build, test, try in ZTools, submit a PR |
| [UI Guidelines](docs/en/ui-guidelines.md) | Before designing UI: three standard layouts, keyboard model, pre-submit checklist |
| [API Reference](docs/en/api.md) | While coding: components, props, hooks, host APIs, allowed modules, permissions |
| [Review Standards](docs/en/review.md) | Before submitting: what maintainers review and what CI enforces |
| [Publishing Guide](docs/en/publishing.md) | Updating manifests or releasing: versioning, targets, drafts, revocation |
| [Contributing Guide](CONTRIBUTING.md) | Pre-submit checklist and local verification commands |

## Directory Structure

| Directory | Contents |
| --- | --- |
| [`extensions/`](extensions/) | One directory per plugin: manifest, source, icon, and tests |
| [`extensions/shared/`](extensions/shared/) | Shared source and test harness; copies inside plugins must match verbatim |
| [`packages/declarative-ui/`](packages/declarative-ui/) | SDK types and runtime for compilation and testing (at runtime, the client provides the runtime) |
| [`packages/ztools-plugins-spec/`](packages/ztools-plugins-spec/) | `plugin.json` JSON Schema and validator |
| [`scripts/`](scripts/) | Scaffolding, build, security scanner, pre-merge verification, and release scripts |

## Reporting Issues

Report plugin or tooling issues in [this repository's Issues](https://github.com/ZToolsTeam/ZTools-extensions/issues) and include:

- Plugin ID, plugin version, and ZTools client version
- OS and CPU architecture
- Steps to reproduce and error output
- For build issues: Node.js version and exact command run

Remove personal details and credentials from logs or screenshots before posting. For desktop client bugs, report them in [ZTools Issues](https://github.com/ZToolsTeam/ZTools/issues).

## License

This repository is licensed under the [MIT License](LICENSE).
