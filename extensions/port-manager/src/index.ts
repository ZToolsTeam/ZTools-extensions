import {
  List,
  ActionPanel,
  Action,
  Icon,
  Clipboard,
  useState,
  useEffect,
  useRef,
  showToast,
  Toast,
  confirmAlert
} from '@ztools/declarative-ui'
import {
  normalizeHostPorts,
  getTerminateBlockReason,
  terminatePid,
  type PortRecord
} from './logic.js'
import { callHostTransport } from './native-ipc.js'

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

export default function PortManagerCommand() {
  const [searchText, setSearchText] = useState('')
  const [records, setRecords] = useState<PortRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  // 同一时间只允许一个结束进程流程，防止连按重复弹确认或重复结束
  const terminatingRef = useRef(false)

  async function loadPorts() {
    setLoading(true)
    const res = await callHostTransport<unknown>('process_list_ports', {})
    if (res.ok) {
      setRecords(normalizeHostPorts(res.data))
      setLoadError('')
    } else {
      // 读不到就如实显示读取失败，不拿示例数据充数
      setRecords([])
      setLoadError(res.error || '读取端口列表失败')
      showToast({ style: Toast.Style.Failure, title: '读取端口列表失败', message: res.error })
    }
    setLoading(false)
  }

  useEffect(() => {
    loadPorts()
  }, [])

  async function terminateProcess(record: PortRecord) {
    if (terminatingRef.current) return
    const blocked = getTerminateBlockReason(record)
    if (blocked) {
      showToast({ style: Toast.Style.Failure, title: '不能结束该进程', message: blocked })
      return
    }
    terminatingRef.current = true
    try {
      // 结束进程会丢失该进程未保存的数据，必须由用户确认
      const confirmed = await confirmAlert({
        title: `结束 ${record.processName} (PID ${record.pid})？`,
        message: `它正在占用 ${record.protocol} :${record.localPort}。将请求它正常退出，未保存的数据可能丢失。`,
        primaryAction: { title: '结束进程', style: 'destructive' },
        dismissAction: { title: '取消' }
      })
      if (!confirmed) return
      showToast({ style: Toast.Style.Animated, title: `正在结束 ${record.processName}`, message: `PID ${record.pid}` })
      let res = await terminatePid(record.pid, 'graceful')
      if (!res.ok && res.canForce) {
        // 正常结束超时：不自动升级，强制结束必须再次确认
        const force = await confirmAlert({
          title: `${record.processName} (PID ${record.pid}) 没有响应`,
          message: `${res.error}。强制结束会立即终止它，未保存的数据会丢失。`,
          primaryAction: { title: '强制结束', style: 'destructive' },
          dismissAction: { title: '取消' }
        })
        if (!force) {
          showToast({ style: Toast.Style.Failure, title: '端口未释放', message: '进程仍在运行，已取消强制结束' })
          return
        }
        res = await terminatePid(record.pid, 'force')
      }
      if (!res.ok) {
        showToast({ style: Toast.Style.Failure, title: '释放端口失败', message: res.error })
        return
      }
      showToast({
        style: Toast.Style.Success,
        title: res.alreadyExited ? `${record.processName} 已经退出` : `已结束占用 :${record.localPort} 的进程`,
        message: res.alreadyExited
          ? `PID ${record.pid} 在结束前已退出，已刷新端口列表`
          : `已${res.forced ? '强制' : ''}结束 ${record.processName} (PID ${record.pid})`
      })
      await loadPorts()
    } finally {
      terminatingRef.current = false
    }
  }

  const query = searchText.trim().toLowerCase()
  const filtered = records.filter(r => {
    if (!query) return true
    return (
      r.localPort.toString().includes(query) ||
      r.processName.toLowerCase().includes(query) ||
      r.pid.toString().includes(query) ||
      r.state.toLowerCase().includes(query)
    )
  })

  // 按端口号升序
  filtered.sort((a, b) => a.localPort - b.localPort)

  return List({
    isLoading: loading,
    searchBarPlaceholder: '搜索端口号、PID 或应用名 (如 8080, 5173)...',
    onSearchTextChange: setSearchText,
    children: [
      List.Section({
        title: loadError ? `读取失败：${loadError}` : `占用中的端口 (${filtered.length}/${records.length})`,
        children: filtered.map(rec =>
          List.Item({
            id: rec.id,
            title: `:${rec.localPort}`,
            subtitle: `${rec.processName} (PID: ${rec.pid})`,
            icon: Icon.Plug,
            accessories: [{ tag: { value: rec.protocol } }, { text: rec.localAddress }],
            actions: ActionPanel({
              title: `端口 :${rec.localPort}`,
              children: [
                Action({
                  title: '复制端口号',
                  icon: Icon.Clipboard,
                  onAction: () => copyWithToast(String(rec.localPort), '已复制端口', `:${rec.localPort}`)
                }),
                Action({
                  title: '复制 PID',
                  icon: Icon.Clipboard,
                  onAction: () => copyWithToast(String(rec.pid), '已复制 PID', String(rec.pid))
                }),
                // 破坏性动作不绑快捷键（⌘X / Ctrl+X 是剪切），只能从动作面板选择并经确认后执行
                Action({
                  title: '终止占用进程 (释放端口)',
                  icon: Icon.Trash,
                  style: Action.Style.Destructive,
                  onAction: () => terminateProcess(rec)
                }),
                Action({
                  title: '刷新端口列表',
                  icon: Icon.ArrowClockwise,
                  shortcut: { modifiers: ['ctrl'], key: 'r' },
                  onAction: loadPorts
                })
              ]
            })
          })
        )
      })
    ]
  })
}
