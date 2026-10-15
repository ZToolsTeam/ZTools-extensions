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
  getRescueActions,
  getFullRescueScript,
  type RescueAction
} from './logic'

declare const ztools: any

export default function NetworkRescueCommand() {
  const [searchText, setSearchText] = useState('')
  const [actions] = useState<RescueAction[]>(getRescueActions())

  async function executeRescue(action: RescueAction) {
    showToast({
      style: Toast.Style.Animated,
      title: '正在执行修复...',
      message: action.command
    })

    try {
      if (typeof ztools !== 'undefined' && ztools.shell && ztools.shell.exec) {
        await ztools.shell.exec(action.command)
      }
      showToast({
        style: Toast.Style.Success,
        title: `已成功执行: ${action.title}`,
        message: action.command
      })
    } catch (err) {
      showToast({
        style: Toast.Style.Failure,
        title: '执行失败',
        message: String(err)
      })
    }
  }

  async function executeFullRescue() {
    const fullCmd = getFullRescueScript()
    showToast({
      style: Toast.Style.Animated,
      title: '正在执行一键全面急救...',
      message: fullCmd
    })

    try {
      if (typeof ztools !== 'undefined' && ztools.shell && ztools.shell.exec) {
        await ztools.shell.exec(fullCmd)
      }
      showToast({
        style: Toast.Style.Success,
        title: '网络急救流程已全部执行完毕',
        message: '若仍存在异常，建议重启计算机生效'
      })
    } catch (err) {
      showToast({
        style: Toast.Style.Failure,
        title: '急救失败',
        message: String(err)
      })
    }
  }

  const query = searchText.trim().toLowerCase()
  const filtered = actions.filter(a => {
    if (!query) return true
    return (
      a.title.toLowerCase().includes(query) ||
      a.command.toLowerCase().includes(query) ||
      a.symptom.toLowerCase().includes(query)
    )
  })

  return List({
    searchBarPlaceholder: '搜索网络故障或命令 (如 dns, winsock, ip)...',
    onSearchTextChange: setSearchText,
    children: [
      List.Section({
        title: `急救修复动作 (${filtered.length})`,
        children: filtered.map(item =>
          List.Item({
            id: item.id,
            title: item.title,
            subtitle: `命令: ${item.command} | 适用: ${item.symptom}`,
            icon: {
              source: Icon.WrenchScrewdriver,
              tintColor: item.requiresAdmin ? Color.Red : Color.Blue
            },
            accessories: [
              {
                tag: {
                  value: item.requiresAdmin ? '需管理员' : '普通权限',
                  color: item.requiresAdmin ? Color.Red : Color.Green
                }
              }
            ],
            actions: ActionPanel({
              title: item.title,
              children: [
                Action({
                  title: '立即执行此项修复',
                  icon: Icon.CheckCircle,
                  onAction: () => executeRescue(item)
                }),
                Action({
                  title: '一键全面急救 (全量执行)',
                  icon: Icon.Bolt,
                  shortcut: { modifiers: ['ctrl'], key: 'a' },
                  onAction: executeFullRescue
                }),
                Action({
                  title: '复制系统命令',
                  icon: Icon.Clipboard,
                  shortcut: { modifiers: ['ctrl'], key: 'c' },
                  onAction: () => {
                    Clipboard.copy(item.command)
                    showToast({
                      style: Toast.Style.Success,
                      title: '已复制命令',
                      message: item.command
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
