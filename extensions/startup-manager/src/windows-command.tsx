import React, {
  Action,
  ActionPanel,
  Color,
  Icon,
  List,
  Toast,
  confirmAlert,
  showToast,
  useEffect,
  useLocale,
  useMemo,
  useState
} from '@ztools/declarative-ui'
import { t } from './i18n.js'
import {
  copyStartupCommandToClipboard,
  filterStartupItems,
  removeBrokenStartupItems,
  describeCleanBrokenResult,
  resolveInitialStartupFilter,
  revealStartupExeInFolder,
  scanStartupItems,
  setStartupItemEnabled
} from './startup-service.js'
import type {
  StartupEntryItem,
  StartupSourceFilter
} from './types.js'

function renderStartupItemActions(params: {
  item: StartupEntryItem
  onToggle: (item: StartupEntryItem) => void
  onRevealExe: (exePath: string) => void | Promise<void>
  onCopyCommand: (command: string) => void | Promise<void>
  onRemoveBroken: (item: StartupEntryItem) => void
  onRescan: () => void
}) {
  const { item, onToggle, onRevealExe, onCopyCommand, onRemoveBroken, onRescan } = params
  return (
    <ActionPanel>
      <Action
        title={item.enabled ? t('actionDisable') : t('actionEnable')}
        icon={item.enabled ? Icon.XMarkCircle : Icon.CheckCircle}
        onAction={() => {
          onToggle(item)
        }}
      />
      {item.exePath && (
        <Action
          title={t('actionRevealExe')}
          icon={Icon.Folder}
          onAction={() => {
            void onRevealExe(item.exePath)
          }}
        />
      )}
      <Action
        title={t('actionCopyCommand')}
        icon={Icon.Clipboard}
        shortcut={{ modifiers: ['ctrl'], key: 'c' }}
        onAction={() => {
          void onCopyCommand(item.command)
        }}
      />
      {item.fileMissing && (
        <Action
          title={t('actionRemoveBroken')}
          icon={Icon.Trash}
          style={Action.Style.Destructive}
          shortcut={{ modifiers: ['ctrl'], key: 'backspace' }}
          onAction={() => {
            onRemoveBroken(item)
          }}
        />
      )}
      <Action
        title={t('actionRescanAll')}
        icon={Icon.ArrowClockwise}
        shortcut={{ modifiers: ['ctrl'], key: 'r' }}
        onAction={onRescan}
      />
    </ActionPanel>
  )
}

export default function StartupManagerCommand(props?: {
  featureCode?: string
  hostOverride?: unknown
}) {
  const locale = useLocale()
  const [items, setItems] = useState<StartupEntryItem[]>([])
  const [sourceFilter, setSourceFilter] = useState<StartupSourceFilter>(
    resolveInitialStartupFilter(props?.featureCode)
  )
  const [searchText, setSearchText] = useState<string>('')
  const [isLoading, setIsLoading] = useState<boolean>(false)
  const [loadError, setLoadError] = useState<string>('')
  const [scanWarnings, setScanWarnings] = useState<string[]>([])

  const reloadItems = async () => {
    setIsLoading(true)
    try {
      const res = await scanStartupItems(props?.hostOverride)
      if (!res.ok) {
        setLoadError(res.error || t('errScanFailed'))
        await showToast({
          style: Toast.Style.Failure,
          title: t('errScanFailed'),
          message: res.error || t('toastScanFailedMsg')
        })
        return
      }
      setLoadError('')
      setScanWarnings(res.warnings ?? [])
      setItems(res.items)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    let seq = 0

    const init = async () => {
      const mySeq = ++seq
      setIsLoading(true)
      try {
        const res = await scanStartupItems(props?.hostOverride)
        if (cancelled || mySeq !== seq) return
        if (res.ok) {
          setLoadError('')
          setScanWarnings(res.warnings ?? [])
          setItems(res.items)
        } else {
          setLoadError(res.error || t('errScanFailed'))
        }
      } finally {
        if (!cancelled && mySeq === seq) {
          setIsLoading(false)
        }
      }
    }

    void init()
    return () => {
      cancelled = true
    }
  }, [props?.hostOverride])

  useEffect(() => {
    if (props?.featureCode) {
      setSourceFilter(resolveInitialStartupFilter(props.featureCode))
    }
  }, [props?.featureCode])

  const enabledCount = useMemo(() => items.filter((i) => i.enabled).length, [items])
  const serviceCount = useMemo(() => items.filter((i) => i.source === 'service').length, [items])
  const brokenCount = useMemo(() => items.filter((i) => i.fileMissing).length, [items])

  const filteredItems = useMemo(
    () => filterStartupItems(items, sourceFilter, searchText),
    [items, sourceFilter, searchText]
  )

  const handleToggleItem = async (item: StartupEntryItem) => {
    const targetEnabled = !item.enabled
    const res = await setStartupItemEnabled(
      item,
      targetEnabled,
      items,
      props?.hostOverride
    )
    if (!res.ok) {
      await showToast({
        style: Toast.Style.Failure,
        title:
          res.errorCode === 'ADMIN_REQUIRED'
            ? t('toastAdminRequired')
            : t('toastToggleFailedTitle'),
        message: res.error || t('toastToggleFailedMsg')
      })
      return
    }
    if (res.updatedItems) {
      setItems(res.updatedItems)
    }
    await showToast({
      style: Toast.Style.Success,
      title: targetEnabled
        ? t('toastEnabledTitle', { name: item.name })
        : t('toastDisabledTitle', { name: item.name }),
      message: `${item.sourceLabel} · ${targetEnabled ? t('toastEnabledMsg') : t('toastDisabledMsg')}`
    })
  }

  const handleRemoveSingleBroken = async (item: StartupEntryItem) => {
    if (!item.fileMissing) {
      await showToast({
        style: Toast.Style.Failure,
        title: t('toastOnlyBrokenAllowed'),
        message: t('toastOnlyBrokenMsg')
      })
      return
    }
    const confirmed = await confirmAlert({
      title: t('confirmRemoveTitle', { name: item.name }),
      message: t('confirmRemoveMsg', { path: item.exePath || item.command })
    })
    if (!confirmed) return

    const res = await removeBrokenStartupItems([item], items, props?.hostOverride)
    // 宿主没有确认删除这一项（失败，或带 partial 的未清理结果）都按失败提示
    if (!res.ok || res.partial || !res.removedIds.includes(item.id)) {
      if (res.remainingItems) setItems(res.remainingItems)
      await showToast({
        style: Toast.Style.Failure,
        title: t('toastCleanSingleFailed'),
        message: res.failed?.[0]?.error || res.error || (res.ok ? t('toastCleanSingleUnconfirmed') : t('toastCleanSingleRetryAdmin'))
      })
      return
    }
    if (res.remainingItems) {
      setItems(res.remainingItems)
    }
    await showToast({
      style: Toast.Style.Success,
      title: t('toastCleanSingleSuccess', { name: item.name })
    })
  }

  const handleCleanAllBroken = async () => {
    const brokenList = items.filter((i) => i.fileMissing)
    if (brokenList.length === 0) {
      await showToast({
        style: Toast.Style.Animated,
        title: t('toastNoBrokenTitle'),
        message: t('toastNoBrokenMsg')
      })
      return
    }
    const confirmed = await confirmAlert({
      title: t('confirmCleanAllTitle', { count: brokenList.length }),
      message: t('confirmCleanAllMsg')
    })
    if (!confirmed) return

    const res = await removeBrokenStartupItems(brokenList, items, props?.hostOverride)
    // 成功、部分成功、失败都只移除宿主确认已删除的条目
    if (res.remainingItems) setItems(res.remainingItems)
    const notice = describeCleanBrokenResult(res, items)
    await showToast({
      style: res.ok && !res.partial ? Toast.Style.Success : Toast.Style.Failure,
      title: notice.title,
      ...(notice.message ? { message: notice.message } : {})
    })
  }

  return (
    <List
      navigationTitle={t('winNavTitle')}
      isLoading={isLoading}
      isShowingDetail={false}
      searchText={searchText}
      onSearchTextChange={setSearchText}
      searchBarPlaceholder={t('winSearchPlaceholder')}
      searchBarAccessory={
        <List.Dropdown
          value={sourceFilter}
          onChange={(val: string) => setSourceFilter(val as StartupSourceFilter)}
          tooltip={t('winFilterTooltip')}
        >
          <List.Dropdown.Item title={t('winFilterAll')} value="all" icon={Icon.List} />
          <List.Dropdown.Item title={t('winFilterApp')} value="app" icon={Icon.Window} />
          <List.Dropdown.Item title={t('winFilterService')} value="service" icon={Icon.Gear} />
          <List.Dropdown.Item title={t('winFilterTask')} value="task" icon={Icon.Clock} />
          <List.Dropdown.Item title={t('winFilterEnabled')} value="enabled" icon={Icon.CheckCircle} />
          <List.Dropdown.Item title={t('winFilterBroken')} value="broken" icon={Icon.ExclamationMark} />
        </List.Dropdown>
      }
      filterBar={{
        summaryText: t('winSummaryText', { total: items.length, enabled: enabledCount, service: serviceCount, broken: brokenCount }),
        actions: [
          {
            id: 'rescan',
            title: t('actionRescan'),
            onAction: () => {
              void reloadItems()
            }
          },
          {
            id: 'clean-broken',
            title: t('actionCleanBroken'),
            style: 'destructive',
            onAction: () => {
              void handleCleanAllBroken()
            }
          }
        ]
      }}
    >
      {(loadError || scanWarnings.length > 0) && (
        <List.Section title={t('sectionLoadStatus')}>
          <List.Item
            id="startup-load-status"
            icon={Icon.ExclamationMark}
            title={loadError ? t('loadErrorTitle') : t('loadWarningsTitle', { count: scanWarnings.length })}
            subtitle={loadError || scanWarnings.join('; ')}
            actions={
              <ActionPanel>
                <Action title={t('actionRescanAll')} icon={Icon.ArrowClockwise} onAction={() => { void reloadItems() }} />
              </ActionPanel>
            }
          />
        </List.Section>
      )}
      {filteredItems.length === 0 ? (
        <List.Section title={t('sectionScanResult')}>
          <List.Item
            id="empty-startup"
            icon={loadError ? Icon.ExclamationMark : Icon.CheckCircle}
            title={loadError ? t('emptyLoadErrorTitle') : t('emptyNoMatchTitle')}
            subtitle={t('emptySubtitle')}
            actions={
              <ActionPanel>
                <Action
                  title={t('actionRescanAll')}
                  icon={Icon.ArrowClockwise}
                  shortcut={{ modifiers: ['ctrl'], key: 'r' }}
                  onAction={() => {
                    void reloadItems()
                  }}
                />
              </ActionPanel>
            }
          />
        </List.Section>
      ) : (
        <List.Section
          title={t('sectionItemsTitle')}
          subtitle={t('sectionItemsCount', { count: filteredItems.length })}
        >
          {filteredItems.map((item) => {
            const accessories = [
              ...(item.fileMissing ? [{ tag: { value: t('tagMissingFile'), color: Color.Red } }] : []),
              { tag: item.sourceLabel },
              { text: item.enabled ? t('statusEnabled') : t('statusDisabled') }
            ]
            return (
              <List.Item
                key={item.id}
                id={item.id}
                title={item.name}
                subtitle={`${item.publisher ? `[${item.publisher}] ` : ''}${item.command}`}
                icon={item.enabled ? Icon.CheckCircle : Icon.Circle}
                accessories={accessories}
                actions={renderStartupItemActions({
                  item,
                  onToggle: (entry) => {
                    void handleToggleItem(entry)
                  },
                  onRevealExe: async (exePath) => {
                    const shown = await revealStartupExeInFolder(exePath, props?.hostOverride)
                    if (!shown) {
                      await showToast({ style: Toast.Style.Failure, title: t('toastRevealFailed'), message: exePath })
                    }
                  },
                  onCopyCommand: async (cmd) => {
                    const copied = await copyStartupCommandToClipboard(cmd, props?.hostOverride)
                    await showToast(copied
                      ? { style: Toast.Style.Success, title: t('toastCopySuccess') }
                      : { style: Toast.Style.Failure, title: t('toastCopyFailedTitle'), message: t('toastCopyFailedMsg') })
                  },
                  onRemoveBroken: (entry) => {
                    void handleRemoveSingleBroken(entry)
                  },
                  onRescan: () => {
                    void reloadItems()
                  }
                })}
              />
            )
          })}
        </List.Section>
      )}
    </List>
  )
}
