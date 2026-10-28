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
  OFFICIAL_WECHAT_OWNER_RULES,
  WechatCleanCategoryItem,
  WechatScannedFileEntry,
  WechatAccountStat,
  WECHAT_FILE_DISPLAY_LIMIT,
  FORBIDDEN_REASON,
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

const CLIENT_REQUIRED_TEXT = '需要在 ZTools 客户端中使用'

export default function WechatCleanerCommand() {
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
      showToast({ style: Toast.Style.Animated, title: '正在扫描微信缓存...' })
    }
    try {
      const snap = await fetchWechatCleanSnapshot()
      setCategories(snap.categories)
      setAllFiles(snap.allFiles)
      setAccountStats(snap.accountStats)
      setProtectedDbBytes(snap.protectedDbBytes)
      setScanError('')
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
      if (options.showIndicator) {
        showToast({
          style: Toast.Style.Success,
          title: '扫描完成',
          message: `找到 ${snap.allFiles.length} 个文件，聊天数据库 ${formatBytes(snap.protectedDbBytes)} 受保护`
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
        title: '没有勾选任何文件',
        message: '请先在右侧勾选要清理的文件'
      })
      return
    }

    const breakdownLines = OFFICIAL_WECHAT_OWNER_RULES.filter(r => r.ownerId !== 999)
      .map(rule => {
        const inCat = targetFiles.filter(f => f.ownerId === rule.ownerId)
        if (inCat.length === 0) return ''
        const bytes = inCat.reduce((s, f) => s + f.sizeBytes, 0)
        return `- ${rule.shortName}：${inCat.length} 个（${formatBytes(bytes)}）`
      })
      .filter(Boolean)
      .join('\n')

    const confirmed = await confirmAlert({
      title: `把 ${targetFiles.length} 个文件移入回收站？`,
      message: `范围：${selectedAccount === 'ALL' ? '全部账号' : selectedAccount}，共 ${formatBytes(targetBytes)}\n\n${breakdownLines}\n\n${FORBIDDEN_REASON}。文件移入回收站后仍占用磁盘空间，清空回收站后才会释放。`,
      primaryAction: { title: '移入回收站', style: 'destructive' }
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
    if (!ok) showToast({ style: Toast.Style.Failure, title: '无法在资源管理器中定位', message: filePath })
  }

  async function openFile(filePath: string) {
    const ok = await openWechatFileDefault(filePath)
    if (!ok) showToast({ style: Toast.Style.Failure, title: '无法打开文件', message: filePath })
  }

  if (!inRealHost) {
    return List({
      searchBarPlaceholder: '搜索微信缓存文件',
      children: [
        List.Item({
          id: 'wx-client-required',
          title: CLIENT_REQUIRED_TEXT,
          subtitle: '本插件读取本机微信电脑版的缓存目录，只能在 Windows 版 ZTools 客户端中运行',
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
        ? `${f.accountId} · 聊天数据库，受保护，不会被清理 · ${f.parentDir}`
        : `${f.accountId} · ${formatDateTime(f.mtime)} · ${f.parentDir}`,
      checkable: !isDbProtected,
      checked: isChecked,
      onCheckChange: (c: boolean) => toggleSingleFile(f.path, c),
      onToggleCheck: (c: boolean) => toggleSingleFile(f.path, c),
      icon: { source: isDbProtected ? Icon.Lock : Icon.Document },
      accessories: [
        { progress: { value: volRatio } },
        { tag: { value: isDbProtected ? '受保护' : f.unrecognized ? '用途未识别' : f.ownerName } },
        { text: formatBytes(f.sizeBytes) }
      ],
      actions: ActionPanel({
        title: f.name,
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
            onAction: () => locateFile(f.path)
          }),
          ...(!isDbProtected
            ? [
                Action({
                  title: isChecked ? '取消勾选此文件' : '勾选此文件',
                  icon: Icon.Checkmark,
                  onAction: () => toggleSingleFile(f.path, !isChecked)
                })
              ]
            : []),
          Action({
            title: '使用默认程序打开文件',
            icon: Icon.AppWindow,
            onAction: () => openFile(f.path)
          }),
          Action.CopyToClipboard({
            title: '复制文件完整路径',
            content: f.path
          })
        ]
      })
    })
  })

  const activeCategory = categories.find(c => String(c.ownerId) === selectedOwnerId)
  const rightTitle = activeCategory ? `${activeCategory.name}（按体积降序）` : '全部微信文件（按体积降序）'
  const shownText =
    filteredFiles.length > visibleFiles.length
      ? `${filteredFiles.length} 项，显示最大的 ${visibleFiles.length} 项`
      : `${filteredFiles.length} 项`

  return List({
    searchBarPlaceholder: '搜索文件名、路径、分类或微信号',
    onSearchTextChange: setSearchText,
    isShowingDetail: false,
    isLoading,
    searchBarAccessory: List.Dropdown({
      tooltip: '按微信账号筛选',
      value: selectedAccount,
      onChange: val => setSelectedAccount(val),
      children: [
        List.Dropdown.Item({
          title: `全部微信账号 (${allFiles.length})`,
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
        : `${selectedAccount === 'ALL' ? '全部账号' : selectedAccount} · 缓存占用 ${formatBytes(totalScannable)} · 已勾选 ${targetFiles.length} 个文件 (${formatBytes(targetBytes)}) · 聊天数据库 ${formatBytes(protectedDbBytes)} 受保护`,
      actions: [
        {
          id: 'wx-act-rescan',
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
      checkable: selectableVisibleFiles.length > 0,
      checked: allVisibleChecked ? true : someVisibleChecked ? 'indeterminate' : false,
      onCheckChange: () => toggleAllVisibleFiles(),
      emptyText: isLoading ? '正在扫描...' : '当前账号与分类下没有找到微信缓存文件',
      items: rightSubListItems
    },
    children: [
      List.Section({
        title: '微信存储总览',
        children: [
          List.Item({
            id: 'wx-nav-all',
            title: '全部微信文件',
            subtitle: `已列出 ${allFiles.length} 个文件`,
            icon: { source: Icon.HardDrive },
            accessories: [{ text: formatBytes(totalScannable) }],
            onSelect: () => setSelectedOwnerId('ALL')
          })
        ]
      }),
      List.Section({
        title: '清理分类与数据库保护区',
        children: categories.map(cat => {
          const isProtected = cat.ownerId === 999
          const checkedInCat = targetFiles.filter(f => f.ownerId === cat.ownerId).length
          return List.Item({
            id: `wx-nav-owner-${cat.ownerId}`,
            title: cat.shortName,
            subtitle: isProtected
              ? '受保护，不会被清理'
              : `已列出 ${cat.files.length} 个 · 已勾选 ${checkedInCat} 个`,
            icon: { source: isProtected ? Icon.Lock : Icon.Folder },
            accessories: [{ text: formatBytes(cat.totalSizeBytes) }],
            onSelect: () => setSelectedOwnerId(String(cat.ownerId))
          })
        })
      })
    ]
  })
}
