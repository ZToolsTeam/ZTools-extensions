#!/usr/bin/env node

/**
 * create-plugin.mjs
 * ZTools 声明式插件脚手架
 *
 * 生成的工程与插件仓库里的现有插件结构一致：
 * 1. plugin.json：只写宿主实际读取的字段（id、name、version、description、author、category、entry、icon、mode、
 *    permissions、targets、nativeComponents），符合 packages/ztools-plugins-spec/plugin.schema.json；
 * 2. src/：源码，SDK 一律从 '@ztools/declarative-ui' 引入；
 * 3. 不单独装 TypeScript，统一用仓库的 scripts/build-declarative.mjs 编译到 dist/（dist/ 不提交）；
 * 4. tests/：一份小测试（清单、过滤逻辑含异常输入、渲染结果）。
 *
 * 默认生成位置：仓库里有 extensions/（插件仓库）时放到 extensions/<id>，否则放到 plugins/<id>。
 */

import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline/promises'
import {
  buildPlatformTargets,
  describePlatforms,
  normalizeCategoryId,
  PLUGIN_CATEGORIES,
  PLUGIN_CATEGORY_IDS,
  resolveCategoryLabel,
  SUPPORTED_PLATFORMS
} from '../packages/ztools-plugins-spec/src/validator.js'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')

/** 插件 ID：小写字母开头，只含小写字母、数字、短横线；构建脚本 build-declarative.mjs 不接受下划线 */
export const PLUGIN_ID_REGEX = /^[a-z][a-z0-9-]{1,63}$/

export const DEFAULT_AUTHOR = 'ZTools Developer'
const DEFAULT_DESCRIPTION = 'A ZTools declarative plugin'
const DEFAULT_EN_DESCRIPTION = 'A ZTools declarative plugin'
const CJK_REGEX = /[\u4e00-\u9fa5]/

/** Convert kebab-case plugin ID into readable English display title (e.g. 'quick-notes' -> 'Quick Notes') */
function formatPluginIdAsTitle(pluginId) {
  return String(pluginId)
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

/**
 * 默认生成目录：仓库里有 extensions/ 时生成到 extensions/，否则生成到 plugins/
 * @param {string} [repoRoot]
 */
export function defaultTargetDir(repoRoot = rootDir) {
  return fs.existsSync(path.join(repoRoot, 'extensions')) ? 'extensions' : 'plugins'
}

/**
 * 校验插件 ID 是否合法
 * @param {string} pluginId
 * @returns {{ valid: boolean, error?: string }}
 */
export function validatePluginId(pluginId) {
  if (!pluginId || typeof pluginId !== 'string') {
    return { valid: false, error: 'Plugin ID must be a non-empty string' }
  }
  const trimmed = pluginId.trim()
  if (trimmed !== pluginId) {
    return { valid: false, error: 'Plugin ID must not have leading or trailing whitespace' }
  }
  if (trimmed.includes('/') || trimmed.includes('\\') || trimmed.includes('..')) {
    return { valid: false, error: 'Plugin ID must not contain path separators or parent directory references (..)' }
  }
  if (!PLUGIN_ID_REGEX.test(trimmed)) {
    return {
      valid: false,
      error: `Invalid plugin ID format: "${trimmed}" (must start with a lowercase letter and contain only lowercase letters, digits, and hyphens; length 2-64, e.g. 'quick-notes')`
    }
  }
  return { valid: true }
}

/**
 * 解析平台选项：cross / both / all（跨平台，默认）、windows / win、macos / mac，也接受逗号分隔的组合
 * @param {string | undefined} value
 * @returns {string[]} 'windows' / 'macos' 的子集
 */
export function parsePlatformOption(value) {
  const raw = String(value ?? '').trim().toLowerCase()
  if (raw === '' || raw === 'cross' || raw === 'both' || raw === 'all' || raw === '1') return [...SUPPORTED_PLATFORMS]
  const aliases = { windows: 'windows', win: 'windows', '2': 'windows', macos: 'macos', mac: 'macos', '3': 'macos' }
  const parts = raw.split(',').map((part) => part.trim()).filter(Boolean)
  const platforms = parts.map((part) => aliases[part])
  if (platforms.length === 0 || platforms.some((p) => !p)) {
    throw new Error(`Unrecognized platform option: "${value}" (allowed: cross / windows / macos)`)
  }
  return [...new Set(platforms)]
}

/**
 * 解析插件分类选项：默认 ['办公效率']，支持逗号或斜杠分隔 1-2 个标准分类（同时接受中文标准名与英文 slug）
 * @param {string | string[] | undefined} value
 * @returns {string[]} 归一化后的标准中文分类标签数组
 */
export function parseCategoryOption(value) {
  const parts = Array.isArray(value)
    ? value.map((item) => String(item ?? '').trim()).filter(Boolean)
    : String(value ?? '').split(/[,，/]/).map((item) => item.trim()).filter(Boolean)
  if (parts.length === 0) return [resolveCategoryLabel('productivity')]

  const invalid = []
  const normalized = []
  for (const rawCat of parts) {
    const label = resolveCategoryLabel(rawCat)
    if (!label) {
      invalid.push(rawCat)
      continue
    }
    if (!normalized.includes(label)) {
      normalized.push(label)
    }
  }
  if (invalid.length > 0) {
    throw new Error(
      `Unrecognized plugin category: "${invalid.join(', ')}" (allowed slugs: ${PLUGIN_CATEGORY_IDS.join(' / ')}, or labels: ${PLUGIN_CATEGORIES.join(' / ')})`
    )
  }
  if (normalized.length > 2) {
    throw new Error(`At most 2 plugin categories are allowed (received ${normalized.length})`)
  }
  return normalized
}

function cleanText(value, fallback) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function toPosix(p) {
  return p.split(path.sep).join('/')
}

/**
 * 编译与检查命令提示：构建脚本只认它所在仓库的插件目录（extensions/ 或 plugins/）
 * @param {string} pluginDir
 */
export function describeNextSteps(pluginDir, repoRoot = rootDir) {
  const candidates = [
    { script: 'scripts/build-declarative.mjs', pluginsRoot: path.join(repoRoot, 'extensions') },
    { script: 'plugins/scripts/build-declarative.mjs', pluginsRoot: path.join(repoRoot, 'plugins') }
  ].filter((c) => fs.existsSync(path.join(repoRoot, c.script)) && fs.existsSync(c.pluginsRoot))
  const rel = toPosix(path.relative(repoRoot, pluginDir))
  const id = path.basename(pluginDir)
  const build = candidates.find((c) => path.dirname(pluginDir) === c.pluginsRoot)
  return {
    inRepo: Boolean(build),
    commands: build
      ? [
          `node ${build.script} ${id}`,
          `node scripts/scan-plugin-security.mjs ${rel}`,
          `node --test ${rel}/tests/*.test.mjs`
        ]
      : []
  }
}

/**
 * 核心创建插件工程函数
 * @param {object} options
 * @param {string} options.pluginId - 插件唯一 ID
 * @param {string} [options.title] - 插件显示名称
 * @param {string} [options.description] - 插件功能描述
 * @param {string} [options.author] - 作者
 * @param {string} [options.targetDir] - 插件放置根目录（默认见 defaultTargetDir）
 * @param {boolean} [options.force] - 是否覆盖已存在的目录
 * @param {string[]} [options.platforms] - 支持的平台（'windows' / 'macos' 的子集），默认跨平台
 * @returns {Promise<{ success: boolean, pluginDir: string, createdFiles: string[] }>}
 */
export async function createPlugin({
  pluginId,
  title,
  description,
  author,
  category,
  targetDir = defaultTargetDir(),
  force = false,
  platforms = [...SUPPORTED_PLATFORMS]
}) {
  // 平台与分类声明非法时直接报错，不生成半成品目录
  const targets = buildPlatformTargets(platforms)
  const normalizedCategory = parseCategoryOption(category)
  // 1. 校验 ID
  const idCheck = validatePluginId(pluginId)
  if (!idCheck.valid) {
    throw new Error(idCheck.error)
  }

  const normalizedTitle = cleanText(title, pluginId)
  const hasCustomDesc = typeof description === 'string' && description.trim().length > 0
  const normalizedDesc = hasCustomDesc ? description.trim() : DEFAULT_DESCRIPTION
  // 严禁将中文标题或描述倒灌进 i18n['en-US']，含中文时英文条目自动回退为英文标题与默认英文描述
  const normalizedEnTitle = CJK_REGEX.test(normalizedTitle)
    ? formatPluginIdAsTitle(pluginId)
    : normalizedTitle
  const normalizedEnDesc = hasCustomDesc && !CJK_REGEX.test(normalizedDesc)
    ? normalizedDesc
    : DEFAULT_EN_DESCRIPTION
  const normalizedAuthor = cleanText(author, DEFAULT_AUTHOR)
  if (normalizedTitle.length > 50) throw new Error(`Plugin name must not exceed 50 characters (received ${normalizedTitle.length})`)
  if (normalizedDesc.length > 500) throw new Error(`Plugin description must not exceed 500 characters (received ${normalizedDesc.length})`)
  if (normalizedAuthor.length > 100) throw new Error(`Plugin author must not exceed 100 characters (received ${normalizedAuthor.length})`)

  const categorySlugs = normalizedCategory.map((cat) => normalizeCategoryId(cat))
  const categoryId = categorySlugs.length === 1 ? categorySlugs[0] : categorySlugs

  // 2. 目标路径与冲突保护
  const absTargetDir = path.isAbsolute(targetDir) ? targetDir : path.resolve(rootDir, targetDir)
  const pluginDir = path.join(absTargetDir, pluginId)

  if (fs.existsSync(pluginDir) && !force) {
    throw new Error(`Target plugin directory already exists: "${pluginDir}". Pass --force to overwrite.`)
  }

  // 3. 创建目录（覆盖时清掉旧的 dist/，避免残留旧产物）
  fs.rmSync(path.join(pluginDir, 'dist'), { recursive: true, force: true })
  fs.mkdirSync(path.join(pluginDir, 'src'), { recursive: true })
  fs.mkdirSync(path.join(pluginDir, 'tests'), { recursive: true })

  const createdFiles = []

  function writeFileLf(relPath, content) {
    const fullPath = path.join(pluginDir, relPath)
    fs.writeFileSync(fullPath, content.replace(/\r\n/g, '\n'), 'utf8')
    createdFiles.push(relPath)
  }

  // 4. plugin.json（包含多语言元数据与标准分类 slug；单命令插件不需要 features，默认导出就是入口）
  const manifest = {
    id: pluginId,
    name: normalizedTitle,
    version: '1.0.0',
    description: normalizedDesc,
    author: normalizedAuthor,
    category: normalizedCategory,
    categoryId,
    defaultLocale: 'en-US',
    i18n: {
      'en-US': {
        name: normalizedEnTitle,
        description: normalizedEnDesc
      }
    },
    entry: 'dist/index.js',
    icon: 'icon.svg',
    mode: 'view',
    // 示例用到了剪贴板；按插件实际功能增删
    permissions: ['clipboard'],
    // 支持的平台：客户端安装时据此判断当前系统能否运行，市场显示「跨平台 / 仅 Windows / 仅 macOS」
    targets,
    nativeComponents: []
  }
  writeFileLf('plugin.json', JSON.stringify(manifest, null, 2) + '\n')

  // 5. package.json：只用来把 dist/*.js 标成 ES 模块，不装依赖、不放构建脚本
  writeFileLf('package.json', JSON.stringify({ name: pluginId, version: '1.0.0', private: true, type: 'module' }, null, 2) + '\n')

  // 6. tsconfig.json：build-declarative.mjs 会统一覆盖 module / outDir 等选项。
  //    paths 指向仓库里的 SDK 类型声明；生成到仓库外时按标准位置 <仓库>/extensions/<id> 写，移进仓库后即可编译
  const insideRepo = !path.relative(rootDir, pluginDir).startsWith('..') && !path.isAbsolute(path.relative(rootDir, pluginDir))
  const sdkTypes = insideRepo
    ? path.join(rootDir, 'packages', 'declarative-ui', 'dist', 'index.d.ts')
    : path.join(pluginDir, '..', '..', 'packages', 'declarative-ui', 'dist', 'index.d.ts')
  const tsconfig = {
    compilerOptions: {
      target: 'ES2022',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      jsx: 'react',
      jsxFactory: 'React.createElement',
      jsxFragmentFactory: 'React.Fragment',
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      outDir: './dist',
      rootDir: './src',
      paths: {
        '@ztools/declarative-ui': [toPosix(path.relative(pluginDir, sdkTypes))]
      }
    },
    include: ['src/**/*']
  }
  writeFileLf('tsconfig.json', JSON.stringify(tsconfig, null, 2) + '\n')

  // 7. icon.svg（单色）
  writeFileLf(
    'icon.svg',
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <rect width="64" height="64" rx="14" fill="#4B5563" />
  <path d="M18 22h28v4H18zM18 30h28v4H18zM18 38h18v4H18z" fill="#FFFFFF" />
</svg>
`
  )

  // 8. src/items.ts：数据与过滤逻辑，和界面分开便于测试
  writeFileLf(
    'src/items.ts',
    `export interface Phrase {
  id: string;
  title: string;
  content: string;
  category: string;
}

// Sample items — replace with your own plugin data
export const SAMPLE_ITEMS: readonly Phrase[] = [
  { id: "thanks", title: "Got it, thanks", content: "Got it, thanks!", category: "Reply" },
  { id: "later", title: "Reply later", content: "I will get back to you shortly.", category: "Reply" },
  { id: "signature", title: "Email signature", content: "Best regards,\\nAlex", category: "Signature" }
];

/** Filter by title, content, or category; returns all items when query is empty or non-string */
export function filterItems(items: readonly Phrase[], query: unknown): Phrase[] {
  const keyword = typeof query === "string" ? query.trim().toLowerCase() : "";
  if (!keyword) return [...items];
  return items.filter((item) =>
    [item.title, item.content, item.category].some((text) => text.toLowerCase().includes(keyword))
  );
}
`
  )

  // 8b. src/i18n.ts：双语词典，支持 zh-CN 与 en-US 自动随宿主语言切换
  const i18nMessages = {
    'zh-CN': {
      navigationTitle: normalizedTitle,
      searchPlaceholder: '搜索短语',
      copyContent: '复制内容',
      copyTitle: '复制标题',
      copiedTitle: '已复制标题'
    },
    'en-US': {
      navigationTitle: normalizedEnTitle,
      searchPlaceholder: 'Search phrases',
      copyContent: 'Copy Content',
      copyTitle: 'Copy Title',
      copiedTitle: 'Title copied'
    }
  }
  writeFileLf(
    'src/i18n.ts',
    `import { createTranslator } from "@ztools/declarative-ui";

export const t = createTranslator(
${JSON.stringify(i18nMessages, null, 2)
  .split('\n')
  .map((line) => `  ${line}`)
  .join('\n')},
  { defaultLocale: "en-US" }
);
`
  )

  // 9. src/index.tsx：单栏列表；调用 useLocale() 订阅宿主语言切换，第 1 个 Action 是回车主动作，第 2 个是次动作，其余进动作面板
  writeFileLf(
    'src/index.tsx',
    `import React, { List, ActionPanel, Action, Icon, Clipboard, showToast, Toast, useState, useLocale } from "@ztools/declarative-ui";
import { t } from "./i18n.js";
import { SAMPLE_ITEMS, filterItems } from "./items.js";

export default function Command() {
  useLocale();
  const [searchText, setSearchText] = useState<string>("");
  const items = filterItems(SAMPLE_ITEMS, searchText);

  return (
    <List
      navigationTitle={t("navigationTitle")}
      searchBarPlaceholder={t("searchPlaceholder")}
      searchText={searchText}
      onSearchTextChange={setSearchText}
    >
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
              <Action.CopyToClipboard title={t("copyContent")} content={item.content} />
              <Action
                title={t("copyTitle")}
                icon={Icon.CopyClipboard}
                onAction={async () => {
                  await Clipboard.copy(item.title);
                  await showToast(Toast.Style.Success, t("copiedTitle"));
                }}
              />
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}
`
  )

  // 10. tests/index.test.mjs：先编译（dist/）再运行
  writeFileLf(
    'tests/index.test.mjs',
    `import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { getLocale, renderDeclarativeRoot, setRuntimeLocale } from "@ztools/declarative-ui";

const pluginDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(fs.readFileSync(path.join(pluginDir, "plugin.json"), "utf8"));

async function load(rel) {
  const file = path.join(pluginDir, "dist", rel);
  assert.ok(fs.existsSync(file), \`Missing dist/\${rel}; run node scripts/build-declarative.mjs \${manifest.id} from the repository root first\`);
  return import(pathToFileURL(file).href);
}

test("manifest: id matches directory name and required/i18n metadata exist", () => {
  assert.equal(manifest.id, path.basename(pluginDir));
  for (const key of ["name", "version", "description", "author", "entry", "icon", "defaultLocale", "categoryId"]) {
    assert.ok(manifest[key], \`Missing \${key}\`);
  }
  assert.ok(manifest.i18n?.["en-US"]?.name, "Missing i18n[en-US].name");
  assert.ok(manifest.i18n?.["en-US"]?.description, "Missing i18n[en-US].description");
  assert.ok(Array.isArray(manifest.permissions));
  assert.ok(Array.isArray(manifest.targets) && manifest.targets.length > 0, "targets must declare at least one platform");
  assert.ok(fs.existsSync(path.join(pluginDir, manifest.icon)), "icon file does not exist");
  assert.ok(fs.existsSync(path.join(pluginDir, manifest.entry)), "entry file does not exist; build first");
});

test("filter: empty query returns all items, case-insensitive, unmatched returns empty array", async () => {
  const { SAMPLE_ITEMS, filterItems } = await load("items.js");
  assert.equal(filterItems(SAMPLE_ITEMS, "").length, SAMPLE_ITEMS.length);
  assert.equal(filterItems(SAMPLE_ITEMS, "   ").length, SAMPLE_ITEMS.length);
  assert.notEqual(filterItems(SAMPLE_ITEMS, ""), SAMPLE_ITEMS, "must return a new array copy");
  assert.deepEqual(filterItems(SAMPLE_ITEMS, "signature").map((item) => item.id), ["signature"]);
  assert.deepEqual(filterItems([{ id: "a", title: "Hello", content: "", category: "" }], "HELLO").map((item) => item.id), ["a"]);
  assert.deepEqual(filterItems(SAMPLE_ITEMS, "nonexistent-keyword"), []);
});

test("[invalid input] non-string query does not throw and behaves as empty query", async () => {
  const { SAMPLE_ITEMS, filterItems } = await load("items.js");
  for (const bad of [undefined, null, 42, {}, ["signature"]]) {
    assert.equal(filterItems(SAMPLE_ITEMS, bad).length, SAMPLE_ITEMS.length, String(bad));
  }
  assert.deepEqual(filterItems([], "any"), []);
});

test("render: root is List, each row has primary action, and copy updates on locale switch", async () => {
  const { default: Command } = await load("index.js");
  const { SAMPLE_ITEMS } = await load("items.js");
  const prevLocale = getLocale();
  setRuntimeLocale("zh-CN");
  const root = renderDeclarativeRoot(Command);
  try {
    const zhView = root.getLatest();
    assert.equal(zhView.type, "List");
    assert.equal(zhView.props.navigationTitle, manifest.name);
    assert.equal(zhView.props.searchBarPlaceholder, ${JSON.stringify(i18nMessages['zh-CN'].searchPlaceholder)});
    const rows = zhView.children.filter((child) => child && child.type === "List.Item");
    assert.equal(rows.length, SAMPLE_ITEMS.length);
    const firstAction = rows[0].props.actions.children[0];
    assert.equal(firstAction.type, "Action.CopyToClipboard");
    assert.equal(firstAction.props.content, SAMPLE_ITEMS[0].content);

    setRuntimeLocale("en-US");
    await new Promise((resolve) => queueMicrotask(resolve));
    const enView = root.getLatest();
    assert.equal(enView.props.navigationTitle, manifest.i18n["en-US"].name);
    assert.equal(enView.props.searchBarPlaceholder, ${JSON.stringify(i18nMessages['en-US'].searchPlaceholder)});
  } finally {
    root.unmount();
    setRuntimeLocale(prevLocale);
  }
});
`
  )

  // 11. README.md
  writeFileLf(
    'README.md',
    `# ${normalizedTitle}

${normalizedDesc}

## Structure

| Path | Description |
| --- | --- |
| \`plugin.json\` | Plugin manifest: name, version, category, i18n metadata, entry, icon, permissions, targets |
| \`src/index.tsx\` | Declarative UI view (imported from \`@ztools/declarative-ui\`) |
| \`src/i18n.ts\` | Bilingual dictionary (\`zh-CN\` / \`en-US\`, created via \`createTranslator\`) |
| \`src/items.ts\` | Sample data and filtering logic |
| \`tests/index.test.mjs\` | Unit tests (build first before running) |
| \`icon.svg\` | Plugin icon |

\`dist/\` contains build artifacts and should not be committed.

## Build and Verify

Run from the extensions repository root:

\`\`\`bash
node scripts/build-declarative.mjs ${pluginId}
node scripts/scan-plugin-security.mjs extensions/${pluginId}
node --test extensions/${pluginId}/tests/*.test.mjs
\`\`\`

See [Getting Started](https://github.com/ZToolsTeam/ZTools-extensions/blob/main/docs/en/getting-started.md) for testing in ZTools, UI guidelines, and submission workflow.
`
  )

  return {
    success: true,
    pluginDir,
    createdFiles
  }
}

/** 取 --flag <value>；value 缺失或是另一个选项时返回 { missing: true } */
function readOption(args, flag) {
  const index = args.indexOf(flag)
  if (index === -1) return { index }
  const value = args[index + 1]
  if (value === undefined || value.startsWith('-')) return { index, missing: true }
  return { index, value }
}

/**
 * CLI 命令行交互与执行入口
 */
async function runCli() {
  const args = process.argv.slice(2)

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
ZTools Plugin Scaffold

Usage:
  node scripts/create-plugin.mjs <plugin-id> [title] [description] [options]

Arguments:
  <plugin-id>       Plugin ID (lowercase letter start, lowercase letters/digits/hyphens only, 2-64 chars)
  [title]           Plugin display name (optional, defaults to plugin ID)
  [description]     Plugin description (optional)

Options:
  --platform <p>     Supported platforms: cross (default) / windows / macos
  --category <c>     Plugin category (1-2 comma-separated items, default "productivity"; slugs: ${PLUGIN_CATEGORY_IDS.join(' / ')})
  --author <name>    Author name (default "${DEFAULT_AUTHOR}")
  --target-dir <dir> Output parent directory (default "${defaultTargetDir()}")
  --force, -f        Overwrite target directory if it already exists
  --help, -h         Show this help message

Examples:
  npm run create-plugin -- quick-notes "Quick Notes" "Capture short snippets" --category productivity
  npm run create-plugin -- wifi-tool "Wi-Fi Tool" --platform windows --category network
    `.trim())
    process.exit(0)
  }

  const force = args.includes('--force') || args.includes('-f')
  const options = {
    '--target-dir': readOption(args, '--target-dir'),
    '--platform': readOption(args, '--platform'),
    '--category': readOption(args, '--category'),
    '--author': readOption(args, '--author')
  }
  for (const [flag, opt] of Object.entries(options)) {
    if (opt.missing) {
      console.error(flag === '--platform' ? 'Error: --platform requires cross / windows / macos' : `Error: ${flag} requires a value`)
      process.exit(1)
    }
  }
  const optionIndexes = new Set(Object.values(options).flatMap((opt) => (opt.index === -1 ? [] : [opt.index, opt.index + 1])))
  const positionalArgs = args.filter((arg, i) => !arg.startsWith('-') && !optionIndexes.has(i))

  let pluginId = positionalArgs[0]
  let title = positionalArgs[1]
  let description = positionalArgs[2]
  let platformOption = options['--platform'].value

  // 没有参数且处于终端交互环境时，逐项询问
  if (!pluginId) {
    if (process.stdin.isTTY) {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
      try {
        pluginId = (await rl.question('? Plugin ID (e.g. my-tool, required): ')).trim()
        title = (await rl.question('? Display name (defaults to ID if blank): ')).trim() || pluginId
        description = (await rl.question('? Description (optional): ')).trim()
        if (platformOption === undefined) {
          platformOption = (await rl.question('? Supported platforms? [1] Cross-platform (default) [2] Windows only [3] macOS only: ')).trim()
        }
      } finally {
        rl.close()
      }
    } else {
      console.error('Error: Missing required argument <plugin-id>')
      console.error('Usage: node scripts/create-plugin.mjs <plugin-id> [title] [description]')
      console.error('Help: node scripts/create-plugin.mjs --help\n')
      process.exit(1)
    }
  }

  try {
    const platforms = parsePlatformOption(platformOption)
    const category = parseCategoryOption(options['--category'].value)
    console.log(`\nScaffolding plugin project: "${pluginId}" (${describePlatforms(platforms)})...`)
    const result = await createPlugin({
      pluginId,
      title,
      description,
      author: options['--author'].value,
      category,
      targetDir: options['--target-dir'].value ?? defaultTargetDir(),
      force,
      platforms
    })

    console.log('\nPlugin project created successfully')
    console.log(`Directory: ${result.pluginDir}`)
    console.log(`Files: ${result.createdFiles.join(', ')}`)
    const next = describeNextSteps(result.pluginDir)
    if (next.inRepo) {
      console.log('\nNext steps (run from repository root):')
      console.log(`  1. ${next.commands[0]}    # Build to dist/`)
      console.log(`  2. ${next.commands[1]}    # Manifest validation & security scan`)
      console.log(`  3. ${next.commands[2]}    # Run plugin tests`)
    } else {
      console.log('\nNote: This directory is outside the repository plugins folder; move it into extensions/ before building.')
    }
    console.log('Guide: https://github.com/ZToolsTeam/ZTools-extensions/blob/main/docs/en/getting-started.md\n')
    process.exit(0)
  } catch (err) {
    console.error(`\nFailed to create plugin: ${err.message}\n`)
    process.exit(1)
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  runCli()
}
