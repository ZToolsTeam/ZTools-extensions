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
  parseIpconfigAll,
  getSampleAdapters,
  type AdapterInfo
} from './logic'

declare const ztools: any

export default function NetworkAdapterCommand() {
  const [searchText, setSearchText] = useState('')
  const [adapters, setAdapters] = useState<AdapterInfo[]>([])
  const [loading, setLoading] = useState(true)

  async function loadAdapters() {
    setLoading(true)
    try {
      let output = ''
      if (typeof ztools !== 'undefined' && ztools.shell && ztools.shell.exec) {
        try {
          const res = await ztools.shell.exec('ipconfig /all')
          output = typeof res === 'string' ? res : res.stdout || ''
        } catch {
          // 回退
        }
      }
      if (!output) {
        setAdapters(getSampleAdapters())
      } else {
        const parsed = parseIpconfigAll(output)
        setAdapters(parsed.length > 0 ? parsed : getSampleAdapters())
      }
    } catch (err) {
      showToast({
        style: Toast.Style.Failure,
        title: '获取网络配置失败',
        message: String(err)
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadAdapters()
  }, [])

  const query = searchText.trim().toLowerCase()
  const filtered = adapters.filter(a => {
    if (!query) return true
    return (
      a.name.toLowerCase().includes(query) ||
      a.description.toLowerCase().includes(query) ||
      a.ipv4.toLowerCase().includes(query) ||
      a.mac.toLowerCase().includes(query)
    )
  })

  return List({
    isLoading: loading,
    searchBarPlaceholder: '搜索网卡名称、IP 地址或 MAC (如 wlan, 192.168)...',
    onSearchTextChange: setSearchText,
    children: [
      List.Section({
        title: `网络适配器 (${filtered.length}/${adapters.length})`,
        children: filtered.map(item =>
          List.Item({
            id: item.id,
            title: item.name,
            subtitle: `IP: ${item.ipv4} | 网关: ${item.gateway} | MAC: ${item.mac}`,
            icon: {
              source: Icon.Wifi,
              tintColor: item.status === 'connected' ? Color.Green : Color.SecondaryText
            },
            accessories: [
              {
                tag: {
                  value: item.status === 'connected' ? '已连接' : '已断开',
                  color: item.status === 'connected' ? Color.Green : Color.SecondaryText
                }
              }
            ],
            actions: ActionPanel({
              title: item.name,
              children: [
                Action({
                  title: '复制 IPv4 地址',
                  icon: Icon.Clipboard,
                  onAction: () => {
                    Clipboard.copy(item.ipv4)
                    showToast({
                      style: Toast.Style.Success,
                      title: '已复制 IPv4',
                      message: item.ipv4
                    })
                  }
                }),
                Action({
                  title: '复制 MAC 物理地址',
                  icon: Icon.Clipboard,
                  shortcut: { modifiers: ['ctrl'], key: 'm' },
                  onAction: () => {
                    Clipboard.copy(item.mac)
                    showToast({
                      style: Toast.Style.Success,
                      title: '已复制 MAC 地址',
                      message: item.mac
                    })
                  }
                }),
                Action({
                  title: '复制默认网关',
                  icon: Icon.Clipboard,
                  shortcut: { modifiers: ['ctrl'], key: 'g' },
                  onAction: () => {
                    Clipboard.copy(item.gateway)
                    showToast({
                      style: Toast.Style.Success,
                      title: '已复制网关',
                      message: item.gateway
                    })
                  }
                }),
                Action({
                  title: '刷新网络配置',
                  icon: Icon.ArrowClockwise,
                  shortcut: { modifiers: ['ctrl'], key: 'r' },
                  onAction: loadAdapters
                })
              ]
            })
          })
        )
      })
    ]
  })
}
