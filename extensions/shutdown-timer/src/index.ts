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
} from '@ztools/declarative-ui'
import {
  getCommandForAction,
  calculateTargetTime,
  getQuickScheduleOptions,
  type QuickScheduleItem
} from './logic'

declare const ztools: any

export default function ShutdownTimerCommand() {
  const [searchText, setSearchText] = useState('')
  const [options] = useState<QuickScheduleItem[]>(getQuickScheduleOptions())

  async function executeSchedule(item: QuickScheduleItem) {
    const cmd = getCommandForAction(item.action, item.seconds)
    try {
      if (typeof ztools !== 'undefined' && ztools.shell && ztools.shell.exec) {
        await ztools.shell.exec(cmd)
      }
      
      if (item.action === 'cancel') {
        showToast({
          style: Toast.Style.Success,
          title: '已取消关机任务',
          message: '系统当前排队的关机/重启计划已清除'
        })
      } else if (item.action === 'shutdown' || item.action === 'reboot') {
        const target = calculateTargetTime(item.seconds)
        showToast({
          style: Toast.Style.Success,
          title: `已设定${item.action === 'shutdown' ? '关机' : '重启'}任务`,
          message: `预计将在 ${target} 执行 (命令行: ${cmd})`
        })
      } else {
        showToast({
          style: Toast.Style.Success,
          title: `已触发 ${item.title}`
        })
      }
    } catch (err) {
      showToast({
        style: Toast.Style.Failure,
        title: '执行失败',
        message: String(err)
      })
    }
  }

  const query = searchText.trim().toLowerCase()
  const filtered = options.filter(item => {
    if (!query) return true
    return (
      item.title.toLowerCase().includes(query) ||
      item.subtitle.toLowerCase().includes(query) ||
      item.description.toLowerCase().includes(query)
    )
  })

  function getIconForAction(action: QuickScheduleItem['action']) {
    switch (action) {
      case 'shutdown':
        return { source: Icon.Power, tintColor: Color.Red }
      case 'reboot':
        return { source: Icon.ArrowClockwise, tintColor: Color.Orange }
      case 'lock':
        return { source: Icon.Lock, tintColor: Color.Blue }
      case 'sleep':
        return { source: Icon.Moon, tintColor: Color.Purple }
      case 'cancel':
        return { source: Icon.XMarkCircle, tintColor: Color.Green }
      default:
        return { source: Icon.Circle, tintColor: Color.SecondaryText }
    }
  }

  return List({
    searchBarPlaceholder: '搜索电源动作 (如 关机, 30, 重启, 锁屏, 取消)...',
    onSearchTextChange: setSearchText,
    children: [
      List.Section({
        title: `快捷电源任务 (${filtered.length})`,
        children: filtered.map(item =>
          List.Item({
            id: item.id,
            title: item.title,
            subtitle: item.subtitle,
            icon: getIconForAction(item.action),
            accessories: [
              {
                text: item.description
              }
            ],
            actions: ActionPanel({
              title: item.title,
              children: [
                Action({
                  title: '立即设定/执行',
                  icon: Icon.CheckCircle,
                  onAction: () => executeSchedule(item)
                }),
                Action({
                  title: '复制系统命令',
                  icon: Icon.Clipboard,
                  shortcut: { modifiers: ['ctrl'], key: 'c' },
                  onAction: () => {
                    const cmd = getCommandForAction(item.action, item.seconds)
                    Clipboard.copy(cmd)
                    showToast({
                      style: Toast.Style.Success,
                      title: '已复制命令',
                      message: cmd
                    })
                  }
                }),
                Action({
                  title: '取消当前关机计划',
                  icon: Icon.XMarkCircle,
                  shortcut: { modifiers: ['ctrl'], key: 'a' },
                  onAction: () => {
                    const cancelItem = options.find(o => o.action === 'cancel')
                    if (cancelItem) executeSchedule(cancelItem)
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
