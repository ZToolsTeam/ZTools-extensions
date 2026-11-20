import {
  List,
  ActionPanel,
  Action,
  Icon,
  useState,
  useEffect,
  showToast,
  Toast,
  confirmAlert,
  useLocale
} from '@ztools/declarative-ui'
import { t } from './i18n.js'
import {
  BoostCandidateItem,
  BoostSnapshot,
  FORBIDDEN_REASON,
  NOT_IN_CLIENT_MESSAGE,
  formatBytes,
  fetchBoostSnapshot,
  terminateBoostProcess,
  selectActionableItems,
  confirmAndExecuteBoost,
  openBoostItemLocation
} from './logic.js'

import { isRealElectronHost } from './native-ipc.js'

export * from './logic.js'

function emptyBoostSnapshot(errors: string[]): BoostSnapshot {
  return {
    totalMemoryBytes: 0,
    usedMemoryBytes: 0,
    memoryUsagePercent: 0,
    startupItemCount: 0,
    candidates: [],
    errors
  }
}

export default function BoostCommand() {
  useLocale()
  const [searchText, setSearchText] = useState('')
  const [tab, setTab] = useState<'all' | 'process' | 'startup_item' | 'temp_cache'>('all')
  const [impactFilter, setImpactFilter] = useState<'all' | 'high' | 'cleanable'>('all')
  const [snapshot, setSnapshot] = useState<BoostSnapshot>(() =>
    emptyBoostSnapshot(isRealElectronHost() ? [] : [t('notInClient')])
  )
  // 扫描后默认不勾选任何项目，由用户自己选择要结束或移走的内容
  const [checkedIds, setCheckedIds] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(() => isRealElectronHost())

  async function refreshBoost(showIndicator = false) {
    if (showIndicator) setIsLoading(true)
    try {
      const snap = await fetchBoostSnapshot()
      setSnapshot(snap)
      setCheckedIds([])
      if (showIndicator) {
        showToast({
          style: snap.errors.length > 0 ? Toast.Style.Failure : Toast.Style.Success,
          title: snap.errors.length > 0 ? t('scanPartialTitle') : t('scanOkTitle'),
          message:
            snap.errors.length > 0
              ? snap.errors.join(t('planJoinSep'))
              : t('scanOkMsg', { total: snap.candidates.length, startup: snap.startupItemCount })
        })
      }
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    if (!isRealElectronHost()) return
    void refreshBoost(false)
  }, [])

  async function handleQuickBoost() {
    if (selectActionableItems(snapshot.candidates, checkedIds).length === 0) {
      showToast({
        style: Toast.Style.Failure,
        title: t('noCheckedTitle'),
        message: t('noCheckedMsg')
      })
      return
    }
    const res = await confirmAndExecuteBoost(snapshot.candidates, checkedIds)
    if (!res) return

    await refreshBoost(false)
    if (res.failed.length === 0) {
      showToast({
        style: Toast.Style.Success,
        title: t('batchSuccessTitle', { count: res.succeeded.length }),
        message: t('batchSuccessMsg', { size: formatBytes(res.handledBytes) })
      })
      return
    }
    const firstErrors = res.failed
      .slice(0, 3)
      .map(f => `${f.item.name}: ${f.error}`)
      .join(t('planJoinSep'))
    showToast({
      style: Toast.Style.Failure,
      title: t('batchPartialTitle', { ok: res.succeeded.length, fail: res.failed.length }),
      message: firstErrors
    })
  }

  async function handleTerminateCandidate(item: BoostCandidateItem) {
    if (!item.pid) return
    if (item.isProtected) {
      showToast({ style: Toast.Style.Failure, title: t('cannotTerminateTitle', { name: item.name }), message: item.lockedReason || t('forbiddenReason') })
      return
    }

    const confirmed = await confirmAlert({
      title: t('confirmKillTitle', { name: item.name }),
      message:
        t('confirmKillMsg', { pid: item.pid, size: formatBytes(item.memoryOrSizeBytes) }) +
        (item.type === 'startup_item' ? t('confirmKillStartupNote') : ''),
      primaryAction: { title: t('confirmKillAction'), style: 'destructive' }
    })
    if (!confirmed) return

    const res = await terminateBoostProcess(item.pid, item.name)
    if (!res.ok) {
      showToast({ style: Toast.Style.Failure, title: t('errTerminateFailed'), message: res.error || t('errTerminateFailed') })
      return
    }
    showToast({
      style: Toast.Style.Success,
      title: res.alreadyExited ? t('procAlreadyExited') : t('procTerminated'),
      message: `${item.name} (PID: ${item.pid})`
    })
    void refreshBoost(false)
  }

  async function handleOpenLocation(item: BoostCandidateItem) {
    const ok = await openBoostItemLocation(item.path)
    if (!ok) {
      showToast({ style: Toast.Style.Failure, title: t('revealFailedTitle'), message: item.path })
    }
  }

  const candidates = snapshot.candidates || []
  const q = searchText.trim().toLowerCase()
  const filtered = candidates
    .filter(c => {
      if (tab !== 'all' && c.type !== tab) return false
      if (impactFilter === 'high' && !c.isHighMemory) return false
      if (impactFilter === 'cleanable' && c.isProtected) return false
      if (!q) return true
      return (
        c.name.toLowerCase().includes(q) ||
        c.path.toLowerCase().includes(q) ||
        String(c.pid || '').includes(q) ||
        (c.startupScope && c.startupScope.toLowerCase().includes(q))
      )
    })
    .sort((a, b) => b.memoryOrSizeBytes - a.memoryOrSizeBytes)

  function toggleSingleBoost(id: string, checked: boolean) {
    setCheckedIds(prev => {
      const set = new Set(prev)
      if (checked) set.add(id)
      else set.delete(id)
      return Array.from(set)
    })
  }

  const maxItemBytes = Math.max(1, filtered[0]?.memoryOrSizeBytes || 1)
  const rightSubListItems = filtered.map(item => {
    const isChecked = !item.isProtected && checkedIds.includes(item.id)
    const volRatio = Math.max(10, Math.min(100, Math.round((item.memoryOrSizeBytes / maxItemBytes) * 100)))
    const typeLabel =
      item.isProtected
        ? t('tagProtected')
        : item.type === 'startup_item'
        ? item.startupScope || t('tagStartup')
        : item.type === 'process'
        ? t('tagProcess')
        : t('tagTempFile')

    return List.Item({
      id: item.id,
      title: item.name,
      subtitle:
        item.type === 'startup_item'
          ? `${item.startupScope || t('tagStartup')} · ${item.recommendation}`
          : item.type === 'process'
          ? `PID: ${item.pid} · ${item.recommendation}`
          : item.path,
      checkable: !item.isProtected,
      checked: isChecked,
      lockedReason: item.isProtected ? item.lockedReason || t('forbiddenReason') : undefined,
      onCheckChange: (c: boolean) => toggleSingleBoost(item.id, c),
      onToggleCheck: (c: boolean) => toggleSingleBoost(item.id, c),
      icon: {
        source: item.isProtected
          ? Icon.Lock
          : item.type === 'startup_item'
          ? Icon.Rocket
          : item.type === 'process'
          ? Icon.Bolt
          : Icon.Trash
      },
      accessories: [
        { progress: { value: volRatio } },
        { tag: { value: typeLabel } },
        { text: formatBytes(item.memoryOrSizeBytes) }
      ],
      actions: ActionPanel({
        title: item.name,
        children: [
          Action({
            title: t('actionProcessChecked'),
            icon: Icon.Bolt,
            onAction: () => handleQuickBoost()
          }),
          ...(item.path
            ? [
                Action({
                  title: t('actionRevealInFolder'),
                  icon: Icon.Folder,
                  onAction: () => handleOpenLocation(item)
                })
              ]
            : []),
          ...(item.pid && !item.isProtected
            ? [
                Action({
                  title: t('actionKillProcess'),
                  icon: Icon.XMarkCircle,
                  style: Action.Style.Destructive,
                  onAction: () => handleTerminateCandidate(item)
                })
              ]
            : [])
        ]
      })
    } as Parameters<typeof List.Item>[0])
  })

  const selectableFiltered = filtered.filter(i => !i.isProtected)
  const checkedInFiltered = selectableFiltered.filter(i => checkedIds.includes(i.id))
  const selectedBytes = checkedInFiltered.reduce((acc, i) => acc + i.memoryOrSizeBytes, 0)
  const allChecked = selectableFiltered.length > 0 && checkedInFiltered.length === selectableFiltered.length
  const someChecked = checkedInFiltered.length > 0 && !allChecked

  const memoryText =
    snapshot.totalMemoryBytes > 0
      ? t('memoryUsageText', {
          pct: snapshot.memoryUsagePercent,
          used: formatBytes(snapshot.usedMemoryBytes),
          total: formatBytes(snapshot.totalMemoryBytes)
        })
      : ''
  const summaryParts = [
    snapshot.errors.join(t('planJoinSep')),
    memoryText,
    t('selectedSummary', { count: checkedInFiltered.length, size: formatBytes(selectedBytes) })
  ].filter(Boolean)

  return List({
    searchBarPlaceholder: t('searchPlaceholder'),
    onSearchTextChange: setSearchText,
    isShowingDetail: false,
    isLoading,
    searchBarAccessory: List.Dropdown({
      tooltip: t('dropdownTooltip'),
      value: impactFilter,
      onChange: val => setImpactFilter(val as 'all' | 'high' | 'cleanable'),
      children: [
        List.Dropdown.Item({ title: t('filterAll', { count: candidates.length }), value: 'all' }),
        List.Dropdown.Item({
          title: t('filterHigh', { count: candidates.filter(c => c.isHighMemory).length }),
          value: 'high'
        }),
        List.Dropdown.Item({
          title: t('filterCleanable', { count: candidates.filter(c => !c.isProtected).length }),
          value: 'cleanable'
        })
      ]
    }),
    filterBar: {
      summaryText: summaryParts.join(' · '),
      actions: [
        {
          id: 'rescan-boost',
          label: t('btnRescan'),
          title: t('btnRescan'),
          style: 'secondary',
          onAction: () => {
            if (!isRealElectronHost()) {
              showToast({ style: Toast.Style.Failure, title: t('cannotScanTitle'), message: t('notInClient') })
              return
            }
            void refreshBoost(true)
          }
        }
      ]
    },
    subList: {
      title: t('subListTitle'),
      subtitle: t('subListSubtitle', {
        total: filtered.length,
        selected: checkedInFiltered.length,
        size: formatBytes(selectedBytes)
      }),
      checkable: selectableFiltered.length > 0,
      checked: allChecked ? true : someChecked ? 'indeterminate' : false,
      onCheckChange: checked => {
        if (checked) {
          const cleanableIds = selectableFiltered.map(i => i.id)
          setCheckedIds(Array.from(new Set([...checkedIds, ...cleanableIds])))
        } else {
          const removeSet = new Set(selectableFiltered.map(i => i.id))
          setCheckedIds(checkedIds.filter(id => !removeSet.has(id)))
        }
      },
      emptyText: snapshot.errors.includes(t('notInClient')) ? t('notInClient') : t('emptyNoItems'),
      items: rightSubListItems
    },
    children: [
      List.Section({
        title: t('sectionCategory'),
        children: [
          List.Item({
            id: 'boost-nav-all',
            title: t('navAllTitle'),
            subtitle: t('navAllSub', { count: candidates.length }),
            icon: { source: Icon.Bolt },
            accessories: [{ text: t('itemCountText', { count: candidates.length }) }],
            onSelect: () => setTab('all')
          }),
          List.Item({
            id: 'boost-nav-process',
            title: t('navProcTitle'),
            subtitle: t('navProcSub'),
            icon: { source: Icon.Cpu },
            accessories: [{ text: t('itemCountText', { count: candidates.filter(c => c.type === 'process').length }) }],
            onSelect: () => setTab('process')
          }),
          List.Item({
            id: 'boost-nav-startup',
            title: t('navStartupTitle'),
            subtitle: t('navStartupSub'),
            icon: { source: Icon.Rocket },
            accessories: [{ text: t('itemCountText', { count: candidates.filter(c => c.type === 'startup_item').length }) }],
            onSelect: () => setTab('startup_item')
          }),
          List.Item({
            id: 'boost-nav-temp',
            title: t('navTempTitle'),
            subtitle: t('navTempSub'),
            icon: { source: Icon.Trash },
            accessories: [{ text: t('itemCountText', { count: candidates.filter(c => c.type === 'temp_cache').length }) }],
            onSelect: () => setTab('temp_cache')
          })
        ]
      })
    ]
  })
}
