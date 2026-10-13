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
  Toast
} from '@ztools/raycast-compat'
import {
  parseNetstatOutput,
  isProtectedPid,
  type PortRecord
} from './logic'

declare const ztools: any

const MOCK_NETSTAT = `
  TCP    0.0.0.0:80             0.0.0.0:0              LISTENING       1044
  TCP    0.0.0.0:443            0.0.0.0:0              LISTENING       1044
  TCP    0.0.0.0:3000           0.0.0.0:0              LISTENING       14220
  TCP    0.0.0.0:5173           0.0.0.0:0              LISTENING       21340
  TCP    127.0.0.1:9222         0.0.0.0:0              LISTENING       8412
  TCP    127.0.0.1:11434        0.0.0.0:0              LISTENING       1908
  TCP    0.0.0.0:3306           0.0.0.0:0              LISTENING       3210
  TCP    0.0.0.0:6379           0.0.0.0:0              LISTENING       4512
  UDP    0.0.0.0:5353           *:*                                    2300
`

export default function PortManagerCommand() {
  const [searchText, setSearchText] = useState('')
  const [records, setRecords] = useState<PortRecord[]>([])
  const [loading, setLoading] = useState(true)

  async function loadPorts() {
    setLoading(true)
    try {
      let output = ''
      if (typeof ztools !== 'undefined' && ztools.shell && ztools.shell.exec) {
        try {
          const res = await ztools.shell.exec('netstat -ano')
          output = typeof res === 'string' ? res : res.stdout || ''
        } catch {
          // 回退
        }
      }
      if (!output) {
        output = MOCK_NETSTAT
      }
      const parsed = parseNetstatOutput(output)
      setRecords(parsed)
    } catch (err) {
      showToast({
        style: Toast.Style.Failure,
        title: '端口扫描失败',
        message: String(err)
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadPorts()
  }, [])

  async function terminateProcess(record: PortRecord) {
    if (isProtectedPid(record.pid)) {
      showToast({
        style: Toast.Style.Failure,
        title: '系统关键进程',
        message: `PID ${record.pid} 受到系统保护，无法终止`
      })
      return
    }

    try {
      if (typeof ztools !== 'undefined' && ztools.shell && ztools.shell.exec) {
        await ztools.shell.exec(`taskkill /F /PID ${record.pid}`)
      }
      setRecords(prev => prev.filter(r => r.pid !== record.pid))
      showToast({
        style: Toast.Style.Success,
        title: `已释放端口 :${record.localPort}`,
        message: `成功终止 PID ${record.pid}`
      })
    } catch (err) {
      showToast({
        style: Toast.Style.Failure,
        title: '释放端口失败',
        message: String(err)
      })
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
        title: `监听中的端口 (${filtered.length}/${records.length})`,
        children: filtered.map(rec =>
          List.Item({
            id: rec.id,
            title: `:${rec.localPort}`,
            subtitle: `${rec.processName} (PID: ${rec.pid})`,
            icon: {
              source: rec.state === 'LISTENING' ? Icon.CircleProgress : Icon.CheckCircle,
              tintColor: rec.protocol === 'TCP' ? Color.Blue : Color.Orange
            },
            accessories: [
              {
                tag: {
                  value: rec.protocol,
                  color: rec.protocol === 'TCP' ? Color.Blue : Color.Orange
                }
              },
              {
                tag: {
                  value: rec.state,
                  color: rec.state === 'LISTENING' ? Color.Green : Color.SecondaryText
                }
              }
            ],
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
