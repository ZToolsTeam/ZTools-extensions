import {
  List,
  ActionPanel,
  Action,
  Icon,
  Clipboard,
  useState,
  useLocale,
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
import { t } from './i18n.js'

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
      title: t('copyFailedTitle'),
      message: err instanceof Error ? err.message : String(err)
    })
    return
  }
  await showToast({ style: Toast.Style.Success, title: successTitle, message: successMessage })
}

async function runPowerAction(item: QuickScheduleItem): Promise<void> {
  const res = await executePowerAction(item)
  if (res.canceled) {
    await showToast({ style: Toast.Style.Animated, title: t('canceledTitle'), message: res.message })
    return
  }
  await showToast(
    res.ok
      ? { style: Toast.Style.Success, title: res.message, message: res.detail }
      : {
          style: Toast.Style.Failure,
          title: t('actionFailedTitle', { title: item.title }),
          message: res.detail ? t('detailJoin', { message: res.message, detail: res.detail }) : res.message
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
        title: t('copyCancelCmdAction'),
        icon: Icon.Clipboard,
        onAction: () => copyWithToast(CANCEL_COMMAND, t('copiedCancelCmdTitle'), t('copiedCancelCmdMessage'))
      })
    ]
  }
  if (item.action === 'shutdown') {
    const cmd = getCommandForAction(item.action, item.seconds)
    return [
      Action({ title: t('scheduleShutdownAction'), icon: Icon.Power, onAction: () => runPowerAction(item) }),
      Action({
        title: t('copyEquivalentCmdAction'),
        icon: Icon.Clipboard,
        shortcut: { modifiers: ['ctrl'], key: 'return' },
        onAction: () => copyWithToast(cmd, t('copiedCmdTitle'), cmd)
      })
    ]
  }
  return [Action({ title: item.title, icon: iconFor(item.action), onAction: () => runPowerAction(item) })]
}

const SECTION_SPECS: Array<{ titleKey: 'sectionShutdown' | 'sectionImmediate' | 'sectionCancel'; actions: QuickScheduleItem['action'][] }> = [
  { titleKey: 'sectionShutdown', actions: ['shutdown'] },
  { titleKey: 'sectionImmediate', actions: ['lock', 'sleep'] },
  { titleKey: 'sectionCancel', actions: ['cancel'] }
]

export default function ShutdownTimerCommand() {
  useLocale()
  const [searchText, setSearchText] = useState('')
  const options = getQuickScheduleOptions()

  const query = searchText.trim().toLowerCase()
  const filtered = options.filter(
    (item) => !query || item.title.toLowerCase().includes(query) || item.subtitle.toLowerCase().includes(query)
  )

  return List({
    searchBarPlaceholder: t('searchPlaceholder'),
    onSearchTextChange: setSearchText,
    children: SECTION_SPECS.map((section) => {
      const items = filtered.filter((item) => section.actions.includes(item.action))
      return items.length === 0
        ? null
        : List.Section({
            title: t(section.titleKey),
            children: items.map((item) =>
              List.Item({
                id: item.id,
                title: item.title,
                subtitle: item.subtitle,
                icon: iconFor(item.action),
                accessories:
                  item.action === 'shutdown'
                    ? [{ tag: { value: t('confirmTag') } }]
                    : item.action === 'cancel'
                    ? [{ tag: { value: t('copyCmdTag') } }]
                    : [],
                actions: ActionPanel({ title: item.title, children: actionsFor(item) })
              })
            )
          })
    }).filter((section) => section !== null)
  })
}
