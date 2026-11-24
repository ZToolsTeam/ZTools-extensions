import {
  List,
  ActionPanel,
  Action,
  Icon,
  useState,
  useEffect,
  useLocale,
  showToast,
  Toast,
  confirmAlert
} from '@ztools/declarative-ui'
import {
  getOfficialWechatOwnerRules,
  WechatCleanCategoryItem,
  WechatScannedFileEntry,
  WechatAccountStat,
  WECHAT_FILE_DISPLAY_LIMIT,
  formatBytes,
  formatDateTime,
  fetchWechatCleanSnapshot,
  executeWechatCleanup,
  summarizeWechatCleanup,
  filterWechatFiles,
  pickDefaultCheckedPaths,
  openWechatDirectory,
  openWechatFileDefault,
  isRealElectronHost
} from './logic.js'
import { t } from './i18n.js'

const SHORTCUT_CLEAN_CHECKED = { modifiers: ['ctrl', 'shift'] as ('ctrl' | 'shift')[], key: 'return' }

export default function WechatCleanerCommand() {
  useLocale()
  const inRealHost = isRealElectronHost()
  const [searchText, setSearchText] = useState('')
  const [selectedAccount, setSelectedAccount] = useState<string>('ALL')
  const [selectedOwnerId, setSelectedOwnerId] = useState<string>('ALL')

  const [categories, setCategories] = useState<WechatCleanCategoryItem[]>([])
  const [allFiles, setAllFiles] = useState<WechatScannedFileEntry[]>([])
  const [accountStats, setAccountStats] = useState<WechatAccountStat[]>([])
  const [selectedFilePaths, setSelectedFilePaths] = useState<string[]>([])
  const [protectedDbBytes, setProtectedDbBytes] = useState(0)
  const [isLoading, setIsLoading] = useState(inRealHost)
  const [scanError, setScanError] = useState('')

  const q = searchText.trim().toLowerCase()

  /**
   * 重新扫描。keepSelection 为 true 时（清理之后）只保留仍然存在的已勾选文件，不再自动勾选新出现的文件；
   * 否则按默认规则只勾选扫描后右侧显示出来的文件
   */
  async function refreshScan(options: { showIndicator?: boolean; keepSelection?: boolean } = {}) {
    if (!inRealHost) return
    setIsLoading(true)
    if (options.showIndicator) {
      showToast({ style: Toast.Style.Animated, title: t('toastScanning') })
    }
    try {
      const snap = await fetchWechatCleanSnapshot()
      setCategories(snap.categories)
      setAllFiles(snap.allFiles)
      setAccountStats(snap.accountStats)
      setProtectedDbBytes(snap.protectedDbBytes)
      setScanError(snap.error || '')
      if (options.keepSelection) {
        const existing = new Set(snap.allFiles.filter(f => !f.isProtected).map(f => f.path))
        setSelectedFilePaths(prev => prev.filter(p => existing.has(p)))
      } else {
        const visible = filterWechatFiles(snap.allFiles, {
          accountId: selectedAccount,
          ownerId: selectedOwnerId,
          query: q
        }).slice(0, WECHAT_FILE_DISPLAY_LIMIT)
        setSelectedFilePaths(pickDefaultCheckedPaths(visible, snap.categories))
      }
      if (snap.error) {
        showToast({ style: Toast.Style.Failure, title: t('toastScanIncomplete'), message: snap.error })
      } else if (options.showIndicator) {
        showToast({
          style: Toast.Style.Success,
          title: t('toastScanDoneTitle'),
          message: t('toastScanDoneMsg', { count: snap.allFiles.length, size: formatBytes(snap.protectedDbBytes) })
        })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setScanError(message)
      showToast({ style: Toast.Style.Failure, title: t('toastScanFailed'), message })
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    refreshScan()
  }, [])

  const filteredFiles = filterWechatFiles(allFiles, {
    accountId: selectedAccount,
    ownerId: selectedOwnerId,
    query: q
  })
  const visibleFiles = filteredFiles.slice(0, WECHAT_FILE_DISPLAY_LIMIT)

  const selectedSet = new Set(selectedFilePaths)
  const selectableVisibleFiles = visibleFiles.filter(f => !f.isProtected)
  const allVisibleChecked =
    selectableVisibleFiles.length > 0 && selectableVisibleFiles.every(f => selectedSet.has(f.path))
  const someVisibleChecked = selectableVisibleFiles.some(f => selectedSet.has(f.path)) && !allVisibleChecked

  // 清理范围：当前账号筛选下用户勾选的文件（不受分类与搜索影响，确认框里按分类列出）
  const targetFiles = allFiles.filter(
    f =>
      !f.isProtected &&
      (selectedAccount === 'ALL' || f.accountId === selectedAccount) &&
      selectedSet.has(f.path)
  )
  const targetBytes = targetFiles.reduce((s, f) => s + f.sizeBytes, 0)

  function toggleSingleFile(filePath: string, nextChecked: boolean) {
    setSelectedFilePaths(prev => {
      const next = new Set(prev)
      if (nextChecked) next.add(filePath)
      else next.delete(filePath)
      return Array.from(next)
    })
  }

  function toggleAllVisibleFiles() {
    if (selectableVisibleFiles.length === 0) return
    setSelectedFilePaths(prev => {
      const next = new Set(prev)
      for (const f of selectableVisibleFiles) {
        if (allVisibleChecked) next.delete(f.path)
        else next.add(f.path)
      }
      return Array.from(next)
    })
  }

  async function handleCleanChecked() {
    if (targetFiles.length === 0) {
      showToast({
        style: Toast.Style.Failure,
        title: t('errNoFilesChecked'),
        message: t('toastNoCheckedMsg')
      })
      return
    }

    const breakdownLines = getOfficialWechatOwnerRules().filter(r => r.ownerId !== 999)
      .map(rule => {
        const inCat = targetFiles.filter(f => f.ownerId === rule.ownerId)
        if (inCat.length === 0) return ''
        const bytes = inCat.reduce((s, f) => s + f.sizeBytes, 0)
        return t('breakdownLine', { name: rule.shortName, count: inCat.length, size: formatBytes(bytes) })
      })
      .filter(Boolean)
      .join('\n')

    const confirmed = await confirmAlert({
      title: t('confirmTrashTitle', { count: targetFiles.length }),
      message: t('confirmTrashMsg', {
        scope: selectedAccount === 'ALL' ? t('scopeAllAccounts') : selectedAccount,
        size: formatBytes(targetBytes),
        breakdown: breakdownLines,
        forbidden: t('forbiddenReason')
      }),
      primaryAction: { title: t('actionMoveToTrash'), style: 'destructive' }
    })
    if (!confirmed) return

    const res = await executeWechatCleanup(
      targetFiles.map(f => f.path),
      targetFiles
    )
    const summary = summarizeWechatCleanup(res)
    showToast({
      style: summary.success ? Toast.Style.Success : Toast.Style.Failure,
      title: summary.title,
      message: summary.message
    })
    if (res.deletedCount > 0) {
      await refreshScan({ keepSelection: true })
    }
  }

  async function locateFile(filePath: string) {
    const ok = await openWechatDirectory(filePath)
    if (!ok) showToast({ style: Toast.Style.Failure, title: t('toastLocateFailed'), message: filePath })
  }

  async function openFile(filePath: string) {
    const ok = await openWechatFileDefault(filePath)
    if (!ok) showToast({ style: Toast.Style.Failure, title: t('toastOpenFailed'), message: filePath })
  }

  if (!inRealHost) {
    return List({
      searchBarPlaceholder: t('clientOnlyPlaceholder'),
      children: [
        List.Item({
          id: 'wx-client-required',
          title: t('clientRequired'),
          subtitle: t('clientOnlySubtitle'),
          icon: { source: Icon.Info }
        })
      ]
    })
  }

  const totalScannable = categories
    .filter(c => c.ownerId !== 999)
    .reduce((s, c) => s + c.totalSizeBytes, 0)

  const maxFileBytes = Math.max(1, visibleFiles[0]?.sizeBytes || 1)
  const rightSubListItems = visibleFiles.map(f => {
    const isDbProtected = f.isProtected || f.ownerId === 999
    const isChecked = !isDbProtected && selectedSet.has(f.path)
    const volRatio = Math.max(10, Math.min(100, Math.round((f.sizeBytes / maxFileBytes) * 100)))

    return List.Item({
      id: f.id,
      title: f.name,
      subtitle: isDbProtected
        ? t('protectedFileSub', { account: f.accountId, dir: f.parentDir })
        : `${f.accountId} · ${formatDateTime(f.mtime)} · ${f.parentDir}`,
      checkable: !isDbProtected,
      checked: isChecked,
      onCheckChange: (c: boolean) => toggleSingleFile(f.path, c),
      onToggleCheck: (c: boolean) => toggleSingleFile(f.path, c),
      icon: { source: isDbProtected ? Icon.Lock : Icon.Document },
      accessories: [
        { progress: { value: volRatio } },
        { tag: { value: isDbProtected ? t('tagProtected') : f.unrecognized ? t('tagUnrecognized') : f.ownerName } },
        { text: formatBytes(f.sizeBytes) }
      ],
      actions: ActionPanel({
        title: f.name,
        children: [
          Action({
            title: t('actionLocateExplorer'),
            icon: Icon.Folder,
            onAction: () => locateFile(f.path)
          }),
          ...(!isDbProtected
            ? [
                Action({
                  title: isChecked ? t('actionUncheckFile') : t('actionCheckFile'),
                  icon: Icon.Checkmark,
                  onAction: () => toggleSingleFile(f.path, !isChecked)
                })
              ]
            : []),
          Action({
            title: t('actionOpenDefault'),
            icon: Icon.AppWindow,
            onAction: () => openFile(f.path)
          }),
          Action({
            title: t('actionCleanChecked', { count: targetFiles.length, size: formatBytes(targetBytes) }),
            icon: Icon.Trash,
            style: Action.Style.Destructive,
            shortcut: SHORTCUT_CLEAN_CHECKED,
            onAction: () => handleCleanChecked()
          }),
          Action.CopyToClipboard({
            title: t('actionCopyFullPath'),
            content: f.path
          })
        ]
      })
    })
  })

  const activeCategory = categories.find(c => String(c.ownerId) === selectedOwnerId)
  const rightTitle = activeCategory ? t('rightTitleCategory', { name: activeCategory.name }) : t('rightTitleAll')
  const shownText =
    filteredFiles.length > visibleFiles.length
      ? t('shownTruncated', { total: filteredFiles.length, shown: visibleFiles.length })
      : t('shownAll', { total: filteredFiles.length })

  return List({
    searchBarPlaceholder: t('searchPlaceholder'),
    onSearchTextChange: setSearchText,
    isShowingDetail: false,
    isLoading,
    searchBarAccessory: List.Dropdown({
      tooltip: t('accountTooltip'),
      value: selectedAccount,
      onChange: val => setSelectedAccount(val),
      children: [
        List.Dropdown.Item({
          title: t('accountAllTitle', { count: allFiles.length }),
          value: 'ALL'
        }),
        ...accountStats.map(acc =>
          List.Dropdown.Item({
            title: `${acc.accountId} (${formatBytes(acc.totalBytes)})`,
            value: acc.accountId
          })
        )
      ]
    }),
    filterBar: {
      summaryText: scanError
        ? t('summaryScanError', { error: scanError })
        : t('summaryNormal', {
            scope: selectedAccount === 'ALL' ? t('scopeAllAccounts') : selectedAccount,
            scannable: formatBytes(totalScannable),
            count: targetFiles.length,
            size: formatBytes(targetBytes),
            protectedSize: formatBytes(protectedDbBytes)
          }),
      actions: [
        {
          id: 'wx-act-clean',
          label: t('actionCleanChecked', { count: targetFiles.length, size: formatBytes(targetBytes) }),
          title: t('actionCleanChecked', { count: targetFiles.length, size: formatBytes(targetBytes) }),
          style: 'primary',
          disabled: targetFiles.length === 0,
          onAction: () => handleCleanChecked()
        },
        {
          id: 'wx-act-rescan',
          label: t('actionRescan'),
          title: t('actionRescan'),
          style: 'secondary',
          onAction: () => refreshScan({ showIndicator: true })
        }
      ]
    },
    subList: {
      title: rightTitle,
      subtitle: t('subListSubtitle', { shown: shownText, count: targetFiles.length, size: formatBytes(targetBytes) }),
      checkable: selectableVisibleFiles.length > 0,
      checked: allVisibleChecked ? true : someVisibleChecked ? 'indeterminate' : false,
      onCheckChange: () => toggleAllVisibleFiles(),
      emptyText: isLoading ? t('emptyScanning') : t('emptyNoFiles'),
      items: rightSubListItems
    },
    children: [
      List.Section({
        title: t('sectionOverview'),
        children: [
          List.Item({
            id: 'wx-nav-all',
            title: t('navAllTitle'),
            subtitle: t('navAllSub', { count: allFiles.length }),
            icon: { source: Icon.HardDrive },
            accessories: [{ text: formatBytes(totalScannable) }],
            onSelect: () => setSelectedOwnerId('ALL')
          })
        ]
      }),
      List.Section({
        title: t('sectionCategories'),
        children: categories.map(cat => {
          const isProtected = cat.ownerId === 999
          const checkedInCat = targetFiles.filter(f => f.ownerId === cat.ownerId).length
          return List.Item({
            id: `wx-nav-owner-${cat.ownerId}`,
            title: cat.shortName,
            subtitle: isProtected
              ? t('catProtectedSub')
              : t('catCountSub', { listed: cat.files.length, checked: checkedInCat }),
            icon: { source: isProtected ? Icon.Lock : Icon.Folder },
            accessories: [{ text: formatBytes(cat.totalSizeBytes) }],
            onSelect: () => setSelectedOwnerId(String(cat.ownerId))
          })
        })
      })
    ]
  })
}
