import {
  List,
  ActionPanel,
  Action,
  Icon,
  Clipboard,
  useLocale,
  useState,
  useEffect,
  showToast,
  Toast
} from '@ztools/declarative-ui'
import {
  type WechatInstanceItem,
  formatBytes,
  fetchWechatInstances,
  launchWechatAgain,
  filterWechatInstances
} from './logic.js'
import { t } from './i18n.js'
import { resolveErrorMessage } from './error-i18n.js'

export * from './logic.js'

async function copyWithToast(text: string, successTitle: string): Promise<void> {
  try {
    await Clipboard.copy(text)
  } catch (err) {
    await showToast({
      style: Toast.Style.Failure,
      title: t('toastCopyFailed'),
      message: err instanceof Error ? err.message : String(err)
    })
    return
  }
  await showToast({ style: Toast.Style.Success, title: successTitle, message: text })
}

export function WechatMultiCommand() {
  useLocale()
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
      setLoadError(snap.ok ? '' : resolveErrorMessage(snap, t('errReadProcessesFailed')))
      setWarning(snap.warning || '')
      if (!snap.ok) {
        if (showNotice) await showToast({ style: Toast.Style.Failure, title: t('errReadProcessesFailed'), message: snap.error })
      } else if (showNotice) {
        await showToast({ style: Toast.Style.Success, title: t('toastRefreshedTitle'), message: t('toastRefreshedMsg', { count: snap.instances.length }) })
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
      await showToast({ style: Toast.Style.Failure, title: t('errLaunchFailed'), message: res.message })
      return
    }
    await showToast({ style: Toast.Style.Success, title: res.message, message: t('launchLimitNote') })
    await refreshInstances(false)
  }

  const filtered = filterWechatInstances(instances, searchText)
  const query = searchText.trim()
  const launchTitle = t('actionLaunchAgain')
  const showLaunchRow = !loadError && (!query || launchTitle.toLowerCase().includes(query.toLowerCase()) || t('kwLaunch').toLowerCase().includes(query.toLowerCase()))

  const launchRow = List.Item({
    id: 'wx-launch',
    title: launchTitle,
    subtitle: installPath ? `${installPath} · ${t('launchLimitNote')}` : t('launchMissingPathSub'),
    icon: Icon.Plus,
    actions: ActionPanel({
      title: launchTitle,
      children: [Action({ title: launchTitle, icon: Icon.Plus, onAction: () => handleLaunch() })]
    })
  })

  const statusRow = List.Item({
    id: 'wx-status',
    title: t('errReadProcessesFailed'),
    subtitle: loadError,
    icon: Icon.ExclamationMark,
    actions: ActionPanel({
      title: t('errReadProcessesFailed'),
      children: [Action({ title: t('actionRetryRead'), icon: Icon.ArrowClockwise, onAction: () => refreshInstances(true) })]
    })
  })

  const instanceRows = filtered.map((item) =>
    List.Item({
      id: item.id,
      title: item.name,
      subtitle: item.startTime ? t('pidStartedAt', { pid: item.pid, time: item.startTime }) : `PID ${item.pid}`,
      icon: Icon.AppWindow,
      accessories: item.memoryBytes > 0 ? [{ text: formatBytes(item.memoryBytes) }] : [],
      actions: ActionPanel({
        title: `${item.name} (PID ${item.pid})`,
        children: [
          Action({
            title: t('actionCopyPid'),
            icon: Icon.Clipboard,
            onAction: () => copyWithToast(String(item.pid), t('toastCopiedPid'))
          })
        ]
      })
    })
  )

  return List({
    navigationTitle: t('navTitle'),
    searchBarPlaceholder: t('searchPlaceholder'),
    onSearchTextChange: setSearchText,
    isShowingDetail: false,
    isLoading,
    filterBar: {
      summaryText: loadError
        ? t('summaryFailed', { error: loadError })
        : t('summaryRunning', { count: instances.length, warning: warning ? ` · ${warning}` : '' }),
      actions: [
        {
          id: 'refresh-wx',
          label: t('actionRefresh'),
          title: t('actionRefresh'),
          style: 'secondary',
          onAction: () => void refreshInstances(true)
        }
      ]
    },
    children: [
      List.Section({
        title: t('sectionActions'),
        children: loadError ? [statusRow] : showLaunchRow ? [launchRow] : []
      }),
      List.Section({
        title: t('sectionRunning', { count: filtered.length }),
        children: instanceRows
      })
    ]
  })
}

export default WechatMultiCommand
