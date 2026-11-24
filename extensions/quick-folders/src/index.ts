import {
  List,
  Form,
  ActionPanel,
  Action,
  Icon,
  Clipboard,
  LocalStorage,
  useState,
  useEffect,
  useLocale,
  useNavigation,
  showToast,
  Toast
} from '@ztools/declarative-ui'
import {
  addCustomFolder,
  buildFolders,
  buildFoldersFromHost,
  buildTerminalCdCommand,
  CUSTOM_FOLDERS_STORAGE_KEY,
  normalizeCustomFolders,
  removeCustomFolder,
  toCustomFolderItem,
  togglePinCustomFolder,
  type CustomFolderEntry,
  type FolderItem,
  type HostFolderPaths
} from './logic.js'
import { callHostTransport, getRealSystemPath } from './native-ipc.js'
import { t } from './i18n.js'

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

async function loadCustomFolders(): Promise<CustomFolderEntry[]> {
  try {
    const raw = await LocalStorage.getItem(CUSTOM_FOLDERS_STORAGE_KEY)
    return normalizeCustomFolders(raw)
  } catch {
    return []
  }
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
      title: t('copyFailedTitle'),
      message: err instanceof Error ? err.message : String(err)
    })
    return
  }
  await showToast({ style: Toast.Style.Success, title: successTitle, message: successMessage })
}

function AddCustomFolderForm(props: {
  onSave: (input: { path: string; name?: string }) => Promise<string | null>
}) {
  useLocale()
  const { pop } = useNavigation()
  const [folderPath, setFolderPath] = useState('')
  const [folderName, setFolderName] = useState('')
  const [pathError, setPathError] = useState('')

  async function handleSubmit() {
    const err = await props.onSave({ path: folderPath, name: folderName })
    if (err) {
      setPathError(err)
      return
    }
    pop()
  }

  return Form({
    navigationTitle: t('formTitle'),
    actions: ActionPanel({
      children: [
        Action.SubmitForm({
          title: t('formSubmitAction'),
          icon: Icon.Checkmark,
          onSubmit: () => handleSubmit()
        })
      ]
    }),
    children: [
      Form.TextField({
        id: 'path',
        title: t('formPathLabel'),
        placeholder: t('formPathPlaceholder'),
        value: folderPath,
        error: pathError || undefined,
        autoFocus: true,
        onChange: (value: string) => {
          setFolderPath(value)
          if (pathError) setPathError('')
        }
      }),
      Form.TextField({
        id: 'name',
        title: t('formNameLabel'),
        placeholder: t('formNamePlaceholder'),
        value: folderName,
        onChange: setFolderName
      })
    ]
  })
}

export default function QuickFoldersCommand() {
  useLocale()
  const { push } = useNavigation()
  const [searchText, setSearchText] = useState('')
  const [folders, setFolders] = useState<FolderItem[]>([])
  const [customFolders, setCustomFolders] = useState<CustomFolderEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    // 从宿主读取当前用户的真实目录，不再写死 C:\Users\Default；读取失败时如实显示宿主给出的原因
    Promise.all([
      loadFolders().then(
        (list) => ({ list, error: list.length === 0 ? t('noFoldersError') : '' }),
        (err: unknown) => ({ list: [] as FolderItem[], error: err instanceof Error ? err.message : String(err) })
      ),
      loadCustomFolders()
    ]).then(([sysResult, customList]) => {
      if (!alive) return
      setFolders(sysResult.list)
      setCustomFolders(customList)
      setLoading(false)
      if (sysResult.error) void showToast({ style: Toast.Style.Failure, title: t('loadFailedTitle'), message: sysResult.error })
    })
    return () => { alive = false }
  }, [])

  async function persistCustomFolders(next: CustomFolderEntry[]): Promise<boolean> {
    try {
      await LocalStorage.setItem(CUSTOM_FOLDERS_STORAGE_KEY, next)
      setCustomFolders(next)
      return true
    } catch (err) {
      await showToast({
        style: Toast.Style.Failure,
        title: t('toastSaveFailed'),
        message: err instanceof Error ? err.message : String(err)
      })
      return false
    }
  }

  async function saveCustomFolder(input: { path: string; name?: string }): Promise<string | null> {
    const result = addCustomFolder(customFolders, input)
    if (!result.ok) {
      const msg = t(result.errorKey)
      await showToast({ style: Toast.Style.Failure, title: t('toastSaveFailed'), message: msg })
      return msg
    }
    const saved = await persistCustomFolders(result.list)
    if (!saved) return t('toastSaveFailed')
    await showToast({ style: Toast.Style.Success, title: t('toastFolderAdded'), message: result.added.path })
    return null
  }

  function openManualAddForm() {
    push(() => AddCustomFolderForm({ onSave: saveCustomFolder }))
  }

  async function pickAndAddFolder() {
    const res = await callHostTransport<{ canceled?: boolean; folderPath?: string; filePaths?: string[] }>(
      'window_show_select_folder_dialog',
      { title: t('addFolderAction') }
    )
    if (!res.ok) {
      if (res.errorCode === 'METHOD_NOT_AVAILABLE' || res.errorCode === 'NOT_SUPPORTED') {
        openManualAddForm()
        return
      }
      await showToast({
        style: Toast.Style.Failure,
        title: t('toastSelectDialogFailed'),
        message: res.error
      })
      return
    }
    if (res.data?.canceled) return
    const selectedPath = String(res.data?.folderPath || res.data?.filePaths?.[0] || '').trim()
    if (!selectedPath) return
    await saveCustomFolder({ path: selectedPath })
  }

  async function handleTogglePin(id: string) {
    const { list, pinned } = togglePinCustomFolder(customFolders, id)
    if (await persistCustomFolders(list)) {
      await showToast({ style: Toast.Style.Success, title: pinned ? t('toastFolderPinned') : t('toastFolderUnpinned') })
    }
  }

  async function handleRemoveCustom(id: string) {
    const next = removeCustomFolder(customFolders, id)
    if (await persistCustomFolders(next)) {
      await showToast({ style: Toast.Style.Success, title: t('toastFolderRemoved') })
    }
  }

  async function openFolder(folder: FolderItem) {
    const res = await callHostTransport('shell_open_path', { fullPath: folder.path })
    await showToast(res.ok
      ? { style: Toast.Style.Success, title: t('openedTitle'), message: folder.path }
      : { style: Toast.Style.Failure, title: t('openFailedTitle'), message: res.error ? `${folder.path}：${res.error}` : folder.path })
  }

  const allFolders = [...customFolders.map(toCustomFolderItem), ...folders]
  const query = searchText.trim().toLowerCase()
  const filtered = allFolders.filter(f => {
    if (!query) return true
    return (
      f.name.toLowerCase().includes(query) ||
      f.path.toLowerCase().includes(query) ||
      f.description.toLowerCase().includes(query) ||
      (f.keywords || []).some(k => k.toLowerCase().includes(query))
    )
  })

  const custom = filtered.filter(f => f.category === 'custom')
  const personal = filtered.filter(f => f.category === 'personal')
  const system = filtered.filter(f => f.category === 'system')
  const temp = filtered.filter(f => f.category === 'temp')

  function renderFolderItem(f: FolderItem) {
    const isCustom = f.category === 'custom'
    const cdCommand = buildTerminalCdCommand(f.path)
    return List.Item({
      id: f.id,
      title: f.name,
      subtitle: f.path,
      icon: isCustom && f.pinned ? Icon.Pin : Icon.Folder,
      keywords: f.keywords,
      accessories: [
        ...(isCustom && f.pinned ? [{ tag: t('pinnedTag') }] : []),
        {
          text: f.description
        }
      ],
      actions: ActionPanel({
        title: f.name,
        children: [
          Action({
            title: t('openAction'),
            icon: Icon.ArrowRight,
            onAction: () => openFolder(f)
          }),
          Action({
            title: t('copyPathAction'),
            icon: Icon.Clipboard,
            shortcut: { modifiers: ['ctrl'], key: 'c' },
            onAction: () => copyWithToast(f.path, t('copiedPathTitle'), f.path)
          }),
          Action({
            title: t('copyTerminalCdAction'),
            icon: Icon.Terminal,
            shortcut: { modifiers: ['ctrl', 'shift'], key: 't' },
            onAction: () => copyWithToast(cdCommand, t('copiedTerminalCdTitle'), cdCommand)
          }),
          ...(isCustom
            ? [
                Action({
                  title: f.pinned ? t('unpinFolderAction') : t('pinFolderAction'),
                  icon: Icon.Pin,
                  onAction: () => handleTogglePin(f.id)
                }),
                Action({
                  title: t('removeFolderAction'),
                  icon: Icon.Trash,
                  style: Action.Style.Destructive,
                  onAction: () => handleRemoveCustom(f.id)
                })
              ]
            : [])
        ]
      })
    })
  }

  return List({
    isLoading: loading,
    searchBarPlaceholder: t('searchPlaceholder'),
    onSearchTextChange: setSearchText,
    filterBar: {
      summaryText: t('summaryText', { systemCount: folders.length, customCount: customFolders.length }),
      actions: [
        { id: 'add-folder', title: t('addFolderAction'), icon: Icon.Plus, onAction: () => pickAndAddFolder() },
        { id: 'manual-add-folder', title: t('manualAddFolderAction'), icon: Icon.Pencil, onAction: () => openManualAddForm() }
      ]
    },
    children: [
      custom.length > 0 &&
        List.Section({
          title: t('sectionCustom', { count: custom.length }),
          children: custom.map(renderFolderItem)
        }),
      personal.length > 0 &&
        List.Section({
          title: t('sectionPersonal', { count: personal.length }),
          children: personal.map(renderFolderItem)
        }),
      system.length > 0 &&
        List.Section({
          title: t('sectionSystem', { count: system.length }),
          children: system.map(renderFolderItem)
        }),
      temp.length > 0 &&
        List.Section({
          title: t('sectionTemp', { count: temp.length }),
          children: temp.map(renderFolderItem)
        })
    ].filter(Boolean)
  })
}
