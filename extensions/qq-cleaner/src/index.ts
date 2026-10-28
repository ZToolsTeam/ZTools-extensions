import {
  List,
  ActionPanel,
  Action,
  Icon,
  useState,
  useEffect,
  showToast,
  Toast,
  confirmAlert
} from '@ztools/declarative-ui'
import {
  OFFICIAL_QQ_GROUP_RULES,
  QQCleanCategoryItem,
  QQScannedFileEntry,
  QQAccountStat,
  QQ_FILE_DISPLAY_LIMIT,
  FORBIDDEN_REASON,
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

const CLIENT_REQUIRED_TEXT = '需要在 ZTools 客户端中使用'

function stripLeadingSymbols(name: string): string {
  return name.replace(/^[^一-龥A-Za-z0-9]+/, '').trim() || name
}

export default function QQCleanerCommand() {
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
      showToast({ style: Toast.Style.Animated, title: '正在扫描 QQ / TIM 缓存...' })
    }
    try {
      const snap = await fetchQQCleanSnapshot()
      setCategories(snap.categories.map(c => ({ ...c, name: stripLeadingSymbols(c.name) })))
      setAllFiles(snap.allFiles)
      setAccountStats(snap.accountStats)
      setProtectedDbBytes(snap.protectedDbBytes)
      setScanError('')
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
      if (options.showIndicator) {
        showToast({
          style: Toast.Style.Success,
          title: '扫描完成',
          message: `识别 ${snap.detectedAccounts.length} 个 QQ 号，找到 ${snap.allFiles.length} 个文件`
        })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setScanError(message)
      showToast({ style: Toast.Style.Failure, title: '扫描失败', message })
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
      showToast({ style: Toast.Style.Failure, title: '聊天数据库不能勾选', message: FORBIDDEN_REASON })
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
        title: '没有勾选任何文件',
        message: '请先在右侧勾选要清理的文件'
      })
      return
    }

    const breakdownLines = OFFICIAL_QQ_GROUP_RULES.filter(r => r.groupId !== 999)
      .map(rule => {
        const inGroup = targetFiles.filter(f => f.groupId === rule.groupId)
        if (inGroup.length === 0) return ''
        const bytes = inGroup.reduce((s, f) => s + f.sizeBytes, 0)
        return `- ${rule.shortName}：${inGroup.length} 个（${formatBytes(bytes)}）`
      })
      .filter(Boolean)
      .join('\n')

    const confirmed = await confirmAlert({
      title: `把 ${targetFiles.length} 个文件移入回收站？`,
      message: `范围：${selectedAccount === 'ALL' ? '全部 QQ 号' : selectedAccount}，共 ${formatBytes(targetBytes)}\n\n${breakdownLines}\n\n${FORBIDDEN_REASON}。文件移入回收站后仍占用磁盘空间，清空回收站后才会释放。`,
      primaryAction: { title: '移入回收站', style: 'destructive' }
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
    if (!ok) showToast({ style: Toast.Style.Failure, title: '无法在资源管理器中定位', message: filePath })
  }

  async function openFile(filePath: string) {
    const ok = await openQQFileDefault(filePath)
    if (!ok) showToast({ style: Toast.Style.Failure, title: '无法打开文件', message: filePath })
  }

  if (!inRealHost) {
    return List({
      searchBarPlaceholder: '搜索 QQ / TIM 缓存文件',
      children: [
        List.Item({
          id: 'qq-client-required',
          title: CLIENT_REQUIRED_TEXT,
          subtitle: '本插件读取本机 QQ / TIM 的缓存目录，只能在 Windows 版 ZTools 客户端中运行',
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
        ? `${file.accountId} · 聊天数据库，受保护，不会被清理 · ${file.parentDir}`
        : `${file.accountId} · ${formatDateTime(file.mtime)} · ${file.parentDir}`,
      checkable: !isProtected,
      checked: isChecked,
      onCheckChange: (next: boolean) => toggleSingleFileCheck(file, next),
      onToggleCheck: (next: boolean) => toggleSingleFileCheck(file, next),
      icon: { source: isProtected ? Icon.Lock : Icon.Document },
      accessories: [
        { progress: { value: volRatio } },
        { tag: { value: isProtected ? '受保护' : file.unrecognized ? '用途未识别' : file.groupName } },
        { text: formatBytes(file.sizeBytes) }
      ],
      actions: ActionPanel({
        title: file.name,
        children: [
          Action({
            title: `清理已勾选的 ${targetFiles.length} 个文件 (${formatBytes(targetBytes)})`,
            icon: Icon.Trash,
            style: Action.Style.Destructive,
            onAction: () => handleCleanChecked()
          }),
          Action({
            title: '在资源管理器定位',
            icon: Icon.Folder,
            onAction: () => locateFile(file.path)
          }),
          ...(!isProtected
            ? [
                Action({
                  title: isChecked ? '取消勾选此文件' : '勾选此文件',
                  icon: Icon.Checkmark,
                  onAction: () => toggleSingleFileCheck(file, !isChecked)
                })
              ]
            : []),
          Action({
            title: '使用默认程序打开文件',
            icon: Icon.Window,
            onAction: () => openFile(file.path)
          }),
          Action.CopyToClipboard({
            title: '复制文件完整路径',
            content: file.path
          })
        ]
      })
    })
  })

  const activeCategory = categories.find(c => c.groupId === selectedGroupId)
  const rightTitle = activeCategory ? `${activeCategory.name}（按体积降序）` : '全部 QQ / TIM 文件（按体积降序）'
  const shownText =
    filteredFiles.length > visibleFiles.length
      ? `${filteredFiles.length} 项，显示最大的 ${visibleFiles.length} 项`
      : `${filteredFiles.length} 项`

  return List({
    searchBarPlaceholder: '搜索文件名、路径、分组或 QQ 号',
    onSearchTextChange: (val: string) => setSearchText(val),
    isShowingDetail: false,
    isLoading,
    searchBarAccessory: List.Dropdown({
      tooltip: '按 QQ 号筛选',
      value: selectedAccount,
      onChange: val => setSelectedAccount(val),
      children: [
        List.Dropdown.Item({
          title: `全部 QQ 号 (${allFiles.length})`,
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
        ? `扫描失败：${scanError}`
        : `${selectedAccount === 'ALL' ? '全部 QQ 号' : selectedAccount} · 缓存占用 ${formatBytes(totalScannable)} · 已勾选 ${targetFiles.length} 个文件 (${formatBytes(targetBytes)}) · 聊天数据库 ${formatBytes(protectedDbBytes)} 受保护`,
      actions: [
        {
          id: 'qq-act-rescan',
          label: '重新扫描',
          title: '重新扫描',
          style: 'secondary',
          onAction: () => refreshScan({ showIndicator: true })
        }
      ]
    },
    subList: {
      title: rightTitle,
      subtitle: `${shownText} · 已勾选 ${targetFiles.length} 个 (${formatBytes(targetBytes)})`,
      checkable: selectableVisible.length > 0,
      checked: allVisibleChecked ? true : someVisibleChecked ? 'indeterminate' : false,
      onCheckChange: () => toggleAllVisibleCheck(),
      emptyText: isLoading ? '正在扫描...' : '当前 QQ 号与分组下没有找到缓存文件',
      items: rightSubListItems
    },
    children: [
      List.Section({
        title: 'QQ 存储总览',
        children: [
          List.Item({
            id: 'qq-nav-all',
            title: '全部 QQ 文件',
            subtitle: `已列出 ${allFiles.length} 个文件`,
            icon: { source: Icon.HardDrive },
            accessories: [{ text: formatBytes(totalScannable) }],
            onSelect: () => setSelectedGroupId(0)
          })
        ]
      }),
      List.Section({
        title: '清理分组与聊天库保护区',
        children: categories.map(cat => {
          const isProtected = cat.groupId === 999
          const checkedInGroup = targetFiles.filter(f => f.groupId === cat.groupId).length
          return List.Item({
            id: `qq-nav-group-${cat.groupId}`,
            title: cat.shortName,
            subtitle: isProtected
              ? '受保护，不会被清理'
              : `已列出 ${cat.files.length} 个 · 已勾选 ${checkedInGroup} 个`,
            icon: { source: isProtected ? Icon.Lock : Icon.Folder },
            accessories: [{ text: formatBytes(cat.totalSizeBytes) }],
            onSelect: () => setSelectedGroupId(cat.groupId)
          })
        })
      })
    ]
  })
}
