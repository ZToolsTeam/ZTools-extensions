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
  MetricGrid,
  SegmentedControl
} from '@ztools/declarative-ui'
import {
  CapabilityActionItem,
  RealPdfDocItem,
  formatBytes,
  fetchRealPdfWorkspace,
  invokeNativeCapability,
  openPdfFileLocation,
  openPdfDocument
} from './logic'

export default function PdfCommand() {
  const [searchText, setSearchText] = useState('')
  const [tab, setTab] = useState<'all' | 'files' | 'presets'>('all')
  const [files, setFiles] = useState<RealPdfDocItem[]>([])
  const [presets, setPresets] = useState<CapabilityActionItem[]>([])
  const [scannedDirs, setScannedDirs] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(true)

  async function refreshWorkspace(showIndicator = false) {
    if (showIndicator) setIsLoading(true)
    try {
      const ws = await fetchRealPdfWorkspace()
      setFiles(ws.files)
      setPresets(ws.presets)
      setScannedDirs(ws.scannedDirs)
      if (showIndicator) {
        showToast({
          style: Toast.Style.Success,
          title: 'PDF 工作台已刷新',
          message: `检索到 ${ws.files.length} 份本机文档 · ${ws.presets.length} 项转换工具`
        })
      }
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    refreshWorkspace(false)
  }, [])

  async function handleRunPreset(preset: CapabilityActionItem, targetFile?: RealPdfDocItem) {
    showToast({
      style: Toast.Style.Animated,
      title: `正在调用: ${preset.title}`,
      message: targetFile ? targetFile.name : `方法: ${preset.method}`
    })
    try {
      const payload = targetFile ? { ...preset.params, inputPath: targetFile.path } : preset.params
      const res = await invokeNativeCapability(preset.method, payload)
      if (!res.ok) {
        showToast({ style: Toast.Style.Failure, title: 'PDF 处理失败', message: res.error || '原生模块返回错误' })
        return
      }
      showToast({
        style: Toast.Style.Success,
        title: 'PDF 任务指令已下发',
        message: `${preset.title}${targetFile ? ` (${targetFile.name})` : ''}`
      })
    } catch (err: any) {
      showToast({ style: Toast.Style.Failure, title: '安全拦截', message: err?.message || String(err) })
    }
  }

  const totalBytes = files.reduce((s, f) => s + f.sizeBytes, 0)
  const totalPages = files.reduce((s, f) => s + f.estimatedPages, 0)
  const q = searchText.trim().toLowerCase()
  const filteredFiles = files.filter(
    f => !q || f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q)
  )
  const filteredPresets = presets.filter(
    p => !q || p.title.toLowerCase().includes(q) || p.subtitle.toLowerCase().includes(q) || p.tag.toLowerCase().includes(q)
  )

  return List({
    searchBarPlaceholder: '搜索本机 PDF / Office 文档或转换工具 (转 Word / 转 Excel / 合并 / 转长图)...',
    onSearchTextChange: setSearchText,
    isShowingDetail: true,
    isLoading,
    metricGrid: MetricGrid({
      columns: 4,
      items: [
        {
          id: 'pdf-files',
          label: '本机已发现文档',
          value: `${files.length} 份`,
          subValue: `${scannedDirs.length} 个文档目录已扫描`,
          status: 'normal'
        },
        {
          id: 'pdf-size',
          label: '文档合计体积',
          value: formatBytes(totalBytes),
          subValue: `预估共 ${totalPages} 页`,
          status: 'normal'
        },
        {
          id: 'pdf-dpi',
          label: '高清渲染精度',
          value: '300 DPI',
          subValue: 'PDF/A-1b 印刷级标准',
          status: 'success'
        },
        {
          id: 'pdf-presets',
          label: 'PDF 工具箱动作',
          value: `${presets.length} 项`,
          subValue: 'Word / Excel / PNG / 合并',
          status: 'success'
        }
      ]
    }),
    segmentedControl: SegmentedControl({
      value: tab,
      onChange: v => setTab(v as any),
      options: [
        { value: 'all', label: '完整 PDF 工作台', badge: files.length + presets.length },
        { value: 'files', label: '本机文档列表', badge: files.length },
        { value: 'presets', label: '转换与合并工具', badge: presets.length }
      ]
    }),
    children: [
      ...(tab === 'all' || tab === 'files'
        ? [
            List.Section({
              title: `本机目录文档与文件清单 (${filteredFiles.length})`,
              children: filteredFiles.map(f =>
                List.Item({
                  id: f.id,
                  title: f.name,
                  subtitle: f.parentDir,
                  icon: { source: Icon.Document, tintColor: f.extension === '.pdf' ? Color.Red : Color.Blue },
                  accessories: [
                    { tag: { value: f.extension, color: f.extension === '.pdf' ? Color.Red : Color.Blue } },
                    { text: formatBytes(f.sizeBytes) }
                  ],
                  detail: List.Item.Detail({
                    markdown: `# 📑 ${f.name}

**本机真实路径**: \`${f.path}\`

---

### 📊 文档属性与转换选项
- **实际文件体积**: \`${formatBytes(f.sizeBytes)}\`
- **估算页数规模**: \`约 ${f.estimatedPages} 页\`
- **文档扩展名**: \`${f.extension}\`
`
                  }),
                  actions: ActionPanel({
                    title: f.name,
                    children: [
                      Action({
                        title: '使用系统默认阅读器打开文档',
                        icon: Icon.Eye,
                        onAction: () => {
                          openPdfDocument(f.path)
                        }
                      }),
                      Action({
                        title: '转换为可编辑 Word (.docx)',
                        icon: Icon.Document,
                        onAction: () => handleRunPreset(presets[0], f)
                      }),
                      Action({
                        title: '导出为 300DPI 高清 PNG 图片',
                        icon: Icon.Image,
                        onAction: () => handleRunPreset(presets[2], f)
                      }),
                      Action({
                        title: '在资源管理器中定位文档',
                        icon: Icon.Folder,
                        onAction: () => {
                          openPdfFileLocation(f.path)
                        }
                      }),
                      Action({
                        title: '刷新本机文档目录',
                        icon: Icon.ArrowClockwise,
                        onAction: () => refreshWorkspace(true)
                      })
                    ]
                  })
                })
              )
            })
          ]
        : []),
      ...(tab === 'all' || tab === 'presets'
        ? [
            List.Section({
              title: `PDF 专业转换与合并工具 (${filteredPresets.length})`,
              children: filteredPresets.map(p =>
                List.Item({
                  id: p.id,
                  title: p.title,
                  subtitle: p.subtitle,
                  icon: { source: Icon.Gear, tintColor: Color.Orange },
                  accessories: [
                    { tag: { value: p.tag, color: Color.Orange } },
                    { text: p.method }
                  ],
                  detail: List.Item.Detail({
                    markdown: `# 🧰 ${p.title}\n\n${p.subtitle}\n\n### 调用参数契约\n\`\`\`json\n${JSON.stringify(p.params, null, 2)}\n\`\`\``
                  }),
                  actions: ActionPanel({
                    title: p.title,
                    children: [
                      Action({
                        title: '对当前文档执行此转换工具',
                        icon: Icon.Play,
                        onAction: () => handleRunPreset(p, files[0])
                      }),
                      Action({
                        title: '复制参数 JSON',
                        icon: Icon.Clipboard,
                        onAction: async () => {
                          await Clipboard.copy(JSON.stringify(p.params, null, 2))
                          showToast({ style: Toast.Style.Success, title: '已复制 PDF 工具参数' })
                        }
                      })
                    ]
                  })
                })
              )
            })
          ]
        : [])
    ]
  })
}
