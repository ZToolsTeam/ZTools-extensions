**English** | [简体中文](../ui-guidelines.md)

# UI Guidelines

ZTools is a "summon, act, dismiss" productivity launcher: users hit a hotkey, find a target in seconds, press Enter, and move on. Plugin interfaces must serve that rhythm—not look like full-blown admin dashboards.

This document is the complete UI standard enforced during review. Sections 1–4 explain the rules; sections 5–7 are quick references while coding and before submitting:

1. [Components & Keyboard Model](#components--keyboard-model)
2. [Eight Principles](#eight-principles)
3. [Three Standard Layouts](#three-standard-layouts)
4. [Choosing a Layout](#choosing-a-layout)
5. [Prop Conventions](#prop-conventions)
6. [Pre-Submit Checklist](#pre-submit-checklist)
7. [Scanner Diagnostics](#scanner-diagnostics)

See [API Reference](api.md) for full component and prop signatures.

## Components & Keyboard Model

Plugins describe UI exclusively with `@ztools/declarative-ui` primitives: `List` (`List.Item`, `List.Section`, `List.Dropdown`), `Detail` (`Detail.Metadata`), `Form` (`TextField`, `TextArea`, `Checkbox`, `Dropdown`, etc.), `ActionPanel`, and `Action`. Plugins never write HTML, manipulate the DOM, or ship CSS—colors, typography, light/dark themes, and animations are handled uniformly by the client.

The client provides a consistent keyboard model for all plugins:

| Key | Behavior |
| --- | --- |
| `Up` / `Down` | Move list selection |
| `Enter` | Run the 1st action of the selected item (primary action) |
| `Cmd/Ctrl+Enter` | Run the 2nd action (secondary action); submits forms |
| `Cmd/Ctrl+K` | Open the action menu listing all actions |
| `Esc` | Close action menu -> pop previous view -> clear search -> exit plugin |
| `Space` | Toggle checkbox on the current row in checkable lists (when search is empty or list is focused) |
| `Left` / `Right` | Switch between left navigation and right detail list in Layout 2 (when input is unfocused) |
| `Cmd/Ctrl+V` | Paste clipboard files or screenshots into views declaring `onFileInput` (except plain text into a non-empty text input) |

`Cmd/Ctrl` means `Cmd` on macOS and `Ctrl` on Windows. In `Action.shortcut`, `modifiers: ["ctrl"]` (or `["cmd"]`) maps automatically to `Cmd` on macOS and `Ctrl` on Windows.

## Eight Principles

### Principle 0: Justify Every Element

Before adding any component, button, counter, or step, answer three questions: What value does it give the user? What concrete problem does it solve? Would the user's primary task be blocked without it?

If an element does not help the user find the target faster, decide more accurately, or act in fewer keystrokes, leave it out.

### Principle 1: Give Most Space to the List or Workspace

Users open a plugin to act on an item, not to read a report.

- Place only the search bar and at most one single-line status bar (`filterBar.summaryText`) at the top.
- Never stack metric cards, multi-row filter pills, or paragraphs of help text above the list.
- At least 7–10 list rows should be visible above the fold.

### Principle 2: One Entry Point per Function

- **One filter control**: If the search bar already has a `List.Dropdown`, do not add duplicate `filterBar.groups` below it; if left navigation already categorizes items, do not add a colored distribution bar.
- **No duplicate action buttons**: Do not repeat the same action in the top bar, list row, detail pane, and footer.

### Principle 3: Separate Global Actions from Item Actions

- **Top status bar**: Left side shows a concise status summary (numbers allowed); right side holds at most 1–2 plugin-wide actions (e.g., "New", "Rescan").
- **Item-specific actions** (delete, kill process, copy, reveal) belong in the item's `ActionPanel`, rendered in the footer bar: primary (`Enter`), secondary (`Cmd/Ctrl+Enter`), and menu (`Cmd/Ctrl+K`). Never place item actions in the top status bar.
- List row `accessories` display passive status (tags, progress, values)—never buttons.

### Principle 4: Surface Frequent Actions, Tuck Away the Rest

The footer displays only the top two actions directly (`Enter` and `Cmd/Ctrl+Enter`). Action #3 and beyond live in `Cmd/Ctrl+K`. Frequently used secondary actions can bind a `shortcut` for direct invocation. Order actions in `ActionPanel` by frequency.

### Principle 5: Monochrome First, Zero Colored Emojis

- **No colored emojis**: Keep emojis out of titles, status bars, dropdowns, and button labels (they render as loud colored blocks on Windows). Use `Icon.*` monochrome icons.
- **No decorative rainbow colors**: Keep icons and tags in default grayscale; never cycle purple/blue/green/yellow across rows. Progress bars differentiate by length alone.
- **Reserve color for risk**: Use `color: Color.Red` only for genuine warnings (e.g., disk usage > 90%).
- Accent colors are applied uniformly by the client to primary buttons and selection highlights.

### Principle 6: Stick to the Three Standard Layouts

Every view plugin must use one of the three layouts below—do not invent a fourth. Headless commands use `mode: "no-view"`.

### Principle 7: Pick the Layout Before Coding

Walk through [Choosing a Layout](#choosing-a-layout) first, then model your implementation after a matching example plugin.

## Three Standard Layouts

In the diagrams below, Layer 1 (search bar) and Layer 4 (footer bar) are drawn by the client; plugins supply only content.

### Layout 1: Single-Column List (Optional Content Preview)

Best for: search, switching, monitors, toggles, clipboard, dictionaries—most "find item -> act" plugins.

```text
+-----------------------------------------------------------------------------------+
| Search...                                         [Category / Sort Dropdown v]    | <- Layer 1: Search & sole filter
+-----------------------------------------------------------------------------------+
| One-line status summary (with key numbers)                   [New / Refresh]      | <- Layer 2: Optional status bar
+-----------------------------------------------------------------------------------+
| Selected Title   Subtitle (path / PID / port)        [Metric Tag] [Status Tag]    |
| Row Title        Subtitle                            [Metric Tag] [Status Tag]    | <- Layer 3: Full-width list
| Row Title        Subtitle                            [Metric Tag] [Status Tag]    |    (or list + real content preview)
+-----------------------------------------------------------------------------------+
| Esc Back                                  | [Primary ↵]  [Secondary ⌘↵]  [⌘K]     | <- Layer 4: Footer bar
+-----------------------------------------------------------------------------------+
```

- When a single row (title + subtitle + accessories) tells the full story, use a **full-width list**: `isShowingDetail={false}`.
- Enable the right preview (`isShowingDetail={true}` with `detail` on `List.Item`) **only** to show actual content (long clipboard text, code snippets, dictionary definitions, QR codes, spec tables). Never open a detail pane just to repeat the row's title and path.
- Lightweight toggle/shortcut plugins can omit `filterBar`.

Examples:

| Plugin | Platform | Highlight |
| --- | --- | --- |
| [`process-monitor`](../../extensions/process-monitor/src/index.ts) | Cross-platform | Full-width list + single-line status bar |
| [`clipboard-manager`](../../extensions/clipboard-manager/src/index.tsx) | Cross-platform | Right-hand preview of actual clipboard content |
| [`kill-process`](../../extensions/kill-process/src/index.tsx) | Windows only | Dropdown filter + status bar + kill action |

### Layout 2: Left Navigation + Right Checkable Detail List

Best for: one-to-many management and cleanup ("pick a category / drive / account / table on the left -> check items on the right -> batch delete / uninstall / move").

```text
+-----------------------------------------------------------------------------------+
| Search large files, extensions, or paths...       [All Drives / Account v]        | <- Layer 1: Search & source switcher
+-----------------------------------------------------------------------------------+
| Total 1.7 TB / Used 1.3 TB (78%) · 678 items                         [Rescan]     | <- Layer 2: Status bar
+--------------------------+--------------------------------------------------------+
| Drives / Categories (32%)| [ ] Cleanable Large Files (by size, Space or Enter)    |
| > All Large Files    678 | [x] Windows11_x64.iso        █████░░ [Image]   8.0 GB  |
| > System (C:)        98% | [ ] Ubuntu-Snapshot.vmem     ████░░░ [Other]   8.0 GB  | <- Layer 3: Nav + checkable list (68%)
| > Databases       67.7GB | [Lock] pagefile.sys          ███░░░░ [System]  4.0 GB  |
+--------------------------+--------------------------------------------------------+
| Esc Back                 | [Move to Trash ↵]    [Reveal in Explorer ⌘↵]   [⌘K]    | <- Layer 4: Footer bar
+--------------------------+--------------------------------------------------------+
```

- Build with `<List isShowingDetail={false} subList={...}>`: `List` children are left navigation items; `subList.items` are right-hand detail rows. Update `subList` state in `onSelect` or `onSelectionChange`.
- Use `checkable` / `checked` / `onCheckChange` on rows and on `subList` itself for select-all.
- Use `accessories` for monochrome progress bars, neutral tags, and sizes.
- Footer actions apply to the selected or checked right-hand items.

Examples:

| Plugin | Platform | Highlight |
| --- | --- | --- |
| [`disk-analyzer`](../../extensions/disk-analyzer/src/index.ts) | Cross-platform | Drive/category nav + checkable large-file list |
| [`batch-rename`](../../extensions/batch-rename/src/index.ts) | Cross-platform | Left folder nav + right rename queue |

### Layout 3: Left Parameter Panel + Right Task Queue

Best for: batch transcoding, audio/PDF processing, OCR, screenshot, recording ("configure parameters on the left -> review queue & estimates on the right -> start batch").

```text
+-----------------------------------------------------------------------------------+
| Search queued files...                            [Preset: Balanced Compress v]   | <- Layer 1: Search & preset switcher
+-----------------------------------------------------------------------------------+
| 36 videos selected (1.4 GB) · Est. ~476 MB after transcode (-66%)    [Rescan]     | <- Layer 2: Estimate status bar
+----------------------------+------------------------------------------------------+
| Transcode Options (~34%)   | [x] Video Queue (~66%)                               |
| Format    [ MP4      v]    | [x] demo_01.mov            █████░░ [-> ~30MB] 89.5MB |
| Codec     [ H.265    v]    | [x] meeting_1018.mp4       ████░░░ [-> ~29MB] 85.2MB | <- Layer 3: Params + task queue
| Quality   [ CRF 23   v]    | [x] promo_4k.mp4           ███░░░░ [-> ~26MB] 78.9MB |
| Est. savings: ~924 MB      |                                                      |
+----------------------------+------------------------------------------------------+
| Esc Back                   | [Start Batch ↵]       [Open Output Folder ⌘↵]  [⌘K]  | <- Layer 4: Footer bar
+----------------------------+------------------------------------------------------+
```

- Build with `<List isShowingDetail={false} workbenchPanel={...} subList={...}>`: `workbenchPanel.fields` holds left parameters (`select` / `toggle` / `text` / `info`) and optional `previewCard`; `subList` holds the checkable queue.
- Primary footer action is typically "Start Processing"; secondary is "Open Output Folder".

Examples:

| Plugin | Platform | Highlight |
| --- | --- | --- |
| [`screenshot`](../../extensions/screenshot/src/index.tsx) | Cross-platform | Capture options + checkable capture list |
| [`batch-video`](../../extensions/batch-video/src/index.ts) | Windows only | Transcode options + queue with size estimates |

### Forms & Detail Pages

Use `Form` for secondary create/edit pages and `Detail` (Markdown + optional `Detail.Metadata`) for read-only result views. They share the same header and footer bar and are typically pushed via `Action.Push` (`Esc` returns).

## Choosing a Layout

Answer in order; the first "Yes" picks your layout:

**Q0: Does the command perform one action and finish immediately without a list or selection?** (e.g., lock screen, toggle dark mode, generate UUID to clipboard, copy timestamp)

Yes -> **Headless command** (`"mode": "no-view"` in `plugin.json`). Default-export an async function that returns a status string (or throws on error):

```ts
import { Clipboard } from "@ztools/declarative-ui";

export default async function Command() {
  const value = String(Date.now());
  await Clipboard.copy(value); // throws on failure; client shows error
  return `Copied ${value}`;
}
```

**Q1: Does the user configure a set of processing parameters on the left while inspecting a task queue and estimates on the right?**

Yes -> **Layout 3**.

**Q2: Is the data a one-to-many "left category / drive / account / table -> right checkable detail list for batch operations" relationship?**

Yes -> **Layout 2**.

**Q3: Is it a secondary create/edit form or a read-only single-document result?**

Yes -> `Form` or `Detail`.

**All other view plugins** -> **Layout 1**:

| Scenario | Pattern |
| --- | --- |
| A few toggles or quick actions | Omit `filterBar`, `isShowingDetail={false}` |
| Search / monitors (processes, ports, windows) | Single-line `filterBar={{ summaryText, actions }}`, `isShowingDetail={false}` |
| Right pane displays real content (long text, definitions, images) | `isShowingDetail={true}`, content only on the right |

## Prop Conventions

| Location | Convention |
| --- | --- |
| Search bar filter / sort / source switcher | `searchBarAccessory={<List.Dropdown value={...} onChange={...}>...</List.Dropdown>}` |
| Layer 2 status bar | `filterBar={{ summaryText: "Concise summary", actions: [{ id: "rescan", title: "Rescan", onAction }] }}` (max 2 actions; omit for lightweight plugins) |
| Row right-side metadata | `accessories={[{ progress: 0.65 }, { tag: "Image" }, { text: "8.0 GB" }]}`—no `color` except `Color.Red` for critical warnings (> 90%) |
| Footer bar | `<ActionPanel>` on the selected item (or `subList` row): 1st direct `Action` is `Enter`, 2nd is `Cmd/Ctrl+Enter`, rest go into `Cmd/Ctrl+K`. If an action explicitly declares `{ modifiers: ["ctrl"], key: "return" }`, it owns `Cmd/Ctrl+Enter` across both footer and menu |

### Shortcut Rules & Reserved Host Hotkeys

1. **Standardize on `"ctrl"` as the primary modifier**: Use `"ctrl"` in `Action.shortcut.modifiers` for cross-platform plugins (auto-mapped to `Cmd` on macOS and `Ctrl` on Windows). Never mix `"cmd"` and `"ctrl"` in the same plugin. Single-key bindings like `shortcut="space"` are supported.
2. **Never bind reserved host hotkeys**: The client consumes these globally or at the shell level (declaring them is blocked at runtime and triggers `UI_RESERVED_SHORTCUT`):
   - `Ctrl/Cmd+,`: Open Settings
   - `Ctrl/Cmd+U`: Toggle launcher / workspace mode
   - `Ctrl/Cmd+Shift+P`: Pop out plugin into a standalone window
   - `Ctrl/Cmd+K`: Toggle action menu
   - `Esc`: Close overlay, pop view, or clear search
3. **No duplicate shortcuts in one panel**: Do not assign the same shortcut to multiple actions in one `ActionPanel`; only the first takes effect.

Legacy SDK props/components that **must not be used** (flagged by the scanner):

| Legacy Prop / Component | Why Forbidden | Replacement |
| --- | --- | --- |
| `metricGrid`, `MetricGrid`, `MetricCard` | Cards above the list steal list space (Principle 1) | Put key numbers in `filterBar.summaryText` |
| `distributionBar`, `DistributionBar` | Duplicates category navigation and adds rainbow colors (Principles 2 & 5) | Put counts/percentages in left nav `accessories` |
| `filterBar.groups` alongside `searchBarAccessory` or left nav | Duplicate filter entry (Principle 2) | Keep a single filter entry point |

## Pre-Submit Checklist

Check every item before opening a PR; fix any "Yes":

1. Did you invent a fourth layout, write HTML/CSS, or touch the DOM?
2. Did you place stat cards (`metricGrid` / `MetricGrid`) or a colored distribution bar (`distributionBar`) above the list?
3. Did you pass `filterBar.groups` when a `searchBarAccessory` dropdown or left navigation already exists?
4. Are there any colored emojis in titles, status bars, options, or button labels?
5. Did you assign decorative colors (`Color.Blue`, `Color.Green`, etc.) to normal icons or tags?
6. With `isShowingDetail={true}`, does the right pane merely repeat the title and path already in the list row? (Switch to a full-width list.)

The scanner partially catches items 2–5 (below); items 1 (custom layout) and 6 are verified manually by reviewers.

## Scanner Diagnostics

`node scripts/scan-plugin-security.mjs extensions/<id>` reports UI diagnostics below. `UI_*` codes are warnings (they do not fail CI, but maintainers require fixing them); the last three are hard errors that fail scanning.

| Code | Severity | Meaning | Rule | Fix |
| --- | --- | --- | --- | --- |
| `UI_COLORFUL_EMOJI` | Warning | Colored emoji found in source | Principle 5, Check #4 | Remove emoji; use `Icon.*` |
| `UI_METRIC_GRID` | Warning | Uses `MetricGrid` / `metricGrid` | Principle 1, Check #2 | Move key numbers into `filterBar.summaryText` |
| `UI_DISTRIBUTION_BAR` | Warning | Uses `DistributionBar` / `distributionBar` | Principles 2 & 5, Check #2 | Remove bar; use nav item `accessories` |
| `UI_RAINBOW_COLOR` | Warning | `color` / `tintColor` uses `Color.Blue`, `Green`, `Orange`, `Purple`, `Yellow`, or `Magenta` | Principle 5, Check #5 | Remove color; reserve `Color.Red` for critical alerts |
| `UI_DUPLICATE_FILTER` | Warning | Same file uses both `searchBarAccessory` and `filterBar.groups` | Principle 2, Check #3 | Keep one filter entry point |
| `UI_RESERVED_SHORTCUT` | Warning | `Action.shortcut` binds a reserved host hotkey (`Ctrl+Shift+P`, `Ctrl+,`, `Ctrl+U`, `Ctrl+K`, `Escape`) | Shortcut rules | Pick a non-conflicting shortcut |
| `DISALLOWED_STYLE_FILE` | Error | `.css` / `.less` / `.scss` / `.sass` / `.styl` file in plugin dir | Check #1 | Delete style files; describe UI with components |
| `DISALLOWED_INLINE_STYLE` | Error | `<style>` tag or `style="..."` attribute in HTML | Check #1 | Remove HTML; use components |
| `DISALLOWED_DOM_STYLE_INJECTION` | Error | `document.createElement('style' / 'link')`, mutating `.style`, or injecting `<style>` via `innerHTML` | Check #1 | Remove style injection; let the client style views |

Security scanner rules (`eval`, obfuscation, undeclared permissions, etc.) are documented in [Review Standards · Scanner Rules](review.md#scanner-rules).
