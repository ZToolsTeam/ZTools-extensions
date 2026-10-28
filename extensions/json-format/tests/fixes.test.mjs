import test from 'node:test'
import assert from 'node:assert/strict'
import { createHost, mount, mountPushed, tick } from '../../shared/test-harness.mjs'
import JsonFormatCommand, { JsonDetailView } from '../dist/index.js'
import {
  validateJson,
  parseJsonAst,
  formatJson,
  minifyJson,
  jsonToTsInterface,
  jsonToRustStruct,
  jsonToGoStruct,
  extractJsonPaths,
  fencedCode
} from '../dist/logic.js'

const host = createHost()
test.beforeEach(() => host.reset())

/* ---------------- 工具 ---------------- */

const textarea = (view) => view.tree().children.find((c) => c.type === 'Form.TextArea')
async function typeInput(view, text) {
  textarea(view).props.onChange(text)
  await tick()
}
const actionTitles = (view) => view.actions().map((a) => a.props.title)
const COPY_TITLES = ['复制 2 格格式化结果', '复制 4 格格式化结果', '复制压缩单行 (Minify)', '复制 TypeScript Interface', '复制 Rust Struct', '复制 Go Struct']

/** 让剪贴板读取抛错（模拟宿主 IPC 失败），返回恢复函数 */
function breakClipboardRead(err) {
  Object.defineProperty(host.clipboard, 'text', { configurable: true, get() { throw err }, set() {} })
  return () => {
    delete host.clipboard.text
    host.clipboard.text = ''
  }
}

/**
 * 按两种规则切分 Markdown 代码块，二者结果必须一致：
 * - commonmark：结束围栏必须独占一行、同字符且不短于开始围栏（宿主新渲染器）
 * - naive：从开始围栏之后找到第一次出现的同一串围栏就结束（旧渲染器的正则写法）
 * 围栏长度选对时，两种规则都不会把内容里的 ``` 当成结束。
 */
function splitMarkdown(md, mode) {
  const blocks = []
  const headings = []
  const lines = md.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const open = /^ {0,3}(`{3,})([^`]*)$/.exec(lines[i])
    if (open) {
      const fence = open[1]
      if (mode === 'naive') {
        const rest = lines.slice(i + 1).join('\n')
        const end = rest.indexOf(fence)
        const body = (end === -1 ? rest : rest.slice(0, end)).replace(/\n$/, '')
        blocks.push({ lang: open[2], body })
        i += body.split('\n').length + 1
      } else {
        const close = new RegExp('^ {0,3}`{' + fence.length + ',}\\s*$')
        const body = []
        i++
        while (i < lines.length && !close.test(lines[i])) body.push(lines[i++])
        blocks.push({ lang: open[2], body: body.join('\n') })
      }
      continue
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(lines[i])
    if (h) headings.push(h[2])
  }
  return { blocks, headings }
}

let ts = null
try {
  const mod = await import('typescript')
  const api = mod.default ?? mod
  // TypeScript 7（原生版）没有 JS 编译器 API，这时只做标识符正则检查
  ts = typeof api.createCompilerHost === 'function' ? api : null
} catch {
  ts = null
}
/** 用 TypeScript 编译器检查生成的声明（noLib，忽略缺少全局类型的 2318） */
function tsErrors(code) {
  const file = 'gen.ts'
  const options = { noLib: true, noEmit: true, strict: true }
  const compilerHost = ts.createCompilerHost(options)
  compilerHost.getSourceFile = (f, lang) => (f === file ? ts.createSourceFile(f, code, lang) : undefined)
  compilerHost.fileExists = (f) => f === file
  compilerHost.readFile = (f) => (f === file ? code : undefined)
  const program = ts.createProgram([file], options, compilerHost)
  return [...program.getSyntacticDiagnostics(), ...program.getSemanticDiagnostics()]
    .filter((d) => d.code !== 2318)
    .map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'))
}

const RUST_IDENT = /^(r#)?[A-Za-z_][A-Za-z0-9_]*$/
const GO_EXPORTED = /^[A-Z][A-Za-z0-9_]*$/
function rustStructs(code) {
  const out = {}
  for (const m of code.matchAll(/pub struct (\S+) \{([\s\S]*?)\n?\}/g)) {
    out[m[1]] = [...m[2].matchAll(/^\s+pub (\S+): ([^,]+),$/gm)].map((f) => ({ name: f[1], type: f[2] }))
  }
  return out
}
function goStructs(code) {
  const out = {}
  for (const m of code.matchAll(/type (\S+) struct \{\n([\s\S]*?)\n\}/g)) {
    out[m[1]] = m[2].split('\n').map((l) => {
      const [name, type, tag] = l.trim().split('\t')
      return { name, type, tag }
    })
  }
  return out
}

/* ---------------- json-format-3：错误定位 ---------------- */

test('多行输入里的非法字面量、单引号定位到真实行列', () => {
  const tru = validateJson('{\n  "a": 1,\n  "b": tru\n}')
  assert.equal(tru.valid, false)
  assert.deepEqual([tru.errorInfo.line, tru.errorInfo.column], [3, 8])
  assert.match(tru.errorInfo.message, /tru/)

  const quote = validateJson("{\n  \"a\": 'x'\n}")
  assert.deepEqual([quote.errorInfo.line, quote.errorInfo.column], [2, 8])
  assert.match(quote.errorInfo.message, /双引号/)

  // 片段里 ^ 指向出错列
  const caretLine = tru.errorInfo.snippet.split('\n').find((l) => l.trim() === '^')
  const codeLine = tru.errorInfo.snippet.split('\n').find((l) => l.startsWith('>'))
  assert.equal(caretLine.indexOf('^'), codeLine.indexOf('tru'))
})

test('[破坏性] 各类语法错误的行列与 CRLF 换行', () => {
  const cases = [
    ['{"a":1,}', 1, 8, /逗号/],
    ['[1,]', 1, 4, /逗号/],
    ['[1,2\n,\n3\n', 4, 1, /意外结束/],
    ['{"a" 1}', 1, 6, /':'/],
    ['{"a":"x\ny"}', 1, 8, /换行/],
    ['{"a":1}}', 1, 8, /多余/],
    ['{a:1}', 1, 2, /双引号/],
    ['01', 1, 1, /数字/],
    ['﻿{}', 1, 1, /BOM/],
    ['{\r\n  "a": [1, 2 3]\r\n}', 2, 14, /','/],
    ['{"k": "\\x"}', 1, 8, /转义/],
    ['{"k": "\\u12G4"}', 1, 8, /\\u/],
    ['"abc', 1, 1, /双引号/]
  ]
  for (const [src, line, column, msg] of cases) {
    const v = validateJson(src)
    assert.equal(v.valid, false, src)
    assert.deepEqual([v.errorInfo.line, v.errorInfo.column], [line, column], JSON.stringify(src))
    assert.match(v.errorInfo.message, msg, src)
    assert.match(v.error, new RegExp(`^第 ${line} 行第 ${column} 列：`))
  }
  assert.equal(validateJson('   ').error, '内容为空')
})

test('[破坏性] 随机变异：自带解析器与 JSON.parse 的合法性判定完全一致', () => {
  const seeds = ['{"a":[1,2.5,-0.1e+3,{"b":null}],"c":"x\\"y\\u4e2d","d":true,"e":false}', '[[],{},"",0]', '{"k":"中文\\n","n":-12345678901234567890}']
  const alphabet = ['"', "'", ',', ':', '{', '}', '[', ']', ' ', '\n', '\\', 'u', 'e', '-', '+', '.', '0', '1', 't', 'n', '\u0001', ' ', '﻿']
  let seed = 7
  const rand = (n) => {
    seed = (seed * 1103515245 + 12345) % 2147483648
    return seed % n
  }
  for (let round = 0; round < 3000; round++) {
    let s = seeds[round % seeds.length]
    for (let k = 0, edits = 1 + rand(3); k < edits; k++) {
      const pos = rand(s.length + 1)
      const op = rand(3)
      const ch = alphabet[rand(alphabet.length)]
      s = op === 0 ? s.slice(0, pos) + ch + s.slice(pos) : op === 1 ? s.slice(0, pos) + s.slice(pos + 1) : s.slice(0, pos) + ch + s.slice(pos + 1)
    }
    let native = true
    try { JSON.parse(s) } catch { native = false }
    let ours = true
    try { parseJsonAst(s) } catch (e) {
      ours = false
      assert.equal(e.name, 'JsonSyntaxError')
      assert.ok(e.offset >= 0 && e.offset <= s.length)
    }
    assert.equal(ours, native, JSON.stringify(s))
    assert.equal(validateJson(s).valid, native)
  }
})

test('[破坏性] 嵌套过深时不崩溃：合法 JSON 仍可格式化，非法 JSON 仍给出定位', () => {
  const deep = '['.repeat(200000) + ']'.repeat(200000)
  const ok = validateJson(deep)
  assert.equal(ok.valid, true)
  assert.equal(ok.stats.byteSize, 400000)
  assert.match(jsonToTsInterface(deep), /^(export type|\/\/ 无法生成)/)
  const bad = validateJson('['.repeat(200000))
  assert.equal(bad.valid, false)
  assert.ok(bad.errorInfo.line >= 1 && bad.errorInfo.column >= 1)
})

test('界面：多行输入的错误提示显示真实行列', async () => {
  const view = await mount(JsonFormatCommand)
  await typeInput(view, '{\n  "a": 1,\n  "b": tru\n}')
  assert.match(textarea(view).props.error, /^\[第 3 行, 列 8\] /)
  await typeInput(view, "{\n  \"a\": 'x'\n}")
  assert.match(textarea(view).props.error, /^\[第 2 行, 列 8\] .*双引号/)
  await typeInput(view, '{"a":1}')
  assert.equal(textarea(view).props.error, undefined)
})

/* ---------------- json-format-6：详情页代码块 ---------------- */

test('值里含 ``` 与 | 时，详情页每段代码都完整留在自己的代码块里', async () => {
  const src = '{"code":"```js\\nalert(1)\\n```","pipe":"a|b","tick":"`x`","long":"````"}'
  const view = await mount(JsonFormatCommand)
  await typeInput(view, src)
  await view.run(undefined, '格式化并查看详情')
  assert.equal(host.lastToast().title, '格式化与类型推导完成')
  const detail = await mountPushed(host)
  const md = detail.tree().props.markdown
  for (const mode of ['commonmark', 'naive']) {
    const { blocks, headings } = splitMarkdown(md, mode)
    assert.deepEqual(blocks.map((b) => b.lang), ['json', 'typescript', 'rust', 'go', 'text'], mode)
    assert.equal(blocks[0].body, formatJson(src, 2), mode)
    assert.equal(blocks[1].body, jsonToTsInterface(src), mode)
    assert.deepEqual(headings.slice(1, 5), ['格式化 JSON', '自动生成的 TypeScript Interface', '自动生成的 Rust Struct (serde)', '自动生成的 Go Struct'], mode)
    assert.match(blocks[4].body, /\$\.pipe\s+string\s+"a\|b"/)
  }
})

test('fencedCode 围栏总比内容里最长的反引号串长', () => {
  assert.equal(fencedCode('x', 'json'), '```json\nx\n```')
  assert.equal(fencedCode('a ``` b', 'json'), '````json\na ``` b\n````')
  assert.equal(fencedCode('`````', ''), '``````\n`````\n``````')
})

test('[破坏性] 详情页 JSONPath 超长取值截断，复制动作仍给全量', async () => {
  const long = 'x'.repeat(500)
  const view = await mount(JsonFormatCommand)
  await typeInput(view, JSON.stringify({ long }))
  await view.run(undefined, '格式化并查看详情')
  const detail = await mountPushed(host)
  const pathBlock = splitMarkdown(detail.tree().props.markdown, 'commonmark').blocks[4].body
  assert.ok(pathBlock.length < 200)
  await detail.run(undefined, '复制全部 JSONPath 列表')
  assert.ok(host.clipboard.text.includes(long))
})

/* ---------------- json-format-7：合法标识符 ---------------- */

const ODD_KEYS = '{"名字":"张三","年龄":30,"user-info":{"first-name":"A","first_name":"B"},"type":1,"self":2,"2fa":true,"_":0,"-":1,"q\\"k":2,"line\\nbreak":3,"items":[{"x-y":1}]}'

test('TypeScript：连字符 / 中文键生成合法接口名，编译无错误', (t) => {
  const code = jsonToTsInterface(ODD_KEYS)
  assert.match(code, /export interface UserInfo \{/)
  assert.match(code, /"user-info": UserInfo;/)
  assert.match(code, /items: ItemItem\[\];/)
  for (const m of code.matchAll(/export (?:interface|type) (\S+)/g)) assert.match(m[1], /^[A-Za-z_$][\w$]*$/)
  if (!ts) return t.skip('没有可用的 TypeScript 编译器 API，跳过编译检查')
  assert.deepEqual(tsErrors(code), [])
})

test('Rust：字段名合法且不重复，原始键写进 serde rename', () => {
  const code = jsonToRustStruct(ODD_KEYS)
  const structs = rustStructs(code)
  for (const [name, fields] of Object.entries(structs)) {
    assert.match(name, /^[A-Z][A-Za-z0-9]*$/)
    const names = fields.map((f) => f.name)
    assert.equal(new Set(names).size, names.length, `${name} 字段重复：${names}`)
    for (const f of names) assert.match(f, RUST_IDENT)
    assert.ok(!names.some((f) => ['r#self', 'r#super', 'r#crate', 'self', 'super', 'crate'].includes(f)))
  }
  assert.match(code, /#\[serde\(rename = "名字"\)\]\n {4}pub field: String,/)
  assert.match(code, /#\[serde\(rename = "年龄"\)\]\n {4}pub field_2: i64,/)
  assert.match(code, /pub r#type: i64,/)
  assert.match(code, /#\[serde\(rename = "self"\)\]\n {4}pub self_: i64,/)
  assert.match(code, /#\[serde\(rename = "q\\"k"\)\]/)
  assert.match(code, /#\[serde\(rename = "line\\nbreak"\)\]/)
  // first-name 与 first_name 都变成 first_name，第二个自动加序号
  assert.deepEqual(structs.UserInfo.map((f) => f.name), ['first_name', 'first_name_2'])
  assert.match(code, /#\[serde\(rename = "first_name"\)\]\n {4}pub first_name_2: String,/)
})

test('Go：字段名非空、导出、不重复，json tag 保留原始键', () => {
  const code = jsonToGoStruct(ODD_KEYS)
  const structs = goStructs(code)
  for (const [name, fields] of Object.entries(structs)) {
    assert.match(name, GO_EXPORTED)
    const names = fields.map((f) => f.name)
    assert.equal(new Set(names).size, names.length, `${name} 字段重复：${names}`)
    for (const f of names) assert.match(f, GO_EXPORTED)
  }
  assert.ok(structs.RootObject.some((f) => f.name === 'Field' && f.tag === '`json:"名字"`'))
  assert.ok(structs.RootObject.some((f) => f.name === 'Field2fa' && f.tag === '`json:"2fa"`'))
  // 键 "-" 不能直接写成 json:"-"（那表示忽略字段）
  assert.ok(structs.RootObject.some((f) => f.tag === '`json:"-,"`'))
  // 含引号的键无法写进 struct tag，给出说明而不是生成坏 tag
  assert.ok(structs.RootObject.some((f) => f.name === 'QK' && /^\/\/ 原始键/.test(f.tag)))
  assert.deepEqual(structs.UserInfo.map((f) => f.name), ['FirstName', 'FirstName2'])
})

/* ---------------- json-format-v1：同名不同结构 ---------------- */

test('不同对象下同名键结构不同时生成不同类型，结构相同时复用', (t) => {
  const src = '{"a":{"data":{"x":1}},"b":{"data":{"y":"s"}},"c":{"data":{"x":2}},"list":[{"data":{"z":true}}]}'
  const tsCode = jsonToTsInterface(src)
  assert.match(tsCode, /export interface A \{\n {2}data: Data;\n\}/)
  assert.match(tsCode, /export interface B \{\n {2}data: BData;\n\}/)
  assert.match(tsCode, /export interface C \{\n {2}data: Data;\n\}/)
  assert.match(tsCode, /export interface BData \{\n {2}y: string;\n\}/)
  assert.match(tsCode, /export interface ListItem \{\n {2}data: ListItemData;\n\}/)
  assert.equal(tsCode.match(/export interface Data \{/g).length, 1)
  assert.ok(tsCode.startsWith('export interface RootObject {'))

  const rust = rustStructs(jsonToRustStruct(src))
  assert.deepEqual(rust.BData, [{ name: 'y', type: 'String' }])
  assert.deepEqual(rust.B, [{ name: 'data', type: 'BData' }])
  assert.deepEqual(rust.ListItemData, [{ name: 'z', type: 'bool' }])

  const go = goStructs(jsonToGoStruct(src))
  assert.equal(go.BData[0].name, 'Y')
  assert.equal(go.B[0].type, 'BData')
  assert.equal(go.C[0].type, 'Data')

  // 子类型名与根类型名冲突时不会覆盖根类型
  const clash = jsonToTsInterface('{"rootObject":{"q":1}}')
  assert.match(clash, /export interface RootObject \{\n {2}rootObject: RootObject2;\n\}/)
  assert.match(clash, /export interface RootObject2 \{\n {2}q: number;\n\}/)
  if (ts) {
    assert.deepEqual(tsErrors(tsCode), [])
    assert.deepEqual(tsErrors(clash), [])
  }
})

/* ---------------- json-format-8：长整数与小数 ---------------- */

test('JSONPath、Rust/Go 类型与统计都按原文数字推导', () => {
  const src = '{"id":12345678901234567890,"price":1.0,"n":-5,"big":123456789012345678901234567890,"exp":1E+2,"mix":[1,2.5],"ids":[1,18446744073709551615]}'
  const paths = Object.fromEntries(extractJsonPaths(src).map((p) => [p.path, p.displayValue]))
  assert.equal(paths['$.id'], '12345678901234567890')
  assert.equal(paths['$.price'], '1.0')
  assert.equal(paths['$.exp'], '1E+2')
  assert.equal(paths['$.big'], '123456789012345678901234567890')

  const rust = Object.fromEntries(rustStructs(jsonToRustStruct(src)).RootObject.map((f) => [f.name, f.type]))
  assert.deepEqual(rust, { id: 'u64', price: 'f64', n: 'i64', big: 'serde_json::Value', exp: 'f64', mix: 'Vec<f64>', ids: 'Vec<u64>' })
  assert.match(jsonToRustStruct(src), /arbitrary_precision/)

  const goCode = jsonToGoStruct(src)
  const go = Object.fromEntries(goStructs(goCode).RootObject.map((f) => [f.name, f.type]))
  assert.deepEqual(go, { Id: 'uint64', Price: 'float64', N: 'int64', Big: 'json.Number', Exp: 'float64', Mix: '[]float64', Ids: '[]uint64' })
  assert.ok(goCode.startsWith('import "encoding/json"'))

  assert.match(jsonToTsInterface(src), /id: number; \/\/ 超出 JS 安全整数范围/)

  const stats = validateJson(src).stats
  assert.equal(stats.minifiedSize, Buffer.byteLength(minifyJson(src)))
  assert.equal(stats.compressionRatio, 0)
  const spaced = validateJson('{ "a" : 1.0 ,\n "b" : [ 1 , 2 ] }').stats
  assert.equal(spaced.minifiedSize, Buffer.byteLength('{"a":1.0,"b":[1,2]}'))
  assert.equal(spaced.keys, 2)
})

test('详情页复制的 JSONPath 列表保留长整数与 1.0', async () => {
  const view = await mount(JsonFormatCommand)
  await typeInput(view, '{"id":12345678901234567890,"price":1.0}')
  await view.run(undefined, '格式化并查看详情')
  const detail = await mountPushed(host)
  await detail.run(undefined, '复制全部 JSONPath 列表')
  assert.equal(host.clipboard.text, '$ = Object{2}\n$.id = 12345678901234567890\n$.price = 1.0')
  await detail.run(undefined, '复制 Rust Struct')
  assert.match(host.clipboard.text, /pub id: u64,\n {4}pub price: f64,/)
})

test('[破坏性] 重复键与 JSON.parse 一致取最后一个值', () => {
  const src = '{"a":1,"a":"s","b":{"x":1},"b":{"y":2.5}}'
  assert.match(jsonToTsInterface(src), /a: string;\n {2}b: B;/)
  assert.match(jsonToTsInterface(src), /export interface B \{\n {2}y: number;\n\}/)
  assert.equal(validateJson(src).stats.keys, 3)
  assert.deepEqual(extractJsonPaths(src).map((p) => p.path), ['$', '$.a', '$.b', '$.b.y'])
})

/* ---------------- json-format-9：非法 / 空输入时不假装复制 ---------------- */

test('输入为空或非法时不提供复制动作；合法时复制内容正确', async () => {
  const view = await mount(JsonFormatCommand)
  for (const COPY of COPY_TITLES) assert.ok(!actionTitles(view).includes(COPY), `空输入不应有「${COPY}」`)

  await typeInput(view, '{"a":1,')
  assert.deepEqual(actionTitles(view), ['格式化并查看详情', '从剪贴板粘贴并校验', '切换为 4 格缩进'])

  // 非法时提交：失败提示，不进入详情
  await view.run(undefined, '格式化并查看详情')
  assert.equal(host.lastToast().title, 'JSON 语法错误')
  assert.match(host.lastToast().message, /^第 1 行第 8 列：/)
  assert.equal(host.pushed.length, 0)

  await typeInput(view, '{"a":1}')
  assert.deepEqual(actionTitles(view).slice(0, 7), ['格式化并查看详情', ...COPY_TITLES])
  await view.run(undefined, '复制 2 格格式化结果')
  assert.equal(host.clipboard.text, '{\n  "a": 1\n}')
  await view.run(undefined, '复制 TypeScript Interface')
  assert.equal(host.clipboard.text, 'export interface RootObject {\n  a: number;\n}')
  for (const title of COPY_TITLES) {
    const action = view.actions().find((a) => a.props.title === title)
    assert.ok(String(action.props.content).length > 0, `${title} 内容不能为空`)
  }

  // 再改回非法：复制动作随之消失
  await typeInput(view, '{"a":')
  assert.ok(!actionTitles(view).some((x) => COPY_TITLES.includes(x)))
})

test('根节点为数字 / 数组时类型代码不为空（宿主拒绝复制空串）', () => {
  for (const src of ['42', '"s"', '[1,2]', '[]', 'null', '[{"a":1}]']) {
    for (const code of [jsonToTsInterface(src), jsonToRustStruct(src), jsonToGoStruct(src)]) {
      assert.ok(code.trim().length > 0, src)
      assert.ok(!code.includes('无法生成'), `${src}: ${code}`)
    }
  }
  assert.equal(jsonToTsInterface('42'), 'export type RootObject = number;')
  assert.equal(jsonToGoStruct('[1,2]'), 'type RootObject []int64')
})

/* ---------------- json-format-2：粘贴不覆盖正在编辑的内容 ---------------- */

test('第 2 个动作（⌘Enter 槽位）不再是会覆盖输入的粘贴', async () => {
  const view = await mount(JsonFormatCommand)
  await typeInput(view, '{"keep":1}')
  const titles = actionTitles(view)
  assert.equal(titles[0], '格式化并查看详情')
  assert.equal(titles[1], '复制 2 格格式化结果')
  assert.ok(titles.indexOf('从剪贴板粘贴并校验') > 1)
})

test('[破坏性] 已有输入时剪贴板不是合法 JSON：保留输入并提示', async () => {
  const view = await mount(JsonFormatCommand)
  await typeInput(view, '{"keep":1}')
  host.clipboard.text = 'hello 不是 JSON'
  await view.run(undefined, '从剪贴板粘贴并校验')
  assert.equal(textarea(view).props.value, '{"keep":1}')
  assert.match(String(host.lastToast().style), /failure/i)
  assert.equal(host.lastToast().title, '剪贴板不是合法 JSON，已保留当前输入')

  // 剪贴板是合法 JSON：覆盖并提示成功
  host.clipboard.text = '{"new":2}'
  await view.run(undefined, '从剪贴板粘贴并校验')
  assert.equal(textarea(view).props.value, '{"new":2}')
  assert.equal(host.lastToast().title, '已从剪贴板读取并成功校验')
})

test('[破坏性] 输入为空时可粘贴非法 JSON 以便修改；剪贴板为空 / 读取失败时提示且不改输入', async () => {
  const view = await mount(JsonFormatCommand)
  host.clipboard.text = '{"a":1,'
  await view.run(undefined, '从剪贴板粘贴并校验')
  assert.equal(textarea(view).props.value, '{"a":1,')
  assert.equal(host.lastToast().title, '剪贴板内容存在语法错误')
  assert.match(textarea(view).props.error, /^\[第 1 行, 列 8\]/)

  host.clipboard.text = '   '
  await view.run(undefined, '从剪贴板粘贴并校验')
  assert.equal(host.lastToast().title, '剪贴板为空')
  assert.equal(textarea(view).props.value, '{"a":1,')

  const restore = breakClipboardRead(Object.assign(new Error('IPC 超时'), { code: 'TIMEOUT' }))
  try {
    await view.run(undefined, '从剪贴板粘贴并校验')
    assert.equal(host.lastToast().title, '读取剪贴板失败')
    assert.equal(host.lastToast().message, 'IPC 超时')
    assert.equal(textarea(view).props.value, '{"a":1,')
  } finally {
    restore()
  }
})

test('详情页提交走表单当前值，缩进切换后格式化结果随之变化', async () => {
  const view = await mount(JsonFormatCommand)
  await typeInput(view, '{"a":[1]}')
  await view.run(undefined, '切换为 4 格缩进')
  await view.run(undefined, '格式化并查看详情')
  const detail = await mountPushed(host)
  const json = splitMarkdown(detail.tree().props.markdown, 'commonmark').blocks[0].body
  assert.equal(json, '{\n    "a": [\n        1\n    ]\n}')
})

test('JsonDetailView 单独使用（未传 jsonPaths / 类型代码）时从格式化文本推导', async () => {
  const view = await mount(() => JsonDetailView({ formatted: '{"id":12345678901234567890}', tsInterface: 'x' }))
  const md = view.tree().props.markdown
  assert.match(md, /\$\.id\s+number\s+12345678901234567890/)
  assert.match(md, /pub id: u64,/)
})

test('JSONPath 索引按显示宽度对齐（中文键占两格）', async () => {
  const view = await mount(JsonFormatCommand)
  await typeInput(view, '{"名字":"张三","ab":1}')
  await view.run(undefined, '格式化并查看详情')
  const detail = await mountPushed(host)
  const block = splitMarkdown(detail.tree().props.markdown, 'commonmark').blocks[4].body.split('\n')
  const col = (line) => {
    const idx = line.search(/(object|string|number)/)
    return [...line.slice(0, idx)].reduce((w, ch) => w + (/[一-鿿]/.test(ch) ? 2 : 1), 0)
  }
  assert.equal(new Set(block.map(col)).size, 1, block.join('\n'))
})
