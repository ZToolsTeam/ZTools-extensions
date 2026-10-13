import {
  List,
  ActionPanel,
  Action,
  Icon,
  Color,
  Clipboard,
  useState,
  useEffect,
  showToast,
  Toast
} from '@ztools/raycast-compat'
import {
  parseChromiumBookmarks,
  getStandardBookmarkPaths,
  getFallbackBookmarks,
  type BookmarkItem
} from './logic'

declare const ztools: any

export default function BrowserBookmarksCommand() {
  const [searchText, setSearchText] = useState('')
  const [bookmarks, setBookmarks] = useState<BookmarkItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const all: BookmarkItem[] = []
      let localAppData = ''
      if (typeof process !== 'undefined' && process.env?.LOCALAPPDATA) {
        localAppData = process.env.LOCALAPPDATA
      }

      if (typeof ztools !== 'undefined' && ztools.fs && ztools.fs.readFile && localAppData) {
        const configs = getStandardBookmarkPaths(localAppData)
        for (const cfg of configs) {
          try {
            const content = await ztools.fs.readFile(cfg.path)
            if (content) {
              const items = parseChromiumBookmarks(content, cfg.browser)
              all.push(...items)
            }
          } catch {
            // 读取单个失败跳过
          }
        }
      }

      if (all.length === 0) {
        // 使用兜底数据
        all.push(...getFallbackBookmarks())
      }

      setBookmarks(all)
      setLoading(false)
    }
    load()
  }, [])

  async function openBookmark(item: BookmarkItem) {
    try {
      if (typeof ztools !== 'undefined' && ztools.shell && ztools.shell.openExternal) {
        await ztools.shell.openExternal(item.url)
      } else if (typeof window !== 'undefined') {
        window.open(item.url, '_blank')
      }
      showToast({
        style: Toast.Style.Success,
        title: '已在浏览器中打开',
        message: item.title
      })
    } catch (err) {
      showToast({
        style: Toast.Style.Failure,
        title: '打开失败',
        message: String(err)
      })
    }
  }

  const query = searchText.trim().toLowerCase()
  const filtered = bookmarks.filter(b => {
    if (!query) return true
    return (
      b.title.toLowerCase().includes(query) ||
      b.url.toLowerCase().includes(query) ||
      b.folder.toLowerCase().includes(query)
    )
  })

  return List({
    isLoading: loading,
    searchBarPlaceholder: '搜索书签标题、网址或文件夹 (如 github, vue, mdn)...',
    onSearchTextChange: setSearchText,
    children: [
      List.Section({
        title: `书签列表 (${filtered.length}/${bookmarks.length})`,
        children: filtered.map(item =>
          List.Item({
            id: item.id,
            title: item.title,
            subtitle: item.url,
            icon: {
              source: Icon.Globe,
              tintColor: item.browser === 'Chrome' ? Color.Yellow : Color.Blue
            },
            accessories: [
              {
                text: item.folder
              },
              {
                tag: {
                  value: item.browser,
                  color: item.browser === 'Chrome' ? Color.Yellow : Color.Blue
                }
              }
            ],
            actions: ActionPanel({
              title: item.title,
              children: [
                Action({
                  title: '在浏览器中打开',
                  icon: Icon.ArrowRight,
                  onAction: () => openBookmark(item)
                }),
                Action({
                  title: '复制网址 (URL)',
                  icon: Icon.Clipboard,
                  shortcut: { modifiers: ['ctrl'], key: 'c' },
                  onAction: () => {
                    Clipboard.copy(item.url)
                    showToast({
                      style: Toast.Style.Success,
                      title: '已复制链接',
                      message: item.url
                    })
                  }
                }),
                Action({
                  title: '复制标题',
                  icon: Icon.Clipboard,
                  onAction: () => {
                    Clipboard.copy(item.title)
                    showToast({
                      style: Toast.Style.Success,
                      title: '已复制标题',
                      message: item.title
                    })
                  }
                })
              ]
            })
          })
        )
      })
    ]
  })
}
