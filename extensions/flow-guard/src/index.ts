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
  useLocale
} from '@ztools/declarative-ui'
import { t } from './i18n.js'
import { isRealElectronHost } from './native-ipc.js'
import {
  ProcessNetworkGroup,
  getForbiddenReason,
  getNotInClientMessage,
  fetchFlowGuardSnapshot,
  terminateNetworkProcess,
  openNetworkProcessLocation
} from './logic.js'
import { resolveErrorMessage } from './error-i18n.js'

export * from './logic.js'

type FlowDropdownFilter = 'all' | 'public' | 'lan' | 'listening' | 'processes' | 'tcp' | 'udp'

export default function FlowGuardCommand() {
  useLocale()
  const [searchText, setSearchText] = useState('')
  const [dropdownFilter, setDropdownFilter] = useState<FlowDropdownFilter>('all')
  const [focusPid, setFocusPid] = useState<number>(0)
  const [groups, setGroups] = useState<ProcessNetworkGroup[]>([])
  const [totalEndpoints, setTotalEndpoints] = useState(0)
  const [totalEstablished, setTotalEstablished] = useState(0)
  const [totalListening, setTotalListening] = useState(0)
  const [totalUdp, setTotalUdp] = useState(0)
  const [totalPublic, setTotalPublic] = useState(0)
  const [totalLan, setTotalLan] = useState(0)
  const [totalLoopback, setTotalLoopback] = useState(0)
  const inClient = isRealElectronHost()
  const [isLoading, setIsLoading] = useState(() => inClient)
  const [loadError, setLoadError] = useState('')

  async function refreshConnections(showIndicator = false) {
    if (showIndicator) setIsLoading(true)
    try {
      const snap = await fetchFlowGuardSnapshot()
      setLoadError(snap.error || '')
      if (snap.error) {
        // 读取失败时清空列表，避免把旧数据当成当前连接
        setGroups([])
        setTotalEndpoints(0)
        setTotalEstablished(0)
        setTotalListening(0)
        setTotalUdp(0)
        setTotalPublic(0)
        setTotalLan(0)
        setTotalLoopback(0)
        if (showIndicator) {
          showToast({ style: Toast.Style.Failure, title: t('toastRefreshFailed'), message: snap.error })
        }
        return
      }
      setGroups(snap.groups)
      setTotalEndpoints(snap.totalEndpoints)
      setTotalEstablished(snap.totalEstablished)
      setTotalListening(snap.totalListening)
      setTotalUdp(snap.totalUdp)
      setTotalPublic(snap.totalPublic)
      setTotalLan(snap.totalLan)
      setTotalLoopback(snap.totalLoopback)
      if (showIndicator) {
        showToast({
          style: Toast.Style.Success,
          title: t('toastRefreshedTitle'),
          message: t('toastRefreshedMsg', {
            procs: snap.groups.length,
            publicCount: snap.totalPublic,
            endpoints: snap.totalEndpoints
          })
        })
      }
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    if (!isRealElectronHost()) return
    void refreshConnections(false)
  }, [])

  async function handleKillProcess(group: ProcessNetworkGroup) {
    if (group.isProtected) {
      await confirmAlert({
        title: t('alertProtectedTitle', { name: group.processName }),
        message: `PID: ${group.pid}\n\n${getForbiddenReason()}`,
        primaryAction: { title: t('alertAck'), style: 'default' }
      })
      return
    }

    const confirmed = await confirmAlert({
      title: t('confirmKillTitle', { name: group.processName }),
      message: t('confirmKillMsg', { pid: group.pid, count: group.endpoints.length }),
      primaryAction: { title: t('confirmKillBtn'), style: 'destructive' }
    })
    if (!confirmed) return

    const res = await terminateNetworkProcess(group.pid, group.processName)
    if (!res.ok) {
      showToast({
        style: Toast.Style.Failure,
        title: t('errTerminateFailed'),
        message: resolveErrorMessage(res, t('errTerminateFailed'))
      })
      return
    }

    showToast({
      style: Toast.Style.Success,
      title: res.alreadyExited ? t('toastAlreadyExited') : t('toastKilled'),
      message: `${group.processName} (PID: ${group.pid})`
    })
    void refreshConnections(false)
  }

  async function handleOpenLocation(processPath: string) {
    const ok = await openNetworkProcessLocation(processPath)
    if (!ok) {
      showToast({ style: Toast.Style.Failure, title: t('toastRevealFailed'), message: processPath })
    }
  }

  const q = searchText.trim().toLowerCase()
  const protoFilter = dropdownFilter === 'tcp' ? 'TCP' : dropdownFilter === 'udp' ? 'UDP' : 'ALL'
  const scopeFilter =
    dropdownFilter === 'public' || dropdownFilter === 'lan' || dropdownFilter === 'listening'
      ? dropdownFilter
      : 'all'

  const filteredGroups = groups.filter((g) => {
    if (focusPid > 0 && g.pid !== focusPid) return false
    if (protoFilter === 'TCP' && g.tcpCount === 0) return false
    if (protoFilter === 'UDP' && g.udpCount === 0) return false
    if (scopeFilter === 'public' && g.publicCount === 0) return false
    if (scopeFilter === 'lan' && g.lanCount === 0) return false
    if (scopeFilter === 'listening' && g.listeningCount === 0) return false
    if (!q) return true
    if (
      g.processName.toLowerCase().includes(q) ||
      String(g.pid).includes(q) ||
      g.processPath.toLowerCase().includes(q)
    ) {
      return true
    }
    return g.endpoints.some(
      (ep) =>
        String(ep.localPort).includes(q) ||
        String(ep.remotePort).includes(q) ||
        ep.remoteAddress.toLowerCase().includes(q) ||
        ep.localAddress.toLowerCase().includes(q)
    )
  })

  const allEndpoints = filteredGroups.flatMap((g) =>
    g.endpoints
      .filter((ep) => {
        if (protoFilter !== 'ALL' && ep.protocol !== protoFilter) return false
        if (scopeFilter !== 'all' && ep.remoteScope !== scopeFilter) return false
        return true
      })
      .map((ep) => ({
        ...ep,
        processPath: g.processPath,
        isProtected: g.isProtected,
        groupCount: g.endpoints.length,
        groupRef: g
      }))
  )

  const maxGroupEndpoints = Math.max(1, ...groups.map((g) => g.endpoints.length))

  const displayLoadError = loadError || (inClient ? '' : getNotInClientMessage())

  return List({
    searchBarPlaceholder: t('searchPlaceholder'),
    onSearchTextChange: setSearchText,
    isShowingDetail: false,
    isLoading,
    searchBarAccessory: List.Dropdown({
      tooltip: t('dropdownTooltip'),
      value: dropdownFilter,
      onChange: (val: string) => setDropdownFilter(val as FlowDropdownFilter),
      children: [
        List.Dropdown.Item({ title: t('filterAll'), value: 'all' }),
        List.Dropdown.Item({ title: t('filterPublic'), value: 'public' }),
        List.Dropdown.Item({ title: t('filterLan'), value: 'lan' }),
        List.Dropdown.Item({ title: t('filterListening'), value: 'listening' }),
        List.Dropdown.Item({ title: t('filterTcp'), value: 'tcp' }),
        List.Dropdown.Item({ title: t('filterUdp'), value: 'udp' }),
        List.Dropdown.Item({ title: t('filterProcesses'), value: 'processes' })
      ]
    }),
    filterBar: {
      summaryText: displayLoadError
        ? displayLoadError
        : t('summaryText', {
            total: totalEndpoints,
            tcp: totalEndpoints - totalUdp,
            udp: totalUdp,
            publicCount: totalPublic,
            established: totalEstablished,
            listening: totalListening,
            lan: totalLan,
            loopback: totalLoopback,
            procs: groups.length
          }),
      actions: [
        ...(focusPid > 0
          ? [
              {
                id: 'clear-focus-pid',
                label: t('btnExitFocusPid', { pid: focusPid }),
                title: t('btnExitFocusPid', { pid: focusPid }),
                style: 'secondary' as const,
                onAction: () => {
                  setFocusPid(0)
                }
              }
            ]
          : []),
        {
          id: 'refresh-net',
          label: t('btnRefreshConn'),
          title: t('btnRefreshConn'),
          style: 'secondary',
          onAction: () => void refreshConnections(true)
        }
      ]
    },
    children:
      dropdownFilter === 'processes'
        ? [
            List.Section({
              title: t('secProcAggregate', { count: filteredGroups.length }),
              children: filteredGroups.map((g) => {
                const firstEp = g.endpoints[0]
                const epSummary = firstEp
                  ? `${firstEp.protocol} ${firstEp.localAddress}:${firstEp.localPort} -> ${firstEp.remoteAddress}:${firstEp.remotePort}`
                  : g.processPath || t('localNetService')
                const ratio = Math.min(100, Math.max(5, Math.round((g.endpoints.length / maxGroupEndpoints) * 100)))
                const scopeTag =
                  g.publicCount > 0 ? t('scopePublic') : g.listeningCount > 0 ? t('scopeListening') : t('scopeLan')

                return List.Item({
                  id: `net-proc-${g.pid}`,
                  title: `${g.processName} (PID: ${g.pid})`,
                  subtitle: t('procSubtitle', {
                    summary: epSummary,
                    pub: g.publicCount,
                    lan: g.lanCount,
                    listen: g.listeningCount
                  }),
                  icon: g.isProtected ? Icon.Shield : Icon.Globe,
                  accessories: [
                    { progress: { value: ratio } },
                    {
                      tag: {
                        value: scopeTag,
                        ...(g.publicCount > 25 ? { color: Color.Red } : {})
                      }
                    },
                    { text: `ESTABLISHED ${g.establishedCount} / LISTEN ${g.listeningCount}` }
                  ],
                  actions: ActionPanel({
                    title: `${g.processName} (PID: ${g.pid})`,
                    children: [
                      Action({
                        title: t('actionViewProcConns', { count: g.endpoints.length }),
                        icon: Icon.MagnifyingGlass,
                        onAction: () => {
                          setFocusPid(g.pid)
                          setDropdownFilter('all')
                        }
                      }),
                      Action({
                        title: t('actionKillProcess'),
                        icon: Icon.XMarkCircle,
                        style: 'destructive',
                        shortcut: { modifiers: ['ctrl'], key: 'return' },
                        onAction: () => handleKillProcess(g)
                      }),
                      ...(g.processPath
                        ? [
                            Action({
                              title: t('actionRevealExe'),
                              icon: Icon.Folder,
                              shortcut: { modifiers: ['ctrl'], key: 'o' },
                              onAction: () => handleOpenLocation(g.processPath)
                            })
                          ]
                        : []),
                      Action({
                        title: t('actionCopyAudit'),
                        icon: Icon.Clipboard,
                        shortcut: { modifiers: ['ctrl'], key: 'c' },
                        onAction: async () => {
                          const text = g.endpoints
                            .map(
                              (e) =>
                                `${e.protocol} ${e.localAddress}:${e.localPort} -> ${e.remoteAddress}:${e.remotePort} (${e.state})`
                            )
                            .join('\n')
                          await Clipboard.copy(text)
                          showToast({
                            style: Toast.Style.Success,
                            title: t('toastCopiedAudit'),
                            message: t('toastCopiedAuditMsg', { count: g.endpoints.length })
                          })
                        }
                      }),
                      Action({
                        title: t('btnRefreshConn'),
                        icon: Icon.ArrowClockwise,
                        shortcut: { modifiers: ['ctrl'], key: 'r' },
                        onAction: () => refreshConnections(true)
                      })
                    ]
                  })
                })
              })
            })
          ]
        : [
            List.Section({
              title: t('secEndpointDetails', { count: allEndpoints.length }),
              children: allEndpoints.slice(0, 120).map((ep, idx) => {
                const scopeLabel =
                  ep.remoteScope === 'public'
                    ? t('scopePublic')
                    : ep.remoteScope === 'lan'
                    ? t('scopeLan')
                    : ep.remoteScope === 'loopback'
                    ? t('scopeLoopback')
                    : t('scopeListening')
                const ratio = Math.min(100, Math.max(6, Math.round((ep.groupCount / maxGroupEndpoints) * 100)))

                return List.Item({
                  id: `ep-${idx}-${ep.pid}-${ep.localPort}-${ep.remotePort}`,
                  title: `${ep.processName} (PID: ${ep.pid})`,
                  subtitle: `${ep.protocol} ${ep.localAddress}:${ep.localPort} -> ${ep.remoteAddress}:${ep.remotePort} (${scopeLabel})`,
                  icon: ep.isProtected ? Icon.Shield : Icon.Globe,
                  accessories: [
                    { progress: { value: ratio } },
                    { tag: { value: scopeLabel } },
                    { text: ep.state === 'LISTENING' ? 'LISTEN' : ep.state }
                  ],
                  actions: ActionPanel({
                    title: `${ep.processName} (${ep.localPort})`,
                    children: [
                      Action({
                        title: t('actionKillProcess'),
                        icon: Icon.XMarkCircle,
                        style: 'destructive',
                        onAction: () => handleKillProcess(ep.groupRef)
                      }),
                      Action({
                        title: t('actionCopyTuple'),
                        icon: Icon.Clipboard,
                        shortcut: { modifiers: ['ctrl'], key: 'c' },
                        onAction: async () => {
                          await Clipboard.copy(
                            `${ep.processName} (PID:${ep.pid}) ${ep.protocol} ${ep.localAddress}:${ep.localPort} -> ${ep.remoteAddress}:${ep.remotePort} [${ep.state}]`
                          )
                          showToast({ style: Toast.Style.Success, title: t('toastCopiedTuple') })
                        }
                      }),
                      Action({
                        title: t('actionFilterByProc'),
                        icon: Icon.MagnifyingGlass,
                        onAction: () => {
                          setFocusPid(ep.pid)
                        }
                      }),
                      ...(ep.processPath
                        ? [
                            Action({
                              title: t('actionRevealExe'),
                              icon: Icon.Folder,
                              shortcut: { modifiers: ['ctrl'], key: 'o' },
                              onAction: () => handleOpenLocation(ep.processPath)
                            })
                          ]
                        : []),
                      Action({
                        title: t('btnRefreshConn'),
                        icon: Icon.ArrowClockwise,
                        shortcut: { modifiers: ['ctrl'], key: 'r' },
                        onAction: () => refreshConnections(true)
                      })
                    ]
                  })
                })
              })
            })
          ]
  })
}
