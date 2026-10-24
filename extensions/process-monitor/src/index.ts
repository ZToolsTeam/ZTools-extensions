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
  DLL_PLUGIN_NAME,
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
  getMockProcesses,
  getMockSystemInfo,
  getMockProcessDetail,
  getMockServicesByPID,
  fetchProcesses,
  fetchSystemInfo,
  fetchProcessDetail,
  fetchServicesByPID,
  terminateProcess,
  openFileLocation,
  getResourceFocus,
  filterProcesses
} from './logic.js'

import { isRealElectronHost } from './native-ipc.js'

export * from './logic.js'

type ProcessViewFilter = 'memory' | 'cpu' | 'high-load' | 'system' | 'user' | 'name' | 'pid'

/**
 * 复制文本：等宿主确认写入成功后才提示成功；写入失败（内容为空、超过上限、剪贴板被占用等）时提示失败原因，不能假装已复制
 */
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

export default function ProcessMonitorCommand() {
  const { push } = useNavigation()
  const inRealHost = isRealElectronHost()
  const [searchText, setSearchText] = useState('')
  const [viewFilter, setViewFilter] = useState<ProcessViewFilter>('memory')
  const [autoRefresh, setAutoRefresh] = useState<boolean>(true)
  const [processes, setProcesses] = useState<ProcessItem[]>(inRealHost ? [] : getMockProcesses())
  const [systemInfo, setSystemInfo] = useState<SystemInfoData>(
    inRealHost
      ? {
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
        }
      : getMockSystemInfo()
  )
  const [isLoading, setIsLoading] = useState(inRealHost)
  const [details, setDetails] = useState<Record<number, ProcessDetailInfo>>(() => {
    const initDetails: Record<number, ProcessDetailInfo> = {}
    if (inRealHost) return initDetails
    for (const p of getMockProcesses()) {
      initDetails[p.pid] = getMockProcessDetail(p.pid)
    }
    return initDetails
  })
  const [services, setServices] = useState<Record<number, ProcessServiceInfo[]>>(() => {
    const initServices: Record<number, ProcessServiceInfo[]> = {}
    if (inRealHost) return initServices
    initServices[1044] = getMockServicesByPID(1044)
    return initServices
  })
  const refreshingRef = useRef(false)
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
    if (showIndicator) setIsLoading(true)
    try {
      const [newProcs, newSys] = await Promise.all([fetchProcesses(), fetchSystemInfo()])
      if (newProcs.length > 0) {
        setProcesses(newProcs)
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
    } finally {
      refreshingRef.current = false
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void refreshData(false)
    if (!autoRefresh) return undefined
    const timer = setInterval(() => {
      void refreshData(false)
    }, 2000)
    if (typeof (timer as any)?.unref === 'function') {
      ;(timer as any).unref()
    }
    return () => {
      clearInterval(timer)
    }
  }, [autoRefresh])

  function handleToggleAutoRefresh() {
    const next = !autoRefresh
    setAutoRefresh(next)
    showToast({
      style: Toast.Style.Success,
      title: next ? '已开启 2 秒实时自动刷新' : '已暂停实时自动刷新',
      message: next ? '每 2 秒自动同步 CPU 与内存快照' : '列表已锁定，可按 Ctrl+R 手动刷新'
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
        message: '该进程由内核直接托管或路径受权限保护'
      })
      return
    }
    const ok = await openFileLocation(targetPath)
    if (ok) {
      showToast({
        style: Toast.Style.Success,
        title: '已在资源管理器中打开',
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

  const baseFiltered = filterProcesses(processes, searchText, tab, sortBy)
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
    navigationTitle: `进程监控 (${DLL_PLUGIN_NAME})`,
    searchBarPlaceholder: '搜索进程名称、PID、完整路径、厂商或服务描述...',
    onSearchTextChange: setSearchText,
    isShowingDetail: false,
    isLoading,
    searchBarAccessory: List.Dropdown({
      tooltip: '切换进程筛选与排序维度',
      value: viewFilter,
      onChange: (val: string) => setViewFilter(val as ProcessViewFilter),
      children: [
        List.Dropdown.Item({ title: '全部进程 · 按内存排序 (Memory)', value: 'memory' }),
        List.Dropdown.Item({ title: '全部进程 · 按 CPU 排序 (CPU)', value: 'cpu' }),
        List.Dropdown.Item({ title: '仅高负载进程 (High Load)', value: 'high-load' }),
        List.Dropdown.Item({ title: '系统关键服务 (System Services)', value: 'system' }),
        List.Dropdown.Item({ title: '用户应用程序 (User Apps)', value: 'user' }),
        List.Dropdown.Item({ title: '按进程名称排序 (Name A-Z)', value: 'name' }),
        List.Dropdown.Item({ title: '按进程 PID 升序 (PID)', value: 'pid' })
      ]
    }),
    filterBar: {
      summaryText: `CPU 负载 ${totalCpuPercent}% · 物理内存已用 ${formatBytes(usedMem)} / ${formatBytes(totalMem)} (${memPercent}%) · 活动进程 ${filtered.length} 个`,
      actions: [
        {
          id: 'refresh-list',
          label: '刷新列表',
          title: '刷新列表',
          style: 'secondary',
          onAction: () => {
            void refreshData(true)
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
      List.Section({
        title: `活动进程列表 (${filtered.length})`,
        children: filtered.map((proc) => {
          const isCrit = getTerminationRisk(proc.pid, proc.name) === 'forbidden'
          const memVal = proc.workingSetBytes ?? proc.memoryBytes ?? 0
          const memRatio = Math.min(100, Math.max(4, Math.round((memVal / maxMemBytes) * 100)))
          const isHighLoad = proc.cpuPercent >= 25 || memVal >= 1024 * 1024 * 1024
          const procServices = services[proc.pid] || []
          const svcHint = procServices.length > 0 ? `托管服务 ${procServices.length} 项` : ''

          return List.Item({
            id: String(proc.pid),
            title: `${proc.name} [PID: ${proc.pid}]`,
            subtitle: [
              `PID: ${proc.pid}`,
              ...(proc.threadCount ? [`线程 ${proc.threadCount}`] : []),
              ...(svcHint ? [svcHint] : []),
              proc.path || proc.commandLine || '系统内核进程'
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
                        message: '内核进程无具体磁盘文件路径'
                      })
                    }
                  }
                }),
                Action({
                  title: '复制启动命令行 (CommandLine)',
                  icon: Icon.Terminal,
                  onAction: () => {
                    const cmdLine =
                      details[proc.pid]?.commandLine || proc.commandLine || proc.path || proc.name
                    return copyWithToast(cmdLine, '已复制启动命令行', cmdLine)
                  }
                }),
                Action({
                  title: '刷新列表',
                  icon: Icon.ArrowClockwise,
                  shortcut: { modifiers: ['ctrl'], key: 'r' },
                  onAction: () => refreshData(true)
                })
              ]
            })
          })
        })
      })
    ]
  })
}
