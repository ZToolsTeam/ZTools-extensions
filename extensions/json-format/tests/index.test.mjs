import test from 'node:test'
import assert from 'node:assert/strict'
import { createHost, mount } from '../../shared/test-harness.mjs'
import JsonFormatCommand from '../dist/index.js'
import {
  validateJson,
  formatJson,
  minifyJson,
  escapeJson,
  unescapeJson,
  sortJsonKeys,
  jsonToTsInterface
} from '../dist/logic.js'

const host = createHost()
test.beforeEach(() => host.reset())

test('格式化与压缩保留原文的数字与字符串写法（长整数不丢精度）', () => {
  const src = '{"id":12345678901234567890,"f":1.0,"e":1E+2,"u":"\\u4e2d","dup":1,"dup":2,"empty":{},"arr":[]}'
  assert.equal(formatJson(src, 2), '{\n  "id": 12345678901234567890,\n  "f": 1.0,\n  "e": 1E+2,\n  "u": "\\u4e2d",\n  "dup": 1,\n  "dup": 2,\n  "empty": {},\n  "arr": []\n}')
  assert.equal(minifyJson(formatJson(src, 4)), src)
  assert.equal(formatJson('[1,{"a":"x"}]', 'tab'), '[\n\t1,\n\t{\n\t\t"a": "x"\n\t}\n]')
})

test('随机 JSON：格式化与压缩结果与 JSON.stringify 一致', () => {
  const gen = (d) => {
    const r = Math.random()
    if (d > 3 || r < 0.3) return [1.5, 'a"b\\\\c\n中', true, null, -7, ''][Math.floor(Math.random() * 6)]
    if (r < 0.6) return Array.from({ length: Math.floor(Math.random() * 4) }, () => gen(d + 1))
    return Object.fromEntries(Array.from({ length: Math.floor(Math.random() * 4) }, (_, i) => [`k${i}:{,`, gen(d + 1)]))
  }
  for (let i = 0; i < 300; i++) {
    const v = gen(0)
    const src = JSON.stringify(v, null, i % 2 ? 0 : 3)
    assert.equal(formatJson(src, 2), JSON.stringify(v, null, 2))
    assert.equal(minifyJson(src), JSON.stringify(v))
  }
})

test('[破坏性] 非法 JSON 原样返回并给出行列定位', () => {
  for (const bad of ['{"a":1,}', '{a:1}', '[1,2', '']) {
    assert.equal(formatJson(bad), bad)
    const v = validateJson(bad)
    assert.equal(v.valid, false)
    assert.ok(v.errorInfo.line >= 1 && v.errorInfo.column >= 1)
  }
})

test('类型推导生成 TypeScript 接口', () => {
  const ts = jsonToTsInterface('{"name":"x","age":1,"tags":["a"]}')
  assert.match(ts, /name: string/)
  assert.match(ts, /age: number/)
})

test('界面：默认输入为空，不显示示例 JSON，也不显示错误', async () => {
  const view = await mount(JsonFormatCommand)
  const area = view.tree().children.find((c) => c.type === 'Form.TextArea')
  assert.equal(area.props.value, '')
  assert.equal(area.props.error, undefined)
})

test('[异常] 极深嵌套导致缩进结果超出字符串上限时如实提示，不崩溃也不提供复制', async () => {
  const { mountPushed } = await import('../../shared/test-harness.mjs')
  host.pushed.push(JsonFormatCommand)
  const view = await mountPushed(host)
  try {
    const deep = '['.repeat(20000) + ']'.repeat(20000)
    await view.fill('jsonInput', deep)
    const field = view.field('jsonInput')
    assert.match(field.props.error, /嵌套过深或体积过大/)
    assert.ok(!view.actions(null).some((a) => /复制/.test(a.props.title)))
    await view.run(null, '格式化并查看详情')
    assert.equal(host.lastToast().title, '无法生成格式化结果')
    assert.equal(host.pushed.length, 1)
  } finally { view.unmount() }
})

test('详情页复制标题与实际缩进一致（4 格 / Tab）', async () => {
  const { mountPushed } = await import('../../shared/test-harness.mjs')
  host.pushed.push(JsonFormatCommand)
  const view = await mountPushed(host)
  try {
    await view.fill('jsonInput', '{"a":[1]}')
    await view.fill('indentType', 'tab')
    await view.run(null, '格式化并查看详情')
    const detail = await mountPushed(host)
    try {
      await detail.run(null, '复制格式化 JSON (Tab)')
      assert.equal(host.clipboard.text, '{\n\t"a": [\n\t\t1\n\t]\n}')
    } finally { detail.unmount() }
  } finally { view.unmount() }
})

test('粘贴文件与纯文本：支持 Ctrl+V 粘贴 .json 文件读取内容并校验，以及粘贴 JSON 文本', async () => {
  host.ipc.filesystem_read_file = async (params) => {
    assert.equal(params.path, '/Users/me/config.json')
    assert.equal(params.encoding, 'utf8')
    return { content: '{"port":8080,"debug":true}' }
  }
  const view = await mount(JsonFormatCommand)
  const getAreaValue = () => view.tree().children.find((c) => c.type === 'Form.TextArea').props.value
  try {
    await view.pasteFiles(['/Users/me/config.json'])
    assert.equal(getAreaValue(), '{"port":8080,"debug":true}')
    assert.equal(host.lastToast().title, '已读取文件并成功校验')

    await view.pasteText('{"name":"ztools"}')
    assert.equal(getAreaValue(), '{"name":"ztools"}')
  } finally {
    view.unmount()
  }
})

test('escapeJson / unescapeJson：转义与去除转义（含带引号、无外层引号与异常边界）', () => {
  const raw = '{"user":"张三","note":"line1\\nline2"}'
  const esc = escapeJson(raw)
  assert.equal(esc.ok, true)
  assert.equal(esc.value, JSON.stringify(raw))

  // 带外层双引号还原
  const unescQuoted = unescapeJson(esc.value)
  assert.equal(unescQuoted.ok, true)
  assert.equal(unescQuoted.value, raw)

  // 不带外层双引号但含转义序列还原
  const unescBare = unescapeJson('{\\"a\\":1,\\"b\\":\\"hi\\nworld\\"}')
  assert.equal(unescBare.ok, true)
  assert.equal(unescBare.value, '{"a":1,"b":"hi\nworld"}')

  // 边界异常
  assert.equal(escapeJson('').ok, false)
  assert.equal(unescapeJson('').ok, false)
  assert.equal(unescapeJson('   ').ok, false)
  assert.equal(unescapeJson('plain text without escapes').ok, false)
  assert.equal(unescapeJson('{"a":1}').ok, false)
  assert.equal(unescapeJson('bad\\xescape').ok, false)
  assert.equal(unescapeJson('"unterminated').ok, false)
})

test('sortJsonKeys：递归按键名字母序稳定排序并保留长整数与小数原文', () => {
  const input = '{"z":1,"a":{"d":12345678901234567890,"b":1.0},"arr":[{"y":2,"x":1},{}]}'
  assert.equal(
    sortJsonKeys(input, 2),
    '{\n  "a": {\n    "b": 1.0,\n    "d": 12345678901234567890\n  },\n  "arr": [\n    {\n      "x": 1,\n      "y": 2\n    },\n    {}\n  ],\n  "z": 1\n}'
  )
  assert.equal(sortJsonKeys('{"b":1,"a":2}', 'tab'), '{\n\t"a": 2,\n\t"b": 1\n}')
  assert.equal(sortJsonKeys('{"bad":'), '{"bad":')
})

test('界面交互：按 Key 排序格式化、转义 (Escape) 与去除转义 (Unescape) 完整闭环', async () => {
  const { mountPushed } = await import('../../shared/test-harness.mjs')
  host.pushed.push(JsonFormatCommand)
  const view = await mountPushed(host)
  try {
    await view.fill('jsonInput', '{"b":2,"a":{"d":1,"c":0}}')
    await view.run(null, '按 Key 字母排序格式化')
    assert.equal(view.field('jsonInput').props.value, '{\n  "a": {\n    "c": 0,\n    "d": 1\n  },\n  "b": 2\n}')
    assert.equal(host.clipboard.text, view.field('jsonInput').props.value)
    assert.equal(host.lastToast().title, '已按 Key 排序格式化并复制')

    await view.fill('jsonInput', '{"k":"v"}')
    await view.run(null, '转义为 JSON 字符串 (Escape)')
    assert.equal(view.field('jsonInput').props.value, '"{\\"k\\":\\"v\\"}"')
    assert.equal(host.clipboard.text, '"{\\"k\\":\\"v\\"}"')
    assert.equal(host.lastToast().title, '已转义为 JSON 字符串并复制')

    // 转义后的字符串可直接去除转义还原
    await view.run(null, '去除转义 (Unescape)')
    assert.equal(view.field('jsonInput').props.value, '{"k":"v"}')
    assert.equal(host.clipboard.text, '{"k":"v"}')
    assert.equal(host.lastToast().title, '已去除转义并复制')

    // 无外层引号的转义 JSON 也可触发去除转义
    await view.fill('jsonInput', '{\\"x\\":1}')
    await view.run(null, '去除转义 (Unescape)')
    assert.equal(view.field('jsonInput').props.value, '{"x":1}')
  } finally {
    view.unmount()
  }
})
