// 独立窗口带状态：输入与缩进风格随弹出带到新窗口，坏数据回落到默认值
import test from 'node:test'
import assert from 'node:assert/strict'
import { renderDeclarativeRoot } from '@ztools/declarative-ui'
import { createHost, mountPushed, tick } from '../../shared/test-harness.mjs'
import JsonFormatCommand from '../dist/index.js'

const host = createHost()
test.beforeEach(() => host.reset())

// ---- 模拟宿主的「弹出独立窗口」交接（与 frontend popoutHandoff 一致：只收纯 JSON，路径另行转交授权）----

function descriptors(node, out = []) {
  if (Array.isArray(node)) node.forEach((n) => descriptors(n, out))
  else if (node && typeof node === 'object') {
    if (typeof node.type === 'string') out.push(node)
    for (const v of [node.children, ...Object.values(node.props || {})]) if (v && typeof v === 'object') descriptors(Array.isArray(v) ? v : v.type ? v : v.items, out)
  }
  return out
}

/** 按宿主方式挂载根页面；handoffSeed 是独立窗口交接来的初值 */
async function openWindow(Command, handoffSeed) {
  const root = renderDeclarativeRoot(() => Command(), handoffSeed === undefined ? undefined : { handoffSeed })
  await tick(20)
  const win = {
    tree: () => root.forceRender(),
    all: (type) => descriptors(win.tree()).filter((n) => n.type === type),
    async act(title) {
      const a = descriptors(win.tree()).find((n) => n.type.startsWith('Action') && !n.type.startsWith('ActionPanel') && typeof n.props?.title === 'string' && n.props.title.startsWith(title))
      if (!a) throw new Error(`找不到动作「${title}」`)
      await a.props.onAction?.()
      await a.props.onSubmit?.({})
      await tick(20)
    },
    /** 收集根页面状态并按 JSON 往返，返回新窗口的初值、要转交授权的路径与被拒绝的 key */
    popout() {
      const { entries, rejected } = root.collectPopoutState()
      const values = Object.fromEntries(entries.map((e) => [e.key, e.value]))
      const seed = JSON.parse(JSON.stringify(values))
      assert.deepEqual(seed, values, '交接的值必须是纯 JSON，否则宿主会整项拒绝')
      return { seed, rejected, paths: entries.flatMap((e) => e.paths) }
    },
    unmount: () => root.unmount()
  }
  return win
}

const area = (win) => win.all('Form.TextArea')[0]
const indentDropdown = (win) => win.all('Form.Dropdown')[0]
async function type(win, text) {
  area(win).props.onChange(text)
  await tick()
}

test('弹出闭环：输入与缩进带到新窗口，新窗口里继续编辑、格式化结果与旧窗口一致', async () => {
  const old = await openWindow(JsonFormatCommand)
  await type(old, '{"a":[1,{"b":"中文"}]}')
  indentDropdown(old).props.onChange('tab')
  await tick()
  const { seed, rejected, paths } = old.popout()
  assert.deepEqual(seed, { jsonText: '{"a":[1,{"b":"中文"}]}', indent: 'tab' })
  assert.deepEqual(rejected, [])
  assert.deepEqual(paths, [], '纯文本插件不转交任何路径授权')
  old.unmount()

  const win = await openWindow(JsonFormatCommand, seed)
  assert.equal(area(win).props.value, '{"a":[1,{"b":"中文"}]}')
  assert.equal(area(win).props.error, undefined)
  assert.equal(indentDropdown(win).props.value, 'tab')
  await win.act('格式化并查看详情')
  const detail = await mountPushed(host)
  assert.match(detail.tree().props.markdown, /\{\n\t"a": \[\n\t\t1,/)

  // 新窗口里的状态是独立的：继续编辑后再弹出，带走的是新值
  await type(win, '[1]')
  await win.act('切换为')
  assert.deepEqual(win.popout().seed, { jsonText: '[1]', indent: 2 })
})

test('没有交接内容时与原来一样：空输入、2 格缩进', async () => {
  const win = await openWindow(JsonFormatCommand)
  assert.equal(area(win).props.value, '')
  assert.equal(indentDropdown(win).props.value, '2')
  assert.deepEqual(win.popout().seed, { jsonText: '', indent: 2 })
})

test('[异常] 交接来的值类型不对（旧版本形状、篡改）时回落到默认值，之后的编辑与切换照常', async () => {
  for (const seed of [
    { jsonText: 123, indent: '8' },
    { jsonText: { a: 1 }, indent: null },
    { jsonText: ['x'], indent: 4.5 },
    { indent: 'TAB', unknown: 'x', __proto__: { jsonText: 'polluted' } },
    JSON.parse('{"__proto__":{"jsonText":"polluted"},"jsonText":null}')
  ]) {
    const win = await openWindow(JsonFormatCommand, seed)
    assert.equal(area(win).props.value, '', JSON.stringify(seed))
    assert.equal(indentDropdown(win).props.value, '2')
    // 坏值上的函数式更新以默认值为基础，不会把坏值带进计算
    await win.act('切换为 4 格缩进')
    assert.equal(indentDropdown(win).props.value, '4')
    await type(win, '{"ok":true}')
    assert.deepEqual(win.popout().seed, { jsonText: '{"ok":true}', indent: 4 })
    win.unmount()
  }
  assert.equal({}.jsonText, undefined, '原型链没有被污染')
})

test('[异常] 只带来一部分 key、或交接内容整体畸形时，缺的那项用默认值', async () => {
  const partial = await openWindow(JsonFormatCommand, { indent: 4 })
  assert.equal(area(partial).props.value, '')
  assert.equal(indentDropdown(partial).props.value, '4')
  for (const bad of [null, [], ['jsonText', 'x'], 'jsonText']) {
    const win = await openWindow(JsonFormatCommand, bad)
    assert.equal(area(win).props.value, '')
    assert.equal(indentDropdown(win).props.value, '2')
    win.unmount()
  }
})

test('[异常] 带来的是非法 JSON：照常显示行列错误，不出现复制结果的动作', async () => {
  const win = await openWindow(JsonFormatCommand, { jsonText: '{"a":1,}', indent: 2 })
  assert.match(String(area(win).props.error), /第 1 行/)
  const titles = win.all('Action.CopyToClipboard').map((a) => a.props.title)
  assert.deepEqual(titles, [])
  await win.act('格式化并查看详情')
  assert.match(String(host.lastToast().title), /语法错误/)
  assert.equal(host.pushed.length, 0)
})
