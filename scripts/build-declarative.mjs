#!/usr/bin/env node
/**
 * 构建声明式 2.0 插件：tsc 输出 ES 模块到各插件的 dist/
 *
 * 用法：node scripts/build-declarative.mjs <plugin-id | author/plugin-id> [...]
 *       node scripts/build-declarative.mjs --all
 *
 * - 插件源码以 plugins/<id>/src 为准，必须能在插件目录内独立编译（SDK 统一从 @ztools/declarative-ui 引入）
 * - 统一以 ES2022 模块输出（宿主加载器同时兼容 ESM 与 CommonJS，这里固定一种避免各插件 tsconfig 不一致）
 * - .tsx 默认按 React.createElement 输出（插件里 import React from '@ztools/declarative-ui'）
 * - 构建前清空 dist/，避免残留已删除源码的旧产物
 * - shared/ 下的公共源码（hash.ts、native-ipc.ts）以复制方式进入插件，构建前校验副本与源文件一致
 * - 同一份脚本在内部插件仓库与公开插件仓库（ZTools-extensions，插件位于 extensions/）都能直接运行
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SHARED = ['hash.ts', 'native-ipc.ts']

// 插件所在目录：内部仓库是根目录本身，公开仓库是 extensions/
const pluginsRoot = fs.existsSync(path.join(root, 'extensions')) ? path.join(root, 'extensions') : root
const sharedRoot = [path.join(pluginsRoot, 'shared'), path.join(root, 'shared')].find((d) => fs.existsSync(d))

function firstExisting(candidates) {
  return candidates.find((p) => fs.existsSync(p))
}

// 依次在本仓库与上级仓库（内部插件仓库作为子模块时）查找
const searchRoots = [root, path.resolve(root, '..')]
const tsc = firstExisting(searchRoots.map((r) => path.join(r, 'node_modules/.bin/tsc')))
const nodeTypes = firstExisting(
  searchRoots.flatMap((r) => [
    path.join(r, 'node_modules/@types/node'),
    path.join(r, 'frontend/node_modules/@types/node'),
    path.join(r, 'electron-client/node_modules/@types/node')
  ])
)

const args = process.argv.slice(2)
// 插件目录：plugins/<id>，以及作者分组的 plugins/<author>/<id>（如 official/github）
function listAllPlugins() {
  const isPlugin = (rel) => fs.existsSync(path.join(pluginsRoot, rel, 'plugin.json')) && fs.existsSync(path.join(pluginsRoot, rel, 'tsconfig.json'))
  const out = []
  for (const d of fs.readdirSync(pluginsRoot, { withFileTypes: true })) {
    if (!d.isDirectory() || ['create-plugin', 'shared', 'scripts', 'node_modules', 'packages'].includes(d.name) || d.name.startsWith('.')) continue
    if (isPlugin(d.name)) {
      out.push(d.name)
      continue
    }
    for (const e of fs.readdirSync(path.join(pluginsRoot, d.name), { withFileTypes: true })) {
      if (e.isDirectory() && isPlugin(`${d.name}/${e.name}`)) out.push(`${d.name}/${e.name}`)
    }
  }
  return out.sort()
}

const ids = args.includes('--all') ? listAllPlugins() : args.filter((a) => !a.startsWith('--'))
if (ids.length === 0) {
  console.error('用法：node scripts/build-declarative.mjs <plugin-id> [...plugin-id] | --all')
  process.exit(2)
}
if (!tsc) {
  console.error('未找到 TypeScript 编译器（请先在仓库根目录 npm install）')
  process.exit(2)
}
if (!nodeTypes) {
  console.error('未找到 @types/node（请先在仓库根目录 npm install）')
  process.exit(2)
}

let failed = 0
for (const id of ids) {
  const dir = path.join(pluginsRoot, id)
  const manifestPath = path.join(dir, 'plugin.json')
  if (!/^(?:[a-z0-9][a-z0-9-]*\/)?[a-z0-9][a-z0-9-]*$/.test(id) || !fs.existsSync(manifestPath)) {
    console.error(`[${id}] 不是有效的插件目录`)
    failed++
    continue
  }
  let staleCopy = false
  for (const name of SHARED) {
    const copy = path.join(dir, 'src', name)
    const origin = sharedRoot && path.join(sharedRoot, name)
    if (fs.existsSync(copy) && origin && fs.existsSync(origin) && fs.readFileSync(copy, 'utf8') !== fs.readFileSync(origin, 'utf8')) {
      console.error(`[${id}] src/${name} 与 shared/${name} 不一致，请重新复制后再构建`)
      staleCopy = true
    }
  }
  if (staleCopy) {
    failed++
    continue
  }
  const hasTsx = fs.readdirSync(path.join(dir, 'src'), { recursive: true }).some((f) => String(f).endsWith('.tsx'))
  fs.rmSync(path.join(dir, 'dist'), { recursive: true, force: true })
  try {
    execFileSync(
      tsc,
      [
        '-p', path.join(dir, 'tsconfig.json'),
        '--module', 'ES2022',
        '--moduleResolution', 'bundler',
        ...(hasTsx ? ['--jsx', 'react'] : []),
        '--typeRoots', path.dirname(nodeTypes),
        '--types', 'node',
        '--outDir', path.join(dir, 'dist')
      ],
      { stdio: 'inherit' }
    )
  } catch {
    console.error(`[${id}] 编译失败`)
    failed++
    continue
  }
  const entry = JSON.parse(fs.readFileSync(manifestPath, 'utf8')).entry || 'dist/index.js'
  if (!fs.existsSync(path.join(dir, entry))) {
    console.error(`[${id}] 编译后缺少入口文件 ${entry}`)
    failed++
    continue
  }
  console.log(`[${id}] 构建完成`)
}
if (ids.length > 1) console.log(`\n共 ${ids.length} 个插件，失败 ${failed} 个`)
process.exit(failed ? 1 : 0)
