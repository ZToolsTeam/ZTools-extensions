#!/usr/bin/env node

/**
 * create-plugin.mjs
 * ZTools 声明式插件脚手架
 *
 * 生成的工程与插件仓库里的现有插件结构一致：
 * 1. plugin.json：只写宿主实际读取的字段（id、name、version、description、author、entry、icon、mode、
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
import { buildPlatformTargets, describePlatforms, SUPPORTED_PLATFORMS } from '../packages/ztools-plugins-spec/src/validator.js'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')

/** 插件 ID：小写字母开头，只含小写字母、数字、短横线；构建脚本 build-declarative.mjs 不接受下划线 */
export const PLUGIN_ID_REGEX = /^[a-z][a-z0-9-]{1,63}$/

export const DEFAULT_AUTHOR = 'ZTools Developer'
const DEFAULT_DESCRIPTION = '一个 ZTools 声明式插件'

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
    return { valid: false, error: '插件 ID 不能为空，且必须为字符串' }
  }
  const trimmed = pluginId.trim()
  if (trimmed !== pluginId) {
    return { valid: false, error: '插件 ID 首尾不能包含空格' }
  }
  if (trimmed.includes('/') || trimmed.includes('\\') || trimmed.includes('..')) {
    return { valid: false, error: '插件 ID 不能包含路径分隔符或上级目录引用 (..)' }
  }
  if (!PLUGIN_ID_REGEX.test(trimmed)) {
    return {
      valid: false,
      error: `插件 ID 格式不符合规范: "${trimmed}"（必须以小写字母开头，只能用小写字母、数字和短横线，长度 2-64 字符，例如: 'quick-notes'）`
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
    throw new Error(`无法识别的平台选项: "${value}"（可选 cross / windows / macos）`)
  }
  return [...new Set(platforms)]
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
  targetDir = defaultTargetDir(),
  force = false,
  platforms = [...SUPPORTED_PLATFORMS]
}) {
  // 平台声明非法时直接报错，不生成半成品目录
  const targets = buildPlatformTargets(platforms)
  // 1. 校验 ID
  const idCheck = validatePluginId(pluginId)
  if (!idCheck.valid) {
    throw new Error(idCheck.error)
  }

  const normalizedTitle = cleanText(title, pluginId)
  const normalizedDesc = cleanText(description, DEFAULT_DESCRIPTION)
  const normalizedAuthor = cleanText(author, DEFAULT_AUTHOR)
  if (normalizedTitle.length > 50) throw new Error(`插件名称不能超过 50 个字符（当前 ${normalizedTitle.length} 个）`)
  if (normalizedDesc.length > 500) throw new Error(`插件描述不能超过 500 个字符（当前 ${normalizedDesc.length} 个）`)
  if (normalizedAuthor.length > 100) throw new Error(`作者不能超过 100 个字符（当前 ${normalizedAuthor.length} 个）`)

  // 2. 目标路径与冲突保护
  const absTargetDir = path.isAbsolute(targetDir) ? targetDir : path.resolve(rootDir, targetDir)
  const pluginDir = path.join(absTargetDir, pluginId)

  if (fs.existsSync(pluginDir) && !force) {
    throw new Error(`目标插件目录已存在: "${pluginDir}"。若要强制覆盖，请指定 --force 标志。`)
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

  // 4. plugin.json（只写宿主读取的字段；单命令插件不需要 features，默认导出就是入口）
  const manifest = {
    id: pluginId,
    name: normalizedTitle,
    version: '1.0.0',
    description: normalizedDesc,
    author: normalizedAuthor,
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

// 示例数据，换成插件自己的内容
export const SAMPLE_ITEMS: readonly Phrase[] = [
  { id: "thanks", title: "收到，谢谢", content: "收到，谢谢！", category: "回复" },
  { id: "later", title: "稍后回复", content: "我稍后回复你。", category: "回复" },
  { id: "signature", title: "邮件落款", content: "祝好\\n张三", category: "签名" }
];

/** 按标题、内容、分类过滤；关键字为空或不是字符串时返回全部 */
export function filterItems(items: readonly Phrase[], query: unknown): Phrase[] {
  const keyword = typeof query === "string" ? query.trim().toLowerCase() : "";
  if (!keyword) return [...items];
  return items.filter((item) =>
    [item.title, item.content, item.category].some((text) => text.toLowerCase().includes(keyword))
  );
}
`
  )

  // 9. src/index.tsx：单栏列表；第 1 个 Action 是回车主动作，第 2 个是次动作，其余进动作面板
  writeFileLf(
    'src/index.tsx',
    `import React, { List, ActionPanel, Action, Icon, Clipboard, showToast, Toast, useState } from "@ztools/declarative-ui";
import { SAMPLE_ITEMS, filterItems } from "./items.js";

export default function Command() {
  const [searchText, setSearchText] = useState<string>("");
  const items = filterItems(SAMPLE_ITEMS, searchText);

  return (
    <List
      navigationTitle={${JSON.stringify(normalizedTitle)}}
      searchBarPlaceholder="搜索短语"
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
              <Action.CopyToClipboard title="复制内容" content={item.content} />
              <Action
                title="复制标题"
                icon={Icon.CopyClipboard}
                onAction={async () => {
                  await Clipboard.copy(item.title);
                  await showToast(Toast.Style.Success, "已复制标题");
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
import { renderDeclarativeRoot } from "@ztools/declarative-ui";

const pluginDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(fs.readFileSync(path.join(pluginDir, "plugin.json"), "utf8"));

async function load(rel) {
  const file = path.join(pluginDir, "dist", rel);
  assert.ok(fs.existsSync(file), \`缺少 dist/\${rel}，请先在仓库根目录运行 node scripts/build-declarative.mjs \${manifest.id}\`);
  return import(pathToFileURL(file).href);
}

test("清单：id 与目录名一致，入口和图标文件存在", () => {
  assert.equal(manifest.id, path.basename(pluginDir));
  for (const key of ["name", "version", "description", "author", "entry", "icon"]) assert.ok(manifest[key], \`缺少 \${key}\`);
  assert.ok(Array.isArray(manifest.permissions));
  assert.ok(Array.isArray(manifest.targets) && manifest.targets.length > 0, "targets 至少声明一个平台");
  assert.ok(fs.existsSync(path.join(pluginDir, manifest.icon)), "图标文件不存在");
  assert.ok(fs.existsSync(path.join(pluginDir, manifest.entry)), "入口文件不存在，请先编译");
});

test("过滤：空关键字返回全部，大小写不敏感，无匹配返回空数组", async () => {
  const { SAMPLE_ITEMS, filterItems } = await load("items.js");
  assert.equal(filterItems(SAMPLE_ITEMS, "").length, SAMPLE_ITEMS.length);
  assert.equal(filterItems(SAMPLE_ITEMS, "   ").length, SAMPLE_ITEMS.length);
  assert.notEqual(filterItems(SAMPLE_ITEMS, ""), SAMPLE_ITEMS, "返回新数组，不能把原数组交出去");
  assert.deepEqual(filterItems(SAMPLE_ITEMS, "签名").map((item) => item.id), ["signature"]);
  assert.deepEqual(filterItems([{ id: "a", title: "Hello", content: "", category: "" }], "HELLO").map((item) => item.id), ["a"]);
  assert.deepEqual(filterItems(SAMPLE_ITEMS, "不存在的关键字"), []);
});

test("[异常输入] 关键字不是字符串时不报错，按空关键字处理", async () => {
  const { SAMPLE_ITEMS, filterItems } = await load("items.js");
  for (const bad of [undefined, null, 42, {}, ["签名"]]) {
    assert.equal(filterItems(SAMPLE_ITEMS, bad).length, SAMPLE_ITEMS.length, String(bad));
  }
  assert.deepEqual(filterItems([], "任意"), []);
});

test("渲染：顶层是 List，每条都有回车主动作", async () => {
  const { default: Command } = await load("index.js");
  const { SAMPLE_ITEMS } = await load("items.js");
  const root = renderDeclarativeRoot(Command);
  try {
    const view = root.getLatest();
    assert.equal(view.type, "List");
    assert.equal(view.props.navigationTitle, manifest.name);
    const rows = view.children.filter((child) => child && child.type === "List.Item");
    assert.equal(rows.length, SAMPLE_ITEMS.length);
    const firstAction = rows[0].props.actions.children[0];
    assert.equal(firstAction.type, "Action.CopyToClipboard");
    assert.equal(firstAction.props.content, SAMPLE_ITEMS[0].content);
  } finally {
    root.unmount();
  }
});
`
  )

  // 11. README.md
  writeFileLf(
    'README.md',
    `# ${normalizedTitle}

${normalizedDesc}

## 目录

| 路径 | 说明 |
| --- | --- |
| \`plugin.json\` | 插件清单：名称、版本、入口、图标、权限、支持的平台 |
| \`src/index.tsx\` | 界面（声明式组件，从 \`@ztools/declarative-ui\` 引入） |
| \`src/items.ts\` | 数据与过滤逻辑 |
| \`tests/index.test.mjs\` | 测试，运行前先编译 |
| \`icon.svg\` | 图标 |

\`dist/\` 是编译产物，不提交。

## 编译与检查

在插件仓库根目录执行：

\`\`\`bash
node scripts/build-declarative.mjs ${pluginId}
node scripts/scan-plugin-security.mjs extensions/${pluginId}
node --test extensions/${pluginId}/tests/*.test.mjs
\`\`\`

在 ZTools 客户端里试用、界面规范和提交流程见 [开发入门](https://github.com/ZToolsTeam/ZTools-extensions/blob/main/docs/getting-started.md)。
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
ZTools 插件脚手架

用法:
  node scripts/create-plugin.mjs <plugin-id> [title] [description] [选项]

参数:
  <plugin-id>       插件 ID（小写字母开头，只能用小写字母、数字和短横线，2-64 位）
  [title]           插件显示名称（可选，默认为插件 ID）
  [description]     插件功能描述（可选）

选项:
  --platform <p>     支持的平台：cross（跨平台，默认）/ windows / macos
  --author <name>    作者（默认 "${DEFAULT_AUTHOR}"）
  --target-dir <dir> 生成到哪个目录（默认 "${defaultTargetDir()}"）
  --force, -f        目标目录已存在时覆盖
  --help, -h         显示此帮助信息

示例:
  npm run create-plugin -- quick-notes "便签" "记录一段文字"
  npm run create-plugin -- wifi-tool "Wi-Fi 工具" --platform windows
    `.trim())
    process.exit(0)
  }

  const force = args.includes('--force') || args.includes('-f')
  const options = { '--target-dir': readOption(args, '--target-dir'), '--platform': readOption(args, '--platform'), '--author': readOption(args, '--author') }
  for (const [flag, opt] of Object.entries(options)) {
    if (opt.missing) {
      console.error(flag === '--platform' ? '错误: --platform 需要指定 cross / windows / macos' : `错误: ${flag} 需要一个值`)
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
        pluginId = (await rl.question('? 插件 ID（如 my-tool，必填）: ')).trim()
        title = (await rl.question('? 显示名称（留空则使用 ID）: ')).trim() || pluginId
        description = (await rl.question('? 功能描述（可留空）: ')).trim()
        if (platformOption === undefined) {
          platformOption = (await rl.question('? 支持哪些平台？[1] 跨平台（默认）[2] 仅 Windows [3] 仅 macOS: ')).trim()
        }
      } finally {
        rl.close()
      }
    } else {
      console.error('错误: 缺少必填参数 <plugin-id>')
      console.error('用法: node scripts/create-plugin.mjs <plugin-id> [title] [description]')
      console.error('查看帮助: node scripts/create-plugin.mjs --help\n')
      process.exit(1)
    }
  }

  try {
    const platforms = parsePlatformOption(platformOption)
    console.log(`\n正在生成插件工程: "${pluginId}"（${describePlatforms(platforms)}）...`)
    const result = await createPlugin({
      pluginId,
      title,
      description,
      author: options['--author'].value,
      targetDir: options['--target-dir'].value ?? defaultTargetDir(),
      force,
      platforms
    })

    console.log('\n插件工程创建成功')
    console.log(`目录: ${result.pluginDir}`)
    console.log(`文件: ${result.createdFiles.join(', ')}`)
    const next = describeNextSteps(result.pluginDir)
    if (next.inRepo) {
      console.log('\n下一步（在仓库根目录执行）:')
      console.log(`  1. ${next.commands[0]}    # 编译到 dist/`)
      console.log(`  2. ${next.commands[1]}    # 清单校验与安全扫描`)
      console.log(`  3. ${next.commands[2]}    # 运行插件测试`)
    } else {
      console.log('\n提示: 这个目录不在仓库的插件目录下，构建脚本找不到它；把它移到 extensions/ 下再编译。')
    }
    console.log('详细说明: https://github.com/ZToolsTeam/ZTools-extensions/blob/main/docs/getting-started.md\n')
    process.exit(0)
  } catch (err) {
    console.error(`\n创建插件失败: ${err.message}\n`)
    process.exit(1)
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  runCli()
}
