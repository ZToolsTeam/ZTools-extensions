import {
  List,
  ActionPanel,
  Action,
  Icon,
  Clipboard,
  useState,
  useEffect,
  showToast,
  Toast
} from '@ztools/declarative-ui'
import {
  type LanShareStatus,
  type SharedFileItem,
  type LanActionResult,
  formatBytes,
  fetchLanShareStatus,
  startLanShare,
  stopLanShare,
  pickFilesToShare,
  addFilesToShare,
  setFileShared,
  removeSharedFile,
  generateQrCodeSvgDataUri,
  filterSharedFiles
} from './logic.js'

export * from './logic.js'

const NO_PASSWORD_NOTE = '同一局域网内的任何设备都能打开并下载，不需要密码'
const FIREWALL_NOTE = '首次启动时 Windows 防火墙可能询问是否允许 ZTools 访问网络，需要允许，手机才能连上'
const KEEP_RUNNING_NOTE = '关闭插件后服务仍在运行，直到在这里停止服务或退出 ZTools'

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

function qrMarkdown(url: string): string {
  const qr = generateQrCodeSvgDataUri(url)
  return qr ? `![访问地址二维码](${qr})\n\n` : '地址太长，无法生成二维码，请复制地址后发送到手机。\n\n'
}

function serviceDetail(status: LanShareStatus): string {
  if (!status.ok) return `### 读取共享状态失败\n\n${status.error || ''}`
  if (!status.running) {
    return `### 共享服务未运行\n\n启动后，同一局域网的设备在浏览器中打开本机地址即可看到共享列表并下载文件。\n\n- ${NO_PASSWORD_NOTE}\n- ${FIREWALL_NOTE}\n- 只支持从电脑下载到其他设备，不支持从手机上传`
  }
  const others = status.interfaces.filter((i) => i.address !== status.lanIp)
  const otherLines = others.length
    ? `\n\n如果手机打不开，换用本机的其他地址：\n\n${others.map((i) => `- ${i.name}：\`http://${i.address}:${status.port}\``).join('\n')}`
    : ''
  const noLan = status.interfaces.length === 0 ? '\n\n没有检测到局域网地址，其他设备无法连接。' : ''
  return `### 共享服务运行中\n\n${qrMarkdown(status.portalUrl)}\`\`\`text\n${status.portalUrl}\n\`\`\`\n\n- ${NO_PASSWORD_NOTE}\n- ${KEEP_RUNNING_NOTE}\n- ${FIREWALL_NOTE}${otherLines}${noLan}`
}

function fileDetail(file: SharedFileItem, status: LanShareStatus): string {
  const head = `### ${file.name}\n\n- 路径：\`${file.path}\`\n- 大小：${formatBytes(file.sizeBytes)}\n\n`
  if (file.isDirectory) return `${head}这是文件夹，共享网页不能下载文件夹。`
  if (!file.shared) return `${head}已暂停共享，其他设备打开下载地址会被拒绝。`
  if (!status.running) return `${head}共享服务未运行，启动后才能下载。`
  return `${head}${qrMarkdown(file.downloadUrl)}\`\`\`text\n${file.downloadUrl}\n\`\`\``
}

const EMPTY_STATUS: LanShareStatus = {
  ok: true,
  running: false,
  lanIp: '',
  port: 0,
  portalUrl: '',
  interfaces: [],
  files: []
}

export function LanShareCommand() {
  const [searchText, setSearchText] = useState('')
  const [status, setStatus] = useState<LanShareStatus>(EMPTY_STATUS)
  const [isLoading, setIsLoading] = useState(true)

  async function refresh(showNotice = false) {
    setIsLoading(true)
    try {
      const next = await fetchLanShareStatus()
      setStatus(next)
      if (showNotice) {
        await showToast(
          next.ok
            ? { style: Toast.Style.Success, title: '已刷新', message: next.running ? next.portalUrl : '共享服务未运行' }
            : { style: Toast.Style.Failure, title: '读取共享状态失败', message: next.error }
        )
      }
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void refresh(false)
  }, [])

  /** 执行一个改变共享状态的操作：结果以客户端返回为准，之后重新读取完整状态 */
  async function applyResult(res: LanActionResult, failureTitle: string, successMessage?: string) {
    if (res.ok) {
      await showToast({ style: Toast.Style.Success, title: res.message, message: successMessage })
    } else {
      await showToast({ style: Toast.Style.Failure, title: failureTitle, message: res.message })
    }
    await refresh(false)
  }

  async function handleStart() {
    const res = await startLanShare()
    await applyResult(res, '启动共享服务失败', res.status?.portalUrl)
  }

  async function handleStop() {
    await applyResult(await stopLanShare(), '停止共享服务失败')
  }

  async function handleAddFiles() {
    const picked = await pickFilesToShare()
    if (picked.canceled) return
    if (!picked.ok) {
      await showToast({ style: Toast.Style.Failure, title: '选择文件失败', message: picked.error })
      return
    }
    const res = await addFilesToShare(picked.paths)
    const portal = res.status?.portalUrl
    await applyResult(res, '共享文件失败', portal ? `${portal} · ${NO_PASSWORD_NOTE}` : undefined)
  }

  async function handleToggle(file: SharedFileItem) {
    await applyResult(await setFileShared(file.id, !file.shared), '切换共享状态失败')
  }

  async function handleRemove(file: SharedFileItem) {
    await applyResult(await removeSharedFile(file.id), '移除失败')
  }

  const filtered = filterSharedFiles(status.files, searchText)
  const downloadable = status.files.filter((f) => f.downloadUrl).length

  const serviceItem = !status.ok
    ? List.Item({
        id: 'lan-service',
        title: '读取共享状态失败',
        subtitle: status.error,
        icon: Icon.ExclamationMark,
        detail: List.Item.Detail({ markdown: serviceDetail(status) }),
        actions: ActionPanel({
          title: '读取共享状态失败',
          children: [Action({ title: '重新读取', icon: Icon.ArrowClockwise, onAction: () => refresh(true) })]
        })
      })
    : status.running
    ? List.Item({
        id: 'lan-service',
        title: `共享服务运行中：${status.portalUrl}`,
        subtitle: NO_PASSWORD_NOTE,
        icon: Icon.Wifi,
        accessories: [{ tag: { value: '运行中' } }],
        detail: List.Item.Detail({ markdown: serviceDetail(status) }),
        actions: ActionPanel({
          title: '共享服务',
          children: [
            Action({
              title: '复制访问地址',
              icon: Icon.Clipboard,
              onAction: () => copyWithToast(status.portalUrl, '已复制访问地址', status.portalUrl)
            }),
            Action({
              title: '停止共享服务',
              icon: Icon.Stop,
              shortcut: { modifiers: ['ctrl'], key: 'return' },
              onAction: () => handleStop()
            })
          ]
        })
      })
    : List.Item({
        id: 'lan-service',
        title: '共享服务未运行',
        subtitle: '启动后，同一局域网的设备可以打开本机地址下载列表中的文件',
        icon: Icon.Wifi,
        accessories: [{ tag: { value: '未运行' } }],
        detail: List.Item.Detail({ markdown: serviceDetail(status) }),
        actions: ActionPanel({
          title: '共享服务',
          children: [Action({ title: '启动共享服务', icon: Icon.Play, onAction: () => handleStart() })]
        })
      })

  const fileItems = filtered.map((file) => {
    const actions: ReturnType<typeof Action>[] = []
    if (file.downloadUrl) {
      actions.push(
        Action({
          title: '复制下载地址',
          icon: Icon.Clipboard,
          onAction: () => copyWithToast(file.downloadUrl, '已复制下载地址', file.downloadUrl)
        })
      )
    }
    actions.push(
      Action({
        title: file.shared ? '暂停共享该文件' : '恢复共享该文件',
        icon: file.shared ? Icon.Pause : Icon.Play,
        shortcut: { modifiers: ['ctrl'], key: 'return' },
        onAction: () => handleToggle(file)
      }),
      Action({
        title: '从共享列表移除（不删除文件）',
        icon: Icon.XMarkCircle,
        onAction: () => handleRemove(file)
      })
    )
    return List.Item({
      id: `lan-file-${file.id}`,
      title: file.name,
      subtitle: file.path,
      icon: Icon.Document,
      accessories: [
        { tag: { value: file.isDirectory ? '文件夹' : file.shared ? '共享中' : '已暂停' } },
        { text: formatBytes(file.sizeBytes) }
      ],
      detail: List.Item.Detail({ markdown: fileDetail(file, status) }),
      actions: ActionPanel({ title: file.name, children: actions })
    })
  })

  return List({
    navigationTitle: '局域网传文件',
    searchBarPlaceholder: '搜索共享的文件名或路径',
    onSearchTextChange: setSearchText,
    isShowingDetail: true,
    isLoading,
    filterBar: {
      summaryText: !status.ok
        ? `读取失败：${status.error || ''}`
        : status.running
        ? `共享中 ${status.portalUrl} · ${downloadable} 个文件可下载`
        : `共享服务未运行 · 列表中 ${status.files.length} 个文件`,
      actions: [
        {
          id: 'add-files',
          label: '选择文件并共享',
          title: '选择文件并共享',
          style: 'secondary',
          // 顶栏按钮由宿主直接调用、不会兜底 rejected promise，失败在函数内提示
          onAction: () => void handleAddFiles()
        },
        {
          id: 'refresh-lan',
          label: '刷新',
          title: '刷新',
          style: 'secondary',
          onAction: () => void refresh(true)
        }
      ]
    },
    children: [
      List.Section({ title: '共享服务', children: [serviceItem] }),
      List.Section({ title: `共享的文件 (${filtered.length})`, children: fileItems })
    ]
  })
}

export default LanShareCommand
