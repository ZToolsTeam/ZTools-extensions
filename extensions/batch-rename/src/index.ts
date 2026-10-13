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
} from '@ztools/raycast-compat'
import {
  batchApplyRename,
  getSampleFiles,
  type RenameRule,
  type RenameResultItem
} from './logic'

export default function BatchRenameCommand() {
  const [files] = useState<string[]>(getSampleFiles())
  const [currentRule, setCurrentRule] = useState<RenameRule>({
    type: 'prefix',
    prefix: '2026_'
  })
  const [results, setResults] = useState<RenameResultItem[]>([])

  useEffect(() => {
    const list = batchApplyRename(files, currentRule)
    setResults(list)
  }, [files, currentRule])

  function setRuleMode(mode: 'prefix' | 'number' | 'lower' | 'replace') {
    if (mode === 'prefix') {
      setCurrentRule({ type: 'prefix', prefix: '2026_' })
      showToast({ style: Toast.Style.Success, title: '规则切换为: 添加前缀 2026_' })
    } else if (mode === 'number') {
      setCurrentRule({ type: 'number', startNumber: 1, padDigits: 3 })
      showToast({ style: Toast.Style.Success, title: '规则切换为: 尾部序号 _001, _002...' })
    } else if (mode === 'lower') {
      setCurrentRule({ type: 'case', caseMode: 'lower' })
      showToast({ style: Toast.Style.Success, title: '规则切换为: 全小写扩展名与主名' })
    } else if (mode === 'replace') {
      setCurrentRule({ type: 'replace', find: 'IMG_', replace: 'PHOTO_' })
      showToast({ style: Toast.Style.Success, title: '规则切换为: 替换 IMG_ 为 PHOTO_' })
    }
  }

  function copyAllNewNames() {
    const text = results.map(r => `${r.oldName} -> ${r.newName}`).join('\n')
    Clipboard.copy(text)
    showToast({
      style: Toast.Style.Success,
      title: '已复制全部新文件名清单'
    })
  }

  return List({
    searchBarPlaceholder: '批量重命名实时预览 (按 Ctrl+1/2/3 切换规则模式)...',
    children: [
      List.Section({
        title: `重命名实时预览 (${results.filter(r => r.changed).length} 项将变更)`,
        children: results.map(item =>
          List.Item({
            id: item.id,
            title: item.newName,
            subtitle: `原名: ${item.oldName}`,
            icon: {
              source: item.changed ? Icon.ArrowRightCircle : Icon.CheckCircle,
              tintColor: item.changed ? Color.Green : Color.SecondaryText
            },
            accessories: [
              {
                tag: {
                  value: item.changed ? '待重命名' : '保持不变',
                  color: item.changed ? Color.Green : Color.SecondaryText
                }
              }
            ],
            actions: ActionPanel({
              title: item.newName,
              children: [
                Action({
                  title: '复制新文件名',
                  icon: Icon.Clipboard,
                  onAction: () => {
                    Clipboard.copy(item.newName)
                    showToast({
                      style: Toast.Style.Success,
                      title: '已复制新文件名',
                      message: item.newName
                    })
                  }
                }),
                Action({
                  title: '复制全部重命名清单',
                  icon: Icon.Document,
                  shortcut: { modifiers: ['ctrl'], key: 'c' },
                  onAction: copyAllNewNames
                }),
                Action({
                  title: '切换为: 添加前缀 (2026_)',
                  icon: Icon.Circle,
                  shortcut: { modifiers: ['ctrl'], key: '1' },
                  onAction: () => setRuleMode('prefix')
                }),
                Action({
                  title: '切换为: 尾部序号 (_001, _002)',
                  icon: Icon.Circle,
                  shortcut: { modifiers: ['ctrl'], key: '2' },
                  onAction: () => setRuleMode('number')
                }),
                Action({
                  title: '切换为: 扩展名与主名全小写',
                  icon: Icon.Circle,
                  shortcut: { modifiers: ['ctrl'], key: '3' },
                  onAction: () => setRuleMode('lower')
                }),
                Action({
                  title: '切换为: 替换 IMG_ 为 PHOTO_',
                  icon: Icon.Circle,
                  shortcut: { modifiers: ['ctrl'], key: '4' },
                  onAction: () => setRuleMode('replace')
                })
              ]
            })
          })
        )
      })
    ]
  })
}
