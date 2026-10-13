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
  getSampleHistoryItems,
  formatTimeAgo,
  type HistoryItem
} from './logic'

declare const ztools: any

export default function BrowserHistoryCommand() {
  const [searchText, setSearchText] = useState('')
  const [historyItems, setHistoryItems] = useState<HistoryItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // 载入历史记录（带实时计算的相对时间）
    const items = getSampleHistoryItems().map(item => ({
      ...item,
      timeAgo: formatTimeAgo(item.visitTime)
    }))
    setHistoryItems(items)
    setLoading(false)
  }, [])

  async function openUrl(item: HistoryItem) {
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
  const filtered = historyItems.filter(item => {
    if (!query) return true
    return (
      item.title.toLowerCase().includes(query) ||
      item.url.toLowerCase().includes(query)
    )
  })

  return List({
    isLoading: loading,
    searchBarPlaceholder: '搜索历史记录 (如 github, raycast, electron)...',
    onSearchTextChange: setSearchText,
    children: [
      List.Section({
        title: `历史记录 (${filtered.length}/${historyItems.length})`,
        children: filtered.map(item =>
          List.Item({
            id: item.id,
            title: item.title,
            subtitle: item.url,
            icon: {
              source: Icon.Clock,
              tintColor: item.browser === 'Chrome' ? Color.Yellow : Color.Blue
            },
            accessories: [
              {
                text: item.timeAgo
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
                  onAction: () => openUrl(item)
                }),
                Action({
                  title: '复制网址 (URL)',
                  icon: Icon.Clipboard,
                  shortcut: { modifiers: ['ctrl'], key: 'c' },
                  onAction: () => {
                    Clipboard.copy(item.url)
                    showToast({
                      style: Toast.Style.Success,
                      title: '已复制网址',
                      message: item.url
                    })
                  }
                }),
                Action({
                  title: '复制网页标题',
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
