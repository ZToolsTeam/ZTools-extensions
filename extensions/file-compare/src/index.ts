import {
  List,
  Form,
  ActionPanel,
  Action,
  Icon,
  Clipboard,
  showToast,
  Toast,
  useState,
  useNavigation
} from '@ztools/declarative-ui'
import { diffText, formatHunk, formatUnifiedDiff, describeHunk, type DiffResult } from './logic.js'
import { pickTextFile } from './host.js'

export * from './logic.js'

interface Side {
  name: string
  text: string
}

/**
 * 编辑左右两段文本的表单
 */
export function EditTextsForm({ left, right, onSave }: { left: Side; right: Side; onSave: (left: Side, right: Side) => void }) {
  const { pop } = useNavigation()
  const [a, setA] = useState(left.text)
  const [b, setB] = useState(right.text)
  return Form(
    {
      navigationTitle: '填写要对比的两段文本',
      actions: ActionPanel({ title: '对比' }, [
        Action.SubmitForm({
          title: '开始对比',
          icon: Icon.Check,
          onSubmit: () => {
            onSave({ name: a === left.text ? left.name : '左侧', text: a }, { name: b === right.text ? right.name : '右侧', text: b })
            pop()
          }
        }),
        Action({ title: '返回', icon: Icon.ArrowLeft, onAction: () => pop() })
      ])
    },
    [
      Form.TextArea({ id: 'left', title: '左侧（原文）', placeholder: '粘贴原始文本', value: a, onChange: (v: string) => setA(v) }),
      Form.TextArea({ id: 'right', title: '右侧（新文）', placeholder: '粘贴修改后的文本', value: b, onChange: (v: string) => setB(v) })
    ]
  )
}

export function FileCompareCommand() {
  const [left, setLeft] = useState<Side>({ name: '左侧', text: '' })
  const [right, setRight] = useState<Side>({ name: '右侧', text: '' })
  const [ignoreWhitespace, setIgnoreWhitespace] = useState(false)
  const { push } = useNavigation()

  const ready = left.text.length > 0 || right.text.length > 0
  let result: DiffResult | null = null
  let error = ''
  if (ready) {
    try {
      result = diffText(left.text, right.text, { ignoreWhitespace })
    } catch (err: any) {
      error = err?.message || String(err)
    }
  }
  const report = result ? formatUnifiedDiff(result, left.name, right.name) : ''

  const openEditor = () =>
    push(() => EditTextsForm({ left, right, onSave: (l, r) => { setLeft(l); setRight(r) } }))

  const pasteInto = async (side: 'left' | 'right') => {
    const text = await Clipboard.readText()
    if (!text) {
      await showToast(Toast.Style.Failure, '剪贴板里没有文字')
      return
    }
    side === 'left' ? setLeft({ name: '剪贴板', text }) : setRight({ name: '剪贴板', text })
    await showToast(Toast.Style.Success, side === 'left' ? '已设为左侧' : '已设为右侧')
  }

  const pickFile = async (side: 'left' | 'right') => {
    try {
      const file = await pickTextFile(side === 'left' ? '选择左侧（原文）文件' : '选择右侧（新文）文件')
      if (!file) return
      side === 'left' ? setLeft({ name: file.name, text: file.text }) : setRight({ name: file.name, text: file.text })
    } catch (err: any) {
      await showToast(Toast.Style.Failure, '读取文件失败', err?.message || String(err))
    }
  }

  const sourceActions = [
    Action({ title: '编辑两段文本…', icon: Icon.Pencil, onAction: openEditor }),
    Action({ title: '剪贴板内容设为左侧', icon: Icon.CopyClipboard, onAction: () => pasteInto('left') }),
    Action({ title: '剪贴板内容设为右侧', icon: Icon.CopyClipboard, onAction: () => pasteInto('right') }),
    Action({ title: '选择文件作为左侧…', icon: Icon.Document, onAction: () => pickFile('left') }),
    Action({ title: '选择文件作为右侧…', icon: Icon.Document, onAction: () => pickFile('right') }),
    Action({ title: '交换左右', icon: Icon.Repeat, onAction: () => { const l = left; setLeft(right); setRight(l) } }),
    Action({ title: ignoreWhitespace ? '恢复比较空白字符' : '忽略空白差异', icon: Icon.Text, onAction: () => setIgnoreWhitespace(!ignoreWhitespace) }),
    Action({ title: '清空', icon: Icon.Trash, onAction: () => { setLeft({ name: '左侧', text: '' }); setRight({ name: '右侧', text: '' }) } })
  ]

  const reportActions = report
    ? [Action({ title: '复制差异报告', icon: Icon.CopyClipboard, onAction: async () => { await Clipboard.copy(report); await showToast(Toast.Style.Success, '已复制差异报告（unified diff）') } })]
    : []

  let sections: any[]
  if (!ready) {
    sections = [
      List.Section({ title: '开始' }, [
        List.Item({ id: 'start-edit', title: '粘贴两段文本进行对比', subtitle: '按回车打开编辑框', icon: Icon.Pencil, actions: ActionPanel({ title: '开始' }, sourceActions) }),
        List.Item({ id: 'start-file', title: '选择两个文件对比', subtitle: 'UTF-8 文本文件，单个不超过 4 MB', icon: Icon.Document, actions: ActionPanel({ title: '开始' }, [sourceActions[3], sourceActions[4], sourceActions[0]]) }),
        List.Item({ id: 'start-clip', title: '用剪贴板内容对比', subtitle: '先复制原文设为左侧，再复制新文设为右侧', icon: Icon.CopyClipboard, actions: ActionPanel({ title: '开始' }, [sourceActions[1], sourceActions[2], sourceActions[0]]) })
      ])
    ]
  } else if (error) {
    sections = [List.Section({ title: '无法对比' }, [List.Item({ id: 'error', title: error, icon: Icon.ExclamationMark, actions: ActionPanel({ title: '操作' }, sourceActions) })])]
  } else if (result && result.identical) {
    sections = [
      List.Section({ title: `${left.name} ↔ ${right.name}` }, [
        List.Item({
          id: 'identical',
          title: ignoreWhitespace ? '两段文本相同（已忽略空白差异）' : '两段文本完全相同',
          subtitle: `共 ${result.leftLines} 行`,
          icon: Icon.Checkmark,
          detail: List.Item.Detail({ markdown: '两侧内容一致，没有差异。' }),
          actions: ActionPanel({ title: '操作' }, sourceActions)
        })
      ])
    ]
  } else if (result) {
    sections = [
      List.Section(
        { title: `${left.name} ↔ ${right.name} · 删除 ${result.removed} 行，新增 ${result.added} 行 · ${result.hunks.length} 处差异` },
        result.hunks.map((h, i) =>
          List.Item({
            id: `hunk-${i}`,
            title: `第 ${Math.max(h.rightStart, 1)} 行附近`,
            subtitle: describeHunk(h),
            icon: Icon.Document,
            detail: List.Item.Detail({ markdown: '```diff\n' + formatHunk(h) + '\n```' }),
            actions: ActionPanel({ title: '差异' }, [
              ...reportActions,
              Action({ title: '复制这一处差异', icon: Icon.CopyClipboard, onAction: async () => { await Clipboard.copy(formatHunk(h)); await showToast(Toast.Style.Success, '已复制') } }),
              ...sourceActions
            ])
          })
        )
      )
    ]
  } else {
    sections = []
  }

  return List(
    {
      navigationTitle: '文本对比',
      isShowingDetail: Boolean(result && result.hunks.length > 0) || Boolean(result?.identical),
      searchBarPlaceholder: '按回车编辑文本，Ctrl+K 查看更多操作',
      actions: ActionPanel({ title: '全局操作' }, [...reportActions, ...sourceActions])
    },
    sections
  )
}

export default FileCompareCommand
