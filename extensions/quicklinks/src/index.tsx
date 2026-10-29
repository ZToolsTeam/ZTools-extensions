import React, {
  Action,
  ActionPanel,
  Form,
  Icon,
  List,
  Toast,
  showToast,
  useEffect,
  useMemo,
  useRef,
  useState,
  useNavigation,
  confirmAlert
} from '@ztools/declarative-ui'
import {
  DEFAULT_QUICKLINKS,
  filterQuicklinks,
  getQuicklinks,
  hasQueryPlaceholder,
  importQuicklinksJson,
  inferQuicklinkCategory,
  launchQuicklink,
  parseGroupUrls,
  saveQuicklinks,
  validateQuicklinkAlias,
  validateQuicklinkUrlPattern
} from './quicklinks-storage.js'
import type { Quicklink, QuicklinkCategory } from './types.js'

export * from './types.js'
export * from './quicklinks-storage.js'

/** 新建与编辑共用：网址组逐行校验全部合法才通过，单个链接校验网址模板 */
function resolveLinkTarget(isGroup: boolean, groupText: string, linkText: string):
  | { ok: true; link: string; urls?: string[] }
  | { ok: false; error: string } {
  if (isGroup) {
    const parsed = parseGroupUrls(groupText)
    return parsed.valid ? { ok: true, link: parsed.urls[0]!, urls: parsed.urls } : { ok: false, error: parsed.error || '网址组无效' }
  }
  const urlCheck = validateQuicklinkUrlPattern(linkText)
  return urlCheck.valid ? { ok: true, link: urlCheck.normalizedUrl } : { ok: false, error: urlCheck.error || '请输入合法的 URL 地址' }
}

export function CreateQuicklinkForm({
  onCreated,
  initialKind = 'single'
}: {
  onCreated?: (item: Quicklink) => void
  initialKind?: 'single' | 'group'
}) {
  const { pop } = useNavigation()
  const [kind, setKind] = useState<'single' | 'group'>(initialKind)
  const [title, setTitle] = useState('')
  const [link, setLink] = useState('')
  const [groupUrls, setGroupUrls] = useState('')
  const [keyword, setKeyword] = useState('')
  const [description, setDescription] = useState('')
  const isGroup = kind === 'group'

  const handleSubmit = async () => {
    if (!title.trim()) {
      await showToast({ style: Toast.Style.Failure, title: '请输入快捷链接标题' })
      return
    }
    const target = resolveLinkTarget(isGroup, groupUrls, link)
    if (!target.ok) {
      await showToast({ style: Toast.Style.Failure, title: target.error })
      return
    }
    const { link: nextLink, urls: nextUrls } = target

    const current = await getQuicklinks()
    const aliasCheck = validateQuicklinkAlias(keyword, current)
    if (!aliasCheck.valid) {
      await showToast({ style: Toast.Style.Failure, title: aliasCheck.error || '别名无效' })
      return
    }
    const newItem: Quicklink = {
      id: `ql-${Date.now()}-${current.length + 1}`,
      title: title.trim(),
      link: nextLink,
      urlPattern: nextLink,
      ...(nextUrls ? { urls: nextUrls } : {}),
      keyword: aliasCheck.alias,
      alias: aliasCheck.alias,
      category: 'direct',
      isGroup,
      description: description.trim() || undefined,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
    newItem.category = inferQuicklinkCategory(newItem)
    const updated = [newItem, ...current]
    await saveQuicklinks(updated)
    await showToast({ style: Toast.Style.Success, title: isGroup ? '网址组创建成功' : '快捷链接创建成功' })
    onCreated?.(newItem)
    pop()
  }

  return (
    <Form
      navigationTitle="新建快捷链接"
      actions={
        <ActionPanel>
          <Action.SubmitForm title="保存快捷链接" onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.Dropdown id="kind" title="类型" value={kind} onChange={(value) => setKind(value === 'group' ? 'group' : 'single')}>
        <Form.Dropdown.Item title="单个链接" value="single" />
        <Form.Dropdown.Item title="网址组（一次打开多个网页）" value="group" />
      </Form.Dropdown>
      <Form.TextField
        id="title"
        title="链接名称"
        placeholder={isGroup ? '例如：上班常用网页' : '例如：GitHub 仓库搜索'}
        value={title}
        onChange={setTitle}
      />
      {isGroup ? (
        <Form.TextArea
          id="urls"
          title="组内网址"
          placeholder="每行一个网址，打开时按顺序依次打开"
          value={groupUrls}
          onChange={setGroupUrls}
        />
      ) : (
        <Form.TextField
          id="link"
          title="目标网址模板"
          placeholder="支持 {query} 变量，如：https://github.com/search?q={query}"
          value={link}
          onChange={setLink}
        />
      )}
      <Form.TextField
        id="keyword"
        title="触发别名"
        placeholder="例如：gh"
        value={keyword}
        onChange={setKeyword}
      />
      <Form.TextField
        id="description"
        title="备注说明"
        placeholder="选填描述"
        value={description}
        onChange={setDescription}
      />
    </Form>
  )
}

export function EditQuicklinkForm({
  item,
  onUpdated
}: {
  item: Quicklink
  onUpdated: (updated: Quicklink) => Promise<void>
}) {
  const { pop } = useNavigation()
  const isGroup = Boolean(item.isGroup && Array.isArray(item.urls))
  const [title, setTitle] = useState(item.title)
  const [link, setLink] = useState(item.link)
  const [groupUrls, setGroupUrls] = useState((item.urls || []).join('\n'))
  const [keyword, setKeyword] = useState(item.alias || item.keyword || '')
  const [description, setDescription] = useState(item.description || '')

  const handleSubmit = async () => {
    // 网址组打开的是组内网址列表，编辑的也必须是这份列表，不能只改一个不会被打开的字段
    const target = resolveLinkTarget(isGroup, groupUrls, link)
    if (!target.ok) {
      await showToast({ style: Toast.Style.Failure, title: target.error })
      return
    }
    const { link: nextLink, urls: nextUrls } = target
    const aliasCheck = validateQuicklinkAlias(keyword, await getQuicklinks(), item.id)
    if (!aliasCheck.valid) {
      await showToast({ style: Toast.Style.Failure, title: aliasCheck.error || '别名无效' })
      return
    }
    const updatedItem: Quicklink = {
      ...item,
      title: title.trim() || item.title,
      link: nextLink,
      urlPattern: nextLink,
      ...(nextUrls ? { urls: nextUrls } : {}),
      keyword: aliasCheck.alias,
      alias: aliasCheck.alias,
      description: description.trim() || undefined,
      updatedAt: Date.now()
    }
    updatedItem.category = inferQuicklinkCategory(updatedItem)
    await onUpdated(updatedItem)
    pop()
  }

  return (
    <Form
      navigationTitle="编辑快捷链接"
      actions={
        <ActionPanel>
          <Action.SubmitForm title="保存修改" onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.TextField id="title" title="链接名称" value={title} onChange={setTitle} />
      {isGroup ? (
        <Form.TextArea
          id="urls"
          title="组内网址"
          placeholder="每行一个网址，打开时按顺序依次打开"
          value={groupUrls}
          onChange={setGroupUrls}
        />
      ) : (
        <Form.TextField id="link" title="目标 URL" value={link} onChange={setLink} />
      )}
      <Form.TextField id="keyword" title="触发别名" value={keyword} onChange={setKeyword} />
      <Form.TextField
        id="description"
        title="备注说明"
        value={description}
        onChange={setDescription}
      />
    </Form>
  )
}

export function ImportQuicklinksForm({
  onImported
}: {
  onImported?: (items: Quicklink[]) => void
}) {
  const { pop } = useNavigation()
  const [jsonText, setJsonText] = useState('')

  const handleSubmit = async () => {
    const current = await getQuicklinks()
    const res = importQuicklinksJson(jsonText, current)
    if (!res.success) {
      await showToast({ style: Toast.Style.Failure, title: res.error || '导入失败' })
      return
    }
    await saveQuicklinks(res.result)
    onImported?.(res.result)
    pop()
  }

  return (
    <Form
      navigationTitle="导入快捷链接 JSON"
      actions={
        <ActionPanel>
          <Action.SubmitForm title="确认导入" onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.TextArea id="json" title="JSON 内容" value={jsonText} onChange={setJsonText} />
    </Form>
  )
}

function getHostnameLabel(rawUrl: string): string {
  try {
    return new URL(rawUrl.replace(/\{(query|argument|arg)(?:\s+[^}]*)?\}/gi, 'q')).hostname
  } catch {
    return rawUrl.slice(0, 28)
  }
}

export interface QuicklinksCommandProps {
  featureCode?: string
  initialLinks?: Quicklink[]
}

export function QuicklinksCommand(props: QuicklinksCommandProps = {}) {
  const { push } = useNavigation()
  const [links, setLinks] = useState<Quicklink[]>(props.initialLinks ?? [])
  const [selectedCategory, setSelectedCategory] = useState<'all' | QuicklinkCategory>(() => {
    if (props.featureCode === 'quicklinks-search-engines') return 'search'
    if (props.featureCode === 'quicklinks-open-groups') return 'group'
    return 'all'
  })
  const [searchText, setSearchText] = useState<string>('')
  const [isLoading, setIsLoading] = useState(!props.initialLinks)
  const [loadError, setLoadError] = useState('')
  const openedNewRef = useRef(false)

  useEffect(() => {
    let active = true
    if (!props.initialLinks) {
      void getQuicklinks().then((items) => { if (active) setLinks(items) }).catch((error) => {
        if (active) setLoadError(error instanceof Error ? error.message : String(error))
      }).finally(() => { if (active) setIsLoading(false) })
    }
    return () => { active = false }
  }, [props.initialLinks])

  useEffect(() => {
    if (props.featureCode !== 'quicklinks-new' || isLoading || loadError || openedNewRef.current) return
    openedNewRef.current = true
    push(<CreateQuicklinkForm onCreated={(created) => setLinks((current) => [created, ...current])} />)
  }, [props.featureCode, isLoading, loadError, push])

  const filtered = useMemo(
    () => filterQuicklinks(links, searchText, selectedCategory),
    [links, searchText, selectedCategory]
  )

  const handleOpenLink = async (item: Quicklink) => {
    const queryArg = filtered.directMatch?.quicklink.id === item.id ? filtered.directMatch.queryArg : ''
    try {
      const urls = await launchQuicklink(item, queryArg)
      await showToast({
        style: Toast.Style.Success,
        title: item.isGroup ? `已打开 ${urls.length} 个网页` : `已打开：${urls[0]}`
      })
    } catch (error) {
      await showToast({ style: Toast.Style.Failure, title: '打开失败', message: error instanceof Error ? error.message : String(error) })
    }
  }

  // 顶部状态条的动作抛错时客户端不会提示，这里自己如实提示失败
  const handleResetDefaults = async () => {
    const confirmed = await confirmAlert({
      title: '恢复默认预设？',
      message: '会用预置列表替换全部已保存的快捷链接，自定义的链接和修改都会丢失。',
      primaryAction: { title: '恢复默认', style: 'destructive' },
      dismissAction: { title: '取消' }
    })
    if (!confirmed) return
    try {
      await saveQuicklinks([...DEFAULT_QUICKLINKS])
    } catch (error) {
      await showToast({ style: Toast.Style.Failure, title: '未恢复默认，原数据保留', message: error instanceof Error ? error.message : String(error) })
      return
    }
    setLinks([...DEFAULT_QUICKLINKS])
    await showToast({
      style: Toast.Style.Success,
      title: '已恢复默认预设快开列表'
    })
  }

  const handleDelete = async (item: Quicklink) => {
    const confirmed = await confirmAlert({
      title: `删除「${item.title}」？`,
      message: '删除后无法恢复。',
      primaryAction: { title: '删除', style: 'destructive' },
      dismissAction: { title: '取消' }
    })
    if (!confirmed) return
    const current = await getQuicklinks()
    const next = current.filter((link) => link.id !== item.id)
    if (next.length === current.length) throw new Error('此快捷链接已不存在，请重新打开插件')
    await saveQuicklinks(next)
    setLinks(next)
    await showToast({ style: Toast.Style.Success, title: `已删除：${item.title}` })
  }

  if (isLoading || loadError) {
    return <List isLoading={isLoading}><List.Item id="load-state" title={loadError ? '无法读取快捷链接' : '正在读取快捷链接'} subtitle={loadError || undefined} /></List>
  }

  return (
    <List
      navigationTitle="网页快开"
      isLoading={false}
      isShowingDetail={false}
      searchText={searchText}
      onSearchTextChange={setSearchText}
      searchBarPlaceholder="搜索快捷链接，或输入“别名 + 空格 + 关键词”（如：gh react）..."
      searchBarAccessory={
        <List.Dropdown
          value={selectedCategory}
          onChange={(val) => { setSelectedCategory(val as 'all' | QuicklinkCategory); setSearchText('') }}
          tooltip="按类型筛选"
        >
          <List.Dropdown.Item title="全部快捷链接" value="all" icon={Icon.Globe} />
          <List.Dropdown.Item title="搜索平台（带参数）" value="search" icon={Icon.Globe} />
          <List.Dropdown.Item title="直达网页" value="direct" icon={Icon.ArrowRight} />
          <List.Dropdown.Item title="批量网址组" value="group" icon={Icon.Desktop} />
        </List.Dropdown>
      }
      filterBar={{
        summaryText: `共 ${filtered.matches.length} 个快开项 · 支持在搜索框输入别名快速带参检索`,
        actions: [
          {
            id: 'create',
            title: '新建快捷链接',
            onAction: () =>
              push(
                <CreateQuicklinkForm
                  initialKind={selectedCategory === 'group' ? 'group' : 'single'}
                  onCreated={(created) => setLinks((prev) => [created, ...prev])}
                />
              )
          },
          {
            id: 'reset-default',
            title: '恢复默认预设',
            onAction: handleResetDefaults
          }
        ]
      }}
    >
      {filtered.matches.map((item) => {
        const alias = item.alias || item.keyword
        const pattern = item.urlPattern || item.link
        const hasQuery = !item.isGroup && hasQueryPlaceholder(pattern)
        const groupUrls = item.isGroup ? item.urls || [] : []
        return (
          <List.Item
            key={item.id}
            id={item.id}
            title={item.title}
            subtitle={item.description || pattern}
            icon={item.isGroup ? Icon.Desktop : Icon.Globe}
            accessories={[
              ...(alias ? [{ tag: `别名: ${alias}` }] : []),
              {
                text: item.isGroup
                  ? `含 ${groupUrls.length} 个网页`
                  : getHostnameLabel(pattern)
              }
            ]}
            actions={
              <ActionPanel>
                <Action
                  title={hasQuery ? '带参搜索 / 访问' : '在浏览器中打开'}
                  icon={Icon.Globe}
                  onAction={() => handleOpenLink(item)}
                />
                <Action
                  title="编辑此快捷链接"
                  icon={Icon.Pencil}
                  onAction={() =>
                    push(
                      <EditQuicklinkForm
                        item={item}
                        onUpdated={async (updated) => {
                          const current = await getQuicklinks()
                          if (!current.some((link) => link.id === updated.id)) throw new Error('此快捷链接已被删除，未保存修改')
                          const next = current.map((link) => link.id === updated.id ? updated : link)
                          await saveQuicklinks(next)
                          setLinks(next)
                        }}
                      />
                    )
                  }
                />
                {item.isGroup ? (
                  <Action.CopyToClipboard title="复制组内全部网址" content={groupUrls.join('\n')} />
                ) : (
                  <Action.CopyToClipboard title="复制目标网址" content={pattern} />
                )}
                <Action
                  title="删除此快捷链接"
                  icon={Icon.Trash}
                  style={Action.Style.Destructive}
                  shortcut={{ modifiers: ['ctrl'], key: 'backspace' }}
                  onAction={() => handleDelete(item)}
                />
              </ActionPanel>
            }
          />
        )
      })}
    </List>
  )
}

export default QuicklinksCommand

export const commands = {
  'quicklinks-all': QuicklinksCommand,
  'quicklinks-search-engines': () => <QuicklinksCommand featureCode="quicklinks-search-engines" />,
  'quicklinks-open-groups': () => <QuicklinksCommand featureCode="quicklinks-open-groups" />,
  'quicklinks-new': () => <QuicklinksCommand featureCode="quicklinks-new" />
}
