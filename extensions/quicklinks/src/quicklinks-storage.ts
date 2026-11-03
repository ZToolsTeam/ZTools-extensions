import type { Quicklink, QuicklinkCategory, QuicklinkItem, QuicklinkResolved } from './types'

export const DEFAULT_QUICKLINKS: Quicklink[] = [
  {
    id: 'ql-1',
    title: 'GitHub 代码与仓库搜索',
    link: 'https://github.com/search?q={query}',
    urlPattern: 'https://github.com/search?q={query}',
    keyword: 'gh',
    alias: 'gh',
    category: 'search',
    isGroup: false,
    description: '检索 GitHub 全球开源仓库、代码与 Issue',
    icon: 'code',
    defaultArgument: 'ztools',
    openCount: 0,
    createdAt: 1700000000000,
    updatedAt: 1700000000000
  },
  {
    id: 'ql-2',
    title: '知乎深度问答检索',
    link: 'https://www.zhihu.com/search?type=content&q={query}',
    urlPattern: 'https://www.zhihu.com/search?type=content&q={query}',
    keyword: 'zh',
    alias: 'zh',
    category: 'search',
    isGroup: false,
    description: '在知乎搜索行业深度技术解析与评测',
    icon: 'globe',
    openCount: 0,
    createdAt: 1700000000000,
    updatedAt: 1700000000000
  },
  {
    id: 'ql-3',
    title: '哔哩哔哩搜索',
    link: 'https://search.bilibili.com/all?keyword={query}',
    urlPattern: 'https://search.bilibili.com/all?keyword={query}',
    keyword: 'bili',
    alias: 'bili',
    category: 'search',
    isGroup: false,
    description: 'B 站硬核科技视频与教程直达',
    icon: 'play',
    openCount: 0,
    createdAt: 1700000000000,
    updatedAt: 1700000000000
  },
  {
    id: 'ql-6',
    title: '谷歌搜索',
    link: 'https://www.google.com/search?q={query}',
    urlPattern: 'https://www.google.com/search?q={query}',
    keyword: 'gg',
    alias: 'gg',
    category: 'search',
    isGroup: false,
    description: '在谷歌搜索网页',
    icon: 'globe',
    openCount: 0,
    createdAt: 1700000000000,
    updatedAt: 1700000000000
  },
  {
    id: 'ql-7',
    title: '小红书搜索',
    link: 'https://www.xiaohongshu.com/search_result?keyword={query}',
    urlPattern: 'https://www.xiaohongshu.com/search_result?keyword={query}',
    keyword: 'xhs',
    alias: 'xhs',
    category: 'search',
    isGroup: false,
    description: '在小红书搜索笔记与经验分享',
    icon: 'globe',
    openCount: 0,
    createdAt: 1700000000000,
    updatedAt: 1700000000000
  },
  {
    id: 'ql-4',
    title: 'DeepSeek 智能对话工作台',
    link: 'https://chat.deepseek.com',
    urlPattern: 'https://chat.deepseek.com',
    keyword: 'ds',
    alias: 'ds',
    category: 'direct',
    isGroup: false,
    description: 'DeepSeek-R1 官方大模型深度思考与对话平台',
    icon: 'globe',
    openCount: 0,
    createdAt: 1700000000000,
    updatedAt: 1700000000000
  },
  {
    id: 'ql-5',
    title: '开发者常用文档网址组',
    link: 'https://developer.mozilla.org/zh-CN/',
    urlPattern: 'https://developer.mozilla.org/zh-CN/',
    keyword: 'docs',
    alias: 'docs',
    category: 'group',
    isGroup: true,
    urls: [
      'https://developer.mozilla.org/zh-CN/',
      'https://stackoverflow.com/',
      'https://github.com/trending'
    ],
    description: '示例：一键打开 MDN 文档、Stack Overflow 与 GitHub 趋势（共 3 个网页），可改成自己的网址',
    icon: 'window',
    openCount: 0,
    createdAt: 1700000000000,
    updatedAt: 1700000000000
  }
]

const STORAGE_KEY = 'ztools:quicklinks:data'

/** {query} / {argument} / {arg}，可带 name="…" default="…" 等属性 */
const PLACEHOLDER_SOURCE = String.raw`\{(query|argument|arg)(?:\s+[^}]*)?\}`

export function hasQueryPlaceholder(url: string): boolean {
  return new RegExp(PLACEHOLDER_SOURCE, 'i').test(String(url ?? ''))
}

/** 按网址重新推断类型：网址组为 group，带占位符为 search，否则 direct */
export function inferQuicklinkCategory(item: Pick<Quicklink, 'isGroup' | 'link' | 'urlPattern'>): QuicklinkCategory {
  if (item.isGroup) return 'group'
  return hasQueryPlaceholder(item.urlPattern || item.link) ? 'search' : 'direct'
}

export function validateQuicklinkUrlPattern(rawUrl: string): {
  valid: boolean
  normalizedUrl: string
  error?: string
} {
  const trimmed = String(rawUrl ?? '').trim()
  if (!trimmed) {
    return { valid: false, normalizedUrl: '', error: 'INVALID_URL: 目标网址不能为空' }
  }
  const lower = trimmed.toLowerCase()
  if (
    lower.startsWith('javascript:') ||
    lower.startsWith('vbscript:') ||
    lower.startsWith('data:text/html')
  ) {
    return {
      valid: false,
      normalizedUrl: '',
      error: 'DANGEROUS_PROTOCOL: 严禁使用 javascript: 等危险脚本伪协议'
    }
  }
  let normalizedUrl = ''
  if (/^https?:\/\//i.test(trimmed)) {
    normalizedUrl = trimmed
  } else if (/^[a-z0-9.-]+\.[a-z]{2,}(\/.*)?$/i.test(trimmed)) {
    normalizedUrl = `https://${trimmed}`
  } else {
    return {
      valid: false,
      normalizedUrl: '',
      error: 'INVALID_URL: 请输入合法的 http(s):// 网址或域名'
    }
  }
  // 与客户端打开网址的校验一致：必须能解析出主机名，且不能带账号密码，否则保存后也打不开
  let parsed: URL
  try {
    parsed = new URL(normalizedUrl.replace(new RegExp(PLACEHOLDER_SOURCE, 'gi'), 'q'))
  } catch {
    return { valid: false, normalizedUrl: '', error: 'INVALID_URL: 网址格式无效' }
  }
  if (!parsed.hostname) {
    return { valid: false, normalizedUrl: '', error: 'INVALID_URL: 网址缺少域名' }
  }
  if (parsed.username || parsed.password) {
    return { valid: false, normalizedUrl: '', error: 'INVALID_URL: 网址不能包含账号或密码' }
  }
  return { valid: true, normalizedUrl }
}

/** 别名用于"别名 + 空格 + 关键词"匹配：不能含空格，也不能与其他条目重复（否则后一个永远匹配不到） */
export function validateQuicklinkAlias(
  rawAlias: string,
  links: Quicklink[],
  selfId?: string
): { valid: boolean; alias?: string; error?: string } {
  const alias = String(rawAlias ?? '').trim()
  if (!alias) return { valid: true }
  if (/\s/.test(alias)) return { valid: false, error: '别名不能包含空格' }
  const lower = alias.toLowerCase()
  const clash = links.find((item) => item.id !== selfId && (item.alias || item.keyword || '').toLowerCase() === lower)
  if (clash) return { valid: false, error: `别名「${alias}」已被「${clash.title}」使用` }
  return { valid: true, alias }
}

/** 网址组：每行一个网址，全部合法才通过 */
export function parseGroupUrls(text: string): { valid: boolean; urls: string[]; error?: string } {
  const lines = String(text ?? '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  if (lines.length === 0) return { valid: false, urls: [], error: '网址组至少需要一个网址' }
  const urls: string[] = []
  for (const [index, line] of lines.entries()) {
    const check = validateQuicklinkUrlPattern(line)
    if (!check.valid) return { valid: false, urls: [], error: `第 ${index + 1} 行：${check.error}` }
    urls.push(check.normalizedUrl)
  }
  return { valid: true, urls }
}

/**
 * 构建目标访问 URL：
 * - 若传入 queryText，进行严格的 encodeURIComponent 替换；
 * - 若未传入 queryText 且模板带 {query}，智能降级返回站点首页 origin
 */
export function buildTargetUrl(pattern: string, queryText?: string): string {
  const check = validateQuicklinkUrlPattern(pattern)
  if (!check.valid) {
    throw new Error(check.error)
  }
  const normalized = check.normalizedUrl
  const hasPlaceholder = hasQueryPlaceholder(normalized)
  const cleanQuery = String(queryText ?? '').trim()

  if (!hasPlaceholder) {
    return normalized
  }

  if (cleanQuery) {
    return normalized.replace(
      /\{(query|argument|arg)(?:\s+[^}]*)?\}/gi,
      encodeURIComponent(cleanQuery)
    )
  }

  // 智能降级至站点主页
  try {
    const parsed = new URL(normalized.replace(/\{(query|argument|arg)(?:\s+[^}]*)?\}/gi, ''))
    return parsed.origin
  } catch {
    return normalized.split('?')[0] || normalized
  }
}

/** 通过宿主打开网址；宿主拒绝或不支持时抛错，不能当作已打开 */
async function openExternalUrl(targetUrl: string): Promise<void> {
  const g = globalThis as Record<string, unknown>
  const win = (typeof window !== 'undefined' ? window : g) as Record<string, unknown>
  const ztools = (win.ztools || g.ztools) as { shell?: { openExternal?: (u: string) => Promise<boolean | void> } } | undefined
  const electron = win.__ztoolsElectron as
    | { transport?: { methods?: Record<string, (request: Record<string, unknown>) => Promise<{ success?: boolean; error?: { message?: string } } | undefined>> } }
    | undefined
  if (typeof ztools?.shell?.openExternal === 'function') {
    if ((await ztools.shell.openExternal(targetUrl)) === false) throw new Error(`系统未能打开：${targetUrl}`)
    return
  }
  const method = electron?.transport?.methods?.shell_open_external
  if (typeof method === 'function') {
    const reply = await method({ params: { url: targetUrl } })
    if (reply?.success !== true) throw new Error(reply?.error?.message || `系统未能打开：${targetUrl}`)
    return
  }
  throw new Error('当前客户端不支持打开网址，请升级客户端')
}

export async function launchQuicklink(
  item: QuicklinkItem | Quicklink,
  queryText?: string,
  opener?: (url: string) => Promise<void> | void
): Promise<string[]> {
  const openFn = opener ?? openExternalUrl

  if (item.isGroup && Array.isArray(item.urls) && item.urls.length > 0) {
    const launched: string[] = []
    for (const rawUrl of item.urls) {
      const target = buildTargetUrl(rawUrl, queryText)
      try {
        await openFn(target)
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        throw new Error(launched.length ? `已打开 ${launched.length} 个，第 ${launched.length + 1} 个打开失败：${reason}` : reason)
      }
      launched.push(target)
    }
    return launched
  }

  const pattern = item.urlPattern || ('link' in item ? item.link : '')
  const target = buildTargetUrl(pattern, queryText)
  await openFn(target)
  return [target]
}

function getStorage(): Storage {
  if (typeof localStorage === 'undefined') throw new Error('当前宿主没有快捷链接存储，无法保存')
  return localStorage
}

export async function getQuicklinks(): Promise<Quicklink[]> {
  const data = getStorage().getItem(STORAGE_KEY)
  if (data === null) return [...DEFAULT_QUICKLINKS]
  const parsed = JSON.parse(data) as Quicklink[]
  if (!Array.isArray(parsed) || parsed.some((item) => !item || typeof item.id !== 'string' || typeof item.title !== 'string' || typeof item.link !== 'string')) {
    throw new Error('快捷链接存储格式无效，未覆盖原数据')
  }
  return parsed
}

export async function saveQuicklinks(quicklinks: Quicklink[]): Promise<void> {
  getStorage().setItem(STORAGE_KEY, JSON.stringify(quicklinks))
}

export function resolveQuicklinkUrl(
  linkTemplate: string,
  queryParam?: string,
  defaultParam?: string
): QuicklinkResolved {
  if (!linkTemplate || typeof linkTemplate !== 'string') {
    return { url: '', hasQuery: false, needsArgument: false }
  }
  const placeholderRegex =
    /\{(query|argument|arg)(?:\s+name="([^"]*)")?(?:\s+default="([^"]*)")?\}/gi
  const hasQuery = placeholderRegex.test(linkTemplate)
  if (!hasQuery) {
    return { url: linkTemplate.trim(), hasQuery: false, needsArgument: false }
  }
  placeholderRegex.lastIndex = 0
  const rawArg = queryParam !== undefined && queryParam !== null ? String(queryParam).trim() : ''
  let missingArgument = false
  const resolved = linkTemplate.replace(placeholderRegex, (_m, _t, _n, defaultAttr) => {
    if (rawArg) return encodeURIComponent(rawArg)
    if (defaultAttr !== undefined && defaultAttr !== null) return encodeURIComponent(defaultAttr)
    if (defaultParam) return encodeURIComponent(defaultParam)
    missingArgument = true
    return ''
  })
  return {
    url: resolved,
    hasQuery: true,
    queryParam: rawArg,
    needsArgument: missingArgument && !rawArg
  }
}

export function filterQuicklinks(
  quicklinks: Quicklink[],
  searchQuery: string,
  categoryFilter: 'all' | QuicklinkCategory = 'all'
): { matches: Quicklink[]; directMatch?: { quicklink: Quicklink; queryArg: string } } {
  const byCategory = quicklinks.filter((ql) => {
    if (categoryFilter === 'all') return true
    return (ql.category || inferQuicklinkCategory(ql)) === categoryFilter
  })

  if (!searchQuery || !searchQuery.trim()) {
    return { matches: byCategory }
  }

  const query = searchQuery.trim()
  const parts = query.split(/\s+/)
  const firstWord = (parts[0] || '').toLowerCase()
  const restArg = parts.slice(1).join(' ')

  const directQuicklink = byCategory.find(
    (ql) => (ql.alias || ql.keyword || '').toLowerCase() === firstWord
  )

  if (directQuicklink && restArg) {
    return {
      matches: [directQuicklink],
      directMatch: {
        quicklink: directQuicklink,
        queryArg: restArg
      }
    }
  }

  const qLower = query.toLowerCase()
  const matches = byCategory.filter(
    (ql) =>
      ql.title.toLowerCase().includes(qLower) ||
      ql.link.toLowerCase().includes(qLower) ||
      (ql.keyword && ql.keyword.toLowerCase().includes(qLower)) ||
      (ql.alias && ql.alias.toLowerCase().includes(qLower)) ||
      (ql.description && ql.description.toLowerCase().includes(qLower))
  )

  return { matches }
}

export function exportQuicklinksJson(quicklinks: Quicklink[]): string {
  return JSON.stringify(quicklinks, null, 2)
}

export function importQuicklinksJson(
  jsonStr: string,
  existing: Quicklink[]
): { success: boolean; importedCount: number; result: Quicklink[]; error?: string } {
  try {
    const parsed = JSON.parse(jsonStr)
    if (!Array.isArray(parsed)) {
      return {
        success: false,
        importedCount: 0,
        result: existing,
        error: '导入内容必须为 Quicklink 数组 JSON'
      }
    }
    const existingMap = new Map<string, Quicklink>()
    existing.forEach((item) => existingMap.set(item.id, item))
    let importedCount = 0
    const merged = [...existing]

    for (const item of parsed) {
      if (item && typeof item === 'object' && item.title && item.link) {
        const check = validateQuicklinkUrlPattern(String(item.link))
        if (!check.valid) continue
        importedCount++
        const id = item.id || `ql-import-${Date.now()}-${importedCount}`
        if (!existingMap.has(id)) {
          merged.push({
            id,
            title: String(item.title).trim(),
            link: check.normalizedUrl,
            urlPattern: check.normalizedUrl,
            keyword: item.keyword ? String(item.keyword).trim() : undefined,
            alias: item.alias ? String(item.alias).trim() : undefined,
            description: item.description ? String(item.description).trim() : undefined,
            createdAt: Date.now(),
            updatedAt: Date.now()
          })
          existingMap.set(id, merged[merged.length - 1]!)
        }
      }
    }
    return { success: true, importedCount, result: merged }
  } catch (err) {
    return {
      success: false,
      importedCount: 0,
      result: existing,
      error: err instanceof Error ? err.message : 'JSON 解析失败'
    }
  }
}
