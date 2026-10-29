import test from 'node:test'
import assert from 'node:assert/strict'
import { createHost, mount, mountPushed, tick } from '../../shared/test-harness.mjs'
import Command, { diffText, hunkPreviewMarkdown, MAX_PREVIEW_LINES } from '../dist/index.js'
const host = createHost()
test.beforeEach(() => host.reset())

test('提交空文本仍代表已载入：整篇新增、删除和两侧为空', async () => {
  for (const [left, right, expected] of [['原文', '', '-原文'], ['', '新文', '+新文'], ['', '', null]]) {
    const view = await mount(Command)
    try {
      await view.run(null, '编辑两段文本…')
      const form = await mountPushed(host)
      try { await form.fill('left', left); await form.fill('right', right); await form.run(null, '开始对比') }
      finally { form.unmount() }
      if (expected) { await view.run(view.item('hunk-0'), '复制差异报告'); assert.ok(host.clipboard.text.includes(expected)) }
      else assert.match(view.item('identical').props.title, /相同/)
      await view.run(null, '清空')
      assert.equal(view.items()[0].props.id, 'start-edit')
    } finally { view.unmount() }
  }
})

test('零字节文件可作为已载入一侧；取消第二个文件不误判为已载入', async () => {
  host.ipc.window_show_open_dialog = async () => ({ canceled: false, filePath: '/空 文件.txt' })
  host.ipc.filesystem_get_file_size = async () => ({ size: 0 })
  host.ipc.filesystem_read_file = async () => ({ content: '', size: 0 })
  const view = await mount(Command)
  try {
    await view.run(null, '选择文件作为左侧…')
    assert.match(view.item('need-other').props.title, /右侧/)
    host.ipc.window_show_open_dialog = async () => ({ canceled: true })
    await view.run(null, '选择文件作为右侧…')
    assert.match(view.item('need-other').props.title, /右侧/)
    host.clipboard.text = '新增'
    await view.run(null, '剪贴板内容设为右侧')
    assert.ok(view.item('hunk-0'))
  } finally { view.unmount() }
})

test('[算法] 搜索预算在一次成功的中间蛇搜索后耗尽：剩余部分改用近似对比时也必须标记 approximate', () => {
  function lcsLength(a, b) { let prev = new Int32Array(b.length + 1); for (let i = 1; i <= a.length; i++) { const cur = new Int32Array(b.length + 1); for (let j = 1; j <= b.length; j++) cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]); prev = cur } return prev[b.length] }
  let seed = 7, unflagged = 0, approximated = 0
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
  for (let t = 0; t < 1500; t++) {
    const gen = () => Array.from({ length: 5 + Math.floor(rnd() * 40) }, () => 'abcdef'[Math.floor(rnd() * 6)])
    const a = gen(), b = gen()
    for (const maxCost of [30, 120, 250]) {
      const r = diffText(a.join('\n'), b.join('\n'), { maxCost })
      if (r.added + r.removed !== a.length + b.length - 2 * lcsLength(a, b)) { approximated++; if (!r.approximate) unflagged++ }
    }
  }
  assert.ok(approximated > 0, '用例应覆盖预算耗尽的情形')
  assert.equal(unflagged, 0)
})

test('[性能] 一处差异上万行时右侧预览只渲染前 500 行并注明，复制动作仍是完整内容', async () => {
  const lines = (p) => Array.from({ length: 3000 }, (_, i) => `${p}${i}`).join('\n')
  const r = diffText(lines('a'), lines('b'))
  assert.equal(r.hunks.length, 1)
  const md = hunkPreviewMarkdown(r.hunks[0])
  assert.ok(md.split('\n').length < MAX_PREVIEW_LINES + 10)
  assert.match(md, /共 6000 行，预览只显示前 500 行/)
  assert.match(md, /^```diff\n@@ -1,3000 \+1,3000 @@/)
  assert.equal(hunkPreviewMarkdown(diffText('a\nb', 'a\nc').hunks[0]), '```diff\n@@ -1,2 +1,2 @@\n a\n-b\n+c\n```')
})

test('[异常] 读取剪贴板或复制失败时提示失败，不显示成功；只差换行符时不说「完全相同」', async () => {
  const view = await mount(Command, host)
  try {
    // 宿主读取剪贴板抛错（注入：读取 text 时抛出）
    Object.defineProperty(host.clipboard, 'text', { configurable: true, get() { throw new Error('剪贴板不可用') }, set() {} })
    try { await view.run(view.item('start-clip'), '剪贴板内容设为左侧'); await tick() }
    finally { Object.defineProperty(host.clipboard, 'text', { configurable: true, writable: true, enumerable: true, value: '' }) }
    assert.equal(host.lastToast().style, 'FAILURE'); assert.match(host.lastToast().title, /读取剪贴板失败/)
    assert.ok(view.item('start-edit'), '失败后仍停留在开始页')
    await view.run(view.item('start-edit'), '编辑两段文本…')
    const form = await mountPushed(host); await form.fill('left', 'a\r\nb\r\n'); await form.fill('right', 'a\nb'); await form.run(null, '开始对比'); form.unmount(); await tick()
    assert.match(view.text(), /逐行内容相同（换行符或末尾换行不同）/); assert.doesNotMatch(view.text(), /完全相同/)
    // 复制失败（宿主拒绝空内容）时不提示「已复制」
    await view.run(view.item('identical'), '编辑两段文本…')
    const again = await mountPushed(host); await again.fill('left', 'x'); await again.fill('right', 'y'); await again.run(null, '开始对比'); again.unmount(); await tick()
    const count = host.toasts.length
    await view.run(view.item('hunk-0'), '复制差异报告'); assert.equal(host.lastToast().style, 'SUCCESS'); assert.equal(host.clipboard.text.split('\n')[0], '--- 左侧')
    Object.defineProperty(host.clipboard, 'text', { configurable: true, get() { return '' }, set() { throw new Error('剪贴板被占用') } })
    try { await view.run(view.item('hunk-0'), '复制这一处差异'); await tick() }
    finally { Object.defineProperty(host.clipboard, 'text', { configurable: true, writable: true, enumerable: true, value: '' }) }
    assert.equal(host.toasts.length, count + 2); assert.equal(host.lastToast().style, 'FAILURE'); assert.match(host.lastToast().title, /复制失败/)
  } finally { view.unmount() }
})
