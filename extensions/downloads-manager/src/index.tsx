import React, {
  Action,
  ActionPanel,
  Color,
  Detail,
  Form,
  Icon,
  List,
  Toast,
  confirmAlert,
  showToast,
  useEffect,
  useMemo,
  useNavigation,
  useState,
  useRef
} from '@ztools/declarative-ui'
import {
  addCustomDownloadDirectory,
  cleanExpiredDownloads,
  cleanRedundantInstallers,
  computeDashboardSummary,
  copyDownloadFileEntity,
  copyDownloadFilePath,
  filterDownloadEntries,
  getDownloadCategoryLabel,
  getDownloadChannelLabel,
  getClientPlatform,
  getCustomDownloadDirectories,
  openDownloadItem,
  removeCustomDownloadDirectory,
  revealDownloadItem,
  scanDownloadsDirectory,
  selectDownloadDirectory,
  togglePinEntry,
  trashDownloadItem
} from './downloads-service.js'
import type {
  DownloadEntry,
  DownloadFileCategory,
  DownloadsDashboardSummary
} from './types.js'

function getCategoryIcon(category: Exclude<DownloadFileCategory, 'all'>): string {
  switch (category) {
    case 'installer':
      return Icon.Download
    case 'archive':
      return Icon.Layers
    case 'document':
      return Icon.Document
    case 'image':
      return Icon.Image
    case 'media':
      return Icon.Video
    case 'code':
      return Icon.Code
    case 'other':
      return Icon.Document
  }
}

/** 安装包筛选项只列当前平台用得上的扩展名；平台未知时全部列出。 */
export function installerExtensionsLabel(platform: string | undefined): string {
  if (platform === 'windows') return '.exe / .msi'
  if (platform === 'macos') return '.dmg / .pkg'
  if (platform === 'linux') return '.deb / .rpm / .AppImage'
  return '.exe / .msi / .dmg / .pkg'
}

/** 网盘与下载器筛选项只列当前平台上存在的客户端；IDM 只有 Windows 版。 */
export function netdiskFilterLabel(platform: string | undefined): string {
  return platform === 'windows' || platform === undefined
    ? '网盘与下载器 (百度 / 夸克 / 阿里 / 迅雷 / IDM)'
    : '网盘与下载器 (百度 / 夸克 / 阿里 / 迅雷)'
}

/** 摘要按当前筛选结果计数；筛选后数量与总数不同时再补总数。 */
export function filteredSummaryText(shown: number, total: number, sourceCount: number, partial: boolean, issueCount: number): string {
  return `已显示 ${shown} 个文件${shown !== total ? `（共 ${total} 个）` : ''} · ${sourceCount} 个目录${partial ? ' · 仅部分结果' : ''}${issueCount ? ` · ${issueCount} 项读取异常` : ''}`
}

function resolveInitialFilterFromFeature(featureCode?: string): string {
  switch (featureCode) {
    case 'downloads-netdisk':
      return 'netdisk'
    case 'downloads-im':
      return 'im'
    case 'downloads-clean-installers':
      return 'type:installer'
    default:
      return 'all'
  }
}

export function AddCustomDownloadDirectoryForm(props: {
  customDirs: string[]
  onAdded: (dirPath: string) => void
  onRemoved: (dirPath: string) => void
}) {
  const { pop } = useNavigation()
  const [selectedDir, setSelectedDir] = useState('')
  const busy = useRef(false)
  const alive = useRef(true)
  useEffect(() => () => { alive.current = false }, [])

  return (
    <Form
      navigationTitle="管理自定义下载监控目录"
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="选择并添加目录"
            icon={Icon.Plus}
            onSubmit={async () => {
              if (busy.current || !alive.current) return
              busy.current = true
              try {
                const selected = await selectDownloadDirectory()
                if (!selected || !alive.current) return
                setSelectedDir(selected)
                const res = await addCustomDownloadDirectory(selected, undefined, () => alive.current)
                if (!alive.current) return
                if (!res.ok || !res.path) throw new Error(res.error || '目录未能保存')
                await showToast({ style: Toast.Style.Success, title: '已添加自定义目录', message: res.path })
                if (alive.current) { props.onAdded(res.path); pop() }
              } catch (error) {
                if (alive.current) await showToast({ style: Toast.Style.Failure, title: '添加目录失败', message: error instanceof Error ? error.message : String(error) })
              } finally { busy.current = false }
            }}
          />
          {props.customDirs.map((customDir) => (
            <Action
              key={`rm-${customDir}`}
              title={`移除自定义目录: ${customDir}`}
              icon={Icon.Trash}
              style={Action.Style.Destructive}
              onAction={async () => {
                if (busy.current || !alive.current) return
                busy.current = true
                try {
                  await removeCustomDownloadDirectory(customDir)
                  if (!alive.current) return
                  props.onRemoved(customDir)
                  await showToast({ style: Toast.Style.Success, title: '已移除目录配置', message: '文件保持原样' })
                  pop()
                } catch (error) {
                  if (alive.current) await showToast({ style: Toast.Style.Failure, title: '未能保存目录配置', message: error instanceof Error ? error.message : String(error) })
                } finally { busy.current = false }

              }}
            />
          ))}
        </ActionPanel>
      }
    >
      <Form.Description title="说明" text="通过系统窗口选择要聚合的文件夹，授予访问权限后保存；目录变化后执行刷新。移除配置不会删除文件。" />
      {selectedDir && <Form.Description title="上次选择的目录" text={selectedDir} />}
    </Form>
  )
}

export function DownloadFileDetailView({ entry }: { entry: DownloadEntry }) {
  const content = `文件：${entry.name}
来源：${entry.sourceLabel}
类型：${getDownloadCategoryLabel(entry.category)}
大小：${entry.sizeFormatted}
修改时间：${entry.modifiedAt}
路径：${entry.path}`
  let size = 3
  for (const run of content.matchAll(/`+/g)) size = Math.max(size, run[0].length + 1)
  const fence = '`'.repeat(size)
  const markdown = `${fence}text\n${content.replace(/\r\n?/g, '\n')}\n${fence}`

  return <Detail navigationTitle={entry.name} markdown={markdown} />
}

export default function DownloadsManagerCommand(props?: {
  launchContext?: { featureCode?: string }
  featureCode?: string
}) {
  const { push } = useNavigation()
  const activeFeatureCode = props?.launchContext?.featureCode || props?.featureCode
  const cleanInstallersMode = activeFeatureCode === 'downloads-clean-installers'
  const [summary, setSummary] = useState<DownloadsDashboardSummary>(() =>
    computeDashboardSummary('', [], [])
  )
  const [filterValue, setFilterValue] = useState<string>(() =>
    resolveInitialFilterFromFeature(activeFeatureCode)
  )
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [isLoading, setIsLoading] = useState<boolean>(true)
  const [customDirs, setCustomDirs] = useState<string[]>([])
  const [loadError, setLoadError] = useState('')
  // 只有确认是 Windows 才展示微信 / QQ / 企业微信等 IM 接收目录承诺（自动发现只按 Windows 目录布局实现）
  const [platform, setPlatform] = useState<string | undefined>(undefined)
  const imAutoDiscovery = platform === 'windows'
  // macOS 的回收站叫“废纸篓”
  const trashName = platform === 'macos' ? '废纸篓' : '回收站'
  const generation = useRef(0), alive = useRef(true), busy = useRef(false)
  useEffect(() => () => { alive.current = false; generation.current++ }, [])
  useEffect(() => {
    void getClientPlatform().then(
      (value) => { if (alive.current) setPlatform(value) },
      () => { if (alive.current) setPlatform(undefined) }
    )
  }, [])

  const reloadDownloads = async (nextCustomDirs?: string[]) => {
    if (busy.current) return
    const request = ++generation.current
    setIsLoading(true); setLoadError('')
    try {
      const directories = nextCustomDirs ?? await getCustomDownloadDirectories()
      const result = await scanDownloadsDirectory({ customDirs: directories, maxFilesPerSource: 100, shouldContinue: () => alive.current && request === generation.current })
      if (!alive.current || request !== generation.current) return
      setCustomDirs(directories); setSummary(result)
    } catch (error) {
      if (!alive.current || request !== generation.current) return
      const message = error instanceof Error ? error.message : String(error)
      setLoadError(message)
      await showToast({ style: Toast.Style.Failure, title: '下载列表未更新', message })
    } finally {
      if (alive.current && request === generation.current) setIsLoading(false)
    }
  }
  useEffect(() => { void reloadDownloads() }, [])
  useEffect(() => { setFilterValue(resolveInitialFilterFromFeature(activeFeatureCode)) }, [activeFeatureCode])

  const runMutation = async (operation: () => Promise<void>) => {
    if (busy.current || !alive.current) return
    busy.current = true; generation.current++; setIsLoading(true)
    try { await operation() }
    catch (error) { if (alive.current) await showToast({ style: Toast.Style.Failure, title: '操作未完成', message: error instanceof Error ? error.message : String(error) }) }
    finally { busy.current = false; if (alive.current) setIsLoading(false) }
  }
  const isInstallerCleanMode = filterValue === 'type:installer'

  const filteredEntries = useMemo(
    () =>
      filterDownloadEntries(summary.entries, {
        filterValue,
        query: searchQuery,
        sortBy: isInstallerCleanMode ? 'size' : 'mtime'
      }),
    [summary.entries, filterValue, searchQuery, isInstallerCleanMode]
  )

  const groupedSections = useMemo(() => {
    if (isInstallerCleanMode) {
      return [
        {
          id: 'sec-installers',
          title: '可清理安装包（按体积从大到小）',
          subtitle: `${filteredEntries.length} 个安装包 · 共 ${summary.installerSizeFormatted}`,
          items: filteredEntries
        }
      ]
    }
    const todayItems: DownloadEntry[] = []
    const weekItems: DownloadEntry[] = []
    const olderItems: DownloadEntry[] = []
    for (const item of filteredEntries) {
      if (item.ageDays !== null && item.ageDays <= 0) {
        todayItems.push(item)
      } else if (item.ageDays !== null && item.ageDays <= 7) {
        weekItems.push(item)
      } else {
        olderItems.push(item)
      }
    }
    const sections: Array<{ id: string; title: string; subtitle: string; items: DownloadEntry[] }> = []
    if (todayItems.length > 0) {
      sections.push({
        id: 'sec-today',
        title: '今日新增',
        subtitle: `${todayItems.length} 项`,
        items: todayItems
      })
    }
    if (weekItems.length > 0) {
      sections.push({
        id: 'sec-week',
        title: '近 7 天',
        subtitle: `${weekItems.length} 项`,
        items: weekItems
      })
    }
    if (olderItems.length > 0 || sections.length === 0) {
      sections.push({
        id: 'sec-older',
        title: sections.length === 0 ? '下载与接收记录' : '更早之前',
        subtitle: `${olderItems.length} 项`,
        items: olderItems
      })
    }
    return sections
  }, [filteredEntries, isInstallerCleanMode, summary.installerSizeFormatted])

  const cleanVisible = async (installers: boolean) => runMutation(async () => {
    const candidates = filteredEntries.filter(item => !item.isPinned && (installers ? item.category === 'installer' : item.ageDays !== null && item.ageDays >= 30 && item.sizeBytes >= 100 * 1024 * 1024))
    if (!candidates.length) {
      await showToast({ style: Toast.Style.Failure, title: '当前列表没有符合条件的未保护文件' }); return
    }
    const confirmed = await confirmAlert({ title: `将当前列表中 ${candidates.length} 个文件移入${trashName}？`,
      message: candidates.map(item => item.path).join('\n') + `\n仅处理这些文件；保护项会跳过。移入${trashName}不会立即释放磁盘空间。` })
    if (!confirmed || !alive.current) return
    const result = installers ? await cleanRedundantInstallers(candidates, undefined, () => alive.current) : await cleanExpiredDownloads(candidates, 30, 100 * 1024 * 1024, undefined, () => alive.current)
    const remaining = new Set(result.remainingEntries.map(item => item.id)), targets = new Set(candidates.map(item => item.id))
    if (!alive.current) return
    setSummary(current => computeDashboardSummary(current.downloadDir, current.entries.filter(item => !targets.has(item.id) || remaining.has(item.id)), current.sources, current))
    const failures = result.failedPaths?.length ?? 0
    await showToast({ style: failures || !result.cleanedCount ? Toast.Style.Failure : Toast.Style.Success,
      title: `已移入${trashName} ${result.cleanedCount} 个${failures ? `，失败 ${failures} 个` : ''}`,
      message: result.error || `移动文件合计 ${result.freedFormatted}；${trashName}保留原文件。` })
  })
  const handleCleanInstallers = () => cleanVisible(true)
  const handleCleanLargeOldFiles = () => cleanVisible(false)

  const openCustomDirManager = () => {
    push(
      <AddCustomDownloadDirectoryForm
        customDirs={customDirs}
        onAdded={(added) => {
          if (alive.current) void reloadDownloads()
        }}
        onRemoved={(removed) => {
          if (alive.current) void reloadDownloads()
        }}
      />
    )
  }

  // 清理安装包入口的主动作是移入废纸篓/回收站（带确认），避免 Enter 直接运行 dmg / 安装包
  const renderItemActions = (item: DownloadEntry) => {
    const openAction = (
      <Action
        key="open"
        title="打开文件"
        icon={Icon.Document}
        onAction={async () => {
          const ok = await openDownloadItem(item.path)
          await showToast({
            style: ok ? Toast.Style.Success : Toast.Style.Failure,
            title: ok ? `已打开: ${item.name}` : '无法打开文件',
            message: item.path
          })
        }}
      />
    )
    const revealAction = (
      <Action
        key="reveal"
        title="打开所在文件夹并选中"
        icon={Icon.Folder}
        shortcut={{ modifiers: ['ctrl'], key: 'enter' }}
        onAction={async () => {
          const ok = await revealDownloadItem(item.path)
          await showToast({
            style: ok ? Toast.Style.Success : Toast.Style.Failure,
            title: ok ? '已在文件管理器中定位文件' : '无法定位文件',
            message: item.path
          })
        }}
      />
    )
    const copyEntityAction = (
      <Action
        key="copy-entity"
        title="复制文件实体（可直接粘贴到微信/桌面）"
        icon={Icon.Clipboard}
        shortcut={{ modifiers: ['ctrl', 'shift'], key: 'c' }}
        onAction={async () => {
          const res = await copyDownloadFileEntity(item.path)
          await showToast({
            style: res.ok ? Toast.Style.Success : Toast.Style.Failure,
            title: res.ok ? `已复制文件实体: ${item.name}` : '复制文件实体失败',
            message: res.ok ? '可粘贴到支持文件粘贴的应用或文件夹' : res.error
          })
        }}
      />
    )
    const copyPathAction = (
      <Action
        key="copy-path"
        title="复制完整路径"
        icon={Icon.Clipboard}
        shortcut={{ modifiers: ['ctrl'], key: 'c' }}
        onAction={async () => {
          const ok = await copyDownloadFilePath(item.path)
          await showToast({
            style: ok ? Toast.Style.Success : Toast.Style.Failure,
            title: ok ? '已复制完整路径' : '复制路径失败',
            message: item.path
          })
        }}
      />
    )
    const pinAction = (
      <Action
        key="pin"
        title={item.isPinned ? '取消置顶保护' : '置顶并保护（跳过自动清理）'}
        icon={Icon.Pin}
        shortcut={{ modifiers: ['ctrl'], key: 'p' }}
        onAction={() => runMutation(async () => {
          const next = await togglePinEntry(summary.entries, item.id)
          if (alive.current) setSummary(current => computeDashboardSummary(current.downloadDir, next, current.sources, current))
        })}
      />
    )
    const trashAction = (
      <Action
        key="trash"
        title={`移入${trashName}`}
        icon={Icon.Trash}
        style={Action.Style.Destructive}
        shortcut={{ modifiers: ['ctrl'], key: 'backspace' }}
        onAction={() => runMutation(async () => {
          const confirmed = await confirmAlert({
            title: `确认将「${item.name}」移入${trashName}？`,
            message: `文件大小: ${item.sizeFormatted}\n来源: ${item.path}`
          })
          if (!confirmed || !alive.current) return
          const res = await trashDownloadItem(summary.entries, item.id)
          if (!res.ok) {
            await showToast({
              style: Toast.Style.Failure,
              title: `移入${trashName}失败`,
              message: res.error || '文件可能正在被占用'
            })
            return
          }
          if (!alive.current) return
          setSummary(current => computeDashboardSummary(current.downloadDir, current.entries.filter(entry => entry.id !== item.id), current.sources, current))
          await showToast({
            style: Toast.Style.Success,
            title: `已移入${trashName}: ${item.name}`,
            message: `文件大小 ${item.sizeFormatted}，仍保留在${trashName}`
          })
        })}
      />
    )
    return cleanInstallersMode
      ? [trashAction, revealAction, openAction, copyEntityAction, copyPathAction, pinAction]
      : [openAction, revealAction, copyEntityAction, copyPathAction, pinAction, trashAction]
  }

  // 列表为空时没有可清理的文件，不提供清理动作
  const renderGlobalActions = (includeClean = true) => (
    <ActionPanel.Section title={includeClean ? '批量清理与渠道配置' : '渠道配置'}>
      {includeClean && <Action
        title="清理当前列表的未保护安装包"
        icon={Icon.Trash}
        style={Action.Style.Destructive}
        shortcut={{ modifiers: ['ctrl', 'shift'], key: 'backspace' }}
        onAction={handleCleanInstallers}
      />}
      {includeClean && <Action
        title="清理当前列表中 30 天前的大文件 (≥ 100 MB)"
        icon={Icon.Trash}
        style={Action.Style.Destructive}
        onAction={handleCleanLargeOldFiles}
      />}
      <Action
        title="管理下载目录"
        icon={Icon.Plus}
        onAction={openCustomDirManager}
      />
      <Action
        title="刷新全渠道扫描"
        icon={Icon.ArrowClockwise}
        shortcut={{ modifiers: ['ctrl'], key: 'r' }}
        onAction={() => reloadDownloads(customDirs)}
      />
    </ActionPanel.Section>
  )

  return (
    <List
      navigationTitle="下载管理"
      searchBarPlaceholder={imAutoDiscovery
        ? '检索文件名、后缀(.exe/.pdf/.zip)或来源(微信/百度网盘/夸克/QQ)...'
        : '检索文件名、后缀(.dmg/.pdf/.zip)或来源(系统下载/百度网盘/夸克)...'}
      isLoading={isLoading}
      isShowingDetail={false}
      searchText={searchQuery}
      onSearchTextChange={(q: string) => setSearchQuery(q)}
      filterBar={{
        summaryText: loadError ? '读取失败，旧结果保留，请刷新重试' : filteredSummaryText(filteredEntries.length, summary.totalCount, summary.sources.length, summary.partial, summary.scanIssues.length)
      }}
      searchBarAccessory={
        <List.Dropdown
          tooltip="按来源渠道或文件类型筛选"
          value={filterValue}
          onChange={(val: string) => setFilterValue(val)}
        >
          <List.Dropdown.Section title="按来源渠道">
            <List.Dropdown.Item title="全渠道汇总" value="all" />
            <List.Dropdown.Item
              title={imAutoDiscovery ? '办公 IM 接收 (微信 / 企微 / QQ / 飞书 / 钉钉)' : '办公 IM 接收（仅 Windows 自动发现，可添加自定义目录）'}
              value="im"
            />
            <List.Dropdown.Item title={netdiskFilterLabel(platform)} value="netdisk" />
            <List.Dropdown.Item title="浏览器与系统下载" value="browser" />
            <List.Dropdown.Item title="自定义监控目录" value="custom" />
          </List.Dropdown.Section>
          <List.Dropdown.Section title="按文件类型">
            <List.Dropdown.Item
              title={`安装包 (${installerExtensionsLabel(platform)}) [${summary.installerCount}]`}
              value="type:installer"
            />
            <List.Dropdown.Item title="办公文档 (.pdf / .docx / .xlsx / .pptx)" value="type:document" />
            <List.Dropdown.Item title="压缩归档 (.zip / .7z / .rar / .tar)" value="type:archive" />
            <List.Dropdown.Item title="图片设计 (.png / .jpg / .webp / .svg)" value="type:image" />
            <List.Dropdown.Item title="音视频媒体 (.mp4 / .mkv / .mp3 / .wav)" value="type:media" />
            <List.Dropdown.Item title="代码与数据 (.json / .sql / .ts / .py)" value="type:code" />
          </List.Dropdown.Section>
        </List.Dropdown>
      }
    >
      {filteredEntries.length === 0 ? (
        <List.Section title="当前筛选状态">
          <List.Item
            id="downloads-empty"
            icon={{ source: Icon.Folder, tintColor: Color.SecondaryText }}
            title={isLoading ? '正在扫描下载与接收目录...' : loadError || summary.scanIssues.length ? '读取未完成，不能判断目录是否为空' : filterValue === 'im' && !imAutoDiscovery ? '当前系统不自动发现微信、QQ、企业微信等接收目录' : '当前筛选条件下暂无下载文件'}
            subtitle={filterValue === 'im' && !imAutoDiscovery
              ? '自动发现只支持 Windows；可在聊天软件设置里查看文件保存位置，再通过动作面板添加为自定义下载目录'
              : '可切换右上角渠道筛选（全渠道 / 办公 IM / 网盘下载 / 安装包），或通过动作面板添加自定义下载目录'}
            actions={
              <ActionPanel>
                {filterValue === 'im' && !imAutoDiscovery && <Action
                  title="添加自定义目录"
                  icon={Icon.Plus}
                  onAction={openCustomDirManager}
                />}
                {(filterValue !== 'all' || searchQuery) && <Action
                  title="重置为全渠道汇总"
                  icon={Icon.ArrowClockwise}
                  onAction={() => {
                    setFilterValue('all')
                    setSearchQuery('')
                  }}
                />}
                {renderGlobalActions(false)}
              </ActionPanel>
            }
          />
        </List.Section>
      ) : (
        groupedSections.map((section) => (
          <List.Section key={section.id} title={section.title} subtitle={section.subtitle}>
            {section.items.map((item) => (
              <List.Item
                key={item.id}
                id={item.id}
                icon={{
                  source: getCategoryIcon(item.category),
                  tintColor: Color.SecondaryText
                }}
                title={item.name}
                subtitle={`${item.sourceLabel} · ${getDownloadCategoryLabel(item.category)}`}
                keywords={[
                  item.ext,
                  item.category,
                  item.channel,
                  item.sourceLabel,
                  item.appName,
                  getDownloadCategoryLabel(item.category)
                ]}
                accessories={[
                  ...(item.isPinned ? [{ tag: { value: '已置顶', color: Color.SecondaryText } }] : []),
                  { text: item.sizeFormatted },
                  { text: item.ageDays === null ? '修改时间未知' : item.ageDays === 0 ? `今天 ${item.modifiedAt.slice(11)}` : `${item.ageDays} 天前` }
                ]}
                actions={
                  <ActionPanel>
                    <ActionPanel.Section title={item.name}>
                      {renderItemActions(item)}
                    </ActionPanel.Section>
                    {renderGlobalActions()}
                  </ActionPanel>
                }
              />
            ))}
          </List.Section>
        ))
      )}
      {(loadError || summary.scanIssues.length > 0) && <List.Section title="读取异常">
        {loadError && <List.Item id="downloads-load-error" title="读取或保护设置失败" subtitle={loadError} actions={<ActionPanel>{renderGlobalActions()}</ActionPanel>} />}
        {summary.scanIssues.map((issue, index) => <List.Item key={index} id={`scan-issue-${index}`} title={issue.path} subtitle={issue.message} actions={<ActionPanel><Action title="刷新下载列表" icon={Icon.ArrowClockwise} onAction={() => reloadDownloads()} /></ActionPanel>} />)}
      </List.Section>}
    </List>
  )
}

export const commands = {
  'downloads-all': DownloadsManagerCommand,
  'downloads-netdisk': () => DownloadsManagerCommand({ featureCode: 'downloads-netdisk' }),
  'downloads-im': () => DownloadsManagerCommand({ featureCode: 'downloads-im' }),
  'downloads-clean-installers': () => DownloadsManagerCommand({ featureCode: 'downloads-clean-installers' })
}
