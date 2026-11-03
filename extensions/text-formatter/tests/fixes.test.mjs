import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { getDeclarativeBridge, Toast } from '@ztools/declarative-ui'
import { createHost, mount, mountPushed, tick } from '../../shared/test-harness.mjs'
import TextFormatterCommand, { PREVIEW_CHAR_LIMIT, textPreviewMarkdown } from '../dist/index.js'
import {
  convertToSimplified,
  convertToTraditional,
  toChinesePunctuation,
  toEnglishPunctuation,
  formatChineseSmart,
  splitChineseParagraphs,
  normalizeCjkSpacing,
  removeLineNumbers,
  addLineNumbers,
  formatMarkdown
} from '../dist/logic.js'

const host = createHost()
test.beforeEach(() => host.reset())

const MULTI = 'banana\n\n  apple  \nbanana\n3 apples\n2024 年会议纪要\n1. first item'
const detailOf = (view, id) => view.item(id).props.detail.props.markdown
const sourceSubtitle = (view) => view.item('source-text').props.subtitle

/** 从代码块里取出预览的原文 */
function previewBody(markdown) {
  const m = markdown.match(/^(`{3,})text\n([\s\S]*)\n\1/)
  assert.ok(m, `预览不是代码块：${markdown.slice(0, 80)}`)
  return m[2]
}

async function applyViaEditor(view, text) {
  await view.run(view.item('source-text'), '编辑待排版文本')
  const form = await mountPushed(host)
  await form.fill('text', text)
  await form.run(null, '应用文本')
  await tick()
  form.unmount()
}

// ---------------------------------------------------------------- text-formatter-1
test('多行正文走 TextArea 编辑页，换行完整保留，行操作按行处理', async () => {
  const view = await mount(TextFormatterCommand)
  assert.equal(view.tree().props.searchText, '', '搜索框不再承载正文')
  await applyViaEditor(view, MULTI)
  assert.equal(host.pushed.length, 0, '应用后返回列表')
  assert.match(sourceSubtitle(view), /当前文本 · 58 字符 · 7 行/)
  assert.equal(previewBody(detailOf(view, 'sort-lines-asc')).split('\n').length, 7)
  assert.equal(previewBody(detailOf(view, 'remove-empty-lines')), 'banana\n  apple  \nbanana\n3 apples\n2024 年会议纪要\n1. first item')
  assert.equal(previewBody(detailOf(view, 'dedupe-lines')).split('\n').filter((l) => l === 'banana').length, 1)
})

test('编辑页预填当前文本；清空后应用回到示例文本', async () => {
  const view = await mount(TextFormatterCommand)
  await applyViaEditor(view, 'a\nb')
  await view.run(view.item('source-text'), '编辑待排版文本')
  const form = await mountPushed(host)
  assert.equal(form.field('text').props.value, 'a\nb', '再次编辑时带出原文（含换行）')
  await form.fill('text', '')
  await form.run(null, '应用文本')
  await tick()
  assert.match(sourceSubtitle(view), /^示例文本/)
  assert.equal(host.lastToast().title, '已清空，使用示例文本')
})

test('从剪贴板读取多行文本后，在搜索框输入只筛选转换项，不会覆盖或拍平正文', async () => {
  host.clipboard.text = MULTI
  const view = await mount(TextFormatterCommand)
  await view.run(view.item('source-text'), '从剪贴板粘贴文本')
  assert.match(sourceSubtitle(view), /7 行/)

  await view.search('行号')
  const ids = view.items().map((i) => i.props.id)
  assert.deepEqual(ids, ['add-line-numbers', 'remove-line-numbers'], '筛选时隐藏待排版文本行，回车直接执行转换')
  assert.equal(previewBody(detailOf(view, 'add-line-numbers')).split('\n').length, 7, '正文仍是 7 行')

  // 筛选词与分类组合；无匹配时列表为空，不报错
  await view.dropdown('case')
  assert.equal(view.items().length, 0)
  await view.search('UPPER')
  assert.deepEqual(view.items().map((i) => i.props.id), ['upper-case'])
  await view.search('')
  await view.dropdown('all')
  assert.ok(view.items().some((i) => i.props.id === 'source-text'))
  assert.match(sourceSubtitle(view), /7 行/)
})

test('结果标题去掉纯英文翻译括注，命名格式名保留，英文仍可搜索', async () => {
  const view = await mount(TextFormatterCommand)
  const titles = view.items().filter((i) => i.props.id !== 'source-text').map((i) => i.props.title)
  for (const title of titles) {
    const inner = /\(([^)]*)\)/.exec(title)?.[1]
    if (inner && !['camelCase', 'snake_case', 'kebab-case'].includes(inner)) assert.doesNotMatch(inner, /^[A-Za-z][A-Za-z ]*(-> ?[A-Za-z ]+)?$/, `含英文翻译括注：${title}`)
  }
  assert.ok(titles.includes('驼峰命名 (camelCase)'))
  assert.ok(titles.includes('全部大写') && titles.includes('简体转繁体'))
  await view.search('title case')
  assert.deepEqual(view.items().map((i) => i.props.id), ['title-case'])
  await view.search('traditional')
  assert.deepEqual(view.items().map((i) => i.props.id).sort(), ['to-simplified', 'to-traditional'])
  view.unmount()
})

test('「将此结果设为当前输入」保留多行；空结果不替换当前文本', async () => {
  const view = await mount(TextFormatterCommand)
  await applyViaEditor(view, 'b\na')
  await view.run(view.item('sort-lines-asc'), '将此结果设为当前输入文本')
  assert.equal(previewBody(detailOf(view, 'source-text')), 'a\nb')

  await applyViaEditor(view, '你好世界')
  await view.run(view.item('camel-case'), '将此结果设为当前输入文本')
  assert.equal(host.lastToast().style, Toast.Style.Failure)
  assert.equal(previewBody(detailOf(view, 'source-text')), '你好世界', '空结果不会把正文清掉')
})

test('剪贴板为空或读取失败时提示失败，正文不变', async () => {
  const view = await mount(TextFormatterCommand)
  await applyViaEditor(view, 'keep\nme')
  host.clipboard.text = ''
  await view.run(view.item('source-text'), '从剪贴板粘贴文本')
  assert.equal(host.lastToast().style, Toast.Style.Failure)
  assert.match(host.lastToast().title, /没有文本/)

  const bridge = getDeclarativeBridge()
  const original = bridge.readClipboardText
  bridge.readClipboardText = async () => {
    throw Object.assign(new Error('剪贴板被占用'), { code: 'FAILED' })
  }
  try {
    await view.run(view.item('source-text'), '从剪贴板粘贴文本')
  } finally {
    bridge.readClipboardText = original
  }
  assert.equal(host.lastToast().title, '读取剪贴板失败')
  assert.equal(previewBody(detailOf(view, 'source-text')), 'keep\nme')
})

test('复制：空结果提示无内容、宿主拒绝写入时提示失败，均不显示「已复制」', async () => {
  const view = await mount(TextFormatterCommand)
  await applyViaEditor(view, '你好世界')
  host.clipboard.text = 'SENTINEL'
  await view.run(view.item('camel-case'), '复制: 驼峰命名 (camelCase)')
  assert.equal(host.lastToast().style, Toast.Style.Failure)
  assert.equal(host.lastToast().title, '没有可复制的内容')
  assert.equal(host.clipboard.text, 'SENTINEL')

  const bridge = getDeclarativeBridge()
  const original = bridge.copyToClipboard
  bridge.copyToClipboard = async () => {
    throw Object.assign(new Error('剪贴板文本超过 8 MiB 上限'), { code: 'RESPONSE_TOO_LARGE' })
  }
  try {
    await view.run(view.item('upper-case'), '复制: 全部大写')
  } finally {
    bridge.copyToClipboard = original
  }
  assert.equal(host.lastToast().title, '复制失败')
  assert.match(host.lastToast().message, /8 MiB/)
  assert.equal(host.clipboard.text, 'SENTINEL')

  await view.run(view.item('upper-case'), '复制: 全部大写')
  assert.equal(host.clipboard.text, '你好世界')
  assert.equal(host.lastToast().style, Toast.Style.Success)
})

// ---------------------------------------------------------------- text-formatter-3
test('简转繁：错误映射已清除，一简对多繁按词组转换', () => {
  assert.equal(
    convertToTraditional('初次出发判断利用冰刺刻，这个问题后来说过'),
    '初次出發判斷利用冰刺刻，這個問題後來說過'
  )
  assert.equal(convertToTraditional('皇后吃面，头发很干，干部'), '皇后吃麵，頭髮很乾，幹部')
  assert.equal(convertToTraditional('软件设置，档案管理'), '軟件設置，檔案管理')
  assert.equal(convertToTraditional('为什么在这里'), '為什麼在這裡')
})

test('繁转简：反向表单独维护，不被一对多覆盖', () => {
  assert.equal(convertToSimplified('這齣戲很好看，儂好，後來發現問題'), '这出戏很好看，侬好，后来发现问题')
  assert.equal(convertToSimplified('頭髮很乾，幹部，為什麼在這裡'), '头发很干，干部，为什么在这里')
})

test('边界：空串、纯英文、Emoji 与扩展区汉字原样保留，往返不丢字', () => {
  assert.equal(convertToTraditional(''), '')
  assert.equal(convertToSimplified(''), '')
  assert.equal(convertToTraditional(undefined), '')
  assert.equal(convertToTraditional('Hello 123 😀 𠮷'), 'Hello 123 😀 𠮷')
  const text = '中华人民共和国 2026 年，这是一段测试文本😀。'
  assert.equal(convertToSimplified(convertToTraditional(text)), text)
})

test('80 万字长文本转换在 2 秒内完成', () => {
  const big = '头发很干，后来发现问题。'.repeat(70000)
  const start = Date.now()
  const out = convertToTraditional(big)
  assert.ok(Date.now() - start < 2000, `耗时 ${Date.now() - start}ms`)
  assert.equal(out.length, big.length)
  assert.ok(out.startsWith('頭髮很乾，後來發現問題。'))
})

// ---------------------------------------------------------------- text-formatter-4
test('中文标点转英文：不改坏小数、域名、网址，行尾不留空格', () => {
  assert.equal(toEnglishPunctuation('版本号是3.14，官网：example.com。'), '版本号是3.14, 官网: example.com.')
  assert.equal(toEnglishPunctuation('see https://example.com/a?b=1,c ok'), 'see https://example.com/a?b=1,c ok')
  assert.equal(toEnglishPunctuation('第一行。\n第二行，\n  缩进行'), '第一行.\n第二行,\n  缩进行')
  assert.equal(toEnglishPunctuation('你好，（括号）。'), '你好, (括号).')
  assert.equal(toEnglishPunctuation('pi=3.14,e=2.71'), 'pi=3.14,e=2.71', '纯 ASCII 原样保留')
})

test('英文标点转中文：只转换紧挨中文的标点，网址、邮箱、小数、行内代码不动', () => {
  assert.equal(toChinesePunctuation('see https://example.com/a?b=1,c ok'), 'see https://example.com/a?b=1,c ok')
  assert.equal(toChinesePunctuation('版本号是3.14,官网:example.com.'), '版本号是3.14，官网：example.com.', '句点两侧都不是中文时不转换')
  assert.equal(
    toChinesePunctuation('请访问https://example.com/a?b=1,c查看文档.'),
    '请访问https://example.com/a?b=1,c查看文档。'
  )
  assert.equal(toChinesePunctuation('邮箱a.b@example.com,时间12:30开始!'), '邮箱a.b@example.com，时间12:30开始！')
  assert.equal(toChinesePunctuation('执行`a,b.c`即可,函数f(x)的值(含括号)'), '执行`a,b.c`即可，函数f(x)的值（含括号）')
  assert.equal(toChinesePunctuation('见[文档](https://a.com/x),然后'), '见[文档](https://a.com/x)，然后', 'Markdown 链接不改')
  assert.equal(toChinesePunctuation('网址https://a.com.然后'), '网址https://a.com。然后', '网址末尾的句号仍按句读转换')
  assert.equal(toChinesePunctuation(''), '')
})

test('中文智能排版不再破坏网址与小数', () => {
  assert.equal(
    formatChineseSmart('请访问https://example.com/a?b=1,c查看文档.版本3.14发布'),
    '　　请访问 https://example.com/a?b=1,c 查看文档。版本 3.14 发布'
  )
})

// ---------------------------------------------------------------- text-formatter-5
test('去除行号只去掉 01. / 1) / 1、 前缀，正文开头的数字保留', () => {
  assert.equal(
    removeLineNumbers('3 apples\n2024 年会议纪要\n1. first item\n01. x\n2) b\n3、c\n3.14 是圆周率\n  4. 缩进'),
    '3 apples\n2024 年会议纪要\nfirst item\nx\nb\nc\n3.14 是圆周率\n缩进'
  )
  const text = 'banana\n3 apples\n\n2024 年'
  assert.equal(removeLineNumbers(addLineNumbers(text)), text, '加行号再去行号可还原')
  assert.equal(removeLineNumbers(''), '')
})

// ---------------------------------------------------------------- text-formatter-6
test('中文智能排版合并多行时英文与数字之间补空格，空行作为段落边界', () => {
  assert.equal(
    splitChineseParagraphs('banana\napple\nbanana\n3 apples\n2024 年会议纪要'),
    'banana apple banana 3 apples 2024 年会议纪要'
  )
  assert.equal(splitChineseParagraphs('第一行中文\n接着第二行'), '第一行中文接着第二行', '中文硬换行直接接上')
  assert.equal(
    formatChineseSmart('第一段第一行\n第一段第二行。\n\n第二段hello\nworld'),
    '　　第一段第一行第一段第二行。\n\n　　第二段 hello world'
  )
  assert.equal(formatChineseSmart('line, ok.\nhello world'), '　　line, ok. hello world', '英文逗号不改成全角')
  assert.equal(
    formatChineseSmart('Hello world! This is fine. 好的'),
    '　　Hello world! This is fine. 好的',
    '英文句子之间的空格不丢'
  )
})

test('Markdown 结构行独立成行、不缩进、不并入正文', () => {
  assert.equal(
    formatChineseSmart('说明文字\n- 第一项\n- 第二项\n---\n结尾'),
    '　　说明文字\n\n- 第一项\n- 第二项\n---\n\n　　结尾'
  )
})

test('边界：空串、只有空白行、80 万字长文本', () => {
  assert.equal(formatChineseSmart(''), '')
  assert.equal(formatChineseSmart('\n\n   \n'), '')
  const big = 'line, ok.\nhello world\n'.repeat(40000)
  const start = Date.now()
  const out = formatChineseSmart(big)
  assert.ok(Date.now() - start < 2000, `耗时 ${Date.now() - start}ms`)
  assert.ok(out.startsWith('　　line, ok. hello world line, ok.'))
  assert.ok(!out.includes('okhello'))
})

test('中英文混排加空格不再删除中文行之间的换行', () => {
  assert.equal(normalizeCjkSpacing('标题\n\n正文  内容'), '标题\n\n正文内容')
})

// ---------------------------------------------------------------- text-formatter-7
test('开启右侧详情，完整展示结果的换行、缩进与空白', async () => {
  const view = await mount(TextFormatterCommand)
  assert.equal(view.tree().props.isShowingDetail, true)
  await applyViaEditor(view, '  a   b  \n\n\tc')
  for (const item of view.items()) {
    assert.ok(item.props.detail?.type === 'List.Item.Detail', `${item.props.id} 缺少详情`)
  }
  assert.equal(previewBody(detailOf(view, 'trim-lines')), 'a   b\n\nc')
  assert.equal(previewBody(detailOf(view, 'collapse-spaces')), ' a b \n\n c')
  assert.equal(previewBody(detailOf(view, 'add-line-numbers')), '01.   a   b  \n02. \n03. \tc')
  // 列表行只显示转换名与字符数，不再塞单行预览
  const row = view.item('trim-lines')
  assert.equal(row.props.title, '去除每行首尾空白')
  assert.deepEqual(row.props.accessories, [{ text: '8 字符' }])
})

test('预览边界：空结果给出说明、内容含 ``` 不会提前结束代码块、超长结果截断并注明', async () => {
  const view = await mount(TextFormatterCommand)
  await applyViaEditor(view, '你好世界')
  assert.equal(detailOf(view, 'camel-case'), '该转换对当前文本没有输出内容')
  assert.deepEqual(view.item('camel-case').props.accessories, [{ text: '无输出' }])

  const md = textPreviewMarkdown('```js\ncode\n````', '')
  assert.ok(md.startsWith('`````text\n'))
  assert.equal(previewBody(md), '```js\ncode\n````')

  const long = 'x'.repeat(PREVIEW_CHAR_LIMIT + 5)
  const longMd = textPreviewMarkdown(long, '')
  assert.equal(previewBody(longMd).length, PREVIEW_CHAR_LIMIT)
  assert.match(longMd, new RegExp(`共 ${PREVIEW_CHAR_LIMIT + 5} 个`))

  // 超长文本：复制得到的是完整结果，不是预览
  await applyViaEditor(view, long)
  await view.run(view.item('upper-case'), '复制: 全部大写')
  assert.equal(host.clipboard.text.length, PREVIEW_CHAR_LIMIT + 5)
})

// ---------------------------------------------------------------- text-formatter-v1
test('Markdown 自动排版不改坏粗体、分隔线、负数，代码块内容原样保留', () => {
  const input = '**bold** text\n---\n***\n-1 degree\n+86 电话\n--flag\n*斜体* 文字\n#Heading\n-Item\n*Item 2\n```c\n#include <x>\n*ptr\n\n\n\n-x\n```\n\n\n\nend  '
  assert.equal(
    formatMarkdown(input),
    '**bold** text\n---\n***\n-1 degree\n+86 电话\n--flag\n*斜体* 文字\n# Heading\n- Item\n* Item 2\n```c\n#include <x>\n*ptr\n\n\n\n-x\n```\n\nend'
  )
})

test('Markdown 代码块：~~~ 围栏、未闭合的代码块到文末都不处理', () => {
  assert.equal(formatMarkdown('~~~\n#a\n~~~\n#b'), '~~~\n#a\n~~~\n# b')
  assert.equal(formatMarkdown('````\n```\n#a\n````\n#b'), '````\n```\n#a\n````\n# b', '短围栏不能关闭长围栏')
  assert.equal(formatMarkdown('```\n#a\n-b'), '```\n#a\n-b')
  assert.equal(formatMarkdown(''), '')
})

test('清单版本已升级，package.json 与 plugin.json 一致', () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('../plugin.json', import.meta.url), 'utf8'))
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/)
  assert.equal(pkg.version, manifest.version)
})

test('示例文本每行显示宽度不超过 44（中文按 2 计），详情栏代码块不会被横向截断；编辑框快捷键按平台显示', async () => {
  const host = createHost()
  const view = await mount(TextFormatterCommand, host)
  try {
    const md = view.item('source-text').props.detail.props.markdown
    const body = md.split('\n').slice(1, -1)
    assert.ok(body.length >= 4)
    const width = line => [...line].reduce((sum, ch) => sum + (/[\u2E80-\uFFEF]/.test(ch) ? 2 : 1), 0)
    for (const line of body) assert.ok(width(line) <= 44, `${line} 宽 ${width(line)}`)
  } finally { view.unmount() }
  const { modEnterLabel } = await import('../dist/index.js')
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  try {
    Object.defineProperty(globalThis, 'navigator', { value: { platform: 'MacIntel' }, configurable: true, writable: true })
    assert.equal(modEnterLabel(), '⌘Enter')
    Object.defineProperty(globalThis, 'navigator', { value: { platform: 'Win32', userAgent: 'Windows' }, configurable: true, writable: true })
    assert.equal(modEnterLabel(), 'Ctrl+Enter')
  } finally {
    if (original) Object.defineProperty(globalThis, 'navigator', original); else delete globalThis.navigator
  }
})
