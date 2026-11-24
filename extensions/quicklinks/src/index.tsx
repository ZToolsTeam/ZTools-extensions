import React, {
  Action,
  ActionPanel,
  Clipboard,
  Form,
  Icon,
  List,
  Toast,
  showToast,
  useEffect,
  useLocale,
  useMemo,
  useRef,
  useState,
  useNavigation,
  confirmAlert
} from '@ztools/declarative-ui'
import { t } from './i18n.js'
import {
  exportQuicklinksJson,
  getDefaultQuicklinks,
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
import { resolveErrorMessage } from './error-i18n.js'

export * from './types.js'
export * from './quicklinks-storage.js'

/** 新建与编辑共用：网址组逐行校验全部合法才通过，单个链接校验网址模板 */
function resolveLinkTarget(isGroup: boolean, groupText: string, linkText: string):
  | { ok: true; link: string; urls?: string[] }
  | { ok: false; error: string } {
  if (isGroup) {
    const parsed = parseGroupUrls(groupText)
    return parsed.valid ? { ok: true, link: parsed.urls[0]!, urls: parsed.urls } : { ok: false, error: resolveErrorMessage(parsed, t('invalidGroupFallback')) }
  }
  const urlCheck = validateQuicklinkUrlPattern(linkText)
  return urlCheck.valid ? { ok: true, link: urlCheck.normalizedUrl } : { ok: false, error: resolveErrorMessage(urlCheck, t('invalidUrlFallback')) }
}

export function CreateQuicklinkForm({
  onCreated,
  initialKind = 'single'
}: {
  onCreated?: (item: Quicklink) => void
  initialKind?: 'single' | 'group'
}) {
  useLocale()
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
      await showToast({ style: Toast.Style.Failure, title: t('enterTitleToast') })
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
      await showToast({ style: Toast.Style.Failure, title: resolveErrorMessage(aliasCheck, t('invalidAliasFallback')) })
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
    await showToast({ style: Toast.Style.Success, title: isGroup ? t('groupCreatedToast') : t('linkCreatedToast') })
    onCreated?.(newItem)
    pop()
  }

  return (
    <Form
      navigationTitle={t('createFormTitle')}
      actions={
        <ActionPanel>
          <Action.SubmitForm title={t('saveQuicklinkBtn')} onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.Dropdown id="kind" title={t('kindLabel')} value={kind} onChange={(value) => setKind(value === 'group' ? 'group' : 'single')}>
        <Form.Dropdown.Item title={t('kindSingle')} value="single" />
        <Form.Dropdown.Item title={t('kindGroup')} value="group" />
      </Form.Dropdown>
      <Form.TextField
        id="title"
        title={t('titleLabel')}
        placeholder={isGroup ? t('titleGroupPlaceholder') : t('titleSinglePlaceholder')}
        value={title}
        onChange={setTitle}
      />
      {isGroup ? (
        <Form.TextArea
          id="urls"
          title={t('urlsLabel')}
          placeholder={t('urlsPlaceholder')}
          value={groupUrls}
          onChange={setGroupUrls}
        />
      ) : (
        <Form.TextField
          id="link"
          title={t('linkTemplateLabel')}
          placeholder={t('linkTemplatePlaceholder')}
          value={link}
          onChange={setLink}
        />
      )}
      <Form.TextField
        id="keyword"
        title={t('aliasLabel')}
        placeholder={t('aliasPlaceholder')}
        value={keyword}
        onChange={setKeyword}
      />
      <Form.TextField
        id="description"
        title={t('descLabel')}
        placeholder={t('descPlaceholder')}
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
  useLocale()
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
      await showToast({ style: Toast.Style.Failure, title: resolveErrorMessage(aliasCheck, t('invalidAliasFallback')) })
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
      navigationTitle={t('editFormTitle')}
      actions={
        <ActionPanel>
          <Action.SubmitForm title={t('saveChangesBtn')} onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.TextField id="title" title={t('titleLabel')} value={title} onChange={setTitle} />
      {isGroup ? (
        <Form.TextArea
          id="urls"
          title={t('urlsLabel')}
          placeholder={t('urlsPlaceholder')}
          value={groupUrls}
          onChange={setGroupUrls}
        />
      ) : (
        <Form.TextField id="link" title={t('targetUrlLabel')} value={link} onChange={setLink} />
      )}
      <Form.TextField id="keyword" title={t('aliasLabel')} value={keyword} onChange={setKeyword} />
      <Form.TextField
        id="description"
        title={t('descLabel')}
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
  useLocale()
  const { pop } = useNavigation()
  const [jsonText, setJsonText] = useState('')

  const handleSubmit = async () => {
    const current = await getQuicklinks()
    const res = importQuicklinksJson(jsonText, current)
    if (!res.success) {
      await showToast({ style: Toast.Style.Failure, title: resolveErrorMessage(res, t('importFailedFallback')) })
      return
    }
    await saveQuicklinks(res.result)
    await showToast({ style: Toast.Style.Success, title: t('importSuccessToast', { count: res.importedCount }) })
    onImported?.(res.result)
    pop()
  }

  return (
    <Form
      navigationTitle={t('importFormTitle')}
      actions={
        <ActionPanel>
          <Action.SubmitForm title={t('confirmImportBtn')} onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.TextArea
        id="json"
        title={t('jsonContentLabel')}
        placeholder={t('jsonContentPlaceholder')}
        value={jsonText}
        onChange={setJsonText}
      />
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
  const locale = useLocale()
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
  }, [props.initialLinks, locale])

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
        title: item.isGroup ? t('openedGroupToast', { count: urls.length }) : t('openedUrlToast', { url: urls[0] })
      })
    } catch (error) {
      await showToast({ style: Toast.Style.Failure, title: t('openFailedToast'), message: error instanceof Error ? error.message : String(error) })
    }
  }

  // 顶部状态条的动作抛错时客户端不会提示，这里自己如实提示失败
  const handleResetDefaults = async () => {
    const confirmed = await confirmAlert({
      title: t('resetConfirmTitle'),
      message: t('resetConfirmMsg'),
      primaryAction: { title: t('resetConfirmBtn'), style: 'destructive' },
      dismissAction: { title: t('cancelBtn') }
    })
    if (!confirmed) return
    const defaults = getDefaultQuicklinks()
    try {
      await saveQuicklinks(defaults)
    } catch (error) {
      await showToast({ style: Toast.Style.Failure, title: t('resetFailedToast'), message: error instanceof Error ? error.message : String(error) })
      return
    }
    setLinks(defaults)
    await showToast({
      style: Toast.Style.Success,
      title: t('resetSuccessToast')
    })
  }

  const handleDelete = async (item: Quicklink) => {
    const confirmed = await confirmAlert({
      title: t('deleteConfirmTitle', { title: item.title }),
      message: t('deleteConfirmMsg'),
      primaryAction: { title: t('deleteBtn'), style: 'destructive' },
      dismissAction: { title: t('cancelBtn') }
    })
    if (!confirmed) return
    const current = await getQuicklinks()
    const next = current.filter((link) => link.id !== item.id)
    if (next.length === current.length) throw new Error(t('missingLinkError'))
    await saveQuicklinks(next)
    setLinks(next)
    await showToast({ style: Toast.Style.Success, title: t('deletedToast', { title: item.title }) })
  }

  const handleOpenImport = () => {
    push(<ImportQuicklinksForm onImported={(next) => setLinks(next)} />)
  }

  const handleExportJson = async () => {
    try {
      await Clipboard.copy(exportQuicklinksJson(links))
      await showToast({
        style: Toast.Style.Success,
        title: t('exportSuccessToast', { count: links.length })
      })
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: t('exportFailedToast'),
        message: error instanceof Error ? error.message : String(error)
      })
    }
  }

  if (isLoading || loadError) {
    return <List isLoading={isLoading}><List.Item id="load-state" title={loadError ? t('loadErrorTitle') : t('loadingTitle')} subtitle={loadError || undefined} /></List>
  }

  return (
    <List
      navigationTitle={t('navTitle')}
      isLoading={false}
      isShowingDetail={false}
      searchText={searchText}
      onSearchTextChange={setSearchText}
      searchBarPlaceholder={t('searchPlaceholder')}
      actions={
        <ActionPanel>
          <Action
            title={t('actionImportJson')}
            icon={Icon.Upload}
            shortcut={{ modifiers: ['ctrl', 'shift'], key: 'i' }}
            onAction={handleOpenImport}
          />
          <Action
            title={t('actionExportJson')}
            icon={Icon.Download}
            shortcut={{ modifiers: ['ctrl', 'shift'], key: 'e' }}
            onAction={handleExportJson}
          />
        </ActionPanel>
      }
      searchBarAccessory={
        <List.Dropdown
          value={selectedCategory}
          onChange={(val) => { setSelectedCategory(val as 'all' | QuicklinkCategory); setSearchText('') }}
          tooltip={t('categoryTooltip')}
        >
          <List.Dropdown.Item title={t('catAll')} value="all" icon={Icon.Globe} />
          <List.Dropdown.Item title={t('catSearch')} value="search" icon={Icon.Globe} />
          <List.Dropdown.Item title={t('catDirect')} value="direct" icon={Icon.ArrowRight} />
          <List.Dropdown.Item title={t('catGroup')} value="group" icon={Icon.Desktop} />
        </List.Dropdown>
      }
      filterBar={{
        summaryText: t('summaryText', { count: filtered.matches.length }),
        actions: [
          {
            id: 'create',
            title: t('createBtn'),
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
            title: t('resetBtn'),
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
              ...(alias ? [{ tag: t('aliasTag', { alias }) }] : []),
              {
                text: item.isGroup
                  ? t('groupCountText', { count: groupUrls.length })
                  : getHostnameLabel(pattern)
              }
            ]}
            actions={
              <ActionPanel>
                <Action
                  title={hasQuery ? t('actionSearchOpen') : t('actionOpenBrowser')}
                  icon={Icon.Globe}
                  onAction={() => handleOpenLink(item)}
                />
                <Action
                  title={t('actionEdit')}
                  icon={Icon.Pencil}
                  onAction={() =>
                    push(
                      <EditQuicklinkForm
                        item={item}
                        onUpdated={async (updated) => {
                          const current = await getQuicklinks()
                          if (!current.some((link) => link.id === updated.id)) throw new Error(t('deletedBeforeSaveError'))
                          const next = current.map((link) => link.id === updated.id ? updated : link)
                          await saveQuicklinks(next)
                          setLinks(next)
                        }}
                      />
                    )
                  }
                />
                {item.isGroup ? (
                  <Action.CopyToClipboard title={t('actionCopyGroupUrls')} content={groupUrls.join('\n')} />
                ) : (
                  <Action.CopyToClipboard title={t('actionCopyUrl')} content={pattern} />
                )}
                <Action
                  title={t('actionDelete')}
                  icon={Icon.Trash}
                  style={Action.Style.Destructive}
                  shortcut={{ modifiers: ['ctrl'], key: 'backspace' }}
                  onAction={() => handleDelete(item)}
                />
                <Action
                  title={t('actionImportJson')}
                  icon={Icon.Upload}
                  shortcut={{ modifiers: ['ctrl', 'shift'], key: 'i' }}
                  onAction={handleOpenImport}
                />
                <Action
                  title={t('actionExportJson')}
                  icon={Icon.Download}
                  shortcut={{ modifiers: ['ctrl', 'shift'], key: 'e' }}
                  onAction={handleExportJson}
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
