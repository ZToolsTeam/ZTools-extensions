import {
  List,
  ActionPanel,
  Action,
  Icon,
  Color,
  Clipboard,
  useState,
  showToast,
  Toast
} from '@ztools/declarative-ui'
import {
  DLL_PLUGIN_NAME,
  getCapabilityItems,
  filterCapabilityItems,
  invokeNativeCapability,
  type CapabilityActionItem
} from './logic'

export default function WindowManagerCommand() {
  const [searchText, setSearchText] = useState('')
  const [items] = useState<CapabilityActionItem[]>(getCapabilityItems())
  const [lastStatus, setLastStatus] = useState<Record<string, string>>({})

  async function handleExecute(item: CapabilityActionItem) {
    showToast({
      style: Toast.Style.Animated,
      title: `正在执行: ${item.title}`,
      message: `${DLL_PLUGIN_NAME}.${item.method}`
    })

    try {
      const res = await invokeNativeCapability(item.method, item.params)
      if (!res.ok) {
        setLastStatus(prev => ({ ...prev, [item.id]: '执行失败' }))
        showToast({
          style: Toast.Style.Failure,
          title: '执行被拒绝或失败',
          message: res.error || '未知错误'
        })
        return res
      }
      setLastStatus(prev => ({ ...prev, [item.id]: res.fromFallback ? '已就绪(离线预览)' : '执行成功' }))
      showToast({
        style: Toast.Style.Success,
        title: `已完成: ${item.title}`,
        message: `${DLL_PLUGIN_NAME}.${item.method}`
      })
      return res
    } catch (err) {
      setLastStatus(prev => ({ ...prev, [item.id]: '异常拦截' }))
      showToast({
        style: Toast.Style.Failure,
        title: '调用异常',
        message: err instanceof Error ? err.message : String(err)
      })
      throw err
    }
  }

  const filtered = filterCapabilityItems(items, searchText)

  return List({
    searchBarPlaceholder: "搜索窗口句柄与置顶分屏管理器功能或底层指令 (WindowManagerPlugin)...",
    onSearchTextChange: setSearchText,
    children: [
      List.Section({
        title: `窗口句柄与置顶分屏管理器 (${filtered.length}/${items.length})`,
        children: filtered.map(item =>
          List.Item({
            id: item.id,
            title: item.title,
            subtitle: item.subtitle,
            icon: {
              source: Icon.Bolt,
              tintColor: Color.Blue
            },
            accessories: [
              {
                tag: {
                  value: lastStatus[item.id] || item.tag,
                  color: lastStatus[item.id] === '执行失败' || lastStatus[item.id] === '异常拦截'
                    ? Color.Red
                    : Color.Green
                }
              }
            ],
            actions: ActionPanel({
              title: item.title,
              children: [
                Action({
                  title: '立即执行此项操作',
                  icon: Icon.Play,
                  onAction: () => handleExecute(item)
                }),
                Action({
                  title: '复制原生调用指令签名',
                  icon: Icon.Clipboard,
                  shortcut: { modifiers: ['ctrl'], key: 'c' },
                  onAction: () => {
                    const payload = JSON.stringify({ plugin: DLL_PLUGIN_NAME, method: item.method, params: item.params })
                    Clipboard.copy(payload)
                    showToast({
                      style: Toast.Style.Success,
                      title: '已复制调用签名',
                      message: `${DLL_PLUGIN_NAME}.${item.method}`
                    })
                  }
                })
              ]
            })
          })
        )
      })
    ]
  })
}
