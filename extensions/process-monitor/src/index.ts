import {
  List,
  Detail,
  ActionPanel,
  Action,
  Icon,
  Color,
  Clipboard,
  useState,
  useEffect,
  useRef,
  showToast,
  Toast,
  confirmAlert,
  useNavigation
} from '@ztools/declarative-ui'
import {
  NOT_IN_CLIENT_MESSAGE,
  type ProcessItem,
  type SystemInfoData,
  type ProcessDetailInfo,
  type ProcessServiceInfo,
  type ProcessSortKey,
  type ProcessTerminateMode,
  FORBIDDEN_REASON,
  getTerminationRisk,
  resolveCpuLoadPercent,
  describeProcessProfile,
  formatBytes,
  fetchProcesses,
  fetchSystemInfo,
  fetchProcessDetail,
  fetchServicesByPID,
  terminateProcess,
  openFileLocation,
  getResourceFocus,
  filterProcesses,
  fetchProcessPortSnapshot,
  filterProcessesByPort,
  matchPortRows,
  type ProcessPort
} from './logic.js'

import { isRealElectronHost } from './native-ipc.js'

export * from './logic.js'

type ProcessViewFilter = 'port' | 'memory' | 'cpu' | 'high-load' | 'system' | 'user' | 'name' | 'pid'

/**
 * 复制文本：等宿主确认写入成功后才提示成功；写入失败（内容为空、超过上限、剪贴板被占用等）时提示失败原因，不能假装已复制
 */
/** 系统文件管理器名称：Windows 路径为资源管理器，其余（macOS）为访达 */
function fileManagerName(samplePath: string): string {
  return /^[a-zA-Z]:[\\/]|^\\\\/.test(samplePath) ? '资源管理器' : '访达'
}

async function copyWithToast(text: string, successTitle: string, successMessage?: string): Promise<void> {
  try {
    await Clipboard.copy(text)
  } catch (err) {
    await showToast({
      style: Toast.Style.Failure,
      title: '复制失败',
      message: err instanceof Error ? err.message : String(err)
    })
    return
  }
  await showToast({ style: Toast.Style.Success, title: successTitle, message: successMessage })
}

export default function ProcessMonitorCommand({ initialView = 'memory' }: { initialView?: ProcessViewFilter } = {}) {
  const { push } = useNavigation()
  const inRealHost = isRealElectronHost()
  const [searchText, setSearchText] = useState('')
  const [viewFilter, setViewFilter] = useState<ProcessViewFilter>(initialView)
  const [autoRefresh, setAutoRefresh] = useState<boolean>(true)
  // 不在客户端里运行时列表保持为空并提示，不显示任何示例进程
  const [processes, setProcesses] = useState<ProcessItem[]>([])
  const [systemInfo, setSystemInfo] = useState<SystemInfoData>({
    cpuUsagePercent: 0,
    cpuCoreCount: 0,
    totalMemoryBytes: 0,
    usedMemoryBytes: 0,
    availableMemoryBytes: 0,
    totalMemory: 0,
    availableMemory: 0,
    memoryUsagePercent: 0,
    processCount: 0,
    threadCount: 0
  })
  const [loadError, setLoadError] = useState(inRealHost ? '' : NOT_IN_CLIENT_MESSAGE)
  const [portsError, setPortsError] = useState('')
  const [ports, setPorts] = useState<ProcessPort[]>([])
  // macOS 宿主改用 lsof 兜底时只能看到当前用户进程的端口，系统服务占用的端口查不到，需要如实提示
  const [portsPartial, setPortsPartial] = useState(false)
  const [isLoading, setIsLoading] = useState(inRealHost)
  const [details, setDetails] = useState<Record<number, ProcessDetailInfo>>({})
  const [services, setServices] = useState<Record<number, ProcessServiceInfo[]>>({})
  const refreshingRef = useRef(false)
  const refreshSequenceRef = useRef(0)
  const refreshPortsRef = useRef<(() => Promise<void>) | null>(null)
  const portsQueryRef = useRef<string | null>(null)
  const terminatingRef = useRef(false)
  const detailLoadedRef = useRef<Record<number, boolean>>({})

  async function loadProcessExtra(proc: ProcessItem) {
    if (!proc || proc.pid <= 0) return
    try {
      const isSvchost = proc.name.toLowerCase() === 'svchost.exe'
      const [detailRes, svcRes] = await Promise.all([
        fetchProcessDetail(proc.pid),
        isSvchost || proc.isSystem ? fetchServicesByPID(proc.pid) : Promise.resolve([])
      ])
      if (detailRes) {
        setDetails((prev) => ({ ...prev, [proc.pid]: detailRes }))
      }
      if (Array.isArray(svcRes) && svcRes.length > 0) {
        setServices((prev) => ({ ...prev, [proc.pid]: svcRes }))
      }
      detailLoadedRef.current[proc.pid] = true
    } catch {
      // ignore background detail errors
    }
  }

  // ⌘I：读取真实的签名 / 发布者 / 版本 / 托管服务并在详情页展示；宿主一项都没给时明确提示，不弹假成功
  async function handleShowProfile(proc: ProcessItem) {
    if (!proc || proc.pid <= 0) return
    let detailRes: ProcessDetailInfo | null = null
    let svcRes: ProcessServiceInfo[] = []
    try {
      ;[detailRes, svcRes] = await Promise.all([fetchProcessDetail(proc.pid), fetchServicesByPID(proc.pid)])
    } catch (err) {
      showToast({
        style: Toast.Style.Failure,
        title: '读取签名与托管服务失败',
        message: err instanceof Error ? err.message : String(err)
      })
      return
    }
    if (detailRes) setDetails((prev) => ({ ...prev, [proc.pid]: detailRes as ProcessDetailInfo }))
    if (svcRes.length > 0) setServices((prev) => ({ ...prev, [proc.pid]: svcRes }))

    const fields = describeProcessProfile(proc, detailRes, svcRes)
    if (fields.length === 0) {
      showToast({
        style: Toast.Style.Failure,
        title: '未读取到签名与托管服务信息',
        message: `当前系统没有为 ${proc.name} (PID: ${proc.pid}) 提供数字签名、版本或关联服务数据`
      })
      return
    }
    const execPath = detailRes?.path || proc.path
    push(() =>
      Detail({
        navigationTitle: `${proc.name} (PID: ${proc.pid})`,
        markdown: `# ${proc.name}\n\nPID ${proc.pid}${execPath ? `\n\n\`${execPath}\`` : ''}`,
        metadata: Detail.Metadata(
          {},
          ...fields.map((f) => Detail.Metadata.Label({ title: f.title, text: f.text }))
        )
      })
    )
  }

  async function refreshData(showIndicator = false) {
    if (refreshingRef.current) return
    refreshingRef.current = true
    const request = ++refreshSequenceRef.current
    if (showIndicator) setIsLoading(true)
    try {
      const [newProcs, newSys] = await Promise.all([fetchProcesses(), fetchSystemInfo()])
      if (request !== refreshSequenceRef.current) return
      setLoadError('')
      setProcesses(newProcs)
      if (newProcs.length > 0) {
        const focus = getResourceFocus(newProcs)
        const candidates: ProcessItem[] = []
        if (focus.topCpu) candidates.push(focus.topCpu)
        if (focus.topMemory && focus.topMemory.pid !== focus.topCpu?.pid) {
          candidates.push(focus.topMemory)
        }
        const svchostProc = newProcs.find((p) => p.name.toLowerCase() === 'svchost.exe')
        if (svchostProc && !candidates.some((c) => c.pid === svchostProc.pid)) {
          candidates.push(svchostProc)
        }
        for (const cand of candidates.slice(0, 3)) {
          if (!detailLoadedRef.current[cand.pid]) {
            detailLoadedRef.current[cand.pid] = true
            void loadProcessExtra(cand)
          }
        }
      }
      if (newSys) setSystemInfo(newSys)
    } catch (error) {
      if (request !== refreshSequenceRef.current) return
      const message = error instanceof Error ? error.message : String(error)
      setLoadError(message)
      if (showIndicator) await showToast({ style: Toast.Style.Failure, title: '刷新失败', message })
    } finally {
      if (request === refreshSequenceRef.current) {
        refreshingRef.current = false
        setIsLoading(false)
      }
    }
  }

  async function handleRefresh() {
    await Promise.all([refreshData(true), refreshPortsRef.current?.()])
  }

  useEffect(() => {
    // 不在客户端里没有可读取的数据，不启动刷新
    if (!inRealHost) return
    if (autoRefresh) void refreshData(false)
    const timer = autoRefresh ? setInterval(() => { void refreshData(false) }, 2000) : undefined
    const backgroundTimer = timer as unknown as { unref?: () => void } | undefined
    backgroundTimer?.unref?.()
    return () => {
      clearInterval(timer)
      refreshSequenceRef.current++
      refreshingRef.current = false
    }
  }, [autoRefresh])

  useEffect(() => {
    const portMode = viewFilter === 'port' || /^port:/i.test(searchText)
    const query = portMode ? JSON.stringify([viewFilter, searchText]) : null
    const queryChanged = query !== portsQueryRef.current
    portsQueryRef.current = query
    if (!portMode) return
    let active = true
    let sequence = 0
    let inFlight = false
    const load = async (manual = false) => {
      if (inFlight && !manual) return
      const request = ++sequence
      inFlight = true
      try {
        const snapshot = await fetchProcessPortSnapshot()
        if (active && request === sequence) { setPorts(snapshot.rows); setPortsPartial(snapshot.partial); setPortsError('') }
      } catch (error) {
        if (active && request === sequence) { setPorts([]); setPortsPartial(false); setPortsError(error instanceof Error ? error.message : String(error)) }
      } finally {
        if (request === sequence) inFlight = false
      }
    }
    refreshPortsRef.current = () => load(true)
    // 暂停仅冻结定时更新；首次进入或查询变化仍读取一次。
    if (autoRefresh || queryChanged) void load()
    const timer = autoRefresh ? setInterval(() => { void load() }, 2000) : undefined
    const backgroundTimer = timer as unknown as { unref?: () => void } | undefined
    backgroundTimer?.unref?.()
    return () => {
      active = false
      refreshPortsRef.current = null
      clearInterval(timer)
    }
  }, [viewFilter, searchText, autoRefresh])

  function handleToggleAutoRefresh() {
    const next = !autoRefresh
    setAutoRefresh(next)
    if (!next) setIsLoading(false)
    showToast({
      style: Toast.Style.Success,
      title: next ? '已开启 2 秒实时自动刷新' : '已暂停实时自动刷新',
      message: next ? '每 2 秒自动同步 CPU 与内存快照' : '列表已锁定，可点「刷新列表」手动刷新'
    })
  }

  async function handleTerminate(proc: ProcessItem, mode: ProcessTerminateMode = 'force') {
    // 同一时间只允许一个结束流程，防止连按重复弹确认或重复结束
    if (terminatingRef.current) return
    terminatingRef.current = true
    try {
      await runTerminate(proc, mode)
    } finally {
      terminatingRef.current = false
    }
  }

  async function runTerminate(proc: ProcessItem, mode: ProcessTerminateMode) {
    const risk = getTerminationRisk(proc.pid, proc.name)
    if (risk === 'forbidden') {
      showToast({
        style: Toast.Style.Failure,
        title: `已拦截：${proc.name} 是系统关键进程`,
        message: FORBIDDEN_REASON
      })
      return
    }
    const modeLabel = mode === 'tree' ? '强制结束进程树' : mode === 'graceful' ? '平缓关闭进程' : '结束进程'

    if (risk === 'high-risk') {
      const confirmed = await confirmAlert({
        title: `高危操作：结束系统界面进程 [${proc.name}]`,
        message: `进程 PID: ${proc.pid} 是系统界面组件，结束后程序坞、桌面或菜单栏会短暂消失，通常由系统自动重新启动。\n\n确定依然执行 [${modeLabel}]？`,
        primaryAction: {
          title: '依然结束',
          style: 'destructive'
        }
      })
      if (!confirmed) return
    } else {
      const confirmed = await confirmAlert({
        title: `确认${modeLabel} [${proc.name}]`,
        message: `目标进程 PID: ${proc.pid}，未保存的数据可能会丢失。`,
        primaryAction: {
          title: '确认结束',
          style: 'destructive'
        }
      })
      if (!confirmed) return
    }

    showToast({
      style: Toast.Style.Animated,
      title: `正在执行: ${modeLabel}`,
      message: `${proc.name} (PID: ${proc.pid})`
    })

    let res = await terminateProcess(proc.pid, proc.name, mode)
    if (!res.ok && res.canForce) {
      // 平缓关闭超时：宿主不自动升级，强制结束必须由用户再次确认
      const force = await confirmAlert({
        title: `${proc.name} (PID: ${proc.pid}) 没有响应平缓关闭`,
        message: `${res.error}。强制结束会立即终止它，未保存的数据会丢失。`,
        primaryAction: {
          title: '强制结束',
          style: 'destructive'
        }
      })
      if (!force) {
        showToast({
          style: Toast.Style.Failure,
          title: '进程仍在运行',
          message: `已取消强制结束 ${proc.name} (PID: ${proc.pid})`
        })
        return
      }
      res = await terminateProcess(proc.pid, proc.name, 'force')
    }
    if (!res.ok) {
      showToast({
        style: Toast.Style.Failure,
        title: '终止失败',
        message: res.error || '终止进程失败'
      })
      return
    }

    showToast({
      style: Toast.Style.Success,
      title: res.alreadyExited ? '进程已经退出' : '进程已成功终止',
      message: `${proc.name} (PID: ${proc.pid})`
    })

    setProcesses((prev) => prev.filter((p) => p.pid !== proc.pid))
    void refreshData(false)
  }

  async function handleOpenLocation(proc: ProcessItem) {
    // 优先用进程列表里的原始路径：宿主只把 process_list / GetProcessList 返回的可执行文件路径授权给本窗口定位，
    // 详情接口（process_info 等）给的路径没有授权，只在列表没有路径时才用
    const targetPath = proc.path || details[proc.pid]?.path
    if (!targetPath) {
      showToast({
        style: Toast.Style.Failure,
        title: '无法定位路径',
        message: '系统没有提供该进程的可执行文件路径（内核进程、受权限保护或改写了进程名的程序）'
      })
      return
    }
    const ok = await openFileLocation(targetPath)
    if (ok) {
      showToast({
        style: Toast.Style.Success,
        title: `已在${fileManagerName(targetPath)}中定位`,
        message: targetPath
      })
    } else {
      showToast({
        style: Toast.Style.Failure,
        title: '打开路径失败',
        // 宿主拒绝（列表刷新后授权过期、文件已不在）时说明怎么办，不只回显路径
        message: `${targetPath}\n文件可能已被移动或删除，或授权已过期，请刷新进程列表后再试`
      })
    }
  }

  const tab: 'all' | 'user' | 'system' =
    viewFilter === 'system' ? 'system' : viewFilter === 'user' ? 'user' : 'all'
  const sortBy: ProcessSortKey =
    viewFilter === 'cpu' || viewFilter === 'high-load'
      ? 'cpu'
      : viewFilter === 'name'
      ? 'name'
      : viewFilter === 'pid'
      ? 'pid'
      : 'memory'

  const portMode = viewFilter === 'port' || /^port:/i.test(searchText)
  const portRows = portMode ? matchPortRows(ports, searchText) : []
  const baseFiltered = portMode ? filterProcessesByPort(processes, ports, searchText) : filterProcesses(processes, searchText, tab, sortBy)
  const filtered =
    viewFilter === 'high-load'
      ? baseFiltered.filter(
          (p) => p.cpuPercent >= 5 || (p.workingSetBytes ?? p.memoryBytes ?? 0) >= 250 * 1024 * 1024
        )
      : baseFiltered

  const totalMem = systemInfo.totalMemoryBytes || systemInfo.totalMemory || 0
  const availMem = systemInfo.availableMemoryBytes || systemInfo.availableMemory || 0
  const usedMem = systemInfo.usedMemoryBytes || Math.max(0, totalMem - availMem)
  const memPercent =
    systemInfo.memoryUsagePercent || (totalMem > 0 ? Math.round((usedMem / totalMem) * 100) : 0)
  const totalCpuPercent = resolveCpuLoadPercent(systemInfo, processes)

  const maxMemBytes = Math.max(
    1,
    ...processes.map((p) => p.workingSetBytes ?? p.memoryBytes ?? 0)
  )

  return List({
    navigationTitle: '进程监控',
    searchBarPlaceholder: portMode ? '输入本地端口号，例如 8080' : '搜索进程、PID 或输入 port:8080 查询端口占用',
    onSearchTextChange: setSearchText,
    isShowingDetail: false,
    isLoading,
    searchBarAccessory: List.Dropdown({
      tooltip: '切换进程筛选与排序维度',
      value: viewFilter,
      onChange: (val: string) => setViewFilter(val as ProcessViewFilter),
      children: [
        List.Dropdown.Item({ title: '本地端口占用', value: 'port' }),
        List.Dropdown.Item({ title: '全部进程 · 按内存排序', value: 'memory' }),
        List.Dropdown.Item({ title: '全部进程 · 按 CPU 排序', value: 'cpu' }),
        List.Dropdown.Item({ title: '仅高负载进程', value: 'high-load' }),
        List.Dropdown.Item({ title: '系统关键服务', value: 'system' }),
        List.Dropdown.Item({ title: '用户应用程序', value: 'user' }),
        List.Dropdown.Item({ title: '按进程名称排序', value: 'name' }),
        List.Dropdown.Item({ title: '按 PID 升序', value: 'pid' })
      ]
    }),
    filterBar: {
      summaryText: loadError === NOT_IN_CLIENT_MESSAGE ? NOT_IN_CLIENT_MESSAGE : loadError ? `数据不可用或已过期：${loadError}` : portMode ? (portsError ? `端口读取失败：${portsError}` : `本地端口匹配 ${filtered.length} 个进程${portsPartial ? '（只能看到当前用户进程的端口，系统服务占用的端口可能查不到）' : ''}`) : `CPU 负载 ${totalCpuPercent}% · 物理内存已用 ${formatBytes(usedMem)} / ${formatBytes(totalMem)} (${memPercent}%) · 活动进程 ${filtered.length} 个`,
      actions: [
        {
          id: 'refresh-list',
          label: '刷新列表',
          title: '刷新列表',
          style: 'secondary',
          onAction: () => {
            void handleRefresh()
          }
        },
        {
          id: 'toggle-auto-refresh',
          label: autoRefresh ? '暂停自动刷新' : '开启自动刷新',
          title: autoRefresh ? '暂停自动刷新' : '开启自动刷新',
          style: 'secondary',
          onAction: () => {
            handleToggleAutoRefresh()
          }
        }
      ]
    },
    children: [
      ...(loadError && processes.length === 0
        ? [
            List.Item({
              id: 'load-error',
              title: loadError === NOT_IN_CLIENT_MESSAGE ? NOT_IN_CLIENT_MESSAGE : '无法读取进程列表',
              subtitle: loadError === NOT_IN_CLIENT_MESSAGE ? '在 ZTools 中打开「进程监控」后查看本机进程' : loadError,
              icon: Icon.ExclamationMark
            })
          ]
        : []),
      List.Section({
        title: `${portMode ? '端口占用进程' : '活动进程列表'}（${filtered.length}）`,
        children: filtered.map((proc) => {
          const isCrit = getTerminationRisk(proc.pid, proc.name) === 'forbidden'
          const memVal = proc.workingSetBytes ?? proc.memoryBytes ?? 0
          const memRatio = Math.min(100, Math.max(4, Math.round((memVal / maxMemBytes) * 100)))
          const isHighLoad = proc.cpuPercent >= 25 || memVal >= 1024 * 1024 * 1024
          const procServices = services[proc.pid] || []
          const svcHint = procServices.length > 0 ? `托管服务 ${procServices.length} 项` : ''

          return List.Item({
            id: String(proc.pid),
            title: proc.name,
            subtitle: [
              `PID: ${proc.pid}`,
              ...(portMode ? [`端口 ${[...new Set(portRows.filter(p => p.pid === proc.pid).map(p => p.localPort))].join(", ")}`] : []),
              ...(proc.threadCount ? [`线程 ${proc.threadCount}`] : []),
              ...(svcHint ? [svcHint] : []),
              proc.path || proc.commandLine || '路径未提供'
            ].join(' · '),
            icon: isCrit ? Icon.Shield : isHighLoad ? Icon.ExclamationMark : Icon.Terminal,
            accessories: [
              { progress: { value: memRatio } },
              ...(isCrit
                ? [{ tag: { value: '系统关键' } }]
                : isHighLoad
                ? [{ tag: { value: '高负载', color: Color.Red } }]
                : [{ tag: { value: proc.isSystem ? '系统服务' : '用户应用' } }]),
              { text: `CPU ${proc.cpuPercent.toFixed(1)}%` },
              { text: formatBytes(memVal) }
            ],
            actions: ActionPanel({
              title: `${proc.name} (PID: ${proc.pid})`,
              children: [
                Action({
                  title: '结束进程',
                  icon: Icon.XMarkCircle,
                  style: 'destructive',
                  onAction: () => handleTerminate(proc, 'force')
                }),
                Action({
                  title: '强制结束进程树',
                  icon: Icon.Trash,
                  style: 'destructive',
                  shortcut: { modifiers: ['ctrl'], key: 'return' },
                  onAction: () => handleTerminate(proc, 'tree')
                }),
                Action({
                  title: '定位文件目录',
                  icon: Icon.Folder,
                  shortcut: { modifiers: ['ctrl'], key: 'o' },
                  onAction: () => handleOpenLocation(proc)
                }),
                Action({
                  title: '复制 PID',
                  icon: Icon.Key,
                  shortcut: { modifiers: ['ctrl'], key: 'c' },
                  onAction: () => copyWithToast(String(proc.pid), '已复制 PID', String(proc.pid))
                }),
                Action({
                  title: '平缓关闭进程 (Graceful)',
                  icon: Icon.Stop,
                  onAction: () => handleTerminate(proc, 'graceful')
                }),
                Action({
                  title: '查看数字签名与托管服务',
                  icon: Icon.MagnifyingGlass,
                  shortcut: { modifiers: ['ctrl'], key: 'i' },
                  onAction: () => handleShowProfile(proc)
                }),
                Action({
                  title: '复制完整可执行路径',
                  icon: Icon.Document,
                  shortcut: { modifiers: ['ctrl', 'shift'], key: 'c' },
                  onAction: () => {
                    const targetPath = details[proc.pid]?.path || proc.path
                    if (targetPath) {
                      return copyWithToast(targetPath, '已复制可执行路径', targetPath)
                    } else {
                      showToast({
                        style: Toast.Style.Failure,
                        title: '路径不可用',
                        message: '没有读取到该进程的可执行文件路径'
                      })
                    }
                  }
                }),
                Action({
                  title: '复制启动命令行 (CommandLine)',
                  icon: Icon.Terminal,
                  onAction: () => {
                    // 只复制系统真实给出的命令行；没有时如实提示，不拿路径或进程名冒充
                    const cmdLine = details[proc.pid]?.commandLine || proc.commandLine
                    if (cmdLine) return copyWithToast(cmdLine, '已复制启动命令行', cmdLine)
                    showToast({
                      style: Toast.Style.Failure,
                      title: '没有读取到启动命令行',
                      message: `当前系统没有为 ${proc.name} (PID: ${proc.pid}) 提供启动命令行`
                    })
                  }
                }),
                Action({
                  title: '刷新列表',
                  icon: Icon.ArrowClockwise,
                  shortcut: { modifiers: ['ctrl'], key: 'r' },
                  onAction: handleRefresh
                })
              ]
            })
          })
        })
      })
    ]
  })
}

/** 插件清单 port-lookup 子命令由宿主按导出名选择。 */
export function portLookup() { return ProcessMonitorCommand({ initialView: 'port' }) }
