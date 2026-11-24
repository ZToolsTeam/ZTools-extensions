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
import { t } from './i18n.js'
import {
  getOfficialQQGroupRules,
  QQCleanCategoryItem,
  QQScannedFileEntry,
  QQAccountStat,
  QQ_FILE_DISPLAY_LIMIT,
  getForbiddenReason,
  formatBytes,
  formatDateTime,
  fetchQQCleanSnapshot,
  executeQQCleanup,
  summarizeQQCleanup,
  filterQQFiles,
  pickDefaultCheckedPaths,
  openQQDirectory,
  openQQFileDefault,
  isRealElectronHost
} from './logic.js'

function stripLeadingSymbols(name: string): string {
  return name.replace(/^[^一-龥A-Za-z0-9]+/, '').trim() || name
}

const SHORTCUT_CLEAN_CHECKED = { modifiers: ['ctrl', 'shift'] as ('ctrl' | 'shift')[], key: 'return' }

export default function QQCleanerCommand() {
  useLocale()
  const inRealHost = isRealElectronHost()
  const [searchText, setSearchText] = useState('')
  const [selectedAccount, setSelectedAccount] = useState<string>('ALL')
  const [selectedGroupId, setSelectedGroupId] = useState<number>(0)

  const [categories, setCategories] = useState<QQCleanCategoryItem[]>([])
  const [allFiles, setAllFiles] = useState<QQScannedFileEntry[]>([])
  const [accountStats, setAccountStats] = useState<QQAccountStat[]>([])
  const [protectedDbBytes, setProtectedDbBytes] = useState(0)
  const [isLoading, setIsLoading] = useState(inRealHost)
  const [scanError, setScanError] = useState('')
  const [checkedFilePaths, setCheckedFilePaths] = useState<string[]>([])

  const q = searchText.trim().toLowerCase()

  /**
   * 重新扫描。keepSelection 为 true 时（清理之后）只保留仍然存在的已勾选文件，不再自动勾选新出现的文件；
   * 否则按默认规则只勾选扫描后右侧显示出来的文件
   */
  async function refreshScan(options: { showIndicator?: boolean; keepSelection?: boolean } = {}) {
    if (!inRealHost) return
    setIsLoading(true)
    if (options.showIndicator) {
      showToast({ style: Toast.Style.Animated, title: t('scanningToast') })
    }
    try {
      const snap = await fetchQQCleanSnapshot()
      setCategories(snap.categories.map(c => ({ ...c, name: stripLeadingSymbols(c.name) })))
      setAllFiles(snap.allFiles)
      setAccountStats(snap.accountStats)
      setProtectedDbBytes(snap.protectedDbBytes)
      setScanError(snap.error || '')
      if (options.keepSelection) {
        const existing = new Set(snap.allFiles.filter(f => !f.isProtected).map(f => f.path))
        setCheckedFilePaths(prev => prev.filter(p => existing.has(p)))
      } else {
        const visible = filterQQFiles(snap.allFiles, {
          accountId: selectedAccount,
          groupId: selectedGroupId,
          query: q
        }).slice(0, QQ_FILE_DISPLAY_LIMIT)
        setCheckedFilePaths(pickDefaultCheckedPaths(visible, snap.categories))
      }
      if (snap.error) {
        showToast({ style: Toast.Style.Failure, title: t('scanIncompleteToast'), message: snap.error })
      } else if (options.showIndicator) {
        showToast({
          style: Toast.Style.Success,
          title: t('scanCompleteToast'),
          message: t('scanCompleteMsg', { accounts: snap.detectedAccounts.length, files: snap.allFiles.length })
        })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setScanError(message)
      showToast({ style: Toast.Style.Failure, title: t('scanFailedToast'), message })
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    refreshScan()
  }, [])

  const filteredFiles = filterQQFiles(allFiles, {
    accountId: selectedAccount,
    groupId: selectedGroupId,
    query: q
  })
  const visibleFiles = filteredFiles.slice(0, QQ_FILE_DISPLAY_LIMIT)

  const checkedSet = new Set(checkedFilePaths)
  const selectableVisible = visibleFiles.filter(f => !f.isProtected && f.groupId !== 999)
  const allVisibleChecked = selectableVisible.length > 0 && selectableVisible.every(f => checkedSet.has(f.path))
  const someVisibleChecked = selectableVisible.some(f => checkedSet.has(f.path)) && !allVisibleChecked

  // 清理范围：当前账号筛选下用户勾选的文件（不受分组与搜索影响，确认框里按分组列出）
  const targetFiles = allFiles.filter(
    f =>
      !f.isProtected &&
      f.groupId !== 999 &&
      (selectedAccount === 'ALL' || f.accountId === selectedAccount) &&
      checkedSet.has(f.path)
  )
  const targetBytes = targetFiles.reduce((s, f) => s + f.sizeBytes, 0)

  function toggleSingleFileCheck(file: QQScannedFileEntry, nextChecked?: boolean) {
    if (file.isProtected || file.groupId === 999) {
      showToast({ style: Toast.Style.Failure, title: t('protectedDbToastTitle'), message: getForbiddenReason() })
      return
    }
    setCheckedFilePaths(prev => {
      const next = new Set(prev)
      const target = typeof nextChecked === 'boolean' ? nextChecked : !next.has(file.path)
      if (target) next.add(file.path)
      else next.delete(file.path)
      return Array.from(next)
    })
  }

  function toggleAllVisibleCheck() {
    if (selectableVisible.length === 0) return
    setCheckedFilePaths(prev => {
      const next = new Set(prev)
      for (const f of selectableVisible) {
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
        title: t('noFilesCheckedTitle'),
        message: t('noFilesCheckedMsg')
      })
      return
    }

    const groupRules = getOfficialQQGroupRules()
    const breakdownLines = groupRules.filter(r => r.groupId !== 999)
      .map(rule => {
        const inGroup = targetFiles.filter(f => f.groupId === rule.groupId)
        if (inGroup.length === 0) return ''
        const bytes = inGroup.reduce((s, f) => s + f.sizeBytes, 0)
        return t('breakdownLine', { name: rule.shortName, count: inGroup.length, bytes: formatBytes(bytes) })
      })
      .filter(Boolean)
      .join('\n')

    const confirmed = await confirmAlert({
      title: t('confirmCleanTitle', { count: targetFiles.length }),
      message: t('confirmCleanMsg', {
        scope: selectedAccount === 'ALL' ? t('allAccountsLabel') : selectedAccount,
        bytes: formatBytes(targetBytes),
        breakdown: breakdownLines,
        reason: getForbiddenReason()
      }),
      primaryAction: { title: t('moveToTrashBtn'), style: 'destructive' }
    })
    if (!confirmed) return

    const res = await executeQQCleanup(
      targetFiles.map(f => f.path),
      targetFiles
    )
    const summary = summarizeQQCleanup(res)
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
    const ok = await openQQDirectory(filePath)
    if (!ok) showToast({ style: Toast.Style.Failure, title: t('locateFailedToast'), message: filePath })
  }

  async function openFile(filePath: string) {
    const ok = await openQQFileDefault(filePath)
    if (!ok) showToast({ style: Toast.Style.Failure, title: t('openFailedToast'), message: filePath })
  }

  if (!inRealHost) {
    return List({
      searchBarPlaceholder: t('searchClientRequiredPlaceholder'),
      children: [
        List.Item({
          id: 'qq-client-required',
          title: t('clientRequired'),
          subtitle: t('clientRequiredSubtitle'),
          icon: { source: Icon.Info }
        })
      ]
    })
  }

  const totalScannable = categories
    .filter(c => c.groupId !== 999)
    .reduce((s, c) => s + c.totalSizeBytes, 0)

  const maxFileBytes = Math.max(1, visibleFiles[0]?.sizeBytes || 1)
  const rightSubListItems = visibleFiles.map(file => {
    const isProtected = file.isProtected || file.groupId === 999
    const isChecked = !isProtected && checkedSet.has(file.path)
    const volRatio = Math.max(10, Math.min(100, Math.round((file.sizeBytes / maxFileBytes) * 100)))

    return List.Item({
      id: file.id,
      title: file.name,
      subtitle: isProtected
        ? t('protectedDbSubtitle', { account: file.accountId, dir: file.parentDir })
        : t('fileSubtitle', { account: file.accountId, date: formatDateTime(file.mtime), dir: file.parentDir }),
      checkable: !isProtected,
      checked: isChecked,
      onCheckChange: (next: boolean) => toggleSingleFileCheck(file, next),
      onToggleCheck: (next: boolean) => toggleSingleFileCheck(file, next),
      icon: { source: isProtected ? Icon.Lock : Icon.Document },
      accessories: [
        { progress: { value: volRatio } },
        { tag: { value: isProtected ? t('tagProtected') : file.unrecognized ? t('tagUnrecognized') : file.groupName } },
        { text: formatBytes(file.sizeBytes) }
      ],
      actions: ActionPanel({
        title: file.name,
        children: [
          Action({
            title: t('revealInExplorer'),
            icon: Icon.Folder,
            onAction: () => locateFile(file.path)
          }),
          ...(!isProtected
            ? [
                Action({
                  title: isChecked ? t('uncheckFile') : t('checkFile'),
                  icon: Icon.Checkmark,
                  onAction: () => toggleSingleFileCheck(file, !isChecked)
                })
              ]
            : []),
          Action({
            title: t('openWithDefault'),
            icon: Icon.Window,
            onAction: () => openFile(file.path)
          }),
          Action({
            title: t('cleanCheckedAction', { count: targetFiles.length, bytes: formatBytes(targetBytes) }),
            icon: Icon.Trash,
            style: Action.Style.Destructive,
            shortcut: SHORTCUT_CLEAN_CHECKED,
            onAction: () => handleCleanChecked()
          }),
          Action.CopyToClipboard({
            title: t('copyFullPath'),
            content: file.path
          })
        ]
      })
    })
  })

  const activeCategory = categories.find(c => c.groupId === selectedGroupId)
  const rightTitle = activeCategory
    ? t('rightTitleCategory', { name: activeCategory.name })
    : t('rightTitleAll')
  const shownText =
    filteredFiles.length > visibleFiles.length
      ? t('shownTruncated', { total: filteredFiles.length, shown: visibleFiles.length })
      : t('shownAll', { total: filteredFiles.length })

  return List({
    searchBarPlaceholder: t('searchPlaceholder'),
    onSearchTextChange: (val: string) => setSearchText(val),
    isShowingDetail: false,
    isLoading,
    searchBarAccessory: List.Dropdown({
      tooltip: t('accountFilterTooltip'),
      value: selectedAccount,
      onChange: val => setSelectedAccount(val),
      children: [
        List.Dropdown.Item({
          title: t('allAccountsDropdown', { count: allFiles.length }),
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
        ? t('summaryIncomplete', { error: scanError })
        : t('summaryReady', {
            scope: selectedAccount === 'ALL' ? t('allAccountsLabel') : selectedAccount,
            scannable: formatBytes(totalScannable),
            count: targetFiles.length,
            bytes: formatBytes(targetBytes),
            protected: formatBytes(protectedDbBytes)
          }),
      actions: [
        {
          id: 'qq-act-clean',
          label: t('cleanCheckedAction', { count: targetFiles.length, bytes: formatBytes(targetBytes) }),
          title: t('cleanCheckedAction', { count: targetFiles.length, bytes: formatBytes(targetBytes) }),
          style: 'primary',
          disabled: targetFiles.length === 0,
          onAction: () => handleCleanChecked()
        },
        {
          id: 'qq-act-rescan',
          label: t('rescan'),
          title: t('rescan'),
          style: 'secondary',
          onAction: () => refreshScan({ showIndicator: true })
        }
      ]
    },
    subList: {
      title: rightTitle,
      subtitle: t('subListSubtitle', { shown: shownText, count: targetFiles.length, bytes: formatBytes(targetBytes) }),
      checkable: selectableVisible.length > 0,
      checked: allVisibleChecked ? true : someVisibleChecked ? 'indeterminate' : false,
      onCheckChange: () => toggleAllVisibleCheck(),
      emptyText: isLoading ? t('scanningEmpty') : t('noFilesEmpty'),
      items: rightSubListItems
    },
    children: [
      List.Section({
        title: t('overviewSection'),
        children: [
          List.Item({
            id: 'qq-nav-all',
            title: t('allQQFilesNav'),
            subtitle: t('listedCountSub', { count: allFiles.length }),
            icon: { source: Icon.HardDrive },
            accessories: [{ text: formatBytes(totalScannable) }],
            onSelect: () => setSelectedGroupId(0)
          })
        ]
      }),
      List.Section({
        title: t('groupsSection'),
        children: categories.map(cat => {
          const isProtected = cat.groupId === 999
          const checkedInGroup = targetFiles.filter(f => f.groupId === cat.groupId).length
          return List.Item({
            id: `qq-nav-group-${cat.groupId}`,
            title: cat.shortName,
            subtitle: isProtected
              ? t('protectedGroupSub')
              : t('groupCountSub', { total: cat.files.length, checked: checkedInGroup }),
            icon: { source: isProtected ? Icon.Lock : Icon.Folder },
            accessories: [{ text: formatBytes(cat.totalSizeBytes) }],
            onSelect: () => setSelectedGroupId(cat.groupId)
          })
        })
      })
    ]
  })
}
