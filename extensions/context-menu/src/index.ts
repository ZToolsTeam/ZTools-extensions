import {
  List,
  ActionPanel,
  Action,
  Icon,
  Clipboard,
  useState,
  useEffect,
  useRef,
  showToast,
  Toast
} from '@ztools/declarative-ui'
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
    title: '读取异常',
    children: [
      List.Item({
        id: 'ctx-scan-error',
        title: hasEntries ? '重新扫描失败' : '读取右键菜单失败',
        subtitle: scanError,
        icon: Icon.ExclamationMark,
        actions: ActionPanel({
          children: [Action({ title: '重新扫描', icon: Icon.ArrowClockwise, onAction: onRescan })]
        })
      })
    ]
  })
}

/** Win11 菜单模式行：状态未识别时两个方向都提供，已知时只提供切换到另一种 */
function win11Section(mode: boolean | null, onSwitch: (useClassic: boolean) => Promise<void>) {
  const actions = [
    mode !== true
      ? Action({ title: '切换为经典完整右键菜单', icon: Icon.List, onAction: () => onSwitch(true) })
      : null,
    mode !== false
      ? Action({ title: '恢复 Windows 11 默认右键菜单', icon: Icon.ArrowClockwise, onAction: () => onSwitch(false) })
      : null
  ].filter(Boolean)
  return List.Section({
    title: '系统设置',
    children: [
      List.Item({
        id: 'ctx-win11-classic',
        title: 'Windows 11 右键菜单模式',
        subtitle: '仅 Windows 11 有效；切换后需重启资源管理器或重新登录',
        icon: Icon.Gear,
        accessories: [{ text: win11ModeLabel(mode) }],
        actions: ActionPanel({ title: 'Windows 11 右键菜单模式', children: actions })
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
      { text: item.enabled === null ? '状态未识别' : item.enabled ? '已启用' : '已禁用' }
    ],
    actions: ActionPanel({
      title: item.title,
      children: [
        canToggle
          ? Action({
              title: item.enabled ? '禁用该菜单项' : '启用该菜单项',
              icon: item.enabled ? Icon.XMarkCircle : Icon.Checkmark,
              onAction: () => onToggle(item)
            })
          : null,
        item.registryKey
          ? Action({
              title: '复制注册表路径',
              icon: Icon.Clipboard,
              onAction: () => onCopy(item.registryKey, '已复制注册表路径')
            })
          : null,
        item.command
          ? Action({
              title: '复制执行命令',
              icon: Icon.Code,
              shortcut: { modifiers: ['cmd', 'shift'], key: 'c' },
              onAction: () => onCopy(item.command, '已复制执行命令')
            })
          : null
      ].filter(Boolean)
    })
  })
}

export function ContextMenuCommand() {
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
        setScanError(snap.error || '读取右键菜单失败')
        showToast({ style: Toast.Style.Failure, title: '读取右键菜单失败', message: snap.error })
        return
      }
      setScanError('')
      setEntries(snap.entries)
      setTruncatedLocations(snap.truncatedLocations)
      if (snap.win11ClassicEnabled !== null) setWin11Classic(snap.win11ClassicEnabled)
      if (showNotice) {
        showToast({
          style: Toast.Style.Success,
          title: '已重新扫描右键菜单',
          message: `已启用 ${snap.enabledCount} 项 · 已禁用 ${snap.disabledCount} 项`
        })
      }
    } catch (err) {
      if (request !== generation.current) return
      setScanError(errorText(err))
      showToast({ style: Toast.Style.Failure, title: '读取右键菜单失败', message: errorText(err) })
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
        showToast({ style: Toast.Style.Failure, title: '修改右键菜单项失败', message: res.message })
      }
    } catch (err) {
      showToast({ style: Toast.Style.Failure, title: '修改右键菜单项失败', message: errorText(err) })
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
        showToast({ style: Toast.Style.Failure, title: '切换 Windows 11 右键菜单模式失败', message: res.message })
      }
    } catch (err) {
      showToast({ style: Toast.Style.Failure, title: '切换 Windows 11 右键菜单模式失败', message: errorText(err) })
    }
  }

  async function copyText(text: string, successTitle: string) {
    try {
      await Clipboard.copy(text)
      showToast({ style: Toast.Style.Success, title: successTitle, message: text })
    } catch (err) {
      showToast({ style: Toast.Style.Failure, title: '复制失败', message: errorText(err) })
    }
  }

  const filtered = filterContextMenuEntries(entries, searchText, filterMode)
  const query = searchText.trim().toLowerCase()
  const showWin11Row = filterMode === 'all' && (!query || WIN11_ROW_KEYWORDS.includes(query))

  return List({
    navigationTitle: '右键菜单管理',
    searchBarPlaceholder: '搜索菜单名称、注册表路径或命令',
    onSearchTextChange: setSearchText,
    isShowingDetail: false,
    isLoading,
    searchBarAccessory: List.Dropdown({
      tooltip: '按菜单位置筛选',
      value: filterMode,
      onChange: (val: string) => setFilterMode(val as ContextMenuFilterMode),
      children: [
        List.Dropdown.Item({ title: '全部位置', value: 'all' }),
        List.Dropdown.Item({ title: '所有文件 (*\\shell)', value: 'file' }),
        List.Dropdown.Item({ title: '文件夹 (Directory\\shell)', value: 'directory' }),
        List.Dropdown.Item({ title: '文件夹空白处 (Directory\\Background\\shell)', value: 'background' }),
        List.Dropdown.Item({ title: '已禁用', value: 'disabled' })
      ]
    }),
    filterBar: {
      summaryText: buildSummaryText({ entries, scanError, isLoading, truncatedLocations }),
      actions: [
        {
          id: 'rescan-reg',
          label: isLoading ? '正在扫描...' : '重新扫描',
          title: '重新扫描',
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
        title: `右键菜单命令项 (${filtered.length})`,
        subtitle: '只包含注册表 shell 下的命令项，不包含外壳扩展 (shellex)',
        children: filtered.map((item) => entryItem(item, handleToggleEntry, copyText))
      })
    ].filter(Boolean)
  })
}

export default ContextMenuCommand
