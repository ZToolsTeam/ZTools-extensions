#!/usr/bin/env node

/**
 * build-plugins-release.mjs
 * ZTools GitOps 自动化打包与发布流水线脚本
 *
 * 功能：
 * 1. 自动遍历 plugins/{author}/{plugin-id} 目录结构（兼容 plugins/{plugin-id}）；
 * 2. 对每个插件执行 Schema 强校验与安全 AST 扫描门禁；
 * 3. 校验合规的插件打包为 {plugin-id}-{version}.zip；
 * 4. 计算并记录每个发布包的 SHA-256 校验和与文件大小；
 * 5. 自动生成包含全量插件元数据的静态全网索引 plugins.json（经阿里云 CDN 分发给客户端）；
 * 6. 支持模块化导出与独立 CLI 执行；
 * 7. plugin.json 声明的截图（screenshots/ 下的 PNG）不进安装包，复制到 <作者>/<id>/screenshots/<版本>/ 随发布上传，
 *    插件目录条目写入 screenshots: [{ url, title, width, height }]。
 */

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { scanPluginSecurity } from './scan-plugin-security.mjs'
import {
  getManifestPlatforms,
  validateStoreCatalog,
  OFFICIAL_PLUGIN_IDS,
  inspectScreenshotFile,
  SCREENSHOT_PATH_REGEX,
  SCREENSHOT_LIMITS,
  LOCALE_TAG_REGEX,
  normalizeCategoryId,
  resolveCategoryLabel
} from '../packages/ztools-plugins-spec/src/validator.js'
import { resolvePluginMinAppVersion } from '../packages/ztools-plugins-spec/src/host-requirements.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')

/**
 * 使用纯 Node.js 标准库制作 ZIP 二进制 Buffer
 * 保证跨平台（Windows/macOS/Linux/CI）零外部依赖、确定性与高效打包
 */
export function createZipArchiveFromDirectory(sourceDir, filterFn = null) {
  const files = []

  function walk(currentDir, baseRelative = '') {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true })
    for (const entry of entries) {
      if (['node_modules', '.git', '.DS_Store', 'Thumbs.db', '.build-runs'].includes(entry.name)) {
        continue
      }
      // 真机截图不进安装包：安装包公开可下载，截图里可能拍到个人信息，客户端运行也用不到
      if (entry.isDirectory() && entry.name.toLowerCase() === 'screenshots') {
        continue
      }
      const fullPath = path.join(currentDir, entry.name)
      const relPath = path.join(baseRelative, entry.name).replace(/\\/g, '/')

      if (filterFn && !filterFn(relPath, fullPath)) {
        continue
      }

      if (entry.isDirectory()) {
        walk(fullPath, relPath)
      } else if (entry.isFile()) {
        const data = fs.readFileSync(fullPath)
        files.push({ name: relPath, data })
      }
    }
  }

  walk(sourceDir)

  // 保证打包内文件顺序确定性
  files.sort((a, b) => a.name.localeCompare(b.name))

  const localHeaders = []
  const centralHeaders = []
  let offset = 0

  for (const file of files) {
    const nameBuf = Buffer.from(file.name, 'utf8')
    const dataBuf = file.data
    const uncompressedSize = dataBuf.length
    const fileCrc = zlib.crc32(dataBuf)
    const compressedData = zlib.deflateRawSync(dataBuf)
    const compressedSize = compressedData.length

    // Local file header (30 bytes + name length)
    const localHeader = Buffer.alloc(30 + nameBuf.length)
    localHeader.writeUInt32LE(0x04034b50, 0)
    localHeader.writeUInt16LE(20, 4) // version needed to extract
    localHeader.writeUInt16LE(0, 6)  // flags
    localHeader.writeUInt16LE(8, 8)  // deflate
    localHeader.writeUInt16LE(0, 10) // dos time
    localHeader.writeUInt16LE(0, 12) // dos date
    localHeader.writeUInt32LE(fileCrc, 14)
    localHeader.writeUInt32LE(compressedSize, 18)
    localHeader.writeUInt32LE(uncompressedSize, 22)
    localHeader.writeUInt16LE(nameBuf.length, 26)
    localHeader.writeUInt16LE(0, 28) // extra field length
    nameBuf.copy(localHeader, 30)

    // Central directory file header (46 bytes + name length)
    const centralHeader = Buffer.alloc(46 + nameBuf.length)
    centralHeader.writeUInt32LE(0x02014b50, 0)
    centralHeader.writeUInt16LE(20, 4) // version made by
    centralHeader.writeUInt16LE(20, 6) // version needed
    centralHeader.writeUInt16LE(0, 8)  // flags
    centralHeader.writeUInt16LE(8, 10) // deflate
    centralHeader.writeUInt16LE(0, 12) // dos time
    centralHeader.writeUInt16LE(0, 14) // dos date
    centralHeader.writeUInt32LE(fileCrc, 16)
    centralHeader.writeUInt32LE(compressedSize, 20)
    centralHeader.writeUInt32LE(uncompressedSize, 24)
    centralHeader.writeUInt16LE(nameBuf.length, 28)
    centralHeader.writeUInt16LE(0, 30) // extra field length
    centralHeader.writeUInt16LE(0, 32) // comment length
    centralHeader.writeUInt16LE(0, 34) // disk number start
    centralHeader.writeUInt16LE(0, 36) // internal file attributes
    centralHeader.writeUInt32LE(0, 38) // external file attributes
    centralHeader.writeUInt32LE(offset, 42) // relative offset
    nameBuf.copy(centralHeader, 46)

    localHeaders.push(localHeader, compressedData)
    centralHeaders.push(centralHeader)
    offset += localHeader.length + compressedData.length
  }

  const centralDirSize = centralHeaders.reduce((sum, h) => sum + h.length, 0)
  const endRecord = Buffer.alloc(22)
  endRecord.writeUInt32LE(0x06054b50, 0)
  endRecord.writeUInt16LE(0, 4) // disk number
  endRecord.writeUInt16LE(0, 6) // disk start
  endRecord.writeUInt16LE(files.length, 8)  // total entries this disk
  endRecord.writeUInt16LE(files.length, 10) // total entries
  endRecord.writeUInt32LE(centralDirSize, 12)
  endRecord.writeUInt32LE(offset, 16)
  endRecord.writeUInt16LE(0, 20) // comment length

  return Buffer.concat([...localHeaders, ...centralHeaders, endRecord])
}

/**
 * 读取 plugin.json 声明的截图（含 i18n.<locale>.screenshots）并逐张复核
 * （与清单校验同一套规则：screenshots/ 下的 PNG、≤ 1 MB、尺寸范围）。
 * 跳过扫描（--skip-scan）时也要复核：目录里的截图地址会直接展示在客户端与官网。
 * @returns {{
 *   errors: string[],
 *   items: Array<{ index: number, path: string, title: string, width: number, height: number, data: Buffer, hash: string }>,
 *   i18nItems: Record<string, Array<{ index: number, path: string, title: string, width: number, height: number, data: Buffer, hash: string }>>
 * }}
 */
export function collectPluginScreenshots(pluginDir, manifest) {
  const errors = []
  const items = []
  const i18nItems = {}

  function collectList(list, label, pathKey, target) {
    if (list === undefined) return
    if (!Array.isArray(list)) {
      errors.push(`${label} 必须为数组`)
      return
    }
    if (list.length > SCREENSHOT_LIMITS.maxCount) {
      errors.push(`${label} 最多 ${SCREENSHOT_LIMITS.maxCount} 张`)
      return
    }
    const seen = new Set()
    for (const [index, shot] of list.entries()) {
      const rel = pathKey === 'file' ? (shot?.file ?? shot?.path) : shot?.path
      if (typeof rel !== 'string' || !SCREENSHOT_PATH_REGEX.test(rel) || seen.has(rel)) {
        errors.push(`${label}[${index}].${pathKey} 不合法或重复: ${JSON.stringify(rel)}`)
        continue
      }
      seen.add(rel)
      const info = inspectScreenshotFile(pluginDir, rel)
      if (!info.ok) {
        errors.push(`${label === 'screenshots' ? '' : `${label}[${index}]: `}${info.error}`)
        continue
      }
      const data = fs.readFileSync(path.join(pluginDir, rel))
      target.push({
        index,
        path: rel,
        title: typeof shot.title === 'string' ? shot.title.trim() : '',
        width: info.width,
        height: info.height,
        data,
        hash: crypto.createHash('sha256').update(data).digest('hex')
      })
    }
  }

  collectList(manifest?.screenshots, 'screenshots', 'path', items)

  if (manifest?.i18n && typeof manifest.i18n === 'object' && !Array.isArray(manifest.i18n)) {
    for (const [locale, entry] of Object.entries(manifest.i18n)) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
      if (entry.screenshots === undefined) continue
      if (!LOCALE_TAG_REGEX.test(locale)) {
        errors.push(`i18n["${locale}"] 语言标签格式不合法`)
        continue
      }
      const localeShots = []
      collectList(entry.screenshots, `i18n["${locale}"].screenshots`, 'file', localeShots)
      if (localeShots.length > 0) {
        i18nItems[locale] = localeShots
      }
    }
  }

  return { errors, items, i18nItems }
}

/**
 * 截图在 CDN 上的相对路径（相对插件目录 <作者>/<id>/）：
 * - 默认截图：screenshots/<版本>/<序号>-<内容哈希前 8 位>.png
 * - 多语言截图：screenshots/<版本>/<locale>/<序号>-<内容哈希前 8 位>.png
 * 带版本号与内容哈希，与安装包一样长期强缓存；同一版本里换了图也会得到新地址，不会被旧缓存挡住。
 */
export function screenshotCdnName(version, index, hash, locale = null) {
  const filename = `${String(index + 1).padStart(2, '0')}-${hash.slice(0, 8)}.png`
  if (locale) {
    return `screenshots/${version}/${locale}/${filename}`
  }
  return `screenshots/${version}/${filename}`
}

/**
 * 解析目录中的分类字段：
 * - category：保留中文标准分类数组（向后兼容老客户端）
 * - categoryId：标准英文 slug（支持单字符串或数组，优先使用 manifest.categoryId，否则由 category 归一化推导）
 */
export function resolveCatalogCategories(manifest) {
  const rawCategoryId = manifest?.categoryId
  const rawCategory = manifest?.category

  const explicitIdList = typeof rawCategoryId === 'string'
    ? [rawCategoryId]
    : (Array.isArray(rawCategoryId) ? rawCategoryId : [])

  const normalizedExplicitIds = Array.from(
    new Set(explicitIdList.map((v) => normalizeCategoryId(v)).filter(Boolean))
  )

  const rawCategoryList = Array.isArray(rawCategory)
    ? rawCategory
    : (typeof rawCategory === 'string' && rawCategory.trim() ? [rawCategory] : [])

  const normalizedFromCategory = Array.from(
    new Set(rawCategoryList.map((v) => normalizeCategoryId(v)).filter(Boolean))
  )

  const slugList = normalizedExplicitIds.length > 0 ? normalizedExplicitIds : normalizedFromCategory

  const category = rawCategoryList.length > 0
    ? Array.from(
      new Set(
        rawCategoryList
          .map((cat) => resolveCategoryLabel(cat) || (typeof cat === 'string' ? cat.trim() : ''))
          .filter(Boolean)
      )
    )
    : slugList.map((id) => resolveCategoryLabel(id)).filter(Boolean)

  let categoryId
  if (typeof rawCategoryId === 'string' && slugList.length === 1) {
    categoryId = slugList[0]
  } else if (slugList.length > 0) {
    categoryId = slugList
  }

  return { category, categoryId }
}

/**
 * 构建写入 catalog.json / plugins.json 的 i18n 对象，透传合法多语言文本并替换为 CDN 截图 URL
 */
export function buildCatalogI18n(manifest, i18nScreenshotsByLocale = {}, { revokedOnly = false } = {}) {
  const rawI18n = manifest?.i18n
  if (!rawI18n || typeof rawI18n !== 'object' || Array.isArray(rawI18n)) {
    return undefined
  }
  const result = {}
  for (const [locale, entry] of Object.entries(rawI18n)) {
    if (!LOCALE_TAG_REGEX.test(locale)) continue
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const out = {}
    if (typeof entry.name === 'string' && entry.name.trim()) {
      out.name = entry.name.trim()
    }
    if (typeof entry.description === 'string' && entry.description.trim()) {
      out.description = entry.description.trim()
    }
    if (typeof entry.revokedReason === 'string' && entry.revokedReason.trim()) {
      out.revokedReason = entry.revokedReason.trim()
    }
    if (!revokedOnly) {
      if (Array.isArray(entry.keywords)) {
        const kws = entry.keywords.filter((k) => typeof k === 'string' && k.trim()).map((k) => k.trim())
        if (kws.length > 0) out.keywords = kws
      }
      if (entry.features && typeof entry.features === 'object' && !Array.isArray(entry.features)) {
        const featuresOut = {}
        for (const [code, feat] of Object.entries(entry.features)) {
          if (!code.trim() || !feat || typeof feat !== 'object' || Array.isArray(feat)) continue
          const featOut = {}
          if (typeof feat.explain === 'string' && feat.explain.trim()) {
            featOut.explain = feat.explain.trim()
          }
          if (Array.isArray(feat.cmds)) {
            featOut.cmds = feat.cmds
          }
          if (Object.keys(featOut).length > 0) {
            featuresOut[code] = featOut
          }
        }
        if (Object.keys(featuresOut).length > 0) {
          out.features = featuresOut
        }
      }
      const localeShots = i18nScreenshotsByLocale[locale]
      if (Array.isArray(localeShots) && localeShots.length > 0) {
        out.screenshots = localeShots
      }
    }
    if (Object.keys(out).length > 0) {
      result[locale] = out
    }
  }
  return Object.keys(result).length > 0 ? result : undefined
}

/**
 * 遍历发现插件目录列表
 * 支持两级 plugins/{author}/{plugin-id} 及单级 plugins/{plugin-id}
 */
export function discoverPluginDirectories(basePluginsDir) {
  const absBase = path.resolve(basePluginsDir)
  if (!fs.existsSync(absBase)) return []

  const pluginEntries = []

  // 1. 如果 basePluginsDir 本身就是一个插件（直接包含 plugin.json）
  if (fs.existsSync(path.join(absBase, 'plugin.json'))) {
    const manifest = JSON.parse(fs.readFileSync(path.join(absBase, 'plugin.json'), 'utf8'))
    const authorStr = typeof manifest.author === 'string'
      ? manifest.author
      : (manifest.author?.name || 'unknown')
    return [{
      author: authorStr,
      pluginId: manifest.id || path.basename(absBase),
      dir: absBase
    }]
  }

  const level1 = fs.readdirSync(absBase, { withFileTypes: true })
  for (const l1 of level1) {
    if (!l1.isDirectory() || ['node_modules', '.git', 'dist'].includes(l1.name)) continue
    const l1Path = path.join(absBase, l1.name)

    // 检查是否为单级插件目录 plugins/{plugin-id}/plugin.json
    if (fs.existsSync(path.join(l1Path, 'plugin.json'))) {
      try {
        const manifest = JSON.parse(fs.readFileSync(path.join(l1Path, 'plugin.json'), 'utf8'))
        const authorStr = typeof manifest.author === 'string'
          ? manifest.author
          : (manifest.author?.name || 'community')
        pluginEntries.push({
          author: authorStr,
          pluginId: manifest.id || l1.name,
          dir: l1Path
        })
      } catch {}
      continue
    }

    // 检查是否为标准两级目录 plugins/{author}/{plugin-id}/plugin.json
    const level2 = fs.readdirSync(l1Path, { withFileTypes: true })
    for (const l2 of level2) {
      if (!l2.isDirectory()) continue
      const l2Path = path.join(l1Path, l2.name)
      if (fs.existsSync(path.join(l2Path, 'plugin.json'))) {
        try {
          const manifest = JSON.parse(fs.readFileSync(path.join(l2Path, 'plugin.json'), 'utf8'))
          pluginEntries.push({
            author: l1.name,
            pluginId: manifest.id || l2.name,
            dir: l2Path
          })
        } catch {}
      }
    }
  }

  return pluginEntries
}

/**
 * 执行自动化打包与发布物索引生成
 * @param {object} options
 * @param {string} [options.pluginsDir] - 插件源码所在根目录
 * @param {string} [options.outputDir] - 发布物输出目录
 * @param {string} [options.cdnBaseUrl] - CDN 基础 URL
 * @param {boolean} [options.failFast] - 遇错立即退出
 * @param {boolean} [options.skipScan] - 是否跳过安全扫描（默认 false）
 * @returns {Promise<{
 *   success: boolean,
 *   total: number,
 *   passedCount: number,
 *   rejectedCount: number,
 *   draftIds: string[],
 *   pluginsIndex: object,
 *   publishedPackages: Array<{ pluginId: string, version: string, zipPath: string, sha256: string, size: number }>
 * }>}
 */
export async function buildPluginsRelease(options = {}) {
  const pluginsDir = path.resolve(options.pluginsDir || path.join(rootDir, 'plugins'))
  const outputDir = path.resolve(options.outputDir || path.join(rootDir, 'dist/plugins'))
  const cdnBaseUrl = (options.cdnBaseUrl || process.env.CDN_BASE_URL || 'https://cdn.ztools.cn').replace(/\/$/, '')
  const urlPrefix = (options.urlPrefix !== undefined ? String(options.urlPrefix) : (process.env.PLUGIN_URL_PREFIX || 'plugins-v2')).replace(/^\/+|\/+$/g, '')
  const failFast = !!options.failFast
  const skipScan = !!options.skipScan

  fs.mkdirSync(outputDir, { recursive: true })

  console.log('🚀 开始执行 ZTools GitOps 插件打包与发布流程...')
  console.log(`📂 插件扫描源: ${pluginsDir}`)
  console.log(`📦 产物输出目录: ${outputDir}`)
  console.log(`🌐 静态 CDN 域名: ${cdnBaseUrl}${urlPrefix ? '/' + urlPrefix : ''}\n`)

  const pluginEntries = discoverPluginDirectories(pluginsDir)
  if (pluginEntries.length === 0) {
    console.warn(`⚠️ 未在目录 ${pluginsDir} 下发现有效的插件工程！`)
    const emptyIndex = {
      schemaVersion: '2.0.0',
      generatedAt: new Date().toISOString(),
      cdnBaseUrl,
      total: 0,
      list: [],
      plugins: []
    }
    fs.writeFileSync(path.join(outputDir, 'plugins.json'), JSON.stringify(emptyIndex, null, 2), 'utf8')
    fs.writeFileSync(path.join(outputDir, 'catalog.json'), JSON.stringify({ success: true, ...emptyIndex }, null, 2), 'utf8')
    return {
      success: true,
      total: 0,
      passedCount: 0,
      rejectedCount: 0,
      draftIds: [],
      pluginsIndex: emptyIndex,
      publishedPackages: []
    }
  }

  const publishedPackages = []
  const catalogList = []
  const draftIds = []
  let rejectedCount = 0

  for (const entry of pluginEntries) {
    const { author, pluginId, dir } = entry
    const authorSlug = String(author || 'official')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'official'
    console.log(`\n------------------------------------------------------------`)
    console.log(`🔨 正在处理插件: [${authorSlug}/${pluginId}] (路径: ${dir})`)

    const manifestPath = path.join(dir, 'plugin.json')
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    const version = manifest.version || '1.0.0'

    // 下架开关：plugin.json 写 "revoked": true 后，目录里只保留下架记录（不扫描、不打包、不提供下载），
    // 客户端刷新目录时据此禁用已安装的该插件。有问题的插件也能立刻下架，不会被扫描失败挡住。
    if (manifest.revoked === true) {
      const reason = typeof manifest.revokedReason === 'string' && manifest.revokedReason.trim()
        ? manifest.revokedReason.trim()
        : '该插件已被官方下架禁用'
      const defaultLocale = typeof manifest.defaultLocale === 'string' && LOCALE_TAG_REGEX.test(manifest.defaultLocale)
        ? manifest.defaultLocale
        : undefined
      const revokedI18n = buildCatalogI18n(manifest, {}, { revokedOnly: true })
      console.warn(`⛔ [${pluginId}] 已下架，只写入下架记录: ${reason}`)
      catalogList.push({
        id: manifest.id || pluginId,
        pluginId: manifest.id || pluginId,
        name: manifest.name || pluginId,
        version,
        description: manifest.description || '',
        author: manifest.author,
        ...(defaultLocale ? { defaultLocale } : {}),
        revoked: true,
        revokedCode: 'OFFICIAL_REVOKED',
        revokedReason: reason,
        revoked_reason: reason,
        ...(revokedI18n ? { i18n: revokedI18n } : {}),
        publishedAt: new Date().toISOString()
      })
      continue
    }

    // 草稿：plugin.json 写 "draft": true 表示功能还没做完（例如只有示例数据），仓库里照常编译、扫描、跑测试，
    // 但不打包、不进插件目录，用户在插件市场里看不到。做完后删掉 draft 字段，PR 合并后由官方发布到插件市场。
    if (manifest.draft === true) {
      const reason = typeof manifest.draftReason === 'string' && manifest.draftReason.trim() ? manifest.draftReason.trim() : '未说明'
      console.warn(`📝 [${pluginId}] 是草稿，本次不发布: ${reason}`)
      draftIds.push(manifest.id || pluginId)
      continue
    }

    // 1. 安全 AST 扫描与 Schema 门禁
    let scanResult = null
    if (!skipScan) {
      scanResult = await scanPluginSecurity(dir)
      if (!scanResult.passed) {
        console.error(`❌ [${pluginId}] 安全审计门禁未通过，拒绝打包发布:`)
        for (const v of scanResult.violations) {
          console.error(`   - [${v.rule}] ${v.file}:${v.line}:${v.column} -> ${v.message}`)
        }
        rejectedCount++
        if (failFast) {
          throw new Error(`插件 ${pluginId} 安全审计失败，构建中止！`)
        }
        continue
      }
      console.log(`✅ [${pluginId}] AST 安全扫描通过！`)
      if (scanResult.requiresTwoManReview) {
        console.warn(`⚠️  [${pluginId}] 触发双人人工复核 (Two-Man Rule): ${scanResult.twoManReviewReasons.join('; ')}`)
      }
    }

    // 截图在打包前复核（跳过扫描时同样复核），不合格的插件不产出任何文件
    const shotResult = collectPluginScreenshots(dir, manifest)
    if (shotResult.errors.length > 0) {
      console.error(`❌ [${pluginId}] 截图不符合要求，拒绝发布:`)
      for (const e of shotResult.errors) console.error(`   - ${e}`)
      rejectedCount++
      if (failFast) {
        throw new Error(`插件 ${pluginId} 截图校验失败，构建中止！`)
      }
      continue
    }

    // 2. 打包为 ZIP 文件
    const zipFileName = `${pluginId}-${version}.zip`
    const pluginOutputDir = path.join(outputDir, authorSlug, pluginId)
    fs.mkdirSync(pluginOutputDir, { recursive: true })

    const zipFilePath = path.join(pluginOutputDir, zipFileName)
    console.log(`📦 正在生成 ZIP 发布包: ${zipFileName}...`)

    const zipBuffer = createZipArchiveFromDirectory(dir)
    fs.writeFileSync(zipFilePath, zipBuffer)

    // 3. 计算 SHA256 校验和与包体大小
    const sha256 = crypto.createHash('sha256').update(zipBuffer).digest('hex')
    const size = zipBuffer.length

    console.log(`✓ 压缩打包完成: 大小 ${(size / 1024).toFixed(2)} KB, SHA256 = ${sha256}`)

    const relPrefix = urlPrefix ? `${urlPrefix}/${authorSlug}/${pluginId}` : `${authorSlug}/${pluginId}`
    const downloadRelPath = `${relPrefix}/${zipFileName}`
    const downloadUrl = `${cdnBaseUrl}/${downloadRelPath}`

    // 4. 拷贝图标至输出目录以便 CDN 静态分发
    let iconUrl = manifest.icon
    if (manifest.icon && fs.existsSync(path.join(dir, manifest.icon))) {
      const iconExt = path.extname(manifest.icon)
      const iconTargetName = `icon${iconExt}`
      const iconTargetPath = path.join(pluginOutputDir, iconTargetName)
      fs.copyFileSync(path.join(dir, manifest.icon), iconTargetPath)
      iconUrl = `${cdnBaseUrl}/${relPrefix}/${iconTargetName}`
    }

    // 5. 截图随版本上传到 CDN（不进安装包），目录里只写地址、说明与尺寸（同步覆盖多语言截图）
    const screenshots = shotResult.items.map((shot) => {
      const cdnName = screenshotCdnName(version, shot.index, shot.hash)
      const target = path.join(pluginOutputDir, ...cdnName.split('/'))
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.writeFileSync(target, shot.data)
      return { url: `${cdnBaseUrl}/${relPrefix}/${cdnName}`, title: shot.title, width: shot.width, height: shot.height }
    })
    const i18nScreenshotsByLocale = {}
    let i18nScreenshotCount = 0
    for (const [locale, localeShots] of Object.entries(shotResult.i18nItems || {})) {
      i18nScreenshotsByLocale[locale] = localeShots.map((shot) => {
        const cdnName = screenshotCdnName(version, shot.index, shot.hash, locale)
        const target = path.join(pluginOutputDir, ...cdnName.split('/'))
        fs.mkdirSync(path.dirname(target), { recursive: true })
        fs.writeFileSync(target, shot.data)
        i18nScreenshotCount++
        return { url: `${cdnBaseUrl}/${relPrefix}/${cdnName}`, title: shot.title, width: shot.width, height: shot.height }
      })
    }
    if (screenshots.length || i18nScreenshotCount) {
      console.log(`🖼  已附带 ${screenshots.length} 张默认截图${i18nScreenshotCount ? `、${i18nScreenshotCount} 张多语言截图` : ''}`)
    }

    const twoManReviewStatus = (scanResult && scanResult.requiresTwoManReview)
      ? { required: true, reasons: scanResult.twoManReviewReasons, status: 'pending' }
      : { required: false, reasons: [], status: 'approved' }

    // 官方标记只看维护者维护的官方名单（packages/ztools-plugins-spec/official-ids.json），不看作者名或目录名：
    // 作者名谁都能写，按作者名判断会让社区插件拿到官方标记
    const isOfficial = OFFICIAL_PLUGIN_IDS.has(manifest.id)

    const { minAppVersion, apis: requiredHostApis } = resolvePluginMinAppVersion(dir, manifest)
    if (minAppVersion) {
      console.log(`ℹ 最低客户端版本 ${minAppVersion}${requiredHostApis.length ? `（用到 ${requiredHostApis.join('、')}）` : ''}`)
    }

    const { category, categoryId } = resolveCatalogCategories(manifest)
    const defaultLocale = typeof manifest.defaultLocale === 'string' && LOCALE_TAG_REGEX.test(manifest.defaultLocale)
      ? manifest.defaultLocale
      : undefined
    const catalogI18n = buildCatalogI18n(manifest, i18nScreenshotsByLocale)

    const pluginMetadata = {
      id: manifest.id,
      pluginId: manifest.id,
      name: manifest.name,
      version: manifest.version,
      description: manifest.description,
      author: manifest.author,
      // 保留中文分类数组兼容老客户端；新客户端优先按标准英文 slug categoryId 归类与本地化渲染
      category,
      ...(categoryId !== undefined ? { categoryId } : {}),
      ...(defaultLocale ? { defaultLocale } : {}),
      keywords: manifest.keywords || [],
      permissions: manifest.permissions || [],
      icon: iconUrl,
      entry: manifest.entry,
      minZToolsVersion: manifest.minZToolsVersion || '2.0.0',
      // 客户端只认 minAppVersion：低于它时不提供更新、安装前提示先升级客户端
      ...(minAppVersion ? { minAppVersion } : {}),
      requireAdmin: !!manifest.requireAdmin,
      // 平台声明由 plugin.json 的 targets 决定（安全扫描已校验必填与格式），不再默认填「双端」
      targets: manifest.targets,
      // 便于客户端与市场直接展示：'windows' / 'macos' 的子集
      platforms: getManifestPlatforms(manifest),
      nativeComponents: Array.isArray(manifest.nativeComponents) ? manifest.nativeComponents : [],
      // 新客户端应直接依据 is_official 布尔值按当前语言本地化渲染官方徽章；
      // official_badge 仅保留用于向后兼容老客户端，不应被新客户端作为文案真源依赖
      is_official: isOfficial,
      official_badge: isOfficial ? '官方自营' : '',
      window: manifest.window,
      features: manifest.features || [],
      ...(screenshots.length ? { screenshots } : {}),
      ...(catalogI18n ? { i18n: catalogI18n } : {}),
      downloadUrl,
      sha256,
      checksum: sha256,
      size,
      file_size: size,
      twoManReview: twoManReviewStatus,
      publishedAt: new Date().toISOString()
    }

    catalogList.push(pluginMetadata)
    publishedPackages.push({
      author: authorSlug,
      pluginId,
      version,
      zipPath: zipFilePath,
      sha256,
      size,
      downloadUrl
    })
  }

  // 5. 生成包含全量插件元数据的静态全网索引 plugins.json 与 catalog.json
  const generatedAt = new Date().toISOString()
  const pluginsIndex = {
    schemaVersion: '2.0.0',
    generatedAt,
    cdnBaseUrl,
    total: catalogList.length,
    list: catalogList,
    plugins: catalogList
  }

  // 写出前整体校验：插件 ID 重复、版本号或下载信息不合法时不生成目录
  const catalogCheck = validateStoreCatalog(pluginsIndex)
  if (!catalogCheck.valid) {
    throw new Error(`插件目录校验失败，已停止生成:\n  - ${catalogCheck.errors.join('\n  - ')}`)
  }

  const indexPath = path.join(outputDir, 'plugins.json')
  fs.writeFileSync(indexPath, JSON.stringify(pluginsIndex, null, 2), 'utf8')

  const catalogPath = path.join(outputDir, 'catalog.json')
  fs.writeFileSync(catalogPath, JSON.stringify({ success: true, ...pluginsIndex }, null, 2), 'utf8')

  console.log(`\n============================================================`)
  console.log(`📄 静态全网索引 plugins.json & catalog.json 已生成: ${indexPath}`)
  console.log(`📊 统计: 共发现 ${pluginEntries.length} 个插件，成功打包 ${catalogList.length} 个，拦截拒绝 ${rejectedCount} 个，草稿未发布 ${draftIds.length} 个`)
  console.log(`============================================================\n`)

  return {
    success: rejectedCount === 0,
    total: pluginEntries.length,
    passedCount: catalogList.length,
    rejectedCount,
    draftIds,
    pluginsIndex,
    publishedPackages
  }
}

async function runCli() {
  const args = process.argv.slice(2)
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
用法:
  node scripts/build-plugins-release.mjs [选项]

选项:
  --plugins-dir <path>    插件源码根目录 (默认: plugins)
  --output-dir <path>     产物输出目录 (默认: dist/plugins)
  --cdn-base-url <url>    静态分发 CDN 域名 (默认: https://cdn.ztools.cn)
  --url-prefix <prefix>   CDN 相对路径前缀 (默认: plugins-v2，即阿里云 OSS 上的目录)
  --fail-fast             遇错立即退出
  --skip-scan             跳过安全扫描 (仅限调试)
  --help, -h              显示帮助信息
    `.trim())
    process.exit(0)
  }

  function getArg(flag, fallback) {
    const idx = args.indexOf(flag)
    if (idx !== -1 && idx + 1 < args.length) return args[idx + 1]
    return fallback
  }

  const pluginsDir = getArg('--plugins-dir', path.join(rootDir, 'plugins'))
  const outputDir = getArg('--output-dir', path.join(rootDir, 'dist/plugins'))
  const cdnBaseUrl = getArg('--cdn-base-url', process.env.CDN_BASE_URL || 'https://cdn.ztools.cn')
  const urlPrefix = getArg('--url-prefix', process.env.PLUGIN_URL_PREFIX || 'plugins-v2')
  const failFast = args.includes('--fail-fast')
  const skipScan = args.includes('--skip-scan')

  const result = await buildPluginsRelease({
    pluginsDir,
    outputDir,
    cdnBaseUrl,
    urlPrefix,
    failFast,
    skipScan
  })

  if (!result.success) {
    console.error('❌ 发布流水线构建失败：存在被安全门禁拦截的插件！')
    process.exit(1)
  } else {
    console.log('🎉 插件发布流水线打包与全网静态索引构建圆满完成！')
    process.exit(0)
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  runCli().catch(err => {
    console.error('构建发生异常:', err)
    process.exit(1)
  })
}
