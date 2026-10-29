import React, {
  List,
  Form,
  ActionPanel,
  Action,
  Icon,
  Clipboard,
  LocalStorage,
  showToast,
  Toast,
  confirmAlert,
  useNavigation,
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef
} from '@ztools/declarative-ui'
import type { SnippetCategory, SnippetFormInput, SnippetItem } from './types.js'
import {
  SnippetStoreRepository,
  resolveMacroTemplate,
  validateSnippetInput
} from './macro-engine.js'
import { SNIPPETS_STORAGE_KEY, assertSnippetUnchanged, parseStoredSnippets, updateSnippets } from './snippets-storage.js'

export * from './types.js'
export * from './macro-engine.js'

function getCategoryIcon(category: SnippetCategory): Icon {
  switch (category) {
    case 'invoice':
      return Icon.Document
    case 'address':
      return Icon.Pin
    case 'customer_service':
      return Icon.Text
    case 'code':
      return Icon.Code
    default:
      return Icon.List
  }
}

export interface SnippetEditFormProps {
  initialData?: SnippetItem
  onSave: (input: SnippetFormInput, expected?: SnippetItem) => Promise<void>
}

export function SnippetEditForm({ initialData, onSave }: SnippetEditFormProps) {
  const { pop } = useNavigation()
  const [title, setTitle] = useState(initialData?.title || '')
  const [category, setCategory] = useState<SnippetCategory>(initialData?.category || 'general')
  const [keyword, setKeyword] = useState(initialData?.keyword || '')
  const [content, setContent] = useState(initialData?.content || '')

  const handleSubmit = useCallback(async () => {
    const payload: SnippetFormInput = {
      id: initialData?.id,
      title,
      category,
      keyword,
      content
    }
    const check = validateSnippetInput(payload)
    if (!check.valid) {
      await showToast({
        style: Toast.Style.Failure,
        title: '无法保存短语',
        message: check.error
      })
      return
    }
    await onSave(payload, initialData)
    pop()
  }, [initialData, title, category, keyword, content, onSave, pop])

  return (
    <Form
      navigationTitle={initialData ? '编辑快捷短语' : '新建快捷短语'}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="保存短语" icon={Icon.CheckCircle} onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.TextField
        id="title"
        title="短语标题"
        value={title}
        onChange={setTitle}
        placeholder="如：公司开票抬头、北京办公地址"
      />
      <Form.Dropdown
        id="category"
        title="所属分类"
        value={category}
        onChange={(v: string) => setCategory(v as SnippetCategory)}
      >
        <Form.Dropdown.Item title="通用短语" value="general" />
        <Form.Dropdown.Item title="发票与开票信息" value="invoice" />
        <Form.Dropdown.Item title="常用地址与联系人" value="address" />
        <Form.Dropdown.Item title="客服与商务话术" value="customer_service" />
        <Form.Dropdown.Item title="开发与代码片段" value="code" />
      </Form.Dropdown>
      <Form.TextField
        id="keyword"
        title="搜索缩写（可选）"
        value={keyword}
        onChange={setKeyword}
        placeholder="如：sh、addr，只用于在列表里搜索，不会在其他应用里自动展开"
      />
      <Form.TextArea
        id="content"
        title="短语模板内容"
        value={content}
        onChange={setContent}
        placeholder="支持宏变量：{date}、{time}、{datetime}、{clipboard}"
      />
      <Form.Description
        title="宏变量提示"
        text="{date}=年月日  {time}=时分秒  {datetime}=日期与时间  {clipboard}=当前剪贴板"
      />
    </Form>
  )
}

export interface SnippetsProps {
  featureCode?: string
  initialSnippets?: SnippetItem[]
}

export function Snippets({ featureCode = 'snippets-all', initialSnippets }: SnippetsProps = {}) {
  const { push } = useNavigation()
  const [isLoading, setIsLoading] = useState<boolean>(!initialSnippets)
  const [snippets, setSnippets] = useState<SnippetItem[]>(initialSnippets || [])
  const [searchText, setSearchText] = useState<string>('')
  const [categoryFilter, setCategoryFilter] = useState<string>(() => {
    if (featureCode === 'snippets-invoice') return 'invoice'
    if (featureCode === 'snippets-address') return 'address'
    return 'all'
  })

  const readyRef = useRef(Boolean(initialSnippets))
  const savingRef = useRef(false)
  const openedNewRef = useRef(false)
  const [loadError, setLoadError] = useState('')
  const mountedRef = useRef<boolean>(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    if (initialSnippets) {
      return
    }
    let active = true
    ;(async () => {
      try {
        const raw = await LocalStorage.getItem(SNIPPETS_STORAGE_KEY)
        if (!active || !mountedRef.current) return
        setSnippets(parseStoredSnippets(raw))
        readyRef.current = true
      } catch (error) {
        if (active && mountedRef.current) setLoadError(error instanceof Error ? error.message : String(error))
      } finally {
        if (active && mountedRef.current) {
          setIsLoading(false)
        }
      }
    })()
    return () => {
      active = false
    }
  }, [initialSnippets])

  const persistSnippets = useCallback(async (update: (items: SnippetItem[]) => SnippetItem[]) => {
    if (!readyRef.current) throw new Error('短语尚未读取成功，请重新打开插件')
    if (savingRef.current) throw new Error('正在保存短语，请稍后再试')
    savingRef.current = true
    try {
      const nextList = await updateSnippets(update)
      if (mountedRef.current) setSnippets(nextList)
    } finally {
      savingRef.current = false
    }
  }, [])

  const handleSaveSnippet = useCallback(async (input: SnippetFormInput, expected?: SnippetItem) => {
    await persistSnippets((items) => {
      if (input.id) {
        if (!expected || input.id !== expected.id) throw new Error('短语编辑状态已变化，请重新打开后再操作')
        assertSnippetUnchanged(items, expected)
      }
      const repository = new SnippetStoreRepository(items)
      repository.save(input)
      return repository.list()
    })
    await showToast({ style: Toast.Style.Success, title: '短语已保存', message: input.title.trim() })
  }, [persistSnippets])

  const handleDeleteSnippet = useCallback(async (expected: SnippetItem) => {
    // 短语是用户自己写的内容，删除后无法恢复：先确认，取消或确认框打不开都不删
    const confirmed = await confirmAlert({
      title: '删除这条快捷短语？',
      message: `「${expected.title}」删除后无法恢复。`,
      primaryAction: { title: '删除', style: 'destructive' },
      dismissAction: { title: '取消' }
    })
    if (!confirmed) return
    await persistSnippets((items) => {
      assertSnippetUnchanged(items, expected)
      return items.filter(item => item.id !== expected.id)
    })
    await showToast({ style: Toast.Style.Success, title: '已删除该快捷短语' })
  }, [persistSnippets])

  const handleUseSnippet = useCallback(async (item: SnippetItem, paste: boolean) => {
    try {
      const clipboardText = item.content.includes('{clipboard}') ? await Clipboard.readText() : ''
      const resolved = resolveMacroTemplate(item.content, clipboardText)
      if (paste) await Clipboard.paste(resolved.text)
      else await Clipboard.copy(resolved.text)
    } catch (error) {
      await showToast({ style: Toast.Style.Failure, title: paste ? '粘贴失败' : '复制失败', message: error instanceof Error ? error.message : String(error) })
      return
    }
    try {
      await persistSnippets((items) => items.map((current) => current.id === item.id ? { ...current, useCount: (current.useCount || 0) + 1 } : current))
    } catch (error) {
      await showToast({ style: Toast.Style.Failure, title: paste ? '已发送请求，但使用次数保存失败' : '已复制，但使用次数保存失败', message: error instanceof Error ? error.message : String(error) })
      return
    }
    await showToast({ style: Toast.Style.Success, title: paste ? '已发送粘贴请求' : '已复制解析后的文本' })
  }, [persistSnippets])

  useEffect(() => {
    if (featureCode !== 'snippets-new' || isLoading || loadError || openedNewRef.current) return
    openedNewRef.current = true
    push(<SnippetEditForm onSave={handleSaveSnippet} />)
  }, [featureCode, isLoading, loadError, handleSaveSnippet, push])

  const filteredSnippets = useMemo(() => {
    const q = searchText.trim().toLowerCase()
    return snippets.filter((item: SnippetItem) => {
      if (categoryFilter !== 'all' && item.category !== categoryFilter) {
        return false
      }
      if (!q) return true
      return (
        item.title.toLowerCase().includes(q) ||
        (item.keyword || '').toLowerCase().includes(q) ||
        item.content.toLowerCase().includes(q)
      )
    })
  }, [snippets, searchText, categoryFilter])

  if (isLoading || loadError) {
    return <List isLoading={isLoading}><List.Item id="load-state" title={loadError ? '无法读取短语' : '正在读取短语'} subtitle={loadError || undefined} /></List>
  }

  return (
    <List
      isLoading={isLoading}
      searchText={searchText}
      onSearchTextChange={setSearchText}
      searchBarPlaceholder="搜索短语标题、触发词或内容（如：税号、地址、退款）..."
      searchBarAccessory={
        <List.Dropdown
          value={categoryFilter}
          onChange={(value) => { setCategoryFilter(value); setSearchText('') }}
          tooltip="按短语分类筛选"
        >
          <List.Dropdown.Item title="全部短语" value="all" icon={Icon.List} />
          <List.Dropdown.Item title="发票与开票信息" value="invoice" icon={Icon.Document} />
          <List.Dropdown.Item title="常用地址与联系人" value="address" icon={Icon.Pin} />
          <List.Dropdown.Item
            title="客服与商务话术"
            value="customer_service"
            icon={Icon.Text}
          />
          <List.Dropdown.Item title="开发与代码片段" value="code" icon={Icon.Code} />
        </List.Dropdown>
      }
      filterBar={{
        summaryText: `共 ${filteredSnippets.length} 条快捷短语 · 支持 {date} / {time} / {clipboard} 宏变量`,
        actions: [
          {
            id: 'new-snippet',
            title: '新建短语',
            onAction: () => push(<SnippetEditForm onSave={handleSaveSnippet} />)
          }
        ]
      }}
    >
      {filteredSnippets.length === 0 ? (
        <List.Item
          id="empty-state"
          icon={Icon.Plus}
          title={snippets.length === 0 ? '还没有短语，按回车新建' : '没有匹配的短语'}
          subtitle={snippets.length === 0 ? '把常用的地址、开票信息或话术存成短语，之后一键粘贴' : '换个关键词或分类，也可以按回车新建短语'}
          actions={
            <ActionPanel>
              <Action title="新建短语" icon={Icon.Plus} onAction={() => push(<SnippetEditForm onSave={handleSaveSnippet} />)} />
            </ActionPanel>
          }
        />
      ) : null}
      {filteredSnippets.map((item: SnippetItem) => (
        <List.Item
          key={item.id}
          id={item.id}
          title={item.title}
          subtitle={item.previewText}
          icon={getCategoryIcon(item.category)}
          accessories={[
            { tag: item.keyword ? `缩写: ${item.keyword}` : item.categoryLabel },
            { text: `使用 ${item.useCount || 0} 次` }
          ]}
          actions={
            <ActionPanel>
              <Action
                title="直接上屏粘贴"
                icon={Icon.ArrowUp}
                onAction={() => handleUseSnippet(item, true)}
              />
              <Action
                title="复制解析后的文本"
                onAction={() => handleUseSnippet(item, false)}
                shortcut={{ modifiers: ['cmd'], key: 'enter' }}
              />
              <Action
                title="编辑短语"
                icon={Icon.Pencil}
                shortcut={{ modifiers: ['cmd'], key: 'e' }}
                onAction={() =>
                  push(<SnippetEditForm initialData={item} onSave={handleSaveSnippet} />)
                }
              />
              <Action
                title="删除短语"
                icon={Icon.Trash}
                style={Action.Style.Destructive}
                shortcut={{ modifiers: ['ctrl'], key: 'backspace' }}
                onAction={() => handleDeleteSnippet(item)}
              />
            </ActionPanel>
          }
        />
      ))}
    </List>
  )
}

export const SnippetsCommand = Snippets
export default Snippets

export const commands = {
  'snippets-all': Snippets,
  'snippets-invoice': () => <Snippets featureCode="snippets-invoice" />,
  'snippets-address': () => <Snippets featureCode="snippets-address" />,
  'snippets-new': () => <Snippets featureCode="snippets-new" />
}
