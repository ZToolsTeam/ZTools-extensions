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
  buildFolders,
  buildFoldersFromHost,
  type FolderItem,
  type HostFolderPaths
} from './logic.js'
import { callHostTransport, getRealSystemPath } from './native-ipc.js'

/**
 * 读取常用目录：优先用宿主的 system_list_common_folders（按平台生成、标明是否存在，并把存在的目录授权给本窗口打开）；
 * 旧宿主没有该方法（或返回结构不对）时回落到逐个 system_get_path 再按系统约定拼路径。
 */
async function loadFolders(): Promise<FolderItem[]> {
  const res = await callHostTransport<{ folders?: unknown }>('system_list_common_folders', {})
  if (res.ok) {
    const list = buildFoldersFromHost(res.data?.folders)
    if (list) return list
  }
  // 不读 'temp'：旧宿主返回的是 ZTools 自己的缓存目录，临时文件夹由 buildFolders 按系统约定生成
  const names = ['home', 'desktop', 'downloads', 'documents', 'pictures', 'videos', 'music', 'appData'] as const
  const values = await Promise.all(names.map((name) => getRealSystemPath(name)))
  const paths = Object.fromEntries(names.map((name, i) => [name, values[i] || ''])) as unknown as HostFolderPaths
  return buildFolders(paths)
}

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

export default function QuickFoldersCommand() {
  const [searchText, setSearchText] = useState('')
  const [folders, setFolders] = useState<FolderItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    // 从宿主读取当前用户的真实目录，不再写死 C:\Users\Default；读取失败时如实显示宿主给出的原因
    loadFolders()
      .then(
        (list) => ({ list, error: list.length === 0 ? '没有读到当前用户的常用目录' : '' }),
        (err: unknown) => ({ list: [] as FolderItem[], error: err instanceof Error ? err.message : String(err) })
      )
      .then(({ list, error }) => {
        if (!alive) return
        setFolders(list)
        setLoading(false)
        if (error) void showToast({ style: Toast.Style.Failure, title: '读取系统目录失败', message: error })
      })
    return () => { alive = false }
  }, [])

  async function openFolder(folder: FolderItem) {
    const res = await callHostTransport('shell_open_path', { fullPath: folder.path })
    await showToast(res.ok
      ? { style: Toast.Style.Success, title: '已打开目录', message: folder.path }
      : { style: Toast.Style.Failure, title: '打开目录失败', message: res.error ? `${folder.path}：${res.error}` : folder.path })
  }

  const query = searchText.trim().toLowerCase()
  const filtered = folders.filter(f => {
    if (!query) return true
    return (
      f.name.toLowerCase().includes(query) ||
      f.path.toLowerCase().includes(query) ||
      f.description.toLowerCase().includes(query) ||
      (f.keywords || []).some(k => k.toLowerCase().includes(query))
    )
  })

  const personal = filtered.filter(f => f.category === 'personal')
  const system = filtered.filter(f => f.category === 'system')
  const temp = filtered.filter(f => f.category === 'temp')

  function renderFolderItem(f: FolderItem) {
    return List.Item({
      id: f.id,
      title: f.name,
      subtitle: f.path,
      icon: Icon.Folder,
      keywords: f.keywords,
      accessories: [
        {
          text: f.description
        }
      ],
      actions: ActionPanel({
        title: f.name,
        children: [
          Action({
            title: '打开目录',
            icon: Icon.ArrowRight,
            onAction: () => openFolder(f)
          }),
          Action({
            title: '复制完整路径',
            icon: Icon.Clipboard,
            shortcut: { modifiers: ['ctrl'], key: 'c' },
            onAction: () => copyWithToast(f.path, '已复制路径', f.path)
          })
        ]
      })
    })
  }

  return List({
    isLoading: loading,
    searchBarPlaceholder: '搜索常用目录，如 桌面、下载、资源库、临时',
    onSearchTextChange: setSearchText,
    children: [
      personal.length > 0 &&
        List.Section({
          title: `个人常用目录 (${personal.length})`,
          children: personal.map(renderFolderItem)
        }),
      system.length > 0 &&
        List.Section({
          title: `系统与配置目录 (${system.length})`,
          children: system.map(renderFolderItem)
        }),
      temp.length > 0 &&
        List.Section({
          title: `临时与缓存目录 (${temp.length})`,
          children: temp.map(renderFolderItem)
        })
    ].filter(Boolean)
  })
}
