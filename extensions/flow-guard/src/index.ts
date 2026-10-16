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
  ProcessNetworkGroup,
  FORBIDDEN_REASON,
  formatBytes,
  fetchFlowGuardSnapshot,
  terminateNetworkProcess,
  openNetworkProcessLocation
} from './logic'

export default function FlowGuardCommand() {
  const [searchText, setSearchText] = useState('')
  const [tab, setTab] = useState<'all' | 'established' | 'listening' | 'udp'>('all')
  const [groups, setGroups] = useState<ProcessNetworkGroup[]>([])
  const [totalEndpoints, setTotalEndpoints] = useState(0)
  const [totalEstablished, setTotalEstablished] = useState(0)
  const [totalListening, setTotalListening] = useState(0)
  const [totalUdp, setTotalUdp] = useState(0)
  const [isLoading, setIsLoading] = useState(true)

  async function refreshConnections(showIndicator = false) {
    if (showIndicator) setIsLoading(true)
    try {
      const snap = await fetchFlowGuardSnapshot()
      setGroups(snap.groups)
      setTotalEndpoints(snap.totalEndpoints)
      setTotalEstablished(snap.totalEstablished)
      setTotalListening(snap.totalListening)
      setTotalUdp(snap.totalUdp)
      if (showIndicator) {
        showToast({
          style: Toast.Style.Success,
          title: '实时网络连接已刷新',
          message: `${snap.groups.length} 个联网进程 · ${snap.totalEndpoints} 个活动套接字`
        })
      }
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    refreshConnections(false)
  }, [])

  async function handleKillProcess(group: ProcessNetworkGroup) {
    if (group.isProtected) {
      await confirmAlert({
        title: `⚠️ 核心网络服务保护 [${group.processName}]`,
        message: `PID: ${group.pid}\n\n${FORBIDDEN_REASON}`,
        primaryAction: { title: '我知道了', style: 'default' }
      })
      return
    }

    const confirmed = await confirmAlert({
      title: `确认阻断并结束联网进程 [${group.processName}]？`,
      message: `进程 PID: ${group.pid}\n活跃连接数: ${group.establishedCount} 个 ESTABLISHED / ${group.listeningCount} 个 LISTENING\n\n结束进程将立即释放其占用的全部端口与远端连接。`,
      primaryAction: { title: '立即阻断结束', style: 'destructive' }
    })
    if (!confirmed) return

    const res = await terminateNetworkProcess(group.pid, group.processName)
    if (!res.ok) {
      showToast({
        style: Toast.Style.Failure,
        title: '阻断失败',
        message: res.error || '权限不足'
      })
      return
    }

    showToast({
      style: Toast.Style.Success,
      title: '已终止联网进程',
      message: `${group.processName} (PID: ${group.pid})`
    })
    refreshConnections(false)
  }

  function renderDetailMarkdown(g: ProcessNetworkGroup): string {
    const endpointRows = g.endpoints
      .slice(0, 18)
      .map(
        (ep, idx) =>
          `${idx + 1}. \`[${ep.protocol}]\` \`${ep.localAddress}:${ep.localPort}\` → \`${ep.remoteAddress}:${ep.remotePort}\` · **${ep.state}**`
      )
      .join('\n')

    const guardBanner = g.isProtected
      ? `> [!CAUTION]\n> **核心系统网络服务**：${FORBIDDEN_REASON}`
      : `> [!TIP]\n> **第三方/用户态联网应用**：若发现异常远端连接或后台偷跑流量，可一键终止并释放端口。`

    return `# 🌐 ${g.processName} (PID: ${g.pid})

**可执行路径**: \`${g.processPath || '系统内核/受保护服务路径'}\`

---

### 📊 网络套接字与资源指标
- **活动连接总数**: \`${g.endpoints.length} 个\` (TCP: \`${g.tcpCount}\` / UDP: \`${g.udpCount}\`)
- **已建立远端会话 (ESTABLISHED)**: \`${g.establishedCount} 个\`
- **本地监听端口 (LISTENING)**: \`${g.listeningCount} 个\`
- **物理内存占用**: \`${formatBytes(g.memoryBytes)}\` · **CPU 占用**: \`${g.cpuPercent.toFixed(1)}%\`

---

### 🔌 实时端口与远端 IP 明细 (前 ${Math.min(18, g.endpoints.length)} 条)
${endpointRows || '_无活动端口_'}

---

${guardBanner}
`
  }

  const q = searchText.trim().toLowerCase()
  const filtered = groups.filter(g => {
    if (tab === 'established' && g.establishedCount === 0) return false
    if (tab === 'listening' && g.listeningCount === 0) return false
    if (tab === 'udp' && g.udpCount === 0) return false
    if (!q) return true
    if (
      g.processName.toLowerCase().includes(q) ||
      String(g.pid).includes(q) ||
      g.processPath.toLowerCase().includes(q)
    ) {
      return true
    }
    return g.endpoints.some(
      ep =>
        String(ep.localPort).includes(q) ||
        String(ep.remotePort).includes(q) ||
        ep.remoteAddress.toLowerCase().includes(q) ||
        ep.localAddress.toLowerCase().includes(q)
    )
  })

  return List({
    searchBarPlaceholder: '搜索联网进程名称、PID、本地端口或远端服务器 IP...',
    onSearchTextChange: setSearchText,
    isShowingDetail: true,
    isLoading,
    metricGrid: MetricGrid({
      columns: 4,
      items: [
        {
          id: 'fg-procs',
          label: '活跃联网进程',
          value: `${groups.length} 个`,
          subValue: `总计 ${totalEndpoints} 个套接字`,
          status: 'normal'
        },
        {
          id: 'fg-est',
          label: '远端活动连接',
          value: `${totalEstablished} 条`,
          subValue: 'TCP ESTABLISHED',
          status: totalEstablished > 80 ? 'warning' : 'success'
        },
        {
          id: 'fg-listen',
          label: '本机监听端口',
          value: `${totalListening} 个`,
          subValue: 'TCP LISTENING',
          status: 'normal'
        },
        {
          id: 'fg-udp',
          label: 'UDP 数据报端点',
          value: `${totalUdp} 个`,
          subValue: '实时 QUIC / DNS / 流媒体',
          status: 'normal'
        }
      ]
    }),
    segmentedControl: SegmentedControl({
      value: tab,
      onChange: v => setTab(v as any),
      options: [
        { value: 'all', label: '全部联网进程', badge: groups.length },
        { value: 'established', label: '远端通信中', badge: groups.filter(g => g.establishedCount > 0).length },
        { value: 'listening', label: '端口监听服务', badge: groups.filter(g => g.listeningCount > 0).length },
        { value: 'udp', label: 'UDP 活动端点', badge: groups.filter(g => g.udpCount > 0).length }
      ]
    }),
    children: [
      List.Section({
        title: `本机实时网络连接与端口监控 (${filtered.length})`,
        children: filtered.map(g =>
          List.Item({
            id: `net-proc-${g.pid}`,
            title: g.processName,
            subtitle: `PID: ${g.pid} · 连接: ${g.establishedCount} 活动 / ${g.listeningCount} 监听 / ${g.udpCount} UDP`,
            icon: {
              source: g.establishedCount > 0 ? Icon.Globe : Icon.Globe,
              tintColor: g.isProtected ? Color.SecondaryText : g.establishedCount > 0 ? Color.Green : Color.Blue
            },
            accessories: [
              {
                tag: {
                  value: g.establishedCount > 0 ? `${g.establishedCount} 远端连接` : `${g.listeningCount} 监听`,
                  color: g.establishedCount > 0 ? Color.Green : Color.Blue
                }
              },
              { text: `${g.endpoints.length} 端口` }
            ],
            detail: List.Item.Detail({
              markdown: renderDetailMarkdown(g)
            }),
            actions: ActionPanel({
              title: g.processName,
              children: [
                Action({
                  title: '刷新实时网络连接快照',
                  icon: Icon.ArrowClockwise,
                  onAction: () => refreshConnections(true)
                }),
                Action({
                  title: '阻断并结束该联网进程',
                  icon: Icon.XMarkCircle,
                  onAction: () => handleKillProcess(g)
                }),
                ...(g.processPath
                  ? [
                      Action({
                        title: '在资源管理器中定位程序',
                        icon: Icon.Folder,
                        onAction: () => {
                          openNetworkProcessLocation(g.processPath)
                        }
                      })
                    ]
                  : []),
                Action({
                  title: '复制连接审计明细',
                  icon: Icon.Clipboard,
                  onAction: async () => {
                    const summaryText = g.endpoints
                      .map(e => `${e.protocol} ${e.localAddress}:${e.localPort} -> ${e.remoteAddress}:${e.remotePort} (${e.state})`)
                      .join('\n')
                    await Clipboard.copy(summaryText)
                    showToast({ style: Toast.Style.Success, title: '已复制连接明细', message: `${g.endpoints.length} 条记录` })
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
