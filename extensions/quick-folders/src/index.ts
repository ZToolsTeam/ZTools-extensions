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
  type FolderItem,
  type HostFolderPaths
} from './logic'
import { getRealSystemPath, openRealPath } from './native-ipc.js'

export default function QuickFoldersCommand() {
  const [searchText, setSearchText] = useState('')
  const [folders, setFolders] = useState<FolderItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // 从宿主读取当前用户的真实目录，不再写死 C:\Users\Default
    const names = ['home', 'desktop', 'downloads', 'documents', 'pictures', 'videos', 'music', 'appData', 'temp'] as const
    Promise.all(names.map((name) => getRealSystemPath(name))).then((values) => {
      const paths = Object.fromEntries(names.map((name, i) => [name, values[i] || ''])) as unknown as HostFolderPaths
      const list = buildFolders(paths)
      setFolders(list)
      setLoading(false)
      if (list.length === 0) {
        showToast({ style: Toast.Style.Failure, title: '读取系统目录失败', message: '没有读到当前用户的主目录' })
      }
    })
  }, [])

  async function openFolder(folder: FolderItem) {
    const ok = await openRealPath(folder.path)
    showToast(ok
      ? { style: Toast.Style.Success, title: '已打开目录', message: folder.path }
      : { style: Toast.Style.Failure, title: '打开目录失败', message: folder.path })
  }

  const query = searchText.trim().toLowerCase()
  const filtered = folders.filter(f => {
    if (!query) return true
    return (
      f.name.toLowerCase().includes(query) ||
      f.path.toLowerCase().includes(query) ||
      f.description.toLowerCase().includes(query)
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
            onAction: () => {
              Clipboard.copy(f.path)
              showToast({
                style: Toast.Style.Success,
                title: '已复制路径',
                message: f.path
              })
            }
          })
        ]
      })
    })
  }

  return List({
    isLoading: loading,
    searchBarPlaceholder: '搜索常用目录 (如 桌面, Downloads, Library, Temp)...',
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
