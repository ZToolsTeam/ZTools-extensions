import test from 'node:test'
import assert from 'node:assert/strict'
import { createHost, mount, mountPushed, tick } from '../../shared/test-harness.mjs'
import FileCompareCommand from '../dist/index.js'
import { diffText, MAX_DIFF_LINES } from '../dist/logic.js'

const host = createHost()
test.beforeEach(() => host.reset())

/** 按宿主真实接口模拟文件系统：路径 → 内容；不存在的路径读取失败 */
function fakeFiles(files) {
  const queue = []
  host.ipc.window_show_open_dialog = async () => {
    const next = queue.shift()
    return next ? { canceled: false, filePath: next } : { canceled: true }
  }
  host.ipc.filesystem_get_file_size = async ({ path }) => ({ size: Buffer.byteLength(files[path] ?? '', 'utf8') })
  host.ipc.filesystem_read_file = async ({ path }) => {
    if (!(path in files)) throw Object.assign(new Error('ENOENT: no such file'), { code: 'FILE_ERROR' })
    return { content: files[path] }
  }
  return { pickNext: (p) => queue.push(p) }
}

/** 由差异结果还原两侧文本，用来断言结果正确（与 patch 应用等价） */
function rebuild(r) {
  return {
    left: r.lines.filter((l) => l.op !== 'add').map((l) => l.text).join('\n'),
    right: r.lines.filter((l) => l.op !== 'remove').map((l) => l.text).join('\n')
  }
}

/** O(NM) 最长公共子序列，作为「最少改动行数」的参照 */
function lcsLength(a, b) {
  let prev = new Int32Array(b.length + 1)
  for (let i = 1; i <= a.length; i++) {
    const cur = new Int32Array(b.length + 1)
    for (let j = 1; j <= b.length; j++) cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1])
    prev = cur
  }
  return prev[b.length]
}

const titles = (view, node) => view.actions(node).map((a) => a.props.title)

// ---------- file-compare-1：差异算法内存与耗时有上限 ----------

test('[性能] 上限 20000 行、两侧完全不同：内存不随差异平方增长，耗时在百毫秒量级，结果正确', () => {
  const A = Array.from({ length: MAX_DIFF_LINES }, (_, i) => `left line ${i} ` + 'x'.repeat(30)).join('\n')
  const B = Array.from({ length: MAX_DIFF_LINES }, (_, i) => `right line ${i} ` + 'y'.repeat(30)).join('\n')
  global.gc?.()
  const before = process.memoryUsage().heapUsed + process.memoryUsage().arrayBuffers
  const t0 = performance.now()
  const r = diffText(A, B)
  const ms = performance.now() - t0
  const grown = process.memoryUsage().heapUsed + process.memoryUsage().arrayBuffers - before
  assert.equal(r.removed, MAX_DIFF_LINES)
  assert.equal(r.added, MAX_DIFF_LINES)
  assert.equal(r.approximate, false)
  assert.deepEqual(rebuild(r), { left: A, right: B })
  // 旧实现 6000 行就要 1.1 GB；现在 20000 行只有结果对象本身的开销
  assert.ok(grown < 200 * 1024 * 1024, `内存增长 ${Math.round(grown / 1e6)} MB`)
  assert.ok(ms < 2000, `耗时 ${Math.round(ms)} ms`)
})

test('[性能] 上限 20000 行、顺序完全颠倒（最坏情况）：触发搜索预算后改用近似结果，仍可还原两侧且不卡死', () => {
  const lines = Array.from({ length: MAX_DIFF_LINES }, (_, i) => `line ${i}`)
  const A = lines.join('\n')
  const B = lines.slice().reverse().join('\n')
  const t0 = performance.now()
  const r = diffText(A, B)
  const ms = performance.now() - t0
  assert.equal(r.approximate, true)
  assert.deepEqual(rebuild(r), { left: A, right: B })
  assert.ok(ms < 3000, `耗时 ${Math.round(ms)} ms`)
})

test('[故障注入] 预算耗尽（maxCost=1）时结果依旧正确，只是不保证最少；未耗尽时与 LCS 参照一致', () => {
  for (let t = 0; t < 400; t++) {
    const alpha = 'abcdefgh'.slice(0, 2 + (t % 7))
    const rnd = (n) => Array.from({ length: n }, () => alpha[Math.floor(Math.random() * alpha.length)])
    const a = rnd(Math.floor(Math.random() * 80))
    const b = rnd(Math.floor(Math.random() * 80))
    const exact = diffText(a.join('\n'), b.join('\n'))
    assert.equal(exact.approximate, false)
    assert.equal(exact.added + exact.removed, a.length + b.length - 2 * lcsLength(a, b))
    assert.deepEqual(rebuild(exact), { left: a.join('\n'), right: b.join('\n') })
    const starved = diffText(a.join('\n'), b.join('\n'), { maxCost: 1 })
    assert.deepEqual(rebuild(starved), { left: a.join('\n'), right: b.join('\n') })
    assert.ok(starved.added + starved.removed >= exact.added + exact.removed)
  }
})

test('[边界] 只在一侧出现的行与大量重复行（空行、括号）混合时仍是最少差异', () => {
  const a = ['{', '', 'a', '}', '', '{', '', 'b', '}', 'only-left', 'tail']
  const b = ['', '{', 'a', '', '}', 'only-right', '{', 'b', '', '}']
  const r = diffText(a.join('\n'), b.join('\n'))
  assert.equal(r.added + r.removed, a.length + b.length - 2 * lcsLength(a, b))
  assert.deepEqual(rebuild(r), { left: a.join('\n'), right: b.join('\n') })
})

test('[集成] 界面载入两个 6000 行完全不同的文件，交换左右后结果正确；最坏情况下标题注明近似结果', async () => {
  const left = Array.from({ length: 6000 }, (_, i) => `L${i}`).join('\n')
  const right = Array.from({ length: 6000 }, (_, i) => `R${i}`).join('\n')
  const rev = left.split('\n').reverse().join('\n')
  const fs = fakeFiles({ '/l.txt': left, '/r.txt': right, '/rev.txt': rev })
  const view = await mount(FileCompareCommand)
  fs.pickNext('/l.txt')
  await view.run(view.item('start-file'), '选择文件作为左侧…')
  fs.pickNext('/r.txt')
  await view.run(view.item('need-other'), '选择文件作为右侧…')
  const t0 = performance.now()
  await view.run(view.item('hunk-0'), '交换左右')
  assert.ok(performance.now() - t0 < 2000)
  assert.match(view.text(), /r\.txt ↔ l\.txt · 删除 6000 行，新增 6000 行/)
  assert.doesNotMatch(view.text(), /近似/)
  fs.pickNext('/rev.txt')
  await view.run(view.item('hunk-0'), '选择文件作为右侧…')
  // 左侧此时是 r.txt，与 rev.txt 没有公共行：直接得到最少差异
  assert.doesNotMatch(view.text(), /近似/)
  fs.pickNext('/l.txt')
  await view.run(view.item('hunk-0'), '选择文件作为左侧…')
  assert.match(view.text(), /l\.txt ↔ rev\.txt · 改动过多，按近似结果显示 · 删除 5999 行，新增 5999 行/)
  await view.run(view.item('hunk-0'), '复制差异报告')
  assert.match(host.clipboard.text, /^--- l\.txt\n\+\+\+ rev\.txt\n@@ /)
})

// ---------- file-compare-5：只载入一侧时不显示假差异 ----------

test('只选了左侧文件：提示还需右侧，不出现整篇删除差异；Enter 选右侧文件、⌘Enter 用剪贴板', async () => {
  const fs = fakeFiles({ '/left.txt': 'a\nb\nc\n', '/right.txt': 'a\nB\nc\n' })
  const view = await mount(FileCompareCommand)
  fs.pickNext('/left.txt')
  await view.run(view.item('start-file'), '选择文件作为左侧…')
  const item = view.item('need-other')
  assert.equal(item.props.title, '还需要右侧（新文）才能对比')
  assert.match(view.text(), /已载入左侧：left\.txt（3 行）/)
  assert.equal(view.items().length, 1)
  assert.deepEqual(titles(view, item).slice(0, 2), ['选择文件作为右侧…', '剪贴板内容设为右侧'])
  assert.ok(!titles(view, item).includes('复制差异报告'))
  assert.ok(!titles(view).includes('复制差异报告'), '全局动作里也不能有无意义的报告')
  fs.pickNext('/right.txt')
  await view.run(item, '选择文件作为右侧…')
  assert.match(view.item('hunk-0').props.subtitle, /删除 1 行，新增 1 行/)
  await view.run(view.item('hunk-0'), '复制差异报告')
  assert.equal(host.clipboard.text, '--- left.txt\n+++ right.txt\n@@ -1,3 +1,3 @@\n a\n-b\n+B\n c')
})

test('剪贴板设为左侧后：主动作是「剪贴板内容设为右侧」，补上后正常对比', async () => {
  const view = await mount(FileCompareCommand)
  host.clipboard.text = 'x\ny'
  await view.run(view.item('start-clip'), '剪贴板内容设为左侧')
  const item = view.item('need-other')
  assert.deepEqual(titles(view, item).slice(0, 2), ['剪贴板内容设为右侧', '选择文件作为右侧…'])
  host.clipboard.text = 'x\nz'
  await view.run(item, '剪贴板内容设为右侧')
  assert.match(view.item('hunk-0').props.subtitle, /删除 1 行，新增 1 行/)
})

test('[异常] 只载入一侧时：右侧取消选择、文件读取失败、剪贴板为空都停留在待选状态', async () => {
  const fs = fakeFiles({ '/left.txt': 'a\n' })
  const view = await mount(FileCompareCommand)
  fs.pickNext('/left.txt')
  await view.run(view.item('start-file'), '选择文件作为左侧…')
  // 取消对话框
  await view.run(view.item('need-other'), '选择文件作为右侧…')
  assert.equal(view.items()[0].props.id, 'need-other')
  // 读取失败
  fs.pickNext('/missing.txt')
  await view.run(view.item('need-other'), '选择文件作为右侧…')
  assert.equal(host.lastToast().title, '读取文件失败')
  assert.equal(view.items()[0].props.id, 'need-other')
  // 剪贴板为空
  host.clipboard.text = ''
  await view.run(view.item('need-other'), '剪贴板内容设为右侧')
  assert.equal(host.lastToast().title, '剪贴板里没有文字')
  assert.equal(view.items()[0].props.id, 'need-other')
})

test('[边界] 交换后变成只缺左侧；表单只填一侧；单侧超过行数上限时立即提示；清空回到首屏', async () => {
  const fs = fakeFiles({ '/left.txt': 'a\n', '/huge.txt': 'x\n'.repeat(MAX_DIFF_LINES + 1) })
  const view = await mount(FileCompareCommand)
  fs.pickNext('/left.txt')
  await view.run(view.item('start-file'), '选择文件作为左侧…')
  await view.run(view.item('need-other'), '交换左右')
  assert.equal(view.item('need-other').props.title, '还需要左侧（原文）才能对比')
  assert.equal(titles(view, view.item('need-other'))[0], '选择文件作为左侧…')
  await view.run(view.item('need-other'), '清空')
  assert.equal(view.items()[0].props.id, 'start-edit')

  await view.run(view.item('start-edit'), '编辑两段文本…')
  const form = await mountPushed(host)
  await form.fill('left', 'only left')
  await form.run(null, '开始对比')
  await tick()
  assert.equal(view.item('need-other').props.title, '还需要右侧（新文）才能对比')
  assert.equal(titles(view, view.item('need-other'))[0], '编辑两段文本…')

  await view.run(view.item('need-other'), '清空')
  fs.pickNext('/huge.txt')
  await view.run(view.item('start-file'), '选择文件作为左侧…')
  assert.match(view.item('error').props.title, new RegExp(`huge\\.txt 超过 ${MAX_DIFF_LINES} 行`))
})

// ---------- file-compare-6：表单不再有多余的「返回」动作 ----------

test('编辑表单只有「开始对比」一个动作（宿主把它映射到 ⌘Enter），不会因误触「返回」丢稿；再次打开保留已填内容与文件名', async () => {
  const fs = fakeFiles({ '/left.txt': 'a\nb\n' })
  const view = await mount(FileCompareCommand)
  fs.pickNext('/left.txt')
  await view.run(view.item('start-file'), '选择文件作为左侧…')
  await view.run(view.item('need-other'), '编辑两段文本…')
  const form = await mountPushed(host)
  assert.deepEqual(form.actions().map((a) => a.props.title), ['开始对比'])
  assert.equal(form.field('left').props.value, 'a\nb\n')
  await form.fill('right', 'a\nc\n')
  await form.run(null, '开始对比')
  await tick()
  assert.equal(host.pushed.length, 0, '提交后返回列表')
  // 左侧未改动：保留文件名；右侧来自表单
  assert.match(view.text(), /left\.txt ↔ 右侧 · 删除 1 行，新增 1 行/)
  await view.run(view.item('hunk-0'), '编辑两段文本…')
  const again = await mountPushed(host)
  assert.equal(again.field('left').props.value, 'a\nb\n')
  assert.equal(again.field('right').props.value, 'a\nc\n')
})
