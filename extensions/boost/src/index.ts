import {
  List,
  ActionPanel,
  Action,
  Icon,
  useState,
  useEffect,
  showToast,
  Toast,
  confirmAlert
} from '@ztools/declarative-ui'
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
  const [searchText, setSearchText] = useState('')
  const [tab, setTab] = useState<'all' | 'process' | 'startup_item' | 'temp_cache'>('all')
  const [impactFilter, setImpactFilter] = useState<'all' | 'high' | 'cleanable'>('all')
  const [snapshot, setSnapshot] = useState<BoostSnapshot>(() =>
    emptyBoostSnapshot(isRealElectronHost() ? [] : [NOT_IN_CLIENT_MESSAGE])
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
          title: snap.errors.length > 0 ? '扫描完成，部分内容读取失败' : '扫描完成',
          message:
            snap.errors.length > 0
              ? snap.errors.join('；')
              : `共 ${snap.candidates.length} 项 · 启动项 ${snap.startupItemCount} 项`
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
        title: '没有勾选可处理的项目',
        message: '先勾选要处理的项目（受保护的项目不能勾选），再按 Enter'
      })
      return
    }
    const res = await confirmAndExecuteBoost(snapshot.candidates, checkedIds)
    if (!res) return

    await refreshBoost(false)
    if (res.failed.length === 0) {
      showToast({
        style: Toast.Style.Success,
        title: `已处理 ${res.succeeded.length} 个项目`,
        message: `合计 ${formatBytes(res.handledBytes)}`
      })
      return
    }
    const firstErrors = res.failed
      .slice(0, 3)
      .map(f => `${f.item.name}：${f.error}`)
      .join('；')
    showToast({
      style: Toast.Style.Failure,
      title: `${res.succeeded.length} 项已处理，${res.failed.length} 项失败`,
      message: firstErrors
    })
  }

  async function handleTerminateCandidate(item: BoostCandidateItem) {
    if (!item.pid) return
    if (item.isProtected) {
      showToast({ style: Toast.Style.Failure, title: `不能结束 ${item.name}`, message: item.lockedReason || FORBIDDEN_REASON })
      return
    }

    const confirmed = await confirmAlert({
      title: `强制结束 ${item.name}？`,
      message:
        `PID ${item.pid}，当前占用 ${formatBytes(item.memoryOrSizeBytes)}。会立即强制结束该进程，进程里未保存的内容会丢失。` +
        (item.type === 'startup_item' ? '\n\n结束进程只影响本次运行，不会取消它的开机启动。' : ''),
      primaryAction: { title: '强制结束', style: 'destructive' }
    })
    if (!confirmed) return

    const res = await terminateBoostProcess(item.pid, item.name)
    if (!res.ok) {
      showToast({ style: Toast.Style.Failure, title: '结束进程失败', message: res.error || '结束进程失败' })
      return
    }
    showToast({
      style: Toast.Style.Success,
      title: res.alreadyExited ? '进程已经退出' : '已结束进程',
      message: `${item.name} (PID: ${item.pid})`
    })
    void refreshBoost(false)
  }

  async function handleOpenLocation(item: BoostCandidateItem) {
    const ok = await openBoostItemLocation(item.path)
    if (!ok) {
      showToast({ style: Toast.Style.Failure, title: '无法在资源管理器中定位', message: item.path })
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
        ? '受保护'
        : item.type === 'startup_item'
        ? item.startupScope || '开机启动项'
        : item.type === 'process'
        ? '进程'
        : '临时文件'

    return List.Item({
      id: item.id,
      title: item.name,
      subtitle:
        item.type === 'startup_item'
          ? `${item.startupScope || '开机启动项'} · ${item.recommendation}`
          : item.type === 'process'
          ? `PID: ${item.pid} · ${item.recommendation}`
          : item.path,
      checkable: !item.isProtected,
      checked: isChecked,
      lockedReason: item.isProtected ? item.lockedReason || FORBIDDEN_REASON : undefined,
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
            title: '处理已勾选的项目',
            icon: Icon.Bolt,
            onAction: () => handleQuickBoost()
          }),
          ...(item.path
            ? [
                Action({
                  title: '在资源管理器中定位',
                  icon: Icon.Folder,
                  onAction: () => handleOpenLocation(item)
                })
              ]
            : []),
          ...(item.pid && !item.isProtected
            ? [
                Action({
                  title: '结束该进程',
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
      ? `内存已用 ${snapshot.memoryUsagePercent}% (${formatBytes(snapshot.usedMemoryBytes)}/${formatBytes(snapshot.totalMemoryBytes)})`
      : ''
  const summaryParts = [
    snapshot.errors.join('；'),
    memoryText,
    `已勾选 ${checkedInFiltered.length} 项（合计 ${formatBytes(selectedBytes)}）`
  ].filter(Boolean)

  return List({
    searchBarPlaceholder: '搜索进程、启动项、PID 或临时文件...',
    onSearchTextChange: setSearchText,
    isShowingDetail: false,
    isLoading,
    searchBarAccessory: List.Dropdown({
      tooltip: '筛选项目',
      value: impactFilter,
      onChange: val => setImpactFilter(val as 'all' | 'high' | 'cleanable'),
      children: [
        List.Dropdown.Item({ title: `全部项目 (${candidates.length})`, value: 'all' }),
        List.Dropdown.Item({
          title: `内存占用高 (${candidates.filter(c => c.isHighMemory).length})`,
          value: 'high'
        }),
        List.Dropdown.Item({
          title: `可处理的项目 (${candidates.filter(c => !c.isProtected).length})`,
          value: 'cleanable'
        })
      ]
    }),
    filterBar: {
      summaryText: summaryParts.join(' · '),
      actions: [
        {
          id: 'rescan-boost',
          label: '重新扫描',
          title: '重新扫描',
          style: 'secondary',
          onAction: () => {
            if (!isRealElectronHost()) {
              showToast({ style: Toast.Style.Failure, title: '无法扫描', message: NOT_IN_CLIENT_MESSAGE })
              return
            }
            void refreshBoost(true)
          }
        }
      ]
    },
    subList: {
      title: '进程、启动项与临时文件（按占用降序，勾选后按 Enter 处理）',
      subtitle: `${filtered.length} 项 · 已选 ${checkedInFiltered.length} 项 (${formatBytes(selectedBytes)})`,
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
      emptyText: snapshot.errors.includes(NOT_IN_CLIENT_MESSAGE) ? NOT_IN_CLIENT_MESSAGE : '当前分类下没有项目',
      items: rightSubListItems
    },
    children: [
      List.Section({
        title: '分类',
        children: [
          List.Item({
            id: 'boost-nav-all',
            title: '全部项目',
            subtitle: `共 ${candidates.length} 项`,
            icon: { source: Icon.Bolt },
            accessories: [{ text: `${candidates.length} 项` }],
            onSelect: () => setTab('all')
          }),
          List.Item({
            id: 'boost-nav-process',
            title: '内存占用最高的进程',
            subtitle: '结束进程可释放内存，未保存的内容会丢失',
            icon: { source: Icon.Cpu },
            accessories: [{ text: `${candidates.filter(c => c.type === 'process').length} 项` }],
            onSelect: () => setTab('process')
          }),
          List.Item({
            id: 'boost-nav-startup',
            title: '“启动”文件夹与常驻进程',
            subtitle: '用户与公共“启动”文件夹，以及按名称判断的常驻进程',
            icon: { source: Icon.Rocket },
            accessories: [{ text: `${candidates.filter(c => c.type === 'startup_item').length} 项` }],
            onSelect: () => setTab('startup_item')
          }),
          List.Item({
            id: 'boost-nav-temp',
            title: '临时文件',
            subtitle: '临时文件夹（%TEMP%）里较大的文件',
            icon: { source: Icon.Trash },
            accessories: [{ text: `${candidates.filter(c => c.type === 'temp_cache').length} 项` }],
            onSelect: () => setTab('temp_cache')
          })
        ]
      })
    ]
  })
}
