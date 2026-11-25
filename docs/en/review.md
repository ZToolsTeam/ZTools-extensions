**English** | [简体中文](../review.md)

# Review Standards

Every new plugin and every update to an existing plugin follows the same Pull Request workflow:

1. **Automated CI checks**: Run automatically on every PR; must pass before merge.
2. **Maintainer review**: Maintainers review the code and diff against the standards below and request changes in the PR when needed.
3. **Merge**: Maintainers merge approved PRs.
4. **Publication**: After the PR is merged, the official team publishes approved plugins to the plugin marketplace.

## Four Gates Before Marketplace Publication

| Gate | What It Enforces |
| --- | --- |
| Manual review | Real functionality, UI guideline compliance, clear non-duplicate naming, and justified permissions (details below) |
| Manifest validation & static scan | CI validates `plugin.json` against `plugin.schema.json` (including path containment for entry and icon) and statically scans source code (see [Scanner Rules](#scanner-rules)) |
| Source-only builds & checksums | Release CI compiles and packages from source—author-uploaded build artifacts are never accepted. Each package's SHA-256 is written to the catalog and verified by clients before install |
| Revocation switch | Problematic plugins are marked `revoked` in their manifest; clients automatically disable installed copies on catalog refresh (see [Publishing Guide · Revocation](publishing.md#revocation)) |

## What Maintainers Review

### Real, Working Functionality

- Solves a concrete use case; placeholder or demo-only plugins are not accepted. Mark unfinished work as `draft` per [Publishing Guide · Drafts](publishing.md#drafts).
- **No fake results**: When real data cannot be obtained, show a real error or empty state—never substitute sample data or report success after a failure (e.g., never show "Copied" if clipboard write failed).
- Empty, loading, error, missing-permission, and offline states all render clear feedback without blank screens or freezes.
- Manually tested in the real client on every platform listed in `targets`, with tested OS versions recorded in the PR.

### UI Guideline Compliance

Reviewed against [UI Guidelines](ui-guidelines.md): uses one of the three standard layouts, orders actions by frequency, avoids colored emojis and meaningless rainbow colors, and never duplicates controls. Although `UI_*` scanner warnings do not fail CI, maintainers require them to be resolved before merge; the two checklist items that static scanning cannot catch (custom fourth layout and detail panes that merely repeat list rows) are checked manually.

### Clear, Unique, Non-Impersonating Identity

- `name` and `description` state plainly what the plugin does without exaggeration.
- No duplicate functionality: prefer improving an existing plugin over submitting a near-clone.
- Names, icons, and author strings must not impersonate other products or the ZTools team.
- `author` follows [Author Attribution](publishing.md#author-attribution): `ZTools Team` for official plugins, GitHub handle or real team name for community plugins (no `ZTools Community` generic label or scaffold placeholder), and original author preserved on updates.
- The marketplace's "Official" badge is controlled exclusively by `packages/ztools-plugins-spec/official-ids.json`; community plugins using official author names are rejected by CI.

### Authentic Screenshots

Every declared [screenshot](publishing.md#screenshots) is inspected:

- Shows the real UI of the current version—not mockups or stitched composites;
- Light theme;
- Zero personal data: no real names, accounts, phone numbers, emails, local home paths, private IPs, MAC addresses, or real filenames (use synthetic data);
- Format, size, and dimensions are enforced by CI manifest validation.

### Localization Completeness

- `plugin.json` should provide `defaultLocale`, `categoryId`, and `i18n["en-US"]` (with accurate English `name` and `description`); when `features` are localized, every key in `i18n.<locale>.features` must match a `code` defined in top-level `features`.
- Use `src/i18n.ts` (`createTranslator`) and `useLocale()` for bilingual UI copy: `zh-CN` and `en-US` must share identical key sets and `{var}` placeholders with no empty translations, and no untranslated strings should leak into English mode.

### Necessary Permissions

- Declare only permissions actually used, and explain each permission's purpose in the PR.
- High-risk permissions (`network`, `fs`, `shell`, `child_process`, `system`, `process`) undergo heightened review. Network-using plugins must list target domains and purposes in their README.
- See [API Reference · Permissions](api.md#permissions).

### Code Quality

- When system capabilities fail (host error, missing permission, timeout), surface specific error-code feedback instead of swallowing errors; no empty `catch {}` blocks.
- Validate all external inputs (user input, files, network responses, clipboard) before use.
- Clean up timers, listeners, and polling in `useEffect` cleanup functions; support cancellation for long operations and avoid state updates after unmount.
- Keep local paths, usernames, tokens, and personal data out of code, comments, logs, and test fixtures.
- Tests cover normal results, empty states, invalid inputs, and dependency failures—not just happy paths.

General principles in the client repository's [Coding Standards](https://github.com/ZToolsTeam/ZTools/blob/main/docs/en/coding-standards.md) and [Testing](https://github.com/ZToolsTeam/ZTools/blob/main/docs/en/testing.md) also apply to plugins.

## What CI Checks

Every PR runs two checks:

```bash
node --test packages/ztools-plugins-spec/tests/*.test.mjs
node scripts/verify-changed-plugins.mjs --base origin/main
```

`verify-changed-plugins.mjs` checks every plugin affected by the PR in sequence:

1. Directory name matches `plugin.json` `id` and no duplicate `id` exists across the repo;
2. Compiles cleanly from source (including TypeScript checks);
3. Manifest validation and static security scan pass with zero errors (including screenshot format, size, and dimensions);
4. All `tests/*.test.mjs` pass;
5. Existing modified plugins bumped `version`;
6. No plugin directory was deleted.

See [Pre-Merge Checks](publishing.md#pre-merge-checks) for what counts as an affected plugin and version-bump rules.

## Scanner Rules

`node scripts/scan-plugin-security.mjs extensions/<id>` reports the following errors (any error fails the scan; `tests/`, `*.test.*`, and `*.spec.*` are skipped):

| Code | Meaning |
| --- | --- |
| `MISSING_PLUGIN_MANIFEST` / `INVALID_JSON_MANIFEST` | Missing `plugin.json` or invalid JSON |
| `MANIFEST_SCHEMA_VIOLATION` | Manifest fails schema validation: missing required fields, bad format, unknown permission, or missing entry/icon file (build before scanning) |
| `BANNED_DYNAMIC_EVAL` | Uses `eval`, including concatenated/computed property forms (`window["ev" + "al"]`) or reflective `window[var]()` calls |
| `BANNED_DYNAMIC_FUNCTION` | Uses `new Function()` / `Function()` or `({}).constructor.constructor(...)` bypasses |
| `BANNED_DYNAMIC_REQUIRE` | `require()` called with a non-literal argument |
| `HEX_STRING_OBFUSCATION` / `OBFUSCATOR_VARIABLE_DETECTED` | Heavy `\x..` hex escapes or `_0x...` obfuscator identifiers; submit readable source, never obfuscated or minified bundles |
| `UNSUPPORTED_RUNTIME_MODULE` | Imports a Node built-in not provided by the declarative runtime (e.g., `fs`, `child_process`, `os`, `http`). Only slim `crypto` and `path` (with or without `node:`) are available—see [Available Modules](api.md#available-modules). Use host APIs for files and commands |
| `UNAUTHORIZED_NODE_MODULE` | Imports a Node module without declaring its corresponding permission |
| `UNAUTHORIZED_NETWORK_CALL` | Calls `fetch`, `XMLHttpRequest`, `WebSocket`, or `EventSource` without declaring `network` |
| `UNAUTHORIZED_PROCESS_EXECUTION` | Calls `exec`, `spawn`, or similar process APIs without declaring `child_process` |
| `DISALLOWED_STYLE_FILE` / `DISALLOWED_INLINE_STYLE` / `DISALLOWED_DOM_STYLE_INJECTION` | Includes style files, inline styles, or DOM style injection; see [UI Guidelines · Scanner Diagnostics](ui-guidelines.md#scanner-diagnostics) |
| `SYNTAX_PARSE_ERROR` / `NO_PARSER_AVAILABLE` | Source cannot be parsed or dependencies are not installed (`npm ci --ignore-scripts` at repo root) |

A "Manual security review required" flag in scanner output is not an error: it signals that the plugin declares high-risk permissions or uses sensitive capabilities like networking or process execution, which maintainers will verify against your PR explanation.
