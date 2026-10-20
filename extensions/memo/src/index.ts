import {
  List,
  Form,
  ActionPanel,
  Action,
  Icon,
  Clipboard,
  useState,
  useEffect,
  useNavigation,
  showToast,
  Toast,
  LocalStorage,
  confirmAlert
} from '@ztools/declarative-ui'
import {
  createMemo,
  updateMemo,
  deleteMemo,
  filterMemos,
  sanitizeStoredMemos,
  readLegacyMemos,
  MEMOS_STORAGE_KEY,
  type MemoItem
} from './logic.js'

/**
 * 新建 / 编辑便签表单
 */
export function MemoForm({ memo, onSave }: { memo?: MemoItem; onSave: (title: string, content: string, tag: string) => Promise<boolean> }) {
  const { pop } = useNavigation()
  const [title, setTitle] = useState(memo?.title ?? '')
  const [content, setContent] = useState(memo?.content ?? '')
  const [tag, setTag] = useState(memo?.tag ?? '')
  const [error, setError] = useState<string | undefined>(undefined)

  const submit = async () => {
    if (!title.trim() && !content.trim()) {
      setError('标题和正文不能都为空')
      return
    }
    if (await onSave(title, content, tag)) pop()
  }

  return Form(
    {
      navigationTitle: memo ? '编辑便签' : '新建便签',
      actions: ActionPanel({ title: '便签' }, [
        Action.SubmitForm({ title: '保存', icon: Icon.Check, onSubmit: submit }),
        Action({ title: '返回', icon: Icon.ArrowLeft, onAction: () => pop() })
      ])
    },
    [
      Form.TextField({ id: 'title', title: '标题', placeholder: '可留空，保存为「无标题便签」', value: title, error, onChange: (v: string) => { setTitle(v); setError(undefined) } }),
      Form.TextArea({ id: 'content', title: '正文', placeholder: '支持 Markdown', value: content, onChange: (v: string) => { setContent(v); setError(undefined) } }),
      Form.TextField({ id: 'tag', title: '标签', placeholder: '例如 工作、生活；可留空', value: tag, onChange: (v: string) => setTag(v) })
    ]
  )
}

export default function MemoCommand() {
  const [searchText, setSearchText] = useState('')
  const [memos, setMemos] = useState<MemoItem[]>([])
  const [loading, setLoading] = useState(true)
  const { push } = useNavigation()

  // 读取宿主插件存储；首次使用时把旧版存在浏览器缓存里的便签迁移过来
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const raw = await LocalStorage.getItem(MEMOS_STORAGE_KEY)
        if (raw !== undefined) {
          if (!cancelled) setMemos(sanitizeStoredMemos(raw))
          return
        }
        const legacy = readLegacyMemos()
        if (legacy.length > 0) {
          await LocalStorage.setItem(MEMOS_STORAGE_KEY, legacy)
          await showToast(Toast.Style.Success, `已迁移 ${legacy.length} 条旧便签`)
        }
        if (!cancelled) setMemos(legacy)
      } catch (err: any) {
        await showToast(Toast.Style.Failure, '读取便签失败', err?.message || String(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // 先写入存储再更新界面：写入失败时界面保持原样
  const commit = async (next: MemoItem[]): Promise<boolean> => {
    try {
      await LocalStorage.setItem(MEMOS_STORAGE_KEY, next)
      setMemos(next)
      return true
    } catch (err: any) {
      await showToast(Toast.Style.Failure, '保存失败', err?.message || String(err))
      return false
    }
  }

  const openCreate = (initialTitle = '') =>
    push(() =>
      MemoForm({
        memo: initialTitle ? ({ title: initialTitle, content: '', tag: '' } as MemoItem) : undefined,
        onSave: async (title, content, tag) => {
          const ok = await commit(createMemo(memos, title, content, tag))
          if (ok) await showToast(Toast.Style.Success, '已保存便签')
          return ok
        }
      })
    )

  const openEdit = (memo: MemoItem) =>
    push(() =>
      MemoForm({
        memo,
        onSave: async (title, content, tag) => {
          const ok = await commit(updateMemo(memos, memo.id, { title: title.trim() || '无标题便签', content: content.trim(), tag: tag.trim() }))
          if (ok) await showToast(Toast.Style.Success, '已更新便签')
          return ok
        }
      })
    )

  const remove = async (memo: MemoItem) => {
    const confirmed = await confirmAlert({
      title: `删除便签「${memo.title}」？`,
      message: '删除后无法恢复。',
      primaryAction: { title: '删除', style: 'destructive' },
      dismissAction: { title: '取消' }
    })
    if (!confirmed) return
    if (await commit(deleteMemo(memos, memo.id))) await showToast(Toast.Style.Success, '已删除便签')
  }

  const filtered = filterMemos(memos, searchText)
  const query = searchText.trim()

  const globalActions = ActionPanel({ title: '便签' }, [
    Action({ title: '新建便签', icon: Icon.Plus, onAction: () => openCreate(query) })
  ])

  const items = filtered.length > 0
    ? filtered.map((item) =>
        List.Item({
          id: item.id,
          title: item.title,
          subtitle: item.tag || undefined,
          icon: Icon.Document,
          accessories: [{ text: new Date(item.updateTime).toLocaleDateString([], { month: '2-digit', day: '2-digit' }) }],
          detail: List.Item.Detail({ markdown: item.content || '*（无正文）*' }),
          actions: ActionPanel({ title: item.title }, [
            Action({ title: '复制正文', icon: Icon.Clipboard, onAction: async () => { await Clipboard.copy(item.content); await showToast(Toast.Style.Success, '已复制正文') } }),
            Action({ title: '编辑便签', icon: Icon.Pencil, onAction: () => openEdit(item) }),
            Action({ title: '新建便签', icon: Icon.Plus, onAction: () => openCreate() }),
            Action({ title: '复制标题', icon: Icon.Clipboard, onAction: async () => { await Clipboard.copy(item.title); await showToast(Toast.Style.Success, '已复制标题') } }),
            Action({ title: '删除便签', icon: Icon.Trash, onAction: () => remove(item) })
          ])
        })
      )
    : [
        List.Item({
          id: 'empty',
          title: loading ? '正在读取便签…' : query ? `新建便签「${query}」` : '还没有便签',
          subtitle: query ? '按回车用这段文字作为标题新建' : '按回车新建第一条便签',
          icon: Icon.Plus,
          detail: List.Item.Detail({ markdown: '' }),
          actions: globalActions
        })
      ]

  return List({
    isLoading: loading,
    isShowingDetail: filtered.length > 0,
    searchBarPlaceholder: '搜索便签标题、正文或标签...',
    searchText,
    onSearchTextChange: setSearchText,
    actions: globalActions,
    children: [
      List.Section({
        title: `便签（${filtered.length}/${memos.length}）`,
        children: items
      })
    ]
  })
}
