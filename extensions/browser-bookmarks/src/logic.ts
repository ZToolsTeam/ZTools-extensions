export interface BookmarkItem {
  id: string
  title: string
  url: string
  folder: string
  browser: 'Chrome' | 'Edge' | 'Other'
}

interface ChromiumRawNode {
  id?: string
  name?: string
  type?: 'folder' | 'url'
  url?: string
  children?: ChromiumRawNode[]
}

interface ChromiumRawRoot {
  roots?: Record<string, ChromiumRawNode>
}

/**
 * 递归解析 Chromium 书签节点
 */
function traverseNode(
  node: ChromiumRawNode,
  currentFolder: string,
  browser: 'Chrome' | 'Edge' | 'Other',
  result: BookmarkItem[]
) {
  if (!node) return

  if (node.type === 'url' && node.url) {
    result.push({
      id: `${browser}-${node.id || Math.random().toString(36).slice(2)}`,
      title: node.name || node.url,
      url: node.url,
      folder: currentFolder || '根目录',
      browser
    })
  } else if (Array.isArray(node.children)) {
    const folderName = node.name || ''
    const nextFolder = currentFolder ? (folderName ? `${currentFolder} / ${folderName}` : currentFolder) : folderName
    for (const child of node.children) {
      traverseNode(child, nextFolder, browser, result)
    }
  }
}

/**
 * 解析 Chromium Bookmarks JSON 文本
 */
export function parseChromiumBookmarks(
  jsonContent: string,
  browser: 'Chrome' | 'Edge' | 'Other' = 'Chrome'
): BookmarkItem[] {
  if (!jsonContent || typeof jsonContent !== 'string') return []

  try {
    const data: ChromiumRawRoot = JSON.parse(jsonContent)
    if (!data || !data.roots) return []

    const items: BookmarkItem[] = []
    for (const rootKey of Object.keys(data.roots)) {
      const rootNode = data.roots[rootKey]
      if (rootNode) {
        traverseNode(rootNode, '', browser, items)
      }
    }
    return items
  } catch {
    return []
  }
}

/**
 * 获取本机典型书签文件绝对路径
 */
export function getStandardBookmarkPaths(localAppData: string = ''): Array<{ path: string; browser: 'Chrome' | 'Edge' }> {
  if (!localAppData) return []
  return [
    {
      path: `${localAppData}\\Google\\Chrome\\User Data\\Default\\Bookmarks`,
      browser: 'Chrome'
    },
    {
      path: `${localAppData}\\Microsoft\\Edge\\User Data\\Default\\Bookmarks`,
      browser: 'Edge'
    }
  ]
}

/**
 * 预设样例书签数据（离线或缺少权限时兜底）
 */
export function getFallbackBookmarks(): BookmarkItem[] {
  return [
    {
      id: 'fb-1',
      title: 'GitHub: Let’s build from here',
      url: 'https://github.com',
      folder: '开发常用',
      browser: 'Chrome'
    },
    {
      id: 'fb-2',
      title: 'ZTools: 现代化桌面效率中枢',
      url: 'https://ztools.cn',
      folder: '效率工具',
      browser: 'Edge'
    },
    {
      id: 'fb-3',
      title: 'MDN Web Docs',
      url: 'https://developer.mozilla.org',
      folder: '开发常用',
      browser: 'Chrome'
    },
    {
      id: 'fb-4',
      title: 'TypeScript: JavaScript With Syntax For Types',
      url: 'https://www.typescriptlang.org',
      folder: '语言与框架',
      browser: 'Edge'
    },
    {
      id: 'fb-5',
      title: 'Vite | Next Generation Frontend Tooling',
      url: 'https://vitejs.dev',
      folder: '语言与框架',
      browser: 'Chrome'
    }
  ]
}
