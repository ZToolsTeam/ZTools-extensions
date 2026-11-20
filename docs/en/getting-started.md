**English** | [简体中文](../getting-started.md)

# Getting Started

This guide walks you through building your first ZTools plugin from scratch: scaffolding, compiling, testing, trying it in the ZTools client, and opening a Pull Request. The example uses `my-tool` as the plugin ID—replace it with your own.

Before you start, skim [UI Guidelines](ui-guidelines.md) to see how ZTools plugins are structured, and keep [API Reference](api.md) handy while coding.

## 1. Prerequisites

- Node.js 24 (matching CI) and Git.
- A Windows or macOS machine with the ZTools desktop client installed to test your plugin.

## 2. Clone and Install Dependencies

```bash
git clone https://github.com/ZToolsTeam/ZTools-extensions.git
cd ZTools-extensions
npm ci --ignore-scripts
```

Install once at the repository root. `npm ci --ignore-scripts` installs from the lockfile, matching the PR CI command; the SDK resolves to `packages/declarative-ui/` via npm workspaces.

All commands below are run from the repository root.

## 3. Scaffold a Plugin

```bash
npm run create-plugin -- my-tool "My Tool" "One-line description of what the plugin does" --author "your-github-handle"
```

This creates `extensions/my-tool/`:

| File | Purpose |
| --- | --- |
| `plugin.json` | Manifest: name, version, entry, icon, permissions, supported platforms |
| `src/index.tsx` | UI: a searchable phrase list that copies on Enter |
| `src/items.ts` | Sample data and filtering logic, kept separate from UI for easy testing |
| `tests/index.test.mjs` | Tests covering manifest, filtering (including edge inputs), and rendering |
| `icon.svg` | Monochrome icon |
| `tsconfig.json` | TypeScript config pointing to the workspace SDK types |
| `package.json` | Marks compiled output as ES modules; no dependencies needed |
| `README.md` | Plugin documentation |

Generated `plugin.json`:

```json
{
  "id": "my-tool",
  "name": "My Tool",
  "version": "1.0.0",
  "description": "One-line description of what the plugin does",
  "author": "your-github-handle",
  "entry": "dist/index.js",
  "icon": "icon.svg",
  "mode": "view",
  "permissions": ["clipboard"],
  "targets": [
    { "id": "windows-electron-any", "platform": "windows", "runtime": "electron", "arch": "any" },
    { "id": "macos-electron-any", "platform": "macos", "runtime": "electron", "arch": "any" }
  ],
  "nativeComponents": []
}
```

Common options:

| Option | Description |
| --- | --- |
| `--platform cross` / `windows` / `macos` | Which platform `targets` to generate (defaults to `cross`). Match the platforms you can actually test |
| `--author <name>` | Recommended: your GitHub username or real team name. The default `ZTools Developer` is a placeholder and must be replaced before submitting |
| `--force` | Overwrite an existing directory |
| `--help` | Show full usage |

Plugin IDs must start with a lowercase letter, use only lowercase letters, digits, and hyphens, and be 2–64 characters long (e.g., `quick-notes`). Do not rename an ID once published; it also serves as the directory name.

Running `npm run create-plugin` with no arguments starts an interactive prompt.

Community plugins should attribute the author or team directly without adding `ZTools Community` prefixes or suffixes; official plugins use `ZTools Team`. When contributing to an existing plugin, keep the original `author`. See [Author Attribution](publishing.md#author-attribution).

## 4. Understand the Starter Code

Core of `src/index.tsx`:

```tsx
import React, { List, ActionPanel, Action, Icon, Clipboard, showToast, Toast, useState } from "@ztools/declarative-ui";
import { SAMPLE_ITEMS, filterItems } from "./items.js";

export default function Command() {
  const [searchText, setSearchText] = useState<string>("");
  const items = filterItems(SAMPLE_ITEMS, searchText);

  return (
    <List searchBarPlaceholder="Search phrases" searchText={searchText} onSearchTextChange={setSearchText}>
      {items.map((item) => (
        <List.Item
          key={item.id}
          id={item.id}
          title={item.title}
          subtitle={item.content}
          icon={Icon.Text}
          accessories={[{ tag: item.category }]}
          actions={
            <ActionPanel>
              <Action.CopyToClipboard title="Copy Content" content={item.content} />
              <Action title="Copy Title" icon={Icon.CopyClipboard} onAction={async () => { /* ... */ }} />
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}
```

Key points:

- **The default export is the plugin entry point**, returning a declarative view (`List` here).
- **Import everything from `@ztools/declarative-ui`**, including `React` and hooks like `useState`. Third-party npm packages are not available at runtime—see [Available Modules](api.md#available-modules).
- **Action order matters**: the 1st action in `ActionPanel` is the primary action (`Enter`), the 2nd is the secondary action (`Cmd/Ctrl+Enter`), and remaining actions appear in the action menu (`Cmd/Ctrl+K`).
- **Use `.js` extensions on relative imports** (`./items.js`), since compiled files live in `dist/items.js`.

The starter uses the simplest single-column list layout. To pick the right layout for your plugin, follow [Choosing a Layout](ui-guidelines.md#choosing-a-layout), or inspect existing plugins such as [`extensions/process-monitor`](../../extensions/process-monitor/), [`extensions/disk-analyzer`](../../extensions/disk-analyzer/), and [`extensions/screenshot`](../../extensions/screenshot/).

## 5. Build

```bash
node scripts/build-declarative.mjs my-tool
```

Compiled output goes to `extensions/my-tool/dist/`:

- `dist/` is cleaned on every build—edit only `src/`. Do not commit `dist/`; CI compiles from source.
- Builds use the repository's pinned TypeScript compiler; type errors fail the build.
- Each source file is compiled individually without bundling, so plugins can only import `@ztools/declarative-ui` and their own relative modules.
- If a plugin copies shared source from `extensions/shared/`, the copy must match the original verbatim or the build fails.

## 6. Scan and Test

```bash
node scripts/scan-plugin-security.mjs extensions/my-tool
node --test extensions/my-tool/tests/*.test.mjs
```

- **Security scan**: Validates `plugin.json` and statically scans source code (blocking `eval`, obfuscation, undeclared network calls, etc.). Because manifest validation checks that `entry` exists, build before scanning. The scanner also emits `UI_*` warnings—see [Scanner Diagnostics](ui-guidelines.md#scanner-diagnostics).
- **Tests**: Tests import compiled files from `dist/`, so rebuild after editing `src/`.

The scaffolded tests are only a starting point. For real features, cover at least: normal results, empty results, invalid inputs, and host capability failures (e.g., clipboard write failure or host IPC error). `extensions/shared/test-harness.mjs` provides a simulated host for rendering plugins, invoking actions, and injecting faults in Node:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHost, mount } from "../../shared/test-harness.mjs";
import Command from "../dist/index.js";

test("renders empty list when search has no match", async () => {
  createHost();
  const view = await mount(Command);
  await view.search("nonexistent-keyword");
  assert.equal(view.items().length, 0);
  view.unmount();
});

test("copies title to clipboard and shows toast", async () => {
  const host = createHost();
  const view = await mount(Command);
  await view.run(view.item("thanks"), "Copy Title");
  assert.equal(host.clipboard.text, "Got it, thanks");
  assert.equal(host.lastToast().title, "Title copied");
  view.unmount();
});
```

On the object returned by `createHost()`, `host.faults.storageRead` / `storageWrite` simulate storage failures, and `host.ipc.<method>` mocks host method responses or errors. Check other plugins' `tests/` directories for more examples.

## 7. Try It in the ZTools Client

Once automated tests pass, verify your plugin in the real desktop client across normal flows, empty states, error states, and keyboard ergonomics.

Launch the client with an **isolated data directory** and copy your built plugin into it. This keeps your personal settings and installed plugins untouched—delete the directory when done. (On macOS, a small amount of Electron's own state still lives in the default location; quit any running ZTools instance first.)

### Step 1: Copy the Plugin

The client loads plugins from `<data-root>/Plugins/<plugin-id>/`. Copy `plugin.json`, `dist/`, and the icon file.

macOS:

```bash
DATA="$HOME/ztools-plugin-dev/Data"
rm -rf "$DATA/Plugins/my-tool"
mkdir -p "$DATA/Plugins/my-tool"
cp -R extensions/my-tool/plugin.json extensions/my-tool/icon.svg extensions/my-tool/dist "$DATA/Plugins/my-tool/"
```

Windows (PowerShell):

```powershell
$data = "$env:USERPROFILE\ztools-plugin-dev\Data"
$dest = "$data\Plugins\my-tool"
Remove-Item -Recurse -Force $dest -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $dest | Out-Null
Copy-Item extensions\my-tool\plugin.json, extensions\my-tool\icon.svg $dest
Copy-Item -Recurse extensions\my-tool\dist $dest
```

### Step 2: Launch the Client with That Data Directory

Quit any running ZTools instance first—only one instance can run at a time, otherwise the new process exits immediately.

macOS (installed in Applications):

```bash
/Applications/ZTools.app/Contents/MacOS/ZTools --data-root="$DATA"
```

Windows (replace with your install or portable directory):

```powershell
& "<ZTools-install-dir>\ZTools.exe" "--data-root=$data"
```

Use the `--data-root=<dir>` form with an equals sign and an absolute path. Plugin data is stored inside this directory, while logs and caches go in its parent directory (`ztools-plugin-dev/` above).

If you are running ZTools from client source, pass `--data-root` the same way—see [Manual Verification](https://github.com/ZToolsTeam/ZTools/blob/main/docs/en/testing.md#manual-verification).

### Step 3: Open the Plugin

Type your plugin name (e.g., "My Tool") in the ZTools search bar and press Enter.

After editing code: rebuild -> re-copy (Step 1) -> quit and relaunch the client. The client caches loaded plugin modules in memory, so relaunching ensures you test the updated bundle.

### If Your Plugin Does Not Appear

| Check | Details |
| --- | --- |
| Directory name matches `id` | The folder under `Plugins/` must equal `plugin.json`'s `id` |
| Real files copied | Symlinks (`ln -s`) and shortcuts are ignored; copy actual files |
| `targets` includes current OS | Plugins without a target for the current OS are hidden |
| `author` is not an official name | Unofficial plugins claiming `ZTools`, `ZTools Team`, `official`, etc. are hidden |
| ID is not a bundled plugin | Both editions ship the same default bundled tools (see [Default Bundled Plugins](https://github.com/ZToolsTeam/ZTools/blob/main/docs/en/architecture.md#default-bundled-plugins)). Bundled copies always take precedence over `Plugins/`. To test edits to a bundled plugin, temporarily change its `id`, folder name, and `author` in the copied directory (do not commit temporary changes) |
| ID is not a reserved built-in ID | Built-in commands reserve certain IDs (see [`packages/ztools-plugins-spec/reserved-ids.json`](../../packages/ztools-plugins-spec/reserved-ids.json)). Pick a different ID |
| Inspect console errors | Add `--remote-debugging-port=9222` when launching, open `chrome://inspect` in Chrome, and check the console for load or runtime errors |

## 8. Submit a Pull Request

1. Fork this repository and commit `extensions/my-tool/` source, manifest, icon, and tests on your branch (`dist/` is gitignored).
2. Run the pre-merge checks listed in [Contributing Guide](../../CONTRIBUTING.md).
3. Open a Pull Request explaining what changed, which platforms you verified, and why each permission is needed.

See [Review Standards](review.md) for review criteria and [Publishing Guide](publishing.md) for versioning, targets, drafts, and revocation. After the PR is merged, the official team publishes approved plugins to the plugin marketplace.
