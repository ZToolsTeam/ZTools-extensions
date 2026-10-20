import test from 'node:test'
import assert from 'node:assert/strict'
import { createHost, mount } from '../../shared/test-harness.mjs'
import JsonFormatCommand from '../dist/index.js'
import { validateJson, formatJson, minifyJson, jsonToTsInterface } from '../dist/logic.js'

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
