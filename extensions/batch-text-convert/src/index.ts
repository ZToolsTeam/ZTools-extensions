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
  convertTextToAllEncodings,
  countLineBreaks,
  type ConversionResult
} from './logic.js'

/** 读取剪贴板原文的长度上限（字符）：再长的文本编码结果会超过剪贴板写入上限，界面也会明显卡顿 */
export const MAX_CLIPBOARD_SOURCE_CHARS = 200000

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = String((error as { message?: unknown }).message || '')
    if (message) return message
  }
  return String(error || '未知错误')
}

/**
 * 复制文本：等宿主确认写入成功后才提示成功，失败时提示原因（不能假装已复制）
 */
async function copyWithToast(text: string, successTitle: string, successMessage: string): Promise<void> {
  try {
    await Clipboard.copy(text)
  } catch (error) {
    await showToast({
      style: Toast.Style.Failure,
      title: '复制失败',
      message: errorMessage(error)
    })
    return
  }
  await showToast({
    style: Toast.Style.Success,
    title: successTitle,
    message: successMessage
  })
}

export default function BatchTextConvertCommand() {
  const [inputText, setInputText] = useState('')
  const [results, setResults] = useState<ConversionResult[]>([])

  useEffect(() => {
    const list = convertTextToAllEncodings(inputText)
    setResults(list)
  }, [inputText])

  /**
   * 搜索框是单行输入框，粘贴进去的换行会被浏览器去掉；
   * 多行文本（JSON、证书、脚本）改为直接读取剪贴板原文，保留换行后再编码
   */
  async function readClipboardSource() {
    let text = ''
    try {
      text = String((await Clipboard.readText()) ?? '')
    } catch (error) {
      await showToast({ style: Toast.Style.Failure, title: '读取剪贴板失败', message: errorMessage(error) })
      return
    }
    if (!text) {
      await showToast({ style: Toast.Style.Failure, title: '剪贴板里没有文本', message: '先复制要编码的文本，再执行此操作' })
      return
    }
    if (text.length > MAX_CLIPBOARD_SOURCE_CHARS) {
      await showToast({
        style: Toast.Style.Failure,
        title: '剪贴板文本过长',
        message: `共 ${text.length} 个字符，最多支持 ${MAX_CLIPBOARD_SOURCE_CHARS} 个字符`
      })
      return
    }
    setInputText(text)
    const breaks = countLineBreaks(text)
    await showToast({
      style: Toast.Style.Success,
      title: '已读取剪贴板文本',
      message: breaks > 0 ? `${text.length} 个字符，含 ${breaks} 处换行` : `${text.length} 个字符`
    })
  }

  const readClipboardAction = Action({
    title: '读取剪贴板文本（保留换行）',
    icon: Icon.Clipboard,
    onAction: readClipboardSource
  })

  const lineBreaks = countLineBreaks(inputText)
  const sectionTitle = !inputText
    ? '字符编码'
    : lineBreaks > 0
      ? `字符编码结果（原文含 ${lineBreaks} 处换行，在搜索框继续输入会改为单行文本）`
      : '字符编码结果'

  const items = !inputText
    ? [
        List.Item({
          id: 'empty-guide',
          title: '在搜索框输入文本，实时查看 Unicode 转义、UTF-8 Hex、Base64、URL 编码',
          subtitle: '多行文本请先复制，再按 ↵ 读取剪贴板（搜索框会去掉换行）',
          icon: Icon.Text,
          actions: ActionPanel({ title: '编码转换', children: [readClipboardAction] })
        })
      ]
    : results.map(item =>
        List.Item({
          id: item.id,
          title: item.encoded || '(空)',
          subtitle: item.name,
          icon: Icon.Text,
          accessories: [
            {
              text: item.description
            }
          ],
          actions: ActionPanel({
            title: item.name,
            children: [
              Action({
                title: '复制编码结果',
                icon: Icon.Clipboard,
                onAction: () => copyWithToast(item.encoded, `已复制 ${item.name}`, item.encoded)
              }),
              // 次动作用 ⌘↵ / Ctrl+Enter 触发，不再绑定 ctrl+c（macOS 上等于 ⌘C，会抢走输入框的系统复制）
              Action({
                title: '复制格式名称',
                icon: Icon.Document,
                onAction: () => copyWithToast(item.name, '已复制名称', item.name)
              }),
              readClipboardAction
            ]
          })
        })
      )

  return List({
    searchBarPlaceholder: '输入文本实时查看多编码转换 (Unicode, Hex, Base64, URL)...',
    searchText: inputText,
    onSearchTextChange: setInputText,
    children: [
      List.Section({
        title: sectionTitle,
        children: items
      })
    ]
  })
}
