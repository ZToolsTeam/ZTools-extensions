/**
 * 软件卸载（布局二：左侧分类 + 右侧软件明细）
 *
 * - 右侧列出系统登记的已安装软件，按登记的占用体积降序；Enter 确认后启动软件自带的卸载程序
 * - 左侧「AppData 目录」只读列出目录占用，可定位或复制路径，不提供删除
 * - 读不到数据时在状态条与空列表中如实显示原因，不显示示例数据
 */

import {
  List,
  ActionPanel,
  Action,
  Icon,
  useState,
  useEffect,
  useLocale,
  showToast,
  Toast,
  confirmAlert
} from '@ztools/declarative-ui'
import { t } from './i18n.js'
import {
  type SoftwareItem,
  type AppDataDirItem,
  getSoftwareSmartCategories,
  getNotInClientMessage,
  PROTECTED_SYSTEM_SOFTWARE_PATTERN,
  FORBIDDEN_SOFTWARE_PATTERN,
  getForbiddenUninstallReason,
  formatBytes,
  formatInstallDate,
  fetchSoftwareList,
  summarizeSoftware,
  probeAppDataDirs,
  uninstallSoftware,
  openSoftwareLocation,
  launchSoftware,
  filterSoftwareList
} from './logic.js'

import { isRealElectronHost } from './native-ipc.js'
import { resolveErrorMessage } from './error-i18n.js'

export default function SoftwareManagerCommand() {
  useLocale()
  const inRealHost = isRealElectronHost()
  const notInClientMsg = getNotInClientMessage()
  const [searchText, setSearchText] = useState('')
  const [viewMode, setViewMode] = useState<'all' | 'appdata'>('all')
  const [smartCatFilter, setSmartCatFilter] = useState<string>('all')
  const [driveFilter, setDriveFilter] = useState<string>('all')
  const [softwareList, setSoftwareList] = useState<SoftwareItem[]>([])
  const [listError, setListError] = useState<string>(inRealHost ? '' : notInClientMsg)
  const [appDataDirs, setAppDataDirs] = useState<AppDataDirItem[]>([])
  const [appDataError, setAppDataError] = useState<string>(inRealHost ? '' : notInClientMsg)
  const [isLoading, setIsLoading] = useState(inRealHost)

  async function refreshData(forceRefresh = false) {
    setIsLoading(true)
    try {
      const list = await fetchSoftwareList(undefined, forceRefresh)
      setSoftwareList(list.items)
      setListError(list.ok ? '' : resolveErrorMessage(list, t('readSoftwareFailed')))
      const dirs = await probeAppDataDirs(list.items)
      setAppDataDirs(dirs.items)
      setAppDataError(dirs.ok ? '' : resolveErrorMessage(dirs, t('scanAppDataFailed')))
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void refreshData(false)
  }, [])

  async function handleUninstall(item: SoftwareItem) {
    if (FORBIDDEN_SOFTWARE_PATTERN.test(item.name)) {
      showToast({
        style: Toast.Style.Failure,
        title: t('cannotUninstallTitle'),
        message: t('cannotUninstallMsg', { name: item.name, reason: getForbiddenUninstallReason() })
      })
      return
    }
    if (!item.uninstallString) {
      showToast({
        style: Toast.Style.Failure,
        title: t('noUninstallerTitle'),
        message: t('noUninstallerMsg', { name: item.name })
      })
      return
    }

    const isProtected = PROTECTED_SYSTEM_SOFTWARE_PATTERN.test(item.name) || item.isSystem
    const confirmed = await confirmAlert({
      title: isProtected
        ? t('confirmUninstallProtected', { name: item.name })
        : t('confirmUninstallNormal', { name: item.name }),
      message: [
        isProtected ? t('protectedUninstallWarn') : '',
        t('willLaunchUninstaller', { cmd: item.uninstallString }),
        t('uninstallWizardNote')
      ]
        .filter(Boolean)
        .join('\n\n'),
      primaryAction: {
        title: t('launchUninstallerBtn'),
        style: 'destructive'
      }
    })
    if (!confirmed) return

    const res = await uninstallSoftware(item)
    if (!res.ok) {
      showToast({ style: Toast.Style.Failure, title: t('launchUninstallFailed'), message: res.error })
      return
    }
    showToast({
      style: Toast.Style.Success,
      title: t('uninstallerStarted'),
      message: t('continueInWizard', { name: item.name })
    })
  }

  async function handleLocate(path: string) {
    const ok = await openSoftwareLocation(path)
    if (!ok) showToast({ style: Toast.Style.Failure, title: t('locateFailed'), message: path })
  }

  async function handleLaunch(item: SoftwareItem) {
    const ok = await launchSoftware(item.launchPath || '')
    if (!ok) showToast({ style: Toast.Style.Failure, title: t('launchFailed'), message: item.launchPath })
  }

  const filtered = filterSoftwareList(softwareList, searchText, smartCatFilter, driveFilter)
  const summary = summarizeSoftware(softwareList)
  const filteredSummary = summarizeSoftware(filtered)
  const keyword = searchText.trim().toLowerCase()
  const visibleDirs = keyword
    ? appDataDirs.filter((d) => `${d.folderName} ${d.fullPath}`.toLowerCase().includes(keyword))
    : appDataDirs
  const appDataTotalBytes = appDataDirs.reduce((s, d) => s + d.sizeBytes, 0)
  const maxSwBytes = Math.max(1, ...filtered.map((s) => s.estimatedSize || 0))
  const maxDirBytes = Math.max(1, ...appDataDirs.map((d) => d.sizeBytes))
  const smartCategories = getSoftwareSmartCategories()

  const rightSubListItems =
    viewMode === 'appdata'
      ? visibleDirs.map((dir) =>
          List.Item({
            id: dir.id,
            title: dir.folderName,
            subtitle: t('appDataSubtitle', { scope: dir.scope, count: dir.fileCount, path: dir.fullPath }),
            icon: { source: Icon.Folder },
            accessories: [
              { progress: Math.min(1, dir.sizeBytes / maxDirBytes) },
              {
                tag: {
                  value: dir.similarSoftwareName
                    ? t('similarSoftwareTag', { name: dir.similarSoftwareName })
                    : t('unmatchedSoftwareTag')
                }
              },
              { text: formatBytes(dir.sizeBytes) }
            ],
            actions: ActionPanel({
              title: dir.folderName,
              children: [
                Action({
                  title: t('revealInExplorer'),
                  icon: Icon.Folder,
                  onAction: () => handleLocate(dir.fullPath)
                }),
                Action.CopyToClipboard({
                  title: t('copyDirPath'),
                  content: dir.fullPath
                })
              ]
            })
          })
        )
      : filtered.map((item) => {
          const isForbidden = FORBIDDEN_SOFTWARE_PATTERN.test(item.name)
          const isProtected = Boolean(item.isSystem) || PROTECTED_SYSTEM_SOFTWARE_PATTERN.test(item.name)
          const catMeta = smartCategories.find((c) => c.id === item.smartCategory)
          const meta = [
            item.publisher || t('unknownPublisher'),
            item.version ? `v${item.version}` : t('unknownVersion'),
            item.installDrive || t('unknownInstallLoc'),
            ...(item.installDate ? [t('installedOn', { date: formatInstallDate(item.installDate) })] : [])
          ]
          return List.Item({
            id: item.id,
            title: item.name,
            subtitle: meta.join(' · '),
            icon: { source: isProtected || isForbidden ? Icon.Lock : Icon.AppWindow },
            accessories: [
              { progress: Math.min(1, (item.estimatedSize || 0) / maxSwBytes) },
              {
                tag: {
                  value: isForbidden
                    ? t('tagSystemComponent')
                    : isProtected
                      ? t('tagSystemRuntime')
                      : catMeta?.shortName || item.smartCategoryName || t('tagOther')
                }
              },
              { text: item.estimatedSize > 0 ? formatBytes(item.estimatedSize) : t('sizeUnknown') }
            ],
            actions: ActionPanel({
              title: item.name,
              children: [
                ...(!isForbidden && item.uninstallString
                  ? [
                      Action({
                        title: t('uninstallAction'),
                        icon: Icon.Trash,
                        style: Action.Style.Destructive,
                        onAction: () => handleUninstall(item)
                      })
                    ]
                  : []),
                ...(item.installLocation
                  ? [
                      Action({
                        title: t('locateInstallDir'),
                        icon: Icon.Folder,
                        onAction: () => handleLocate(item.installLocation)
                      })
                    ]
                  : []),
                ...(item.launchPath
                  ? [
                      Action({
                        title: t('launchAppAction'),
                        icon: Icon.Play,
                        onAction: () => handleLaunch(item)
                      })
                    ]
                  : []),
                ...(item.uninstallString
                  ? [
                      Action.CopyToClipboard({
                        title: t('copyUninstallCmd'),
                        content: item.uninstallString
                      })
                    ]
                  : [])
              ]
            })
          })
        })

  const summaryText =
    viewMode === 'appdata'
      ? appDataError || t('appDataSummary', { count: appDataDirs.length, bytes: formatBytes(appDataTotalBytes) })
      : listError ||
        t('softwareSummary', {
          total: summary.totalCount,
          bytes: formatBytes(summary.totalSizeBytes),
          unknownNote: summary.unknownSizeCount > 0 ? t('unknownSizeNote', { count: summary.unknownSizeCount }) : '',
          shown: filtered.length,
          shownBytes: formatBytes(filteredSummary.totalSizeBytes)
        })

  const emptyText =
    viewMode === 'appdata'
      ? appDataError || (isLoading ? t('scanningEmpty') : t('noAppDataEmpty'))
      : listError ||
        (isLoading ? t('readingEmpty') : softwareList.length === 0 ? t('noSoftwareInstalled') : t('noMatchingSoftware'))

  return List({
    searchBarPlaceholder: viewMode === 'appdata' ? t('searchAppDataPlaceholder') : t('searchSoftwarePlaceholder'),
    onSearchTextChange: setSearchText,
    isShowingDetail: false,
    isLoading,
    searchBarAccessory: List.Dropdown({
      tooltip: t('driveFilterTooltip'),
      value: driveFilter,
      onChange: (val) => setDriveFilter(val),
      children: [
        List.Dropdown.Item({ title: t('allDrives', { count: softwareList.length }), value: 'all' }),
        List.Dropdown.Item({
          title: `C: (${softwareList.filter((s) => s.installDrive === 'C:').length})`,
          value: 'C:'
        }),
        List.Dropdown.Item({
          title: `D: (${softwareList.filter((s) => s.installDrive === 'D:').length})`,
          value: 'D:'
        }),
        List.Dropdown.Item({
          title: t('otherDrives', {
            count: softwareList.filter((s) => s.installDrive !== 'C:' && s.installDrive !== 'D:').length
          }),
          value: 'OTHER'
        })
      ]
    }),
    filterBar: {
      summaryText,
      actions: [
        {
          id: 'rescan-all',
          title: t('rescan'),
          style: 'secondary',
          onAction: () => refreshData(true)
        }
      ]
    },
    subList: {
      title: viewMode === 'appdata' ? t('subListAppDataTitle') : t('subListSoftwareTitle'),
      subtitle:
        viewMode === 'appdata'
          ? t('subListAppDataCount', { count: visibleDirs.length })
          : t('subListSoftwareCount', { count: filtered.length }),
      emptyText,
      items: rightSubListItems
    },
    children: [
      List.Section({
        title: t('overviewSection'),
        children: [
          List.Item({
            id: 'sw-nav-all',
            title: t('allInstalledTitle'),
            subtitle: t('subListSoftwareCount', { count: summary.totalCount }),
            icon: { source: Icon.AppWindow },
            accessories: [{ text: formatBytes(summary.totalSizeBytes) }],
            onSelect: () => {
              setViewMode('all')
              setSmartCatFilter('all')
            }
          }),
          List.Item({
            id: 'sw-nav-appdata',
            title: t('appDataDirTitle'),
            subtitle: t('appDataNavSub', { count: appDataDirs.length }),
            icon: { source: Icon.Folder },
            accessories: [{ text: formatBytes(appDataTotalBytes) }],
            onSelect: () => {
              setViewMode('appdata')
            }
          })
        ]
      }),
      List.Section({
        title: t('byCategorySection'),
        children: smartCategories.map((cat) => {
          const catItems = softwareList.filter((s) => s.smartCategory === cat.id)
          const catBytes = catItems.reduce((acc, s) => acc + (s.estimatedSize || 0), 0)
          return List.Item({
            id: `sw-nav-cat-${cat.id}`,
            title: cat.name,
            subtitle: t('subListSoftwareCount', { count: catItems.length }),
            icon: { source: cat.id === 'runtime_system' ? Icon.Lock : Icon.Folder },
            accessories: [{ text: formatBytes(catBytes) }],
            onSelect: () => {
              setViewMode('all')
              setSmartCatFilter(cat.id)
            }
          })
        })
      })
    ]
  })
}
