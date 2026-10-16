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
  RealAudioFileItem,
  formatBytes,
  fetchRealAudioWorkspace,
  invokeNativeCapability,
  openAudioFileLocation
} from './logic'

export default function BatchAudioCommand() {
  const [searchText, setSearchText] = useState('')
  const [tab, setTab] = useState<'all' | 'files' | 'presets'>('all')
  const [files, setFiles] = useState<RealAudioFileItem[]>([])
  const [presets, setPresets] = useState<CapabilityActionItem[]>([])
  const [scannedDirs, setScannedDirs] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(true)

  async function refreshWorkspace(showIndicator = false) {
    if (showIndicator) setIsLoading(true)
    try {
      const ws = await fetchRealAudioWorkspace()
      setFiles(ws.files)
      setPresets(ws.presets)
      setScannedDirs(ws.scannedDirs)
      if (showIndicator) {
        showToast({
          style: Toast.Style.Success,
          title: '音频工作台已刷新',
          message: `检索到 ${ws.files.length} 个本地文件 · ${ws.presets.length} 套音频处理预设`
        })
      }
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    refreshWorkspace(false)
  }, [])

  async function handleRunPreset(preset: CapabilityActionItem, targetFile?: RealAudioFileItem) {
    showToast({
      style: Toast.Style.Animated,
      title: `正在调用: ${preset.title}`,
      message: targetFile ? targetFile.name : `方法: ${preset.method}`
    })
    try {
      const payload = targetFile ? { ...preset.params, inputPath: targetFile.path } : preset.params
      const res = await invokeNativeCapability(preset.method, payload)
      if (!res.ok) {
        showToast({ style: Toast.Style.Failure, title: '音频处理失败', message: res.error || '原生模块返回错误' })
        return
      }
      showToast({
        style: Toast.Style.Success,
        title: '音频批处理指令已下发',
        message: `${preset.title}${targetFile ? ` (${targetFile.name})` : ''}`
      })
    } catch (err: any) {
      showToast({ style: Toast.Style.Failure, title: '参数拦截', message: err?.message || String(err) })
    }
  }

  const totalBytes = files.reduce((s, f) => s + f.sizeBytes, 0)
  const q = searchText.trim().toLowerCase()
  const filteredFiles = files.filter(
    f => !q || f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q)
  )
  const filteredPresets = presets.filter(
    p => !q || p.title.toLowerCase().includes(q) || p.subtitle.toLowerCase().includes(q) || p.tag.toLowerCase().includes(q)
  )

  return List({
    searchBarPlaceholder: '搜索本机音频文件、响度均衡预设或输出格式 (MP3 / FLAC / Loudnorm)...',
    onSearchTextChange: setSearchText,
    isShowingDetail: true,
    isLoading,
    metricGrid: MetricGrid({
      columns: 4,
      items: [
        {
          id: 'ba-files',
          label: '本机待处理音轨',
          value: `${files.length} 首`,
          subValue: `${scannedDirs.length} 个本机目录已扫描`,
          status: 'normal'
        },
        {
          id: 'ba-size',
          label: '原始文件总体积',
          value: formatBytes(totalBytes),
          subValue: '本机真实文件采样',
          status: 'normal'
        },
        {
          id: 'ba-lufs',
          label: '广播级响度基准',
          value: '-16 LUFS',
          subValue: 'EBU R128 防爆音保护',
          status: 'success'
        },
        {
          id: 'ba-presets',
          label: '专业音频处理预设',
          value: `${presets.length} 套`,
          subValue: 'MP3 / FLAC / 静音切除 / 淡入淡出',
          status: 'success'
        }
      ]
    }),
    segmentedControl: SegmentedControl({
      value: tab,
      onChange: v => setTab(v as any),
      options: [
        { value: 'all', label: '完整音频工作台', badge: files.length + presets.length },
        { value: 'files', label: '本机音频文件', badge: files.length },
        { value: 'presets', label: '音频处理预设', badge: presets.length }
      ]
    }),
    children: [
      ...(tab === 'all' || tab === 'files'
        ? [
            List.Section({
              title: `本机目录音频与媒体文件列表 (${filteredFiles.length})`,
              children: filteredFiles.map(f =>
                List.Item({
                  id: f.id,
                  title: f.name,
                  subtitle: f.parentDir,
                  icon: { source: Icon.Music, tintColor: Color.Green },
                  accessories: [
                    { tag: { value: f.extension, color: Color.Blue } },
                    { text: formatBytes(f.sizeBytes) }
                  ],
                  detail: List.Item.Detail({
                    markdown: `# 🎵 ${f.name}

**本机真实路径**: \`${f.path}\`

---

### 📊 文件与音轨规格
- **原始文件体积**: \`${formatBytes(f.sizeBytes)}\`
- **封装扩展名**: \`${f.extension}\`
- **所在目录**: \`${f.parentDir}\`
`
                  }),
                  actions: ActionPanel({
                    title: f.name,
                    children: [
                      Action({
                        title: '转码为 MP3 (320kbps CBR)',
                        icon: Icon.Music,
                        onAction: () => handleRunPreset(presets[0], f)
                      }),
                      Action({
                        title: '执行 EBU R128 (-16 LUFS) 响度标准化',
                        icon: Icon.Bolt,
                        onAction: () => handleRunPreset(presets[2], f)
                      }),
                      Action({
                        title: '在资源管理器中定位文件',
                        icon: Icon.Folder,
                        onAction: () => {
                          openAudioFileLocation(f.path)
                        }
                      }),
                      Action({
                        title: '刷新本机音频目录',
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
              title: `专业批量音频处理预设 (${filteredPresets.length})`,
              children: filteredPresets.map(p =>
                List.Item({
                  id: p.id,
                  title: p.title,
                  subtitle: p.subtitle,
                  icon: { source: Icon.SpeakerHigh, tintColor: Color.Blue },
                  accessories: [
                    { tag: { value: p.tag, color: Color.Blue } },
                    { text: p.method }
                  ],
                  detail: List.Item.Detail({
                    markdown: `# 🎚️ ${p.title}\n\n${p.subtitle}\n\n### 调用参数契约\n\`\`\`json\n${JSON.stringify(p.params, null, 2)}\n\`\`\``
                  }),
                  actions: ActionPanel({
                    title: p.title,
                    children: [
                      Action({
                        title: '对当前音轨执行此处理方案',
                        icon: Icon.Play,
                        onAction: () => handleRunPreset(p, files[0])
                      }),
                      Action({
                        title: '复制参数 JSON',
                        icon: Icon.Clipboard,
                        onAction: async () => {
                          await Clipboard.copy(JSON.stringify(p.params, null, 2))
                          showToast({ style: Toast.Style.Success, title: '已复制音频处理参数' })
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
