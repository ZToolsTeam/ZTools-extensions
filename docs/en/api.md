**English** | [简体中文](../api.md)

# API Reference

Plugins depend on a single package: `@ztools/declarative-ui`. It provides UI components, hooks, and common system capabilities (toasts, clipboard, storage, etc.). This guide explains what each API does and key edge cases; **the authoritative type signatures live in [`packages/declarative-ui/dist/index.d.ts`](../../packages/declarative-ui/dist/index.d.ts)** and are visible on hover in your editor.

For layout choices and action ordering, see [UI Guidelines](ui-guidelines.md). This document covers the API surface itself.

- [Entry Structure](#entry-structure)
- [Available Modules](#available-modules)
- [Components](#components)
- [Hooks](#hooks)
- [Internationalization (i18n Preview)](#internationalization-i18n-preview)
- [System Capabilities](#system-capabilities)
- [Client Host API (window.ztools)](#client-host-api-windowztools)
- [Permissions](#permissions)
- [Testing APIs](#testing-apis)

## Entry Structure

```tsx
import React, { Detail, ActionPanel, Action, useState } from "@ztools/declarative-ui";

export default function Command() {
  const [count, setCount] = useState(0);
  return (
    <Detail
      markdown={`Click count: ${count}`}
      actions={
        <ActionPanel>
          <Action title="Increment" onAction={() => setCount((n) => n + 1)} />
        </ActionPanel>
      }
    />
  );
}
```

- The module referenced by `plugin.json`'s `entry` (typically `dist/index.js`) exposes **the default-exported function as the plugin entry point**.
- JSX compiles to `React.createElement`, so files using JSX must import `React` from `@ztools/declarative-ui` (not the `react` npm package).
- Components can also be called directly without JSX: `List.Item({ title: "..." })`, `List({ ... }, ...children)`. Several `.ts` plugins in this repository use that style.
- For multi-command plugins, declare `features` in `plugin.json` (see [Publishing Guide · Manifest Fields](publishing.md#manifest-fields)) and export matching functions by `code` (exact match, camelCase, PascalCase, or `<Name>Command`); falls back to the default export if not found.

## Available Modules

Plugins execute inside the client UI runtime, which only resolves the modules below—any other import fails with `UNAUTHORIZED_MODULE_ACCESS`. Each source file is compiled individually without bundling, so **third-party npm packages are unavailable at runtime**. Implement needed logic directly in plugin source.

| Import | What It Provides |
| --- | --- |
| `@ztools/declarative-ui` | All UI components, hooks, and SDK system capabilities |
| `./file.js` | Other source modules inside the same plugin |
| `crypto` / `node:crypto` | Slim subset: `createHash` / `createHmac` (`md5`, `sha1`, `sha256`), `randomBytes` (max 65536 bytes), `randomUUID`; cipher APIs are unavailable. Standard browser `globalThis.crypto` (WebCrypto) is also available |
| `path` / `node:path` | Slim subset: `join`, `resolve`, `dirname`, `basename`, `extname` (string manipulation normalized to `/`) |

Node built-ins such as `fs` are not available and will be rejected even if `fs` permission is declared. Use `ztools.fs` from the [Client Host API](#client-host-api-windowztools) for file operations.

Rules for relative imports:

- Must start with `./`; parent traversal (`../`) is disallowed.
- Paths resolve relative to the entry directory (`dist/`), not the importing file. **Keep all source files flat under `src/`** and import with `.js` extensions (e.g., `./logic.js`).

## Components

### List

Search bar + list; all three standard layouts are built on `List`.

| Prop | Description |
| --- | --- |
| `searchText` / `onSearchTextChange` | Controlled search text. **The client does not filter items for you**—filter in `onSearchTextChange` |
| `searchBarPlaceholder` | Search input placeholder |
| `searchBarAccessory` | Right-side search bar control; place a `List.Dropdown` for filtering, sorting, or switching data sources |
| `isLoading` | Displays a loading indicator |
| `navigationTitle` | View title |
| `isShowingDetail` | Toggles the right-hand preview pane populated from the selected item's `detail` |
| `selectedItemId` / `onSelectionChange` | Controls or observes the currently selected `List.Item` by `id` |
| `filterBar` | Single-line status bar under the search bar: `{ summaryText, actions }` where each action is `{ id, title, icon?, onAction }` (max 2 global actions) |
| `subList` | Right-hand detail list for Layouts 2 & 3: `{ title?, subtitle?, emptyText?, checkable?, checked?, onCheckChange?, items }` (`items` is a `List.Item` array) |
| `workbenchPanel` | Left-hand parameter panel for Layout 3: `{ title?, subtitle?, fields, previewCard? }`, each field `{ id, label, type: "select" \| "toggle" \| "text" \| "info", value, options?, onChange? }` |
| `fileInput` / `onFileInput` | Accepts drag-and-drop or `Cmd/Ctrl+V` pasted files (also supported on `Detail` and `Form`); see [File Drop & Paste Input](#file-drop--paste-input) |
| `actions` | Fallback bottom actions when no item is selected (e.g., empty list) or the selected item defines no `actions` |

`metricGrid`, `distributionBar`, `segmentedControl`, and `header` still exist in types for legacy compatibility; `metricGrid` and `distributionBar` must not be used (see [UI Guidelines · Prop Conventions](ui-guidelines.md#prop-conventions)).

**`List.Item`**

| Prop | Description |
| --- | --- |
| `id` | Unique row identifier used for selection and testing |
| `title` / `subtitle` | Primary and secondary text |
| `icon` | Monochrome icon from `Icon.*` |
| `accessories` | Right-side metadata array: `{ text }`, `{ tag }`, `{ progress: 0..1 }`, `{ icon }`, `{ date }`, optional `tooltip`. `text` / `tag` / `progress` also accept `{ value, color }` (reserve color for critical alerts only) |
| `keywords` | Extra search keywords for your filtering logic |
| `actions` | `ActionPanel` shown when this row is selected |
| `detail` | Right-hand preview content (typically `Detail`) when `isShowingDetail` is enabled |
| `checkable` / `checked` / `onCheckChange` | Checkable row; `checked` also supports `"indeterminate"` |
| `onSelect` | Invoked when clicked or selected in left navigation (used in Layout 2 to switch `subList`) |

**`List.Section`**: Groups rows with `title`, `subtitle`, and optional `checkable` / `checked` / `onCheckChange` for group select-all.

**`List.Dropdown`**: Props `value` / `defaultValue`, `onChange(value)`, `tooltip`; children are `List.Dropdown.Item` (`title`, `value`, `icon`) and `List.Dropdown.Section`.

### Detail

Markdown document with an optional right-hand metadata sidebar. Props: `markdown`, `navigationTitle`, `isLoading`, `actions`, `metadata`.

`markdown` supports headings, lists, tables, blockquotes, code blocks, links, and images. Fenced code blocks tagged `math` (```` ```math ````) render as typeset LaTeX formulas (client 1.1.8.11+); invalid formulas fall back to raw source. External resource commands (links/images) are disallowed inside math blocks.

`metadata` accepts a `Detail.Metadata` containing:

| Component | Props |
| --- | --- |
| `Detail.Metadata.Label` | `title`, `text`, `icon` |
| `Detail.Metadata.Link` | `title`, `target` (URL), `text` |
| `Detail.Metadata.TagList` | `title`; children are `Detail.Metadata.TagList.Item` (`text`, `icon`, `color`) |
| `Detail.Metadata.Separator` | Divider line |

### Form

Form view with `navigationTitle`, `isLoading`, and `actions`. Field components:

| Component | Key Props |
| --- | --- |
| `Form.TextField` / `Form.PasswordField` | `id`, `title`, `placeholder`, `value` / `defaultValue`, `onChange`, `error`, `info`, `autoFocus` |
| `Form.TextArea` | `id`, `title`, `placeholder`, `value` / `defaultValue`, `onChange`, `error`, `info` |
| `Form.Checkbox` | `id`, `title`, `label`, `value` / `defaultValue`, `onChange` |
| `Form.Dropdown` | `id`, `title`, `value` / `defaultValue`, `onChange`, `error`, `info`; children `Form.Dropdown.Item` (`title`, `value`, `icon`), `Form.Dropdown.Section` |
| `Form.Description` | `title`, `text`; client 1.1.8.11+ also supports `markdown` (takes precedence over `text`) with the same safe Markdown, images, and `math` blocks as `Detail` |
| `Form.Separator` | Divider line |

Submit forms with `Action.SubmitForm`: `onSubmit(values)` receives a map keyed by field `id`. In forms, `Cmd/Ctrl+Enter` triggers the first action.

### File Drop & Paste Input

`List`, `Detail`, and `Form` all support receiving dropped or `Cmd/Ctrl+V` pasted files via `fileInput` and `onFileInput`:

```tsx
<List
  fileInput={{
    extensions: [".png", ".jpg", ".webp"],
    allowMultiple: true,
    allowImage: true,
    allowDirectories: false,
  }}
  onFileInput={({ files, source, targetFieldId }) => {
    // files: Array<{ path, name, size, isDirectory }>
  }}
>
```

| Option (`fileInput`) | Description |
| --- | --- |
| `extensions` | Allowed file extensions (case-insensitive, e.g., `[".pdf"]` or `["pdf"]`); omit to allow all |
| `allowMultiple` | Allow multiple files at once (default `true`; when `false`, only the first match is passed) |
| `allowDirectories` | Allow folders (default `false`) |
| `allowImage` | Materialize clipboard screenshots/bitmaps into a temporary PNG file (default `false`) |
| `onTextPaste` | Optional plain-text paste handler `(text: string) => void` for dual-mode plugins (e.g., QR, JSON, hash); fires only when focus is not in a non-empty text input |

Callback payload (`FileInputPayload`):

- `files`: Filtered, read-authorized file entries `{ path, name, size?, isDirectory? }`.
- `directories`: Subset of paths confirmed by the client to be directories (provided only when `allowDirectories: true` and folders were dropped/pasted). Use this instead of guessing by filename extension (folder names can contain dots like `2026.11_invoices`). Dropped folders receive recursive read grants so plugins can enumerate them via `ztools.fs`; if filtering folder contents by extension, omit `extensions` and filter inside the plugin.
- `source`: `"drop"` or `"paste"`.
- `targetFieldId`: When dropped/pasted onto a specific `Form` field or `workbenchPanel.fields` slot, identifies that field's `id`.

Note: When focus is inside a non-empty search box or text input and the clipboard holds plain text, `Cmd/Ctrl+V` performs normal text paste without triggering file import.

### ActionPanel & Action

`ActionPanel` groups actions using `ActionPanel.Section` (`title`) and `ActionPanel.Submenu` (`title`, `icon`—rendered as a grouped section in the action menu; submenus do not take `shortcut`). The 1st direct action is the primary action (`Enter`), the 2nd defaults to the secondary action (`Cmd/Ctrl+Enter`), and remaining actions go into the action menu (`Cmd/Ctrl+K`). If any action explicitly declares `Ctrl/Cmd+Enter` (`{ modifiers: ["ctrl"], key: "return" }`), that action owns the shortcut across both the footer bar and action menu instead of the 2nd item.

Every action accepts `title`, `icon`, and `shortcut` (`{ modifiers: ["ctrl" | "opt" | "alt" | "shift"], key }` or a single key like `"space"`). Prefer `"ctrl"` as the primary modifier (automatically mapped to `Cmd` on macOS and `Ctrl` on Windows) and do not mix `"cmd"` and `"ctrl"` in the same plugin. Avoid host-reserved hotkeys (`Ctrl/Cmd+,`, `Ctrl/Cmd+U`, `Ctrl/Cmd+Shift+P`, `Ctrl/Cmd+K`, `Esc`).

| Action | Client Behavior |
| --- | --- |
| `Action` | Calls `onAction`. If `onAction` throws, the client displays a failure toast with the error message automatically; set `style: Action.Style.Destructive` for dangerous actions |
| `Action.CopyToClipboard` | Copies `content` to clipboard, shows confirmation toast, then invokes `onCopy` |
| `Action.Paste` | Copies `content` and sends a paste keystroke to the previous foreground app. Requires Accessibility permission on macOS and aborts if the target changes. Return indicates keystroke dispatch only—not guaranteed receipt—so destructive dequeue flows should stay recoverable and avoid auto-retrying unconfirmed pastes |
| `Action.OpenInBrowser` | Opens `url` in the default browser |
| `Action.ShowInFinder` | Reveals `path` in Finder / File Explorer |
| `Action.OpenWith` / `Action.Open` | Opens `path` with the default application |
| `Action.Push` | Pushes `target` view onto the navigation stack (`Esc` pops back) |
| `Action.SubmitForm` | Collects form values and calls `onSubmit(values)` |

### Icons & Colors

- `Icon`: Monochrome linear icons (`Icon.Text`, `Icon.Folder`, `Icon.Trash`, `Icon.Gear`, ...). Full list in [`constants/icons.d.ts`](../../packages/declarative-ui/dist/constants/icons.d.ts).
- `Color`: Color constants such as `Color.Red`. Per UI guidelines, reserve `Color.Red` strictly for critical warnings.

## Hooks

| Hook | Purpose |
| --- | --- |
| `useState`, `useEffect`, `useMemo`, `useCallback`, `useRef` | Same semantics as React hooks. Clean up timers and listeners in the function returned by `useEffect` |
| `useNavigation()` | Returns `{ push(view), pop() }` for programmatic navigation |
| `usePromise(fn, args?, options?)` | Runs an async function, returning `{ data, error, isLoading, revalidate, mutate }` |
| `useCachedPromise(fn, args?, options?)` | Same as `usePromise` with plugin-scoped in-memory caching for instant re-entry |
| `useFetch(url, options?)` | Fetches and parses HTTP responses (requires `network` permission; see [Network Requests](#network-requests)) |
| `useCachedState(key, initialValue, options?)` | State backed by plugin-scoped in-memory cache (`options.cache` accepts a custom `Cache`) |
| `usePopoutState(key, initialValue)` | Like `useState`, preserved when the user pops the plugin out into a standalone window |

## Internationalization (i18n Preview)

Multi-language support across the ZTools client and `@ztools/declarative-ui` is rolling out progressively:

- The SDK plans to expose a `useLocale()` hook (returning the active client locale identifier, e.g. `"zh-CN"` / `"en-US"`) alongside localized `plugin.json` metadata so declarative plugins can adapt copy automatically to the host language.
- Until `useLocale()` lands in a stable release, treat `packages/declarative-ui/dist/index.d.ts` as the source of truth for currently exported APIs. When authoring new plugins, keep user-facing strings grouped in a dedicated dictionary module so adopting `useLocale()` later is straightforward.

## System Capabilities

### Timed Sleep Prevention

`window.ztools.sys.managePowerSession({ action, mode?, durationMinutes? })` manages wake locks for the current window and plugin on Windows and macOS. `action` is `status`, `start`, `stop`, or `toggle`; `mode` is `display` (keep screen awake) or `system` (allow display off, keep system awake); `durationMinutes` is an integer `0..10080` (`0` means manual stop).

Returns `{ active, mode, startedAtMs, expiresAtMs, remainingMs }`. Countdowns run in the main process and continue after navigating away from the plugin, releasing when the owning window closes or the app exits. Stopping releases only the current plugin's lock. It does not block manual screen lock or lid-close sleep. Surface call errors honestly—never assume success.

| API | Description |
| --- | --- |
| `showToast(style, title, message?)` or `showToast({ style, title, message })` | Toast notification with `Toast.Style.Success` / `Failure` / `Animated`. Returned handle supports updating `title`, `message`, `style`, or calling `hide()` |
| `showHUD(title)` | Brief success toast (auto-dismisses after ~1.5 s) |
| `confirmAlert({ title, message?, primaryAction?, dismissAction? })` | In-client confirmation dialog returning a boolean. Set `primaryAction.style` to `"destructive"` for irreversible actions |
| `Clipboard.copy(content)` / `paste(content)` / `readText()` / `readFiles()` / `readImage()` / `clear()` | Clipboard access. `copy` throws on empty input, payloads > 8 MiB, or busy clipboard—never show "Copied" on failure. `readFiles()` returns `string[]`; `readImage()` returns an image Data URL or `null` |
| `LocalStorage.getItem` / `setItem` / `removeItem` / `allItems` / `clear` | Plugin-isolated persistent JSON storage across restarts. Keys 1–200 chars, max 4 MiB per value |
| `SecureStorage` | OS-keychain-encrypted storage for secrets/tokens (max 64 KiB per value). Fails fast if encryption is unavailable (never falls back to plaintext); check `status()` first. Protects secrets at rest from other apps, not from other plugins inside the same client |
| `Cache` | Plugin-isolated in-memory cache (`get` / `set` / `has` / `remove` / `clear` / `subscribe`), cleared on client restart; `new Cache({ namespace })` sub-scopes within the plugin |
| `open(target)` | Opens a URL in the default browser |
| `terminateProcess(pid, options?)` | Terminates a local process (requires `process` permission). `options`: `mode` (`graceful` / `force`), `tree`, `timeoutMs`, `expectedName` (rejects on name mismatch to prevent PID reuse accidents) |
| `ZToolsHostError` / `isZToolsHostError(err)` | Error class thrown on host call failures with `err.code` (e.g., `PROCESS_PROTECTED`, `PLUGIN_PERMISSION_REQUIRED`) |
| `getHostTransport()` | Low-level plugin-authenticated transport (`call(method, params)`). Prefer the higher-level APIs above when available |

### Multi-Window Concurrent Storage

Both `LocalStorage` and `SecureStorage` provide atomic read-modify-write helpers scoped to the current plugin, preventing lost updates when multiple windows of the same plugin write concurrently:

| Method | Semantics |
| --- | --- |
| `compareAndSet(key, expected, value): Promise<boolean>` | Atomically writes `value` and returns `true` only if the stored JSON matches `expected`; otherwise returns `false` without writing. `expected === undefined` means the key does not exist (distinct from stored JSON `null`) |
| `updateItem(key, update): Promise<T>` | Reads current value, computes `update(current)`, and attempts atomic write; retries up to 8 times on conflict, throwing `STORAGE_CONFLICT` if exhausted. Skips writing when serialized JSON is unchanged |

`update` must be a synchronous, idempotent, pure data transform (no network calls, clipboard writes, toasts, or external mutations). Returning a mutated copy of the input object/array is supported, but you must return the new value. Run side effects only after `await updateItem(...)` resolves:

```ts
await LocalStorage.updateItem("launch-count", (current) =>
  typeof current === "number" ? current + 1 : 1
);
```

Values must be JSON-serializable and obey `setItem` size limits. `SecureStorage` keys are 1–128 chars, starting with an alphanumeric character and containing only alphanumerics, `.`, `_`, `:`, `-`. Unsupported atomic storage, cancellation, encryption failures, or I/O errors throw directly—never treat them as concurrency conflicts or fall back to plain `getItem` + `setItem`.

### Network Requests

`fetch` and `useFetch` run in the client renderer and are subject to browser CORS rules. Any network usage must declare `"network"` in `plugin.json` and document target domains and purposes in the plugin's README. Even when indirect wrappers like `useFetch` are used, the same declaration rule applies.

## Client Host API (window.ztools)

For capabilities not wrapped by the SDK (filesystem, native dialogs, screenshots, system stats, etc.), use `window.ztools`. Full type definitions live in the client repo at [`packages/api/types/index.d.ts`](https://github.com/ZToolsTeam/ZTools/blob/main/packages/api/types/index.d.ts). Common namespaces:

| Namespace | Purpose |
| --- | --- |
| `ztools.fs` | Read, write, copy, move, delete files, list directories |
| `ztools.win` | Open file, save file, and folder picker dialogs |
| `ztools.shell` | Open files/URLs, reveal in file manager, move to trash |
| `ztools.sys` | Platform detection, system paths, hardware/resource stats, notifications |
| `ztools.clipboard` | Text, image, and file clipboard operations |
| `ztools.screen` / `ztools.screenshot` | Screen capture and display metadata |
| `ztools.process` | Running processes and open ports |
| `ztools.network` | Host-initiated HTTP requests and downloads |
| `ztools.db` | Key-value and document storage (new plugins should prefer SDK `LocalStorage`) |
| `ztools.ocr`, `ztools.image`, `ztools.zip` | OCR, image manipulation, archives |

Important notes:

- **Available only inside the real client**: `window.ztools` is absent in Node tests—check existence before calling, fail honestly when missing, or stub in tests without returning fake production data.
- **Platform parity varies**: Verify every called method on all platforms declared in `targets`.
- **Match declared permissions**: Every call is audited against `plugin.json` `permissions`.
- Namespaces omitted from this table (updates, telemetry, accounts, privileged calls) are reserved for the client itself.

### Mounted Volumes, Clipboard History & Safe Rename

The methods below are invoked via `getHostTransport().call(method, params)`. Always surface errors honestly—never swallow failures and return empty arrays or fake success.

| Method & Params | Result & Edge Cases |
| --- | --- |
| `system_list_volumes`, `{}` | Returns `{ volumes, partial, errors }` on Windows/macOS. `partial: true` with `errors: string[]` means some volumes failed to read—never display partial totals as complete. Full failure throws |
| `clipboard_history_restore`, `{ id, paste? }` | `id` must come from host `clipboard_history_query` (1–64 chars), never a plugin-fabricated ID or raw content. Restores original text/image/file type; `paste: true` also hides the window and pastes to the target app. Returns `{ success: true }`; expired entries, missing files, or paste errors throw |
| `filesystem_move_file_no_replace`, `{ sourcePath, destPath }` | Path-based version is SDK Contract 1 only. Requires write grants on both source and destination; atomically refuses to overwrite an existing destination via native helper. Missing native helper fails explicitly without falling back to an overwriting move. Case-only renames are not currently supported; identical paths are a no-op |
| `filesystem_get_directory_contents`, `{ path }` | SDK Contract 1 returns `{ success: true, files, writeAuthorized }`. Listing implies read grant only; if `writeAuthorized` is `false`, prompt the user to grant folder write access before renaming. Even when `true`, writes can still fail due to OS permissions or concurrent directory changes |
| `image_ocr`, `{ action, lang?, path?, restoreWindow? }` | Local offline OCR. `lang`: `zh-Hans-CN` (default), `en-US`, `ja-JP`, `ko-KR`. `action`: `recognizeImage` (user-authorized `path`, <= 16 MB), `recognizeClipboard` (`clipboard` permission), `captureRegion` (`screen` permission; `restoreWindow: false` keeps window hidden after capture). Returns `{ ok: true, text, lines }`, `{ ok: false, empty: true, error }`, `{ ok: false, canceled: true, error }`, or `{ ok: false, error }`. Set timeout to ~3 minutes for `captureRegion`. Supported on both macOS and Windows (Windows requires the chosen OCR language pack) |
| `formula_ocr`, `{ action, path?, restoreWindow?, includePreview? }` | Local offline math formula OCR to LaTeX (client 1.1.8.11+, macOS & Windows). ~114 MB model is downloaded on demand: `action` supports `modelStatus` (`{ state, totalBytes, receivedBytes?, error? }` where `state` is `missing` / `downloading` / `ready` / `failed`), `downloadModel`, `cancelDownload`, plus `recognizeImage`, `recognizeClipboard`, and `captureRegion`. Optional `includePreview: true` returns `previewDataUrl` (PNG data URL, max 1600 px side, <= 384 KiB). Returns `{ ok: true, latex, score, lowConfidence, previewDataUrl? }`—prompt user verification when `lowConfidence` is `true`; also handles `modelMissing`, `empty`, and `canceled`. Recognizes one formula (single or multi-line) per call |

Volume entry fields:

| Field | Type & Meaning |
| --- | --- |
| `path` | `string`, actual mount path (drive root or mount point) |
| `label` | `string`, volume label |
| `fileSystem` | `string`, filesystem name (empty string if unknown) |
| `totalBytes` / `usedBytes` / `availableBytes` | `number`, sizes in bytes (OS-reserved space may make `used + available < total`) |
| `capacityGroup` | `string`, shared pool identifier (e.g., volumes sharing an APFS container); count each group only once when summing capacity |

SDK Contract 2 file methods use capability grants instead of raw paths (safe move uses `filesystem_move_file` with `replace: false`). When restoring clipboard and pasting, distinguish restore success from paste failure.

## Permissions

`permissions` in `plugin.json` declares the capabilities a plugin uses for reviewers and users: **declare everything you use, and nothing you do not**.

| Permission | Purpose | High-Risk |
| --- | --- | --- |
| `network` | Outbound network requests | Yes |
| `clipboard` | Read/write clipboard, paste to foreground app | |
| `dialog` | Native file open/save dialogs | |
| `notification` | OS notifications | |
| `shell` | Open files/URLs, reveal in file manager, run shell commands | Yes |
| `fs` | Read/write local files | Yes |
| `child_process` | Spawn external programs or commands | Yes |
| `database` | Client-provided data storage | |
| `sqlite` | Read SQLite database files | |
| `system` | System info, power management, system settings | Yes |
| `screen` | Screen capture and display info | |
| `tray` | System tray capabilities | |
| `crypto` | Import `crypto` module | |
| `audio` | Audio capture or processing | |
| `video` | Screen recording, camera, or video processing | |
| `process` | Terminate local processes (`terminateProcess`) | Yes |

Where permissions are enforced:

- **Static scanner (pre-merge)**: Fails if `fetch` / `XMLHttpRequest` / `WebSocket` / `EventSource` is used without `network`, `exec` / `spawn` without `child_process`, or Node imports without their matching permission. Declaring high-risk permissions flags the plugin for heightened manual review.
- **Client runtime**: Enforces `process` (`terminateProcess` throws `PLUGIN_PERMISSION_REQUIRED` if undeclared) and requires `fs` to move search/scan results to trash.
- **Maintainer review**: All other permissions are audited manually against code because declarative plugins share the renderer JS environment.

## Testing APIs

Utilities for testing plugins in Node:

| API | Description |
| --- | --- |
| `renderDeclarativeRoot(Command)` | Renders a plugin and returns `{ getLatest(), forceRender(), unmount() }`, where `getLatest()` yields the virtual view tree (`type`, `props`, `children`) |
| `setDeclarativeBridge(bridge)` | Replaces client bridge implementations (toasts, clipboard, storage, navigation, etc.) to simulate success or failure |
| [`extensions/shared/test-harness.mjs`](../../extensions/shared/test-harness.mjs) | Ready-to-use simulated host built on the two APIs above: `createHost()`, `mount(Command)`, `tick()`, search, action invocation, file paste/drop simulation (`api.pasteFiles`, `api.dropFiles`, `api.pasteText`), and storage/IPC fault injection. See [Getting Started · Scan and Test](getting-started.md#6-scan-and-test) |
