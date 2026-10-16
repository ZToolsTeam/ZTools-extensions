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
  RealVideoFileItem,
  formatBytes,
  fetchRealVideoWorkspace,
  invokeNativeCapability,
  openVideoFileLocation
} from './logic'

export default function BatchVideoCommand() {
  const [searchText, setSearchText] = useState('')
  const [tab, setTab] = useState<'all' | 'files' | 'presets'>('all')
  const [files, setFiles] = useState<RealVideoFileItem[]>([])
  const [presets, setPresets] = useState<CapabilityActionItem[]>([])
  const [scannedDirs, setScannedDirs] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(true)

  async function refreshWorkspace(showIndicator = false) {
    if (showIndicator) setIsLoading(true)
    try {
      const ws = await fetchRealVideoWorkspace()
      setFiles(ws.files)
      setPresets(ws.presets)
      setScannedDirs(ws.scannedDirs)
      if (showIndicator) {
        showToast({
          style: Toast.Style.Success,
          title: '视频工作台已刷新',
          message: `检索到 ${ws.files.length} 个本地文件 · ${ws.presets.length} 套转码预设`
        })
      }
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    refreshWorkspace(false)
  }, [])

  async function handleRunPreset(preset: CapabilityActionItem, targetFile?: RealVideoFileItem) {
    showToast({
      style: Toast.Style.Animated,
      title: `正在调用: ${preset.title}`,
      message: targetFile ? targetFile.name : `方法: ${preset.method}`
    })
    try {
      const payload = targetFile ? { ...preset.params, inputPath: targetFile.path } : preset.params
      const res = await invokeNativeCapability(preset.method, payload)
      if (!res.ok) {
        showToast({ style: Toast.Style.Failure, title: '转码任务失败', message: res.error || '原生模块返回错误' })
        return
      }
      showToast({
        style: Toast.Style.Success,
        title: '视频批处理指令已下发',
        message: `${preset.title}${targetFile ? ` (${targetFile.name})` : ''}`
      })
    } catch (err: any) {
      showToast({ style: Toast.Style.Failure, title: '参数拦截', message: err?.message || String(err) })
    }
  }

  const totalBytes = files.reduce((s, f) => s + f.sizeBytes, 0)
  const totalSaved = files.reduce((s, f) => s + Math.max(0, f.sizeBytes - f.estimatedCompressedBytes), 0)
  const q = searchText.trim().toLowerCase()
  const filteredFiles = files.filter(
    f => !q || f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q)
  )
  const filteredPresets = presets.filter(
    p => !q || p.title.toLowerCase().includes(q) || p.subtitle.toLowerCase().includes(q) || p.tag.toLowerCase().includes(q)
  )

  return List({
    searchBarPlaceholder: '搜索本机视频媒体文件、转码预设或输出格式 (MP4 / H.264 / GIF)...',
    onSearchTextChange: setSearchText,
    isShowingDetail: true,
    isLoading,
    metricGrid: MetricGrid({
      columns: 4,
      items: [
        {
          id: 'bv-files',
          label: '本机待处理文件',
          value: `${files.length} 个`,
          subValue: `${scannedDirs.length} 个媒体目录已扫描`,
          status: 'normal'
        },
        {
          id: 'bv-size',
          label: '原始文件总体积',
          value: formatBytes(totalBytes),
          subValue: '本机真实文件采样',
          status: 'normal'
        },
        {
          id: 'bv-saved',
          label: 'CRF23 预计节省',
          value: formatBytes(totalSaved),
          subValue: '平均瘦身 58%',
          status: 'success'
        },
        {
          id: 'bv-presets',
          label: '硬件加速转码预设',
          value: `${presets.length} 套`,
          subValue: 'H.264 / MP4 / 9:16 / GIF',
          status: 'success'
        }
      ]
    }),
    segmentedControl: SegmentedControl({
      value: tab,
      onChange: v => setTab(v as any),
      options: [
        { value: 'all', label: '完整工作台', badge: files.length + presets.length },
        { value: 'files', label: '本机媒体文件', badge: files.length },
        { value: 'presets', label: '转码工艺预设', badge: presets.length }
      ]
    }),
    children: [
      ...(tab === 'all' || tab === 'files'
        ? [
            List.Section({
              title: `本机目录媒体文件列表 (${filteredFiles.length})`,
              children: filteredFiles.map(f =>
                List.Item({
                  id: f.id,
                  title: f.name,
                  subtitle: f.parentDir,
                  icon: { source: Icon.Video, tintColor: Color.Purple },
                  accessories: [
                    { tag: { value: `瘦身后约 ${formatBytes(f.estimatedCompressedBytes)}`, color: Color.Green } },
                    { text: formatBytes(f.sizeBytes) }
                  ],
                  detail: List.Item.Detail({
                    markdown: `# 🎬 ${f.name}

**本机真实路径**: \`${f.path}\`

---

### 📊 转码与体积预估
- **当前原始体积**: \`${formatBytes(f.sizeBytes)}\`
- **H.264 CRF 23 压缩后预估**: \`${formatBytes(f.estimatedCompressedBytes)}\`
- **预计节省磁盘空间**: \`${formatBytes(Math.max(0, f.sizeBytes - f.estimatedCompressedBytes))}\`
`
                  }),
                  actions: ActionPanel({
                    title: f.name,
                    children: [
                      Action({
                        title: '执行 H.264 CRF23 智能瘦身',
                        icon: Icon.Bolt,
                        onAction: () => handleRunPreset(presets[0], f)
                      }),
                      Action({
                        title: '转码为标准 MP4 容器',
                        icon: Icon.Video,
                        onAction: () => handleRunPreset(presets[1], f)
                      }),
                      Action({
                        title: '在资源管理器中定位文件',
                        icon: Icon.Folder,
                        onAction: () => {
                          openVideoFileLocation(f.path)
                        }
                      }),
                      Action({
                        title: '刷新本机视频目录',
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
              title: `专业批量视频转码预设 (${filteredPresets.length})`,
              children: filteredPresets.map(p =>
                List.Item({
                  id: p.id,
                  title: p.title,
                  subtitle: p.subtitle,
                  icon: { source: Icon.Gear, tintColor: Color.Blue },
                  accessories: [
                    { tag: { value: p.tag, color: Color.Blue } },
                    { text: p.method }
                  ],
                  detail: List.Item.Detail({
                    markdown: `# ⚙️ ${p.title}\n\n${p.subtitle}\n\n### 调用参数契约\n\`\`\`json\n${JSON.stringify(p.params, null, 2)}\n\`\`\``
                  }),
                  actions: ActionPanel({
                    title: p.title,
                    children: [
                      Action({
                        title: '对当前队列执行此转码方案',
                        icon: Icon.Play,
                        onAction: () => handleRunPreset(p, files[0])
                      }),
                      Action({
                        title: '复制参数 JSON',
                        icon: Icon.Clipboard,
                        onAction: async () => {
                          await Clipboard.copy(JSON.stringify(p.params, null, 2))
                          showToast({ style: Toast.Style.Success, title: '已复制转码参数' })
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
