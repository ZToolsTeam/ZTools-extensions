import test from 'node:test'
import assert from 'node:assert/strict'
import { jsonToTsInterface, jsonToGoStruct, jsonToRustStruct } from '../dist/logic.js'

test('混合类型数组覆盖所有样本，Go/Rust 使用能保留整个元素的 JSON 类型', () => {
  for (const input of ['[1,"two"]', '[{"a":1},{"a":"two"}]', '[[1],["two"]]', '[-1,18446744073709551615]']) {
    const ts = jsonToTsInterface(input)
    assert.ok(ts.length > 0)
    assert.match(jsonToGoStruct(input), /\[\]json\.RawMessage/)
    assert.match(jsonToRustStruct(input), /Vec<serde_json::Value>/)
  }
  assert.match(jsonToTsInterface('[1,"two"]'), /\(number \| string\)\[\]/)
  const objects = jsonToTsInterface('[{"a":1},{"a":"two"}]')
  assert.match(objects, /a: number/); assert.match(objects, /a: string/)
})

test('对象数组里有可选 / 可空字段时合并出具体类型，不退化为通用 JSON 类型', () => {
  const input = JSON.stringify({ users: [{ id: 1, email: null }, { id: 2, email: 'x@y', tags: ['t'] }] })
  const ts = jsonToTsInterface(input)
  assert.match(ts, /users: UserItem\[\];/)
  assert.match(ts, /id: number;/)
  assert.match(ts, /email: string \| null;/)
  assert.match(ts, /tags\?: string\[\];/)
  assert.doesNotMatch(ts, /any|unknown|UserItem2/)

  const rust = jsonToRustStruct(input)
  assert.match(rust, /pub users: Vec<UserItem>,/)
  assert.match(rust, /pub email: Option<String>,/)
  assert.match(rust, /#\[serde\(default, skip_serializing_if = "Option::is_none"\)\]\n    pub tags: Option<Vec<String>>,/)
  assert.doesNotMatch(rust, /serde_json::Value/)

  const go = jsonToGoStruct(input)
  assert.match(go, /Users\t\[\]UserItem\t/)
  assert.match(go, /Email\t\*string\t`json:"email"`/)
  assert.match(go, /Tags\t\*\[\]string\t`json:"tags,omitempty"`/)
  assert.doesNotMatch(go, /RawMessage|interface\{\}/)

  // 字段之间完全不重叠也按并集合并为全可选
  const disjoint = jsonToTsInterface('[{"a":1},{"b":"two"}]')
  assert.match(disjoint, /a\?: number;/); assert.match(disjoint, /b\?: string;/)
  // 数组元素可空
  assert.match(jsonToTsInterface('[null,1]'), /\(number \| null\)\[\]/)
  assert.match(jsonToRustStruct('[null,1]'), /Vec<Option<i64>>/)
  assert.match(jsonToGoStruct('[null,1]'), /\[\]\*int64/)
  // 可空对象元素与嵌套对象字段
  const nested = jsonToTsInterface('{"list":[{"meta":null},{"meta":{"k":1}},null]}')
  assert.match(nested, /list: \(ListItem \| null\)\[\];/)
  assert.match(nested, /meta: Meta \| null;/)
  // 同一字段类型冲突（数字与字符串）仍不能硬合并
  assert.match(jsonToGoStruct('{"xs":[{"v":1},{"v":"s"}]}'), /\[\]json\.RawMessage/)
})

test('同结构对象数组递归合并数字类型；空数组和非法输入仍可处理', () => {
  assert.match(jsonToRustStruct('[{"value":1},{"value":2.5}]'), /pub value: f64/)
  assert.match(jsonToGoStruct('[{"value":1},{"value":2.5}]'), /Value\s+float64/)
  assert.match(jsonToRustStruct('[]'), /Vec<serde_json::Value>/)
  assert.match(jsonToGoStruct('bad'), /无法生成/)
})
