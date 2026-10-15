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
  createMemo,
  deleteMemo,
  getSampleMemos,
  type MemoItem
} from './logic'

const STORAGE_KEY = 'ztools_memo_items'

export default function MemoCommand() {
  const [searchText, setSearchText] = useState('')
  const [memos, setMemos] = useState<MemoItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    try {
      let saved: MemoItem[] = []
      if (typeof localStorage !== 'undefined') {
        const raw = localStorage.getItem(STORAGE_KEY)
        if (raw) saved = JSON.parse(raw)
      }
      if (!saved || saved.length === 0) {
        saved = getSampleMemos()
      }
      setMemos(saved)
    } finally {
      setLoading(false)
    }
  }, [])

  function updateAndPersist(next: MemoItem[]) {
    setMemos(next)
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    }
  }

  function copyContent(memo: MemoItem) {
    Clipboard.copy(memo.content)
    showToast({
      style: Toast.Style.Success,
      title: '已复制便签内容',
      message: memo.title
    })
  }

  const query = searchText.trim().toLowerCase()
  const filtered = memos.filter(m => {
    if (!query) return true
    return (
      m.title.toLowerCase().includes(query) ||
      m.content.toLowerCase().includes(query) ||
      m.tag.toLowerCase().includes(query)
    )
  })

  return List({
    isLoading: loading,
    searchBarPlaceholder: '搜索便签标题、正文或标签...',
    onSearchTextChange: setSearchText,
    children: [
      List.Section({
        title: `便签列表 (${filtered.length}/${memos.length})`,
        children: filtered.map(item =>
          List.Item({
            id: item.id,
            title: item.title,
            subtitle: item.content.replace(/[\r\n]+/g, ' ').slice(0, 50),
            icon: {
              source: Icon.Document,
              tintColor: item.tag === '工作' ? Color.Blue : item.tag === '技术' ? Color.Green : Color.Orange
            },
            accessories: [
              {
                tag: {
                  value: item.tag,
                  color: item.tag === '工作' ? Color.Blue : item.tag === '技术' ? Color.Green : Color.Orange
                }
              }
            ],
            actions: ActionPanel({
              title: item.title,
              children: [
                Action({
                  title: '复制正文内容',
                  icon: Icon.Clipboard,
                  onAction: () => copyContent(item)
                }),
                Action({
                  title: '复制便签标题',
                  icon: Icon.Clipboard,
                  shortcut: { modifiers: ['ctrl'], key: 'c' },
                  onAction: () => {
                    Clipboard.copy(item.title)
                    showToast({
                      style: Toast.Style.Success,
                      title: '已复制标题',
                      message: item.title
                    })
                  }
                }),
                Action({
                  title: '删除该便签',
                  icon: Icon.Trash,
                  shortcut: { modifiers: ['ctrl'], key: 'd' },
                  onAction: () => {
                    const next = deleteMemo(memos, item.id)
                    updateAndPersist(next)
                    showToast({
                      style: Toast.Style.Success,
                      title: '已删除便签'
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
