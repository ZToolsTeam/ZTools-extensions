import {
  List,
  ActionPanel,
  Action,
  Icon,
  Clipboard,
  useState,
  showToast,
  Toast
} from '@ztools/declarative-ui'
import {
  CANCEL_COMMAND,
  executePowerAction,
  getCommandForAction,
  getQuickScheduleOptions,
  type QuickScheduleItem
} from './logic.js'

export * from './logic.js'

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

async function runPowerAction(item: QuickScheduleItem): Promise<void> {
  const res = await executePowerAction(item)
  if (res.canceled) {
    await showToast({ style: Toast.Style.Animated, title: '已取消', message: res.message })
    return
  }
  await showToast(
    res.ok
      ? { style: Toast.Style.Success, title: res.message, message: res.detail }
      : {
          style: Toast.Style.Failure,
          title: `${item.title}失败`,
          message: res.detail ? `${res.message}；${res.detail}` : res.message
        }
  )
}

function iconFor(action: QuickScheduleItem['action']): Icon {
  switch (action) {
    case 'shutdown':
      return Icon.Power
    case 'lock':
      return Icon.Lock
    case 'sleep':
      return Icon.Moon
    default:
      return Icon.XMarkCircle
  }
}

function actionsFor(item: QuickScheduleItem) {
  if (item.action === 'cancel') {
    return [
      Action({
        title: '复制取消命令',
        icon: Icon.Clipboard,
        onAction: () => copyWithToast(CANCEL_COMMAND, '已复制取消命令', '在命令提示符中运行即可取消已设定的关机')
      })
    ]
  }
  if (item.action === 'shutdown') {
    const cmd = getCommandForAction(item.action, item.seconds)
    return [
      Action({ title: '设定定时关机（需确认）', icon: Icon.Power, onAction: () => runPowerAction(item) }),
      Action({
        title: '复制等价命令',
        icon: Icon.Clipboard,
        shortcut: { modifiers: ['ctrl'], key: 'return' },
        onAction: () => copyWithToast(cmd, '已复制命令', cmd)
      })
    ]
  }
  return [Action({ title: item.title, icon: iconFor(item.action), onAction: () => runPowerAction(item) })]
}

const SECTIONS: Array<{ title: string; actions: QuickScheduleItem['action'][] }> = [
  { title: '定时关机', actions: ['shutdown'] },
  { title: '立即执行', actions: ['lock', 'sleep'] },
  { title: '取消关机计划', actions: ['cancel'] }
]

export default function ShutdownTimerCommand() {
  const [searchText, setSearchText] = useState('')
  const [options] = useState<QuickScheduleItem[]>(getQuickScheduleOptions())

  const query = searchText.trim().toLowerCase()
  const filtered = options.filter(
    (item) => !query || item.title.toLowerCase().includes(query) || item.subtitle.toLowerCase().includes(query)
  )

  return List({
    searchBarPlaceholder: '搜索电源动作，如 关机、30、锁屏、取消',
    onSearchTextChange: setSearchText,
    children: SECTIONS.map((section) => {
      const items = filtered.filter((item) => section.actions.includes(item.action))
      return items.length === 0
        ? null
        : List.Section({
            title: section.title,
            children: items.map((item) =>
              List.Item({
                id: item.id,
                title: item.title,
                subtitle: item.subtitle,
                icon: iconFor(item.action),
                accessories:
                  item.action === 'shutdown'
                    ? [{ tag: { value: '执行前确认' } }]
                    : item.action === 'cancel'
                    ? [{ tag: { value: '复制命令' } }]
                    : [],
                actions: ActionPanel({ title: item.title, children: actionsFor(item) })
              })
            )
          })
    }).filter((section) => section !== null)
  })
}
