import {
  List,
  ActionPanel,
  Action,
  Icon,
  Clipboard,
  useState,
  useEffect,
  useRef,
  useLocale,
  showToast,
  Toast
} from '@ztools/declarative-ui'
import { t } from './i18n.js'
import {
  type ContextMenuEntry,
  type ContextMenuFilterMode,
  fetchContextMenuEntries,
  toggleContextMenuEntry,
  switchWin11ClassicMenu,
  filterContextMenuEntries,
  buildSummaryText,
  win11ModeLabel
} from './logic.js'

export * from './logic.js'

const WIN11_ROW_KEYWORDS = 'windows 11 win11 经典 完整 默认 折叠 classic 右键菜单模式'

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function scanErrorSection(scanError: string, hasEntries: boolean, onRescan: () => Promise<void>) {
  return List.Section({
    title: t('section.scanError'),
    children: [
      List.Item({
        id: 'ctx-scan-error',
        title: hasEntries ? t('item.rescanFailed') : t('item.scanFailed'),
        subtitle: scanError,
        icon: Icon.ExclamationMark,
        actions: ActionPanel({
          children: [Action({ title: t('action.rescan'), icon: Icon.ArrowClockwise, onAction: onRescan })]
        })
      })
    ]
  })
}

/** Win11 菜单模式行：状态未识别时两个方向都提供，已知时只提供切换到另一种 */
function win11Section(mode: boolean | null, onSwitch: (useClassic: boolean) => Promise<void>) {
  const actions = [
    mode !== true
      ? Action({ title: t('action.switchToClassic'), icon: Icon.List, onAction: () => onSwitch(true) })
      : null,
    mode !== false
      ? Action({ title: t('action.restoreWin11'), icon: Icon.ArrowClockwise, onAction: () => onSwitch(false) })
      : null
  ].filter(Boolean)
  return List.Section({
    title: t('section.systemSettings'),
    children: [
      List.Item({
        id: 'ctx-win11-classic',
        title: t('win11.title'),
        subtitle: t('win11.subtitle'),
        icon: Icon.Gear,
        accessories: [{ text: win11ModeLabel(mode) }],
        actions: ActionPanel({ title: t('win11.title'), children: actions })
      })
    ]
  })
}

function entryItem(
  item: ContextMenuEntry,
  onToggle: (item: ContextMenuEntry) => Promise<void>,
  onCopy: (text: string, successTitle: string) => Promise<void>
) {
  const canToggle = item.enabled !== null && Boolean(item.registryKey)
  return List.Item({
    id: item.id,
    title: item.title,
    subtitle: item.command ? `${item.registryKey} · ${item.command}` : item.registryKey,
    icon: item.enabled === null ? Icon.QuestionMark : item.enabled ? Icon.Checkmark : Icon.XMarkCircle,
    accessories: [
      { tag: { value: item.scopeLabel } },
      { text: item.enabled === null ? t('status.unknown') : item.enabled ? t('status.enabled') : t('status.disabled') }
    ],
    actions: ActionPanel({
      title: item.title,
      children: [
        canToggle
          ? Action({
              title: item.enabled ? t('action.disableEntry') : t('action.enableEntry'),
              icon: item.enabled ? Icon.XMarkCircle : Icon.Checkmark,
              onAction: () => onToggle(item)
            })
          : null,
        item.registryKey
          ? Action({
              title: t('action.copyRegPath'),
              icon: Icon.Clipboard,
              onAction: () => onCopy(item.registryKey, t('toast.copiedRegPath'))
            })
          : null,
        item.command
          ? Action({
              title: t('action.copyCommand'),
              icon: Icon.Code,
              shortcut: { modifiers: ['cmd', 'shift'], key: 'c' },
              onAction: () => onCopy(item.command, t('toast.copiedCommand'))
            })
          : null
      ].filter(Boolean)
    })
  })
}

export function ContextMenuCommand() {
  useLocale()
  const [searchText, setSearchText] = useState('')
  const [filterMode, setFilterMode] = useState<ContextMenuFilterMode>('all')
  const [entries, setEntries] = useState<ContextMenuEntry[]>([])
  const [scanError, setScanError] = useState('')
  const [truncatedLocations, setTruncatedLocations] = useState<string[]>([])
  // 宿主扫描不返回 Win11 经典菜单状态：未成功切换过之前一律显示未识别，不假设任何一种模式
  const [win11Classic, setWin11Classic] = useState<boolean | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const generation = useRef(0)
  const pendingIds = useRef(new Set<string>())

  async function refreshEntries(showNotice = false) {
    const request = ++generation.current
    setIsLoading(true)
    try {
      const snap = await fetchContextMenuEntries()
      if (request !== generation.current) return
      if (!snap.ok) {
        // 扫描失败不能当成没有菜单项：保留上次结果并显示错误
        setScanError(snap.error || t('item.scanFailed'))
        showToast({ style: Toast.Style.Failure, title: t('item.scanFailed'), message: snap.error })
        return
      }
      setScanError('')
      setEntries(snap.entries)
      setTruncatedLocations(snap.truncatedLocations)
      if (snap.win11ClassicEnabled !== null) setWin11Classic(snap.win11ClassicEnabled)
      if (showNotice) {
        showToast({
          style: Toast.Style.Success,
          title: t('toast.rescanSuccess'),
          message: t('toast.rescanSummary', { enabled: snap.enabledCount, disabled: snap.disabledCount })
        })
      }
    } catch (err) {
      if (request !== generation.current) return
      setScanError(errorText(err))
      showToast({ style: Toast.Style.Failure, title: t('item.scanFailed'), message: errorText(err) })
    } finally {
      if (request === generation.current) setIsLoading(false)
    }
  }

  useEffect(() => {
    void refreshEntries(false)
  }, [])

  async function handleToggleEntry(item: ContextMenuEntry) {
    if (item.enabled === null || !item.registryKey || pendingIds.current.has(item.id)) return
    pendingIds.current.add(item.id)
    try {
      const res = await toggleContextMenuEntry(item.id, !item.enabled, undefined, item.registryKey, item.title)
      if (res.ok) {
        setEntries((prev) => prev.map((cur) => (cur.id === item.id ? { ...cur, enabled: res.enabled } : cur)))
        showToast({ style: Toast.Style.Success, title: res.message, message: item.registryKey })
      } else {
        showToast({ style: Toast.Style.Failure, title: t('toast.toggleFailed'), message: res.message })
      }
    } catch (err) {
      showToast({ style: Toast.Style.Failure, title: t('toast.toggleFailed'), message: errorText(err) })
    } finally {
      pendingIds.current.delete(item.id)
    }
  }

  async function handleSwitchWin11(useClassic: boolean) {
    try {
      const res = await switchWin11ClassicMenu(useClassic)
      if (res.ok) {
        setWin11Classic(useClassic)
        showToast({ style: Toast.Style.Success, title: res.message })
      } else {
        showToast({ style: Toast.Style.Failure, title: t('toast.switchWin11Failed'), message: res.message })
      }
    } catch (err) {
      showToast({ style: Toast.Style.Failure, title: t('toast.switchWin11Failed'), message: errorText(err) })
    }
  }

  async function copyText(text: string, successTitle: string) {
    try {
      await Clipboard.copy(text)
      showToast({ style: Toast.Style.Success, title: successTitle, message: text })
    } catch (err) {
      showToast({ style: Toast.Style.Failure, title: t('toast.copyFailed'), message: errorText(err) })
    }
  }

  const filtered = filterContextMenuEntries(entries, searchText, filterMode)
  const query = searchText.trim().toLowerCase()
  const showWin11Row = filterMode === 'all' && (!query || WIN11_ROW_KEYWORDS.includes(query))

  return List({
    navigationTitle: t('nav.title'),
    searchBarPlaceholder: t('search.placeholder'),
    onSearchTextChange: setSearchText,
    isShowingDetail: false,
    isLoading,
    searchBarAccessory: List.Dropdown({
      tooltip: t('filter.tooltip'),
      value: filterMode,
      onChange: (val: string) => setFilterMode(val as ContextMenuFilterMode),
      children: [
        List.Dropdown.Item({ title: t('filter.all'), value: 'all' }),
        List.Dropdown.Item({ title: t('filter.file'), value: 'file' }),
        List.Dropdown.Item({ title: t('filter.directory'), value: 'directory' }),
        List.Dropdown.Item({ title: t('filter.background'), value: 'background' }),
        List.Dropdown.Item({ title: t('filter.disabled'), value: 'disabled' })
      ]
    }),
    filterBar: {
      summaryText: buildSummaryText({ entries, scanError, isLoading, truncatedLocations }),
      actions: [
        {
          id: 'rescan-reg',
          label: isLoading ? t('filterBar.scanning') : t('action.rescan'),
          title: t('action.rescan'),
          style: 'secondary',
          disabled: isLoading,
          onAction: () => void refreshEntries(true)
        }
      ]
    },
    children: [
      scanError ? scanErrorSection(scanError, entries.length > 0, () => refreshEntries(true)) : null,
      showWin11Row ? win11Section(win11Classic, handleSwitchWin11) : null,
      List.Section({
        title: t('section.entries', { count: filtered.length }),
        subtitle: t('section.entriesSubtitle'),
        children: filtered.map((item) => entryItem(item, handleToggleEntry, copyText))
      })
    ].filter(Boolean)
  })
}

export default ContextMenuCommand
