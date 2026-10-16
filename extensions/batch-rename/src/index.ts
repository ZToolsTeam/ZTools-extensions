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
  RenameRule,
  RealFileEntry,
  formatBytes,
  applyRenameRule,
  fetchRealBatchRenameFiles,
  executeRealFileRename,
  openRenameFileLocation
} from './logic'

export default function BatchRenameCommand() {
  const [searchText, setSearchText] = useState('')
  const [ruleTab, setRuleTab] = useState<'number' | 'prefix' | 'suffix' | 'lower'>('number')
  const [sourceScope, setSourceScope] = useState<'downloads' | 'desktop' | 'documents'>('downloads')
  const [directory, setDirectory] = useState('')
  const [realFiles, setRealFiles] = useState<RealFileEntry[]>([])
  const [isLoading, setIsLoading] = useState(true)

  async function loadDirectoryFiles(scope = sourceScope, showIndicator = false) {
    if (showIndicator) setIsLoading(true)
    try {
      const res = await fetchRealBatchRenameFiles(scope)
      setDirectory(res.directory)
      setRealFiles(res.files)
      if (showIndicator) {
        showToast({
          style: Toast.Style.Success,
          title: '已加载本机真实目录文件',
          message: `${res.directory} (${res.files.length} 个文件)`
        })
      }
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadDirectoryFiles(sourceScope, false)
  }, [])

  function getActiveRule(): RenameRule {
    if (ruleTab === 'prefix') {
      return { type: 'prefix', prefix: searchText.trim() ? `${searchText.trim()}_` : 'ZTools_' }
    }
    if (ruleTab === 'suffix') {
      return { type: 'suffix', suffix: searchText.trim() ? `_${searchText.trim()}` : '_v2' }
    }
    if (ruleTab === 'lower') {
      return { type: 'case', caseMode: 'lower' }
    }
    return { type: 'number', startNumber: 1, padDigits: 2 }
  }

  const activeRule = getActiveRule()
  const previewItems = realFiles.map((f, idx) => {
    const newName = applyRenameRule(f.name, activeRule, idx)
    return {
      ...f,
      newName,
      changed: newName !== f.name
    }
  })

  async function handleRenameSingle(item: typeof previewItems[0]) {
    if (!item.changed) {
      showToast({ style: Toast.Style.Failure, title: '文件名未发生变化', message: item.name })
      return
    }
    const confirmed = await confirmAlert({
      title: '确认在真实磁盘上重命名此文件？',
      message: `原文件名: ${item.name}\n新文件名: ${item.newName}\n所在目录: ${item.parentDir}`,
      primaryAction: { title: '确认重命名', style: 'default' }
    })
    if (!confirmed) return

    const res = await executeRealFileRename(item.fullPath, item.newName)
    if (!res.ok) {
      showToast({ style: Toast.Style.Failure, title: '重命名失败', message: res.error || '文件被占用或无权限' })
      return
    }
    showToast({ style: Toast.Style.Success, title: '文件重命名成功', message: `${item.name} → ${item.newName}` })
    loadDirectoryFiles(sourceScope, false)
  }

  const changedCount = previewItems.filter(p => p.changed).length
  const totalBytes = realFiles.reduce((s, f) => s + f.sizeBytes, 0)

  return List({
    searchBarPlaceholder:
      ruleTab === 'prefix' || ruleTab === 'suffix'
        ? '输入自定义前缀/后缀词 (实时生成新旧文件名对比)...'
        : '搜索本机文件名或切换顶栏重命名规则预览变更...',
    onSearchTextChange: setSearchText,
    isShowingDetail: true,
    isLoading,
    metricGrid: MetricGrid({
      columns: 4,
      items: [
        {
          id: 'br-dir',
          label: '当前工作目录',
          value: sourceScope === 'downloads' ? '下载 (Downloads)' : sourceScope === 'desktop' ? '桌面 (Desktop)' : '文档 (Documents)',
          subValue: directory || '加载中...',
          status: 'normal'
        },
        {
          id: 'br-total',
          label: '目录实测文件数',
          value: `${realFiles.length} 个`,
          subValue: `总计 ${formatBytes(totalBytes)}`,
          status: 'normal'
        },
        {
          id: 'br-changed',
          label: '预计变更文件数',
          value: `${changedCount} 个`,
          subValue: `规则: ${ruleTab}`,
          status: changedCount > 0 ? 'success' : 'normal'
        },
        {
          id: 'br-rule',
          label: '重命名安全引擎',
          value: '原子级预览',
          subValue: '支持一键定位与恢复',
          status: 'success'
        }
      ]
    }),
    segmentedControl: SegmentedControl({
      value: ruleTab,
      onChange: v => setRuleTab(v as any),
      options: [
        { value: 'number', label: '序号递增 (_01)', badge: previewItems.length },
        { value: 'prefix', label: '前缀注入 (Prefix_)' },
        { value: 'suffix', label: '后缀追加 (_Suffix)' },
        { value: 'lower', label: '规范全小写 (lowercase)' }
      ]
    }),
    children: [
      List.Section({
        title: `本机真实文件新旧命名实时对比 (${ directory || sourceScope })`,
        children: previewItems.map(item =>
          List.Item({
            id: item.fullPath,
            title: `${item.name}  ➔  ${item.newName}`,
            subtitle: item.parentDir,
            icon: {
              source: item.changed ? Icon.CheckCircle : Icon.Document,
              tintColor: item.changed ? Color.Green : Color.SecondaryText
            },
            accessories: [
              {
                tag: {
                  value: item.changed ? '待改名' : '无变化',
                  color: item.changed ? Color.Green : Color.SecondaryText
                }
              },
              { text: formatBytes(item.sizeBytes) }
            ],
            detail: List.Item.Detail({
              markdown: `# ✏️ 批量重命名实时 Diff 预览

**所属真实目录**: \`${item.parentDir}\`

---

### 🔄 新旧文件名对比
- **原始文件名 (Old)**: \`${item.name}\`
- **目标新名称 (New)**: \`${item.newName}\`
- **文件大小**: \`${formatBytes(item.sizeBytes)}\`

---

> [!TIP]
> 按 \`Enter\` 可针对当前选中文件执行真实磁盘改名，也可通过动作面板切换工作目录（下载 / 桌面 / 文档）。
`
            }),
            actions: ActionPanel({
              title: item.name,
              children: [
                Action({
                  title: '对此文件执行真实重命名',
                  icon: Icon.Pencil,
                  onAction: () => handleRenameSingle(item)
                }),
                Action({
                  title: '切换到「桌面 (Desktop)」目录',
                  icon: Icon.Desktop,
                  onAction: () => {
                    setSourceScope('desktop')
                    loadDirectoryFiles('desktop', true)
                  }
                }),
                Action({
                  title: '切换到「文档 (Documents)」目录',
                  icon: Icon.Document,
                  onAction: () => {
                    setSourceScope('documents')
                    loadDirectoryFiles('documents', true)
                  }
                }),
                Action({
                  title: '切换到「下载 (Downloads)」目录',
                  icon: Icon.Download,
                  onAction: () => {
                    setSourceScope('downloads')
                    loadDirectoryFiles('downloads', true)
                  }
                }),
                Action({
                  title: '在资源管理器中定位文件',
                  icon: Icon.Folder,
                  onAction: () => {
                    openRenameFileLocation(item.fullPath)
                  }
                }),
                Action({
                  title: '复制新文件名',
                  icon: Icon.Clipboard,
                  onAction: async () => {
                    await Clipboard.copy(item.newName)
                    showToast({ style: Toast.Style.Success, title: '已复制新文件名', message: item.newName })
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
