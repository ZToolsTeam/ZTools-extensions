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
  normalizeHostPorts,
  isProtectedPid,
  type PortRecord
} from './logic'
import { callHostTransport } from './native-ipc.js'

export default function PortManagerCommand() {
  const [searchText, setSearchText] = useState('')
  const [records, setRecords] = useState<PortRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

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
    if (record.pid <= 0 || isProtectedPid(record.pid)) {
      showToast({
        style: Toast.Style.Failure,
        title: '系统关键进程',
        message: `PID ${record.pid} 受到系统保护，无法终止`
      })
      return
    }
    const res = await callHostTransport<unknown>('process_kill', { pid: record.pid, force: true })
    if (!res.ok) {
      showToast({ style: Toast.Style.Failure, title: '释放端口失败', message: res.error })
      return
    }
    showToast({
      style: Toast.Style.Success,
      title: `已释放端口 :${record.localPort}`,
      message: `已结束 ${record.processName} (PID ${record.pid})`
    })
    await loadPorts()
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
                  onAction: () => {
                    Clipboard.copy(String(rec.localPort))
                    showToast({ style: Toast.Style.Success, title: '已复制端口', message: `:${rec.localPort}` })
                  }
                }),
                Action({
                  title: '复制 PID',
                  icon: Icon.Clipboard,
                  onAction: () => {
                    Clipboard.copy(String(rec.pid))
                    showToast({ style: Toast.Style.Success, title: '已复制 PID', message: String(rec.pid) })
                  }
                }),
                Action({
                  title: '终止占用进程 (释放端口)',
                  icon: Icon.Trash,
                  shortcut: { modifiers: ['ctrl'], key: 'x' },
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
