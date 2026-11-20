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
  useLocale,
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef
} from '@ztools/declarative-ui'
import type { SnippetCategory, SnippetFormInput, SnippetItem } from './types.js'
import {
  SnippetStoreRepository,
  getSnippetCategoryLabel,
  resolveMacroTemplate,
  validateSnippetInput
} from './macro-engine.js'
import { SNIPPETS_STORAGE_KEY, assertSnippetUnchanged, parseStoredSnippets, updateSnippets } from './snippets-storage.js'
import { t } from './i18n.js'

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
  useLocale()
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
        title: t('cannotSaveTitle'),
        message: check.error
      })
      return
    }
    await onSave(payload, initialData)
    pop()
  }, [initialData, title, category, keyword, content, onSave, pop])

  return (
    <Form
      navigationTitle={initialData ? t('editFormTitle') : t('newFormTitle')}
      actions={
        <ActionPanel>
          <Action.SubmitForm title={t('saveAction')} icon={Icon.CheckCircle} onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.TextField
        id="title"
        title={t('fieldTitle')}
        value={title}
        onChange={setTitle}
        placeholder={t('fieldTitlePlaceholder')}
      />
      <Form.Dropdown
        id="category"
        title={t('fieldCategory')}
        value={category}
        onChange={(v: string) => setCategory(v as SnippetCategory)}
      >
        <Form.Dropdown.Item title={t('catGeneral')} value="general" />
        <Form.Dropdown.Item title={t('catInvoice')} value="invoice" />
        <Form.Dropdown.Item title={t('catAddress')} value="address" />
        <Form.Dropdown.Item title={t('catCustomerService')} value="customer_service" />
        <Form.Dropdown.Item title={t('catCode')} value="code" />
      </Form.Dropdown>
      <Form.TextField
        id="keyword"
        title={t('fieldKeyword')}
        value={keyword}
        onChange={setKeyword}
        placeholder={t('fieldKeywordPlaceholder')}
      />
      <Form.TextArea
        id="content"
        title={t('fieldContent')}
        value={content}
        onChange={setContent}
        placeholder={t('fieldContentPlaceholder')}
      />
      <Form.Description
        title={t('macroHintTitle')}
        text={t('macroHintText')}
      />
    </Form>
  )
}

export interface SnippetsProps {
  featureCode?: string
  initialSnippets?: SnippetItem[]
}

export function Snippets({ featureCode = 'snippets-all', initialSnippets }: SnippetsProps = {}) {
  useLocale()
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
    if (!readyRef.current) throw new Error(t('notReadyError'))
    if (savingRef.current) throw new Error(t('savingBusyError'))
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
        if (!expected || input.id !== expected.id) throw new Error(t('editStateChangedError'))
        assertSnippetUnchanged(items, expected)
      }
      const repository = new SnippetStoreRepository(items)
      repository.save(input)
      return repository.list()
    })
    await showToast({ style: Toast.Style.Success, title: t('savedToast'), message: input.title.trim() })
  }, [persistSnippets])

  const handleDeleteSnippet = useCallback(async (expected: SnippetItem) => {
    // 短语是用户自己写的内容，删除后无法恢复：先确认，取消或确认框打不开都不删
    const confirmed = await confirmAlert({
      title: t('deleteConfirmTitle'),
      message: t('deleteConfirmMessage', { title: expected.title }),
      primaryAction: { title: t('deleteConfirmBtn'), style: 'destructive' },
      dismissAction: { title: t('cancelBtn') }
    })
    if (!confirmed) return
    await persistSnippets((items) => {
      assertSnippetUnchanged(items, expected)
      return items.filter(item => item.id !== expected.id)
    })
    await showToast({ style: Toast.Style.Success, title: t('deletedToast') })
  }, [persistSnippets])

  const handleUseSnippet = useCallback(async (item: SnippetItem, paste: boolean) => {
    try {
      const clipboardText = item.content.includes('{clipboard}') ? await Clipboard.readText() : ''
      const resolved = resolveMacroTemplate(item.content, clipboardText)
      if (paste) await Clipboard.paste(resolved.text)
      else await Clipboard.copy(resolved.text)
    } catch (error) {
      await showToast({ style: Toast.Style.Failure, title: paste ? t('pasteFailedToast') : t('copyFailedToast'), message: error instanceof Error ? error.message : String(error) })
      return
    }
    try {
      await persistSnippets((items) => items.map((current) => current.id === item.id ? { ...current, useCount: (current.useCount || 0) + 1 } : current))
    } catch (error) {
      await showToast({ style: Toast.Style.Failure, title: paste ? t('pasteCountSaveFailed') : t('copyCountSaveFailed'), message: error instanceof Error ? error.message : String(error) })
      return
    }
    await showToast({ style: Toast.Style.Success, title: paste ? t('pastedToast') : t('copiedToast') })
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
    return <List isLoading={isLoading}><List.Item id="load-state" title={loadError ? t('loadErrorTitle') : t('loadingTitle')} subtitle={loadError || undefined} /></List>
  }

  return (
    <List
      isLoading={isLoading}
      searchText={searchText}
      onSearchTextChange={setSearchText}
      searchBarPlaceholder={t('searchPlaceholder')}
      searchBarAccessory={
        <List.Dropdown
          value={categoryFilter}
          onChange={(value) => { setCategoryFilter(value); setSearchText('') }}
          tooltip={t('filterTooltip')}
        >
          <List.Dropdown.Item title={t('filterAll')} value="all" icon={Icon.List} />
          <List.Dropdown.Item title={t('catInvoice')} value="invoice" icon={Icon.Document} />
          <List.Dropdown.Item title={t('catAddress')} value="address" icon={Icon.Pin} />
          <List.Dropdown.Item
            title={t('catCustomerService')}
            value="customer_service"
            icon={Icon.Text}
          />
          <List.Dropdown.Item title={t('catCode')} value="code" icon={Icon.Code} />
        </List.Dropdown>
      }
      filterBar={{
        summaryText: t('summaryText', { count: filteredSnippets.length }),
        actions: [
          {
            id: 'new-snippet',
            title: t('newSnippetAction'),
            onAction: () => push(<SnippetEditForm onSave={handleSaveSnippet} />)
          }
        ]
      }}
    >
      {filteredSnippets.length === 0 ? (
        <List.Item
          id="empty-state"
          icon={Icon.Plus}
          title={snippets.length === 0 ? t('emptyNoSnippetsTitle') : t('emptyNoMatchTitle')}
          subtitle={snippets.length === 0 ? t('emptyNoSnippetsSubtitle') : t('emptyNoMatchSubtitle')}
          actions={
            <ActionPanel>
              <Action title={t('newSnippetAction')} icon={Icon.Plus} onAction={() => push(<SnippetEditForm onSave={handleSaveSnippet} />)} />
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
            { tag: item.keyword ? t('keywordTag', { keyword: item.keyword }) : getSnippetCategoryLabel(item.category) },
            { text: t('useCountText', { count: item.useCount || 0 }) }
          ]}
          actions={
            <ActionPanel>
              <Action
                title={t('pasteAction')}
                icon={Icon.ArrowUp}
                onAction={() => handleUseSnippet(item, true)}
              />
              <Action
                title={t('copyAction')}
                onAction={() => handleUseSnippet(item, false)}
                shortcut={{ modifiers: ['ctrl'], key: 'enter' }}
              />
              <Action
                title={t('editAction')}
                icon={Icon.Pencil}
                shortcut={{ modifiers: ['ctrl'], key: 'e' }}
                onAction={() =>
                  push(<SnippetEditForm initialData={item} onSave={handleSaveSnippet} />)
                }
              />
              <Action
                title={t('deleteAction')}
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
