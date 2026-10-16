import {
  List,
  ActionPanel,
  Action,
  Icon,
  Color,
  Clipboard,
  useState,
  useEffect,
  showToast,
  Toast,
  confirmAlert,
  MetricGrid,
  SegmentedControl
} from '@ztools/declarative-ui'
import {
  QQCleanCategoryItem,
  FORBIDDEN_REASON,
  formatBytes,
  fetchQQCleanSnapshot,
  executeQQCleanup,
  openQQDirectory
} from './logic'

export default function QQCleanerCommand() {
  const [searchText, setSearchText] = useState('')
  const [tab, setTab] = useState<'all' | 'cache' | 'media' | 'logs'>('all')
  const [categories, setCategories] = useState<QQCleanCategoryItem[]>([])
  const [accounts, setAccounts] = useState<string[]>([])
  const [diskFree, setDiskFree] = useState(0)
  const [diskTotal, setDiskTotal] = useState(0)
  const [isLoading, setIsLoading] = useState(true)

  async function refreshScan(showIndicator = false) {
    if (showIndicator) {
      setIsLoading(true)
      showToast({
        style: Toast.Style.Animated,
        title: '正在扫描本机 QQ / NTQQ 存储目录...',
        message: '扫描群聊缩略图与缓存，自动保护 Msg3.0.db / nt_msg.db'
      })
    }
    try {
      const snap = await fetchQQCleanSnapshot()
      setCategories(snap.categories)
      setAccounts(snap.detectedAccounts)
      setDiskFree(snap.systemDiskFreeBytes)
      setDiskTotal(snap.systemDiskTotalBytes)
      if (showIndicator) {
        showToast({
          style: Toast.Style.Success,
          title: 'QQ 存储扫描完成',
          message: `可扫描空间 ${formatBytes(snap.totalScannableBytes)}`
        })
      }
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    refreshScan(false)
  }, [])

  function toggleCategory(id: string) {
    setCategories(prev => prev.map(c => (c.id === id ? { ...c, checked: !c.checked } : c)))
  }

  async function handleCleanChecked() {
    const selected = categories.filter(c => c.checked && c.totalSizeBytes > 0)
    if (selected.length === 0) {
      showToast({
        style: Toast.Style.Failure,
        title: '暂无可清理的已勾选项',
        message: '请先勾选包含可清理缓存的分类项'
      })
      return
    }

    const totalBytes = selected.reduce((s, c) => s + c.totalSizeBytes, 0)
    const confirmed = await confirmAlert({
      title: '确认执行 QQ 专项深度清理？',
      message: `即将把已勾选的 ${selected.length} 个分类样本缓存移入系统回收站（预计涉及 ${formatBytes(totalBytes)}）。\n\n🛡️ 安全承诺：${FORBIDDEN_REASON}`,
      primaryAction: { title: '安全移入回收站', style: 'destructive' }
    })
    if (!confirmed) return

    const res = await executeQQCleanup(categories)
    showToast({
      style: Toast.Style.Success,
      title: 'QQ 专项清理完成',
      message: `已清理 ${res.deletedCount} 个文件，释放 ${formatBytes(res.freedBytes)}`
    })
    refreshScan(false)
  }

  function renderDetailMarkdown(item: QQCleanCategoryItem): string {
    const samplesMd =
      item.sampleFiles.length > 0
        ? item.sampleFiles
            .map((s, idx) => `${idx + 1}. \`${s.path.split(/[\\/]/).pop() || s.path}\` — **${formatBytes(s.sizeBytes)}**`)
            .join('\n')
        : '_该路径当前无冗余缓存文件或目录尚未创建_'

    return `# 🐧 ${item.name}

**本机真实路径**: \`${item.targetDir}\`  
**目录状态**: \`${item.existsOnDisk ? '✅ 已检测到本地目录' : '⚪ 当前未产生缓存'}\` · **勾选状态**: \`${item.checked ? '已纳入清理' : '未勾选'}\`

---

### 📊 扫描统计画像
- **检索文件数**: \`${item.fileCount} 项\`
- **实测占用体积**: \`${formatBytes(item.totalSizeBytes)}\`
- **风险等级**: \`${item.riskLevel === 'safe' ? '安全放心清理' : item.riskLevel === 'recommended' ? '推荐清理' : '谨慎确认'}\`

### 📄 实测文件样本清单
${samplesMd}

---

> [!IMPORTANT]
> **消息记录加密库防误删锁**：${FORBIDDEN_REASON}
`
  }

  const totalScannable = categories.reduce((s, c) => s + c.totalSizeBytes, 0)
  const checkedBytes = categories.filter(c => c.checked).reduce((s, c) => s + c.totalSizeBytes, 0)
  const q = searchText.trim().toLowerCase()
  const filtered = categories.filter(c => {
    if (tab !== 'all' && c.category !== tab) return false
    if (!q) return true
    return c.name.toLowerCase().includes(q) || c.targetDir.toLowerCase().includes(q) || c.description.toLowerCase().includes(q)
  })

  return List({
    searchBarPlaceholder: '搜索 QQ / NTQQ 缓存分类、存储路径或文件样本...',
    onSearchTextChange: setSearchText,
    isShowingDetail: true,
    isLoading,
    metricGrid: MetricGrid({
      columns: 4,
      items: [
        {
          id: 'qq-total',
          label: 'QQ 专项扫描总量',
          value: formatBytes(totalScannable),
          subValue: `${categories.reduce((s, c) => s + c.fileCount, 0)} 个扫描项`,
          status: 'normal'
        },
        {
          id: 'qq-checked',
          label: '已选待释放空间',
          value: formatBytes(checkedBytes),
          subValue: `${categories.filter(c => c.checked).length} 项已勾选`,
          status: 'success'
        },
        {
          id: 'qq-accounts',
          label: '识别 QQ 账号目录',
          value: `${accounts.length} 个`,
          subValue: accounts.length > 0 ? accounts.join(', ') : '默认 Tencent Files 路径',
          status: 'normal'
        },
        {
          id: 'qq-c-free',
          label: '系统盘 (C:) 可用空间',
          value: formatBytes(diskFree),
          subValue: `总计 ${formatBytes(diskTotal)}`,
          status: diskFree > 0 && diskFree < 15 * 1024 * 1024 * 1024 ? 'danger' : 'normal'
        }
      ]
    }),
    segmentedControl: SegmentedControl({
      value: tab,
      onChange: v => setTab(v as any),
      options: [
        { value: 'all', label: '全部分类', badge: categories.length },
        { value: 'cache', label: '运行缓存', badge: categories.filter(c => c.category === 'cache').length },
        { value: 'media', label: '群聊媒体缓存', badge: categories.filter(c => c.category === 'media').length },
        { value: 'logs', label: '日志与临时项', badge: categories.filter(c => c.category === 'logs').length }
      ]
    }),
    children: [
      List.Section({
        title: `QQ / NTQQ 本机真实存储扫描结果 (${filtered.length})`,
        children: filtered.map(item =>
          List.Item({
            id: item.id,
            title: `${item.checked ? '☑️' : '⬜'} ${item.name}`,
            subtitle: item.targetDir,
            icon: {
              source: item.existsOnDisk ? Icon.CheckCircle : Icon.Circle,
              tintColor: item.checked ? Color.Green : Color.SecondaryText
            },
            accessories: [
              {
                tag: {
                  value: item.existsOnDisk ? `${item.fileCount} 项` : '未生成',
                  color: item.existsOnDisk ? Color.Blue : Color.SecondaryText
                }
              },
              { text: formatBytes(item.totalSizeBytes) }
            ],
            detail: List.Item.Detail({
              markdown: renderDetailMarkdown(item)
            }),
            actions: ActionPanel({
              title: item.name,
              children: [
                Action({
                  title: item.checked ? '取消勾选此项' : '勾选纳入清理',
                  icon: Icon.CheckCircle,
                  onAction: () => toggleCategory(item.id)
                }),
                Action({
                  title: '立即清理已勾选 QQ 缓存',
                  icon: Icon.Trash,
                  onAction: () => handleCleanChecked()
                }),
                Action({
                  title: '在资源管理器中打开目录',
                  icon: Icon.Folder,
                  onAction: () => {
                    openQQDirectory(item.targetDir)
                  }
                }),
                Action({
                  title: '重新扫描 QQ 存储',
                  icon: Icon.ArrowClockwise,
                  onAction: () => refreshScan(true)
                }),
                Action({
                  title: '复制目录路径',
                  icon: Icon.Clipboard,
                  onAction: async () => {
                    await Clipboard.copy(item.targetDir)
                    showToast({ style: Toast.Style.Success, title: '路径已复制', message: item.targetDir })
                  }
                })
              ]
            })
          })
        )
      })
    ]
  })
}
