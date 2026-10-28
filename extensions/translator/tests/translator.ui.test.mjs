import test from 'node:test'
import assert from 'node:assert/strict'
import { getDeclarativeBridge } from '@ztools/declarative-ui'
import { createHost, mount, tick } from '../../shared/test-harness.mjs'
import TranslatorCommand from '../dist/index.js'

const host = createHost()

function installTranslator(dict = { 请查收附件: 'Please find attached', meeting: '会议', 季度报告: 'Quarterly report' }) {
  host.ipc.translator_translate = async ({ text, sourceLanguage, targetLanguage }) => {
    if (!(text in dict)) {
      throw Object.assign(new Error('宿主内部错误'), { code: 'INTERNAL_ERROR' })
    }
    return { originalText: text, translatedText: dict[text], sourceLanguage, targetLanguage, engine: 'offline' }
  }
  host.ipc.translator_get_history = async () => ({
    items: [
      { id: 'h-1', originalText: 'hello world', translatedText: '你好，世界', sourceLanguage: 'en', targetLanguage: 'zh-CN', timestamp: 1728000000000 }
    ]
  })
}

const translateCalls = () => host.ipcCalls.filter(([m]) => m === 'translator_translate')

test.beforeEach(() => {
  host.reset()
  delete globalThis.__ztoolsLaunchContext
})

test('输入为空：显示输入提示，不去翻译任何内置句子；显示客户端的翻译记录，没有假的“清空记录”', async () => {
  installTranslator()
  const view = await mount(TranslatorCommand, host)
  await tick(10)

  const tree = view.tree()
  assert.equal(tree.type, 'List')
  assert.equal(tree.props.isShowingDetail, true)
  assert.equal(tree.props.searchBarAccessory, undefined, '方向固定为中英互译，不再提供无效的语种下拉框')
  assert.equal(/[\u{1F300}-\u{1FAFF}]/u.test(view.text()), false)

  const empty = view.item('translation-empty')
  assert.match(empty.props.title, /输入中文或英文/)
  assert.equal(translateCalls().length, 0)
  assert.equal(view.text().includes('quarterly financial report'), false)

  const hist = view.item('h-1')
  assert.equal(hist.props.title, '你好，世界')
  assert.deepEqual(view.actions(hist).map((a) => a.props.title), ['复制译文', '复制原文与译文'])
  assert.equal(view.text().includes('清空'), false)
  view.unmount()
})

test('翻译成功：一行译文，Enter 复制译文，次动作复制原文与译文，可复制英文变量名', async () => {
  installTranslator()
  const view = await mount(TranslatorCommand, host)
  await view.search('请查收附件')
  await tick(10)

  const item = view.item('translation-result')
  assert.equal(item.props.title, 'Please find attached')
  assert.equal(item.props.subtitle, '请查收附件')
  assert.equal(view.items().filter((i) => i.props.id.startsWith('variant-')).length, 0, '不再生成假的“商务润色”“术语精解”行')
  assert.deepEqual(view.actions(item).map((a) => a.props.title), [
    '复制译文',
    '复制原文与译文',
    '复制 camelCase 变量名',
    '复制 snake_case 变量名'
  ])
  assert.match(view.tree().props.filterBar.props.summaryText, /中文 → 英语 · 客户端离线词库/)

  await view.run(item, '复制译文')
  assert.equal(host.clipboard.text, 'Please find attached')
  await view.run(item, '复制原文与译文')
  assert.equal(host.clipboard.text, '请查收附件\nPlease find attached')
  await view.run(item, '复制 camelCase 变量名')
  assert.equal(host.clipboard.text, 'pleaseFindAttached')

  // 新的翻译进入最近记录
  assert.equal(view.items().some((i) => i.props.title === 'Please find attached' && i.props.id.startsWith('hist-')), true)
  view.unmount()
})

test('[故障注入] 未收录或接口失败：列表显示“未能翻译”与原因，旧译文被清掉，不显示假译文', async () => {
  installTranslator()
  const view = await mount(TranslatorCommand, host)
  await view.search('meeting')
  await tick(10)
  assert.equal(view.item('translation-result').props.title, '会议')

  await view.search('Please find attached the quarterly financial report for your review.')
  await tick(10)
  const failed = view.item('translation-failed')
  assert.equal(failed.props.title, '未能翻译')
  assert.match(failed.props.subtitle, /宿主内部错误/)
  assert.match(failed.props.subtitle, /未收录的内容无法翻译/)
  assert.throws(() => view.item('translation-result'))
  assert.equal(view.tree().props.isLoading, false)

  // 清空输入回到提示
  await view.search('')
  await tick(5)
  assert.ok(view.item('translation-empty'))
  view.unmount()
})

test('[时序] 慢的旧请求晚于新请求返回时，不覆盖新输入的译文', async () => {
  installTranslator()
  let releaseSlow
  const slowGate = new Promise((r) => (releaseSlow = r))
  host.ipc.translator_translate = async ({ text, sourceLanguage, targetLanguage }) => {
    if (text === 'meeting') await slowGate
    const out = text === 'meeting' ? '会议' : 'Please find attached'
    return { originalText: text, translatedText: out, sourceLanguage, targetLanguage, engine: 'offline' }
  }
  const view = await mount(TranslatorCommand, host)
  await view.search('meeting')
  await view.search('请查收附件')
  await tick(10)
  assert.equal(view.item('translation-result').props.title, 'Please find attached')
  releaseSlow()
  await tick(10)
  assert.equal(view.item('translation-result').props.title, 'Please find attached')
  view.unmount()
})

test('翻译剪贴板：读取后填入搜索框并翻译；剪贴板为空或读取失败时如实提示，不发翻译请求', async () => {
  installTranslator()
  const view = await mount(TranslatorCommand, host)
  const pasteBtn = () => view.tree().props.filterBar.props.actions.find((a) => a.id === 'paste-translate-btn')

  host.clipboard.text = ''
  await pasteBtn().onAction()
  await tick(5)
  assert.equal(host.lastToast().title, '剪贴板里没有文字')
  assert.equal(translateCalls().length, 0)

  const bridge = getDeclarativeBridge()
  const realRead = bridge.readClipboardText
  bridge.readClipboardText = async () => {
    throw new Error('剪贴板被占用')
  }
  try {
    await pasteBtn().onAction()
    await tick(5)
    assert.equal(host.lastToast().title, '读取剪贴板失败')
    assert.match(host.lastToast().message, /剪贴板被占用/)
    assert.equal(translateCalls().length, 0)
  } finally {
    bridge.readClipboardText = realRead
  }

  host.clipboard.text = '  请查收附件  '
  await pasteBtn().onAction()
  await tick(10)
  assert.equal(view.tree().props.searchText, '请查收附件')
  assert.equal(view.item('translation-result').props.title, 'Please find attached')
  view.unmount()
})

test('[故障注入] 复制失败时提示失败，不提示“已复制”', async () => {
  installTranslator()
  const view = await mount(TranslatorCommand, host)
  await view.search('meeting')
  await tick(10)
  const bridge = getDeclarativeBridge()
  const realCopy = bridge.copyToClipboard
  bridge.copyToClipboard = async () => {
    throw new Error('剪贴板被占用')
  }
  try {
    await view.run(view.item('translation-result'), '复制译文')
    assert.equal(host.lastToast().title, '复制失败')
    assert.equal(host.toasts.some((t) => t.title === '已复制译文'), false)
  } finally {
    bridge.copyToClipboard = realCopy
  }
  view.unmount()
})

test('变量命名命令：中文经客户端翻译成英文后给出 camelCase，Enter 复制；英文原文直接转换不发请求', async () => {
  installTranslator()
  globalThis.__ztoolsLaunchContext = { pluginId: 'translator', featureCode: 'translate-naming' }
  const view = await mount(TranslatorCommand, host)
  assert.match(view.item('translation-empty').props.title, /英文变量名/)

  await view.search('季度报告')
  await tick(10)
  const item = view.item('translation-result')
  assert.equal(item.props.title, 'quarterlyReport')
  assert.deepEqual(view.actions(item).map((a) => a.props.title).slice(0, 3), [
    '复制 camelCase 变量名',
    '复制 snake_case 变量名',
    '复制 CONSTANT_CASE 常量名'
  ])
  await view.run(item, '复制 camelCase 变量名')
  assert.equal(host.clipboard.text, 'quarterlyReport')
  await view.run(item, '复制 snake_case 变量名')
  assert.equal(host.clipboard.text, 'quarterly_report')

  const before = translateCalls().length
  await view.search('user display name')
  await tick(10)
  assert.equal(translateCalls().length, before, '英文原文不需要翻译')
  const direct = view.item('translation-result')
  assert.equal(direct.props.title, 'userDisplayName')
  assert.equal(view.actions(direct).some((a) => a.props.title === '复制原文与译文'), false)
  view.unmount()
})

test('[故障注入] 读取翻译记录失败时显示失败原因，不影响翻译', async () => {
  installTranslator()
  host.ipc.translator_get_history = async () => {
    throw new Error('database is locked')
  }
  const view = await mount(TranslatorCommand, host)
  await tick(10)
  const failed = view.item('history-failed')
  assert.match(failed.props.subtitle, /database is locked/)
  await view.search('meeting')
  await tick(10)
  assert.equal(view.item('translation-result').props.title, '会议')
  view.unmount()
})

test('不在客户端里运行：只显示“需要在 ZTools 客户端中使用”，不显示示例译文或示例记录', async () => {
  const saved = globalThis.__ztoolsElectron
  delete globalThis.__ztoolsElectron
  try {
    const view = await mount(TranslatorCommand, host)
    await tick(5)
    const items = view.items()
    assert.equal(items.length, 1)
    assert.equal(items[0].props.id, 'translator-client-required')
    assert.equal(items[0].props.title, '需要在 ZTools 客户端中使用')
    view.unmount()
  } finally {
    globalThis.__ztoolsElectron = saved
  }
})
