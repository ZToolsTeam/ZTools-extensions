import {
  List,
  ActionPanel,
  Action,
  Icon,
  Clipboard,
  useState,
  useEffect,
  showToast,
  Toast
} from '@ztools/declarative-ui'
import {
  type WechatInstanceItem,
  LAUNCH_LIMIT_NOTE,
  formatBytes,
  fetchWechatInstances,
  launchWechatAgain,
  filterWechatInstances
} from './logic.js'

export * from './logic.js'

async function copyWithToast(text: string, successTitle: string): Promise<void> {
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
  await showToast({ style: Toast.Style.Success, title: successTitle, message: text })
}

export function WechatMultiCommand() {
  const [searchText, setSearchText] = useState('')
  const [instances, setInstances] = useState<WechatInstanceItem[]>([])
  const [installPath, setInstallPath] = useState('')
  const [loadError, setLoadError] = useState('')
  const [warning, setWarning] = useState('')
  const [isLoading, setIsLoading] = useState(true)

  async function refreshInstances(showNotice = false) {
    setIsLoading(true)
    try {
      const snap = await fetchWechatInstances()
      setInstances(snap.instances)
      setInstallPath(snap.installPath)
      setLoadError(snap.ok ? '' : snap.error || '读取微信进程失败')
      setWarning(snap.warning || '')
      if (!snap.ok) {
        if (showNotice) await showToast({ style: Toast.Style.Failure, title: '读取微信进程失败', message: snap.error })
      } else if (showNotice) {
        await showToast({ style: Toast.Style.Success, title: '已刷新', message: `运行中的微信进程 ${snap.instances.length} 个` })
      }
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void refreshInstances(false)
  }, [])

  async function handleLaunch() {
    const res = await launchWechatAgain()
    if (!res.ok) {
      await showToast({ style: Toast.Style.Failure, title: '启动微信失败', message: res.message })
      return
    }
    await showToast({ style: Toast.Style.Success, title: res.message, message: LAUNCH_LIMIT_NOTE })
    await refreshInstances(false)
  }

  const filtered = filterWechatInstances(instances, searchText)
  const query = searchText.trim()
  const showLaunchRow = !loadError && (!query || '再运行一次微信'.includes(query) || '启动'.includes(query))

  const launchRow = List.Item({
    id: 'wx-launch',
    title: '再运行一次微信',
    subtitle: installPath ? `${installPath} · ${LAUNCH_LIMIT_NOTE}` : '未检测到微信安装位置，启动时会提示失败原因',
    icon: Icon.Plus,
    actions: ActionPanel({
      title: '再运行一次微信',
      children: [Action({ title: '再运行一次微信', icon: Icon.Plus, onAction: () => handleLaunch() })]
    })
  })

  const statusRow = List.Item({
    id: 'wx-status',
    title: '读取微信进程失败',
    subtitle: loadError,
    icon: Icon.ExclamationMark,
    actions: ActionPanel({
      title: '读取微信进程失败',
      children: [Action({ title: '重新读取', icon: Icon.ArrowClockwise, onAction: () => refreshInstances(true) })]
    })
  })

  const instanceRows = filtered.map((item) =>
    List.Item({
      id: item.id,
      title: item.name,
      subtitle: item.startTime ? `PID ${item.pid} · 启动于 ${item.startTime}` : `PID ${item.pid}`,
      icon: Icon.AppWindow,
      accessories: item.memoryBytes > 0 ? [{ text: formatBytes(item.memoryBytes) }] : [],
      actions: ActionPanel({
        title: `${item.name} (PID ${item.pid})`,
        children: [
          Action({
            title: '复制 PID',
            icon: Icon.Clipboard,
            onAction: () => copyWithToast(String(item.pid), '已复制 PID')
          })
        ]
      })
    })
  )

  return List({
    navigationTitle: '微信多开',
    searchBarPlaceholder: '搜索微信进程名或 PID',
    onSearchTextChange: setSearchText,
    isShowingDetail: false,
    isLoading,
    filterBar: {
      summaryText: loadError
        ? `读取失败：${loadError}`
        : `运行中的 WeChat / Weixin 进程 ${instances.length} 个（同一个微信也可能有多个同名进程）${warning ? ` · ${warning}` : ''}`,
      actions: [
        {
          id: 'refresh-wx',
          label: '刷新',
          title: '刷新',
          style: 'secondary',
          onAction: () => void refreshInstances(true)
        }
      ]
    },
    children: [
      List.Section({
        title: '操作',
        children: loadError ? [statusRow] : showLaunchRow ? [launchRow] : []
      }),
      List.Section({
        title: `正在运行的微信 (${filtered.length})`,
        children: instanceRows
      })
    ]
  })
}

export default WechatMultiCommand
