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
  getDefaultFolders,
  type FolderItem
} from './logic'

declare const ztools: any

export default function QuickFoldersCommand() {
  const [searchText, setSearchText] = useState('')
  const [folders, setFolders] = useState<FolderItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // 探测系统实际环境变量
    let envOverrides: Record<string, string> | undefined
    if (typeof process !== 'undefined' && process.env) {
      envOverrides = {
        USERPROFILE: process.env.USERPROFILE || 'C:\\Users\\Default',
        APPDATA: process.env.APPDATA || '',
        LOCALAPPDATA: process.env.LOCALAPPDATA || '',
        WINDIR: process.env.WINDIR || 'C:\\Windows',
        TEMP: process.env.TEMP || ''
      }
    }
    setFolders(getDefaultFolders(envOverrides))
    setLoading(false)
  }, [])

  async function openFolder(folder: FolderItem) {
    try {
      if (typeof ztools !== 'undefined' && ztools.shell && ztools.shell.openPath) {
        await ztools.shell.openPath(folder.path)
      } else if (typeof ztools !== 'undefined' && ztools.shell && ztools.shell.openExternal) {
        await ztools.shell.openExternal(folder.path)
      }
      showToast({
        style: Toast.Style.Success,
        title: '已在资源管理器中打开',
        message: folder.path
      })
    } catch (err) {
      showToast({
        style: Toast.Style.Failure,
        title: '打开目录失败',
        message: String(err)
      })
    }
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
      icon: {
        source: Icon.Folder,
        tintColor: f.category === 'personal' ? Color.Yellow : f.category === 'system' ? Color.Blue : Color.Orange
      },
      accessories: [
        {
          text: f.description
        }
      ],
      actions: ActionPanel({
        title: f.name,
        children: [
          Action({
            title: '在资源管理器中打开',
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
    searchBarPlaceholder: '搜索高频目录 (如 桌面, Downloads, AppData, Temp)...',
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
