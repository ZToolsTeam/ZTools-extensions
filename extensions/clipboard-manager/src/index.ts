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
} from '@ztools/declarative-ui'
import {
  addClipboardEntry,
  togglePinEntry,
  deleteEntry,
  clearUnpinnedEntries,
  getSampleClipboardEntries,
  type ClipboardEntry
} from './logic'

const STORAGE_KEY = 'ztools_clipboard_entries'

export default function ClipboardManagerCommand() {
  const [searchText, setSearchText] = useState('')
  const [entries, setEntries] = useState<ClipboardEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    try {
      let saved: ClipboardEntry[] = []
      if (typeof localStorage !== 'undefined') {
        const raw = localStorage.getItem(STORAGE_KEY)
        if (raw) saved = JSON.parse(raw)
      }
      if (!saved || saved.length === 0) {
        saved = getSampleClipboardEntries()
      }
      setEntries(saved)
    } finally {
      setLoading(false)
    }
  }, [])

  function updateAndPersist(next: ClipboardEntry[]) {
    setEntries(next)
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    }
  }

  function copyText(entry: ClipboardEntry) {
    Clipboard.copy(entry.text)
    showToast({
      style: Toast.Style.Success,
      title: '已复制到剪贴板',
      message: entry.text.length > 40 ? `${entry.text.slice(0, 40)}...` : entry.text
    })
  }

  const query = searchText.trim().toLowerCase()
  const filtered = entries.filter(e => {
    if (!query) return true
    return e.text.toLowerCase().includes(query)
  })

  const pinned = filtered.filter(e => e.pinned)
  const unpinned = filtered.filter(e => !e.pinned)

  function getIconForType(type: ClipboardEntry['type']) {
    switch (type) {
      case 'url':
        return { source: Icon.Globe, tintColor: Color.Blue }
      case 'code':
        return { source: Icon.Code, tintColor: Color.Green }
      case 'json':
        return { source: Icon.Document, tintColor: Color.Orange }
      default:
        return { source: Icon.Text, tintColor: Color.PrimaryText }
    }
  }

  function renderItem(item: ClipboardEntry) {
    return List.Item({
      id: item.id,
      title: item.text.replace(/[\r\n]+/g, ' ').slice(0, 60),
      subtitle: `${item.length} 字符`,
      icon: getIconForType(item.type),
      accessories: [
        {
          tag: {
            value: item.type.toUpperCase(),
            color: item.type === 'url' ? Color.Blue : item.type === 'code' ? Color.Green : Color.SecondaryText
          }
        },
        item.pinned
          ? {
              icon: { source: Icon.Pin, tintColor: Color.Yellow }
            }
          : {}
      ],
      actions: ActionPanel({
        title: '剪贴板操作',
        children: [
          Action({
            title: '复制到剪贴板',
            icon: Icon.Clipboard,
            onAction: () => copyText(item)
          }),
          Action({
            title: item.pinned ? '取消置顶' : 'Pin 置顶收藏',
            icon: Icon.Pin,
            shortcut: { modifiers: ['ctrl'], key: 'p' },
            onAction: () => {
              const next = togglePinEntry(entries, item.id)
              updateAndPersist(next)
              showToast({
                style: Toast.Style.Success,
                title: item.pinned ? '已取消置顶' : '已置顶收藏'
              })
            }
          }),
          Action({
            title: '删除该记录',
            icon: Icon.Trash,
            shortcut: { modifiers: ['ctrl'], key: 'd' },
            onAction: () => {
              const next = deleteEntry(entries, item.id)
              updateAndPersist(next)
              showToast({
                style: Toast.Style.Success,
                title: '已删除记录'
              })
            }
          }),
          Action({
            title: '清空所有未置顶记录',
            icon: Icon.XMarkCircle,
            shortcut: { modifiers: ['ctrl', 'shift'], key: 'd' },
            onAction: () => {
              const next = clearUnpinnedEntries(entries)
              updateAndPersist(next)
              showToast({
                style: Toast.Style.Success,
                title: '已清空非置顶记录'
              })
            }
          })
        ]
      })
    })
  }

  return List({
    isLoading: loading,
    searchBarPlaceholder: '搜索剪贴板历史 (支持 URL、代码、JSON)...',
    onSearchTextChange: setSearchText,
    children: [
      pinned.length > 0 &&
        List.Section({
          title: `置顶收藏 (${pinned.length})`,
          children: pinned.map(renderItem)
        }),
      unpinned.length > 0 &&
        List.Section({
          title: `最近剪贴 (${unpinned.length})`,
          children: unpinned.map(renderItem)
        })
    ].filter(Boolean)
  })
}
