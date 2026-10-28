// 独立窗口带状态：左右两侧内容与「忽略空白」随弹出带到新窗口，坏数据回落为空
import test from 'node:test'
import assert from 'node:assert/strict'
import { renderDeclarativeRoot } from '@ztools/declarative-ui'
import { createHost, mountPushed, tick } from '../../shared/test-harness.mjs'
import FileCompareCommand from '../dist/index.js'
import { MAX_DIFF_LINES } from '../dist/logic.js'

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

const ids = (win) => win.all('List.Item').map((i) => i.props.id)
const sectionTitle = (win) => win.all('List.Section')[0].props.title

test('弹出闭环：两侧文本与忽略空白带到新窗口，差异与报告和旧窗口一致', async () => {
  const old = await openWindow(FileCompareCommand)
  await old.act('编辑两段文本…')
  const form = await mountPushed(host)
  await form.fill('left', 'a\nb  c\nd')
  await form.fill('right', 'a\nb c\nD')
  await form.run(null, '开始对比')
  await old.act('忽略空白差异')
  assert.deepEqual(ids(old), ['hunk-0'])
  const before = sectionTitle(old)
  await old.act('复制差异报告')
  const report = host.clipboard.text
  assert.match(report, /^--- 左侧\n\+\+\+ 右侧\n@@ -1,3 \+1,3 @@\n a\n/)

  const { seed, rejected, paths } = old.popout()
  assert.deepEqual(seed, {
    left: { name: '左侧', text: 'a\nb  c\nd', source: 'text' },
    right: { name: '右侧', text: 'a\nb c\nD', source: 'text' },
    ignoreWhitespace: true
  })
  assert.deepEqual(rejected, [])
  assert.deepEqual(paths, [], '文件内容已读成文本，不转交路径授权')
  old.unmount()

  host.reset()
  const win = await openWindow(FileCompareCommand, seed)
  assert.equal(sectionTitle(win), before)
  assert.deepEqual(ids(win), ['hunk-0'])
  await win.act('复制差异报告')
  assert.equal(host.clipboard.text, report)
  await win.act('恢复比较空白字符')
  assert.match(sectionTitle(win), /删除 2 行，新增 2 行/)
})

test('只载入了一侧（来自文件）：新窗口保持「待选另一侧」，主动作仍是选文件', async () => {
  host.ipc.window_show_open_dialog = async () => ({ canceled: false, filePath: '/tmp/fixtures/old.txt' })
  host.ipc.filesystem_get_file_size = async () => ({ success: true, size: 4 })
  host.ipc.filesystem_read_file = async () => ({ content: 'x\ny' })
  const old = await openWindow(FileCompareCommand)
  await old.act('选择文件作为左侧…')
  const { seed } = old.popout()
  assert.deepEqual(seed.left, { name: 'old.txt', text: 'x\ny', source: 'file' })

  const win = await openWindow(FileCompareCommand, seed)
  assert.deepEqual(ids(win), ['need-other'])
  assert.match(sectionTitle(win), /已载入左侧：old\.txt（2 行）/)
  const first = descriptors(win.all('List.Item')[0].props.actions).find((n) => n.type === 'Action')
  assert.equal(first.props.title, '选择文件作为右侧…')
})

test('[异常] 交接来的值形状不对（旧版本、篡改）时回落为空，回到开始页且可以照常对比', async () => {
  for (const seed of [
    { left: { name: 1, text: 'x' }, right: { text: 'y' }, ignoreWhitespace: 'yes' },
    { left: { name: 'L', text: 'x', source: 'evil' }, right: 'y', ignoreWhitespace: 1 },
    { left: ['L', 'x'], right: null },
    null
  ]) {
    host.reset()
    const win = await openWindow(FileCompareCommand, seed)
    assert.deepEqual(ids(win), ['start-edit', 'start-file', 'start-clip'], JSON.stringify(seed))
    host.clipboard.text = 'p'
    await win.act('剪贴板内容设为左侧')
    host.clipboard.text = 'q'
    await win.act('剪贴板内容设为右侧')
    assert.deepEqual(ids(win), ['hunk-0'])
    win.unmount()
  }
})

test('[异常] 只有一侧合法：合法的一侧保留，另一侧为空，进入「待选另一侧」', async () => {
  const win = await openWindow(FileCompareCommand, { left: { name: '剪贴板', text: 'a', source: 'clipboard' }, right: { name: '右侧', text: 7 } })
  assert.deepEqual(ids(win), ['need-other'])
  assert.match(sectionTitle(win), /已载入左侧：剪贴板/)
})

test('[边界] 带来的文本超过对比行数上限：提示无法对比，不崩溃', async () => {
  const big = 'x\n'.repeat(MAX_DIFF_LINES + 1)
  const win = await openWindow(FileCompareCommand, { left: { name: 'big.log', text: big, source: 'file' }, right: { name: 'r', text: 'y', source: 'text' }, ignoreWhitespace: false })
  assert.deepEqual(ids(win), ['error'])
  assert.match(win.all('List.Item')[0].props.title, /行/)
})
