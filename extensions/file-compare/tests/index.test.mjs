import test from 'node:test'
import { gitTestTool } from '../../shared/test-tools.mjs'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHost, mount, mountPushed, tick } from '../../shared/test-harness.mjs'
import FileCompareCommand from '../dist/index.js'
import { diffText, formatUnifiedDiff, splitLines, MAX_DIFF_LINES, fencedDiffMarkdown } from '../dist/logic.js'

const host = createHost()
test.beforeEach(() => host.reset())

// 以独立的二维动态规划计算最少插入/删除数，不把系统 diff 的启发式输出当作最优答案。
function minimumEditCount(left, right) {
  // 保留每行结尾的 LF，末行缺少换行本身也是需要写进补丁的差异。
  const a = left.match(/[^\n]*\n|[^\n]+$/g) ?? []
  const b = right.match(/[^\n]*\n|[^\n]+$/g) ?? []
  const cost = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1))
  for (let i = 0; i <= a.length; i++) cost[i][0] = i
  for (let j = 0; j <= b.length; j++) cost[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      cost[i][j] = a[i - 1] === b[j - 1]
        ? cost[i - 1][j - 1]
        : Math.min(cost[i - 1][j], cost[i][j - 1]) + 1
    }
  }
  return cost[a.length][b.length]
}

test('差异最小且可逆：与独立最小编辑数一致，报告能被 patch 正确应用', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ztools-diff-'))
  let seed = 0x20261103
  const randomInt = (limit) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return Math.floor(seed / 0x100000000 * limit)
  }
  const rnd = (n) => Array.from({ length: n }, () => 'abcde'[randomInt(5)]).join('\n')
  try {
    for (let t = 0; t < 120; t++) {
      const A = rnd(randomInt(30))
      const B = rnd(randomInt(30))
      const r = diffText(A, B)
      assert.equal(r.approximate, false)
      assert.equal(r.lines.filter((l) => l.op !== 'remove').map((l) => l.text).join('\n'), splitLines(B).join('\n'))
      fs.writeFileSync(path.join(dir, 'a'), A)
      fs.writeFileSync(path.join(dir, 'b'), B)
      assert.equal(r.added + r.removed, minimumEditCount(A, B), `固定样本 ${t}: ${JSON.stringify({ A, B })}`)
      if (!r.identical) {
        fs.writeFileSync(path.join(dir, 'p'), formatUnifiedDiff(r, 'a', 'b'))
        execFileSync(gitTestTool('patch'), ['-s', '-o', path.join(dir, 'o'), path.join(dir, 'a'), path.join(dir, 'p')])
        assert.equal(fs.readFileSync(path.join(dir, 'o'), 'utf8'), fs.readFileSync(path.join(dir, 'b'), 'utf8'))
      }
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('[边界] 换行符差异、忽略空白、空文本、超大文本', () => {
  assert.equal(diffText('x\r\ny', 'x\ny').identical, false)
  assert.equal(diffText('a  b', 'a b', { ignoreWhitespace: true }).identical, true)
  assert.equal(diffText('', '').identical, true)
  assert.equal(diffText('', 'a').added, 1)
  assert.throws(() => diffText('x\n'.repeat(MAX_DIFF_LINES + 1), 'y'), /行/)
})

test('界面：空状态无示例数据；填写两段文本后列出差异并可复制报告', async () => {
  const view = await mount(FileCompareCommand)
  assert.equal(view.items()[0].props.id, 'start-edit')
  await view.run(view.item('start-edit'), '编辑两段文本…')
  const form = await mountPushed(host)
  await form.fill('left', 'a\nb\nc')
  await form.fill('right', 'a\nB\nc')
  await form.run(null, '开始对比')
  await tick()
  const hunk = view.item('hunk-0')
  assert.match(hunk.props.subtitle, /删除 1 行，新增 1 行/)
  await view.run(hunk, '复制差异报告')
  assert.equal(host.clipboard.text, '--- 左侧\n+++ 右侧\n@@ -1,3 +1,3 @@\n a\n-b\n+B\n c\n\\ No newline at end of file\n')
})

test('[故障注入] 选择的文件不是 UTF-8 文本时提示，不显示乱码对比', async () => {
  host.ipc.window_show_open_dialog = async () => ({ canceled: false, filePath: '/bin.dat' })
  host.ipc.filesystem_get_file_size = async () => ({ success: true, size: 10 })
  host.ipc.filesystem_read_file = async () => { throw Object.assign(new Error('The encoded data was not valid for encoding utf-8'), { code: 'FILE_ERROR' }) }
  const view = await mount(FileCompareCommand)
  await view.run(view.item('start-file'), '选择文件作为左侧…')
  assert.match(String(host.lastToast().message), /UTF-8/)
  assert.equal(view.items()[0].props.id, 'start-edit')
})

test('差异详情围栏比内容里最长的反引号多一个：对比含 ``` 的 Markdown 文件时代码块不被截断', () => {
  assert.equal(fencedDiffMarkdown('-a\n+b'), '```diff\n-a\n+b\n```')
  const md = fencedDiffMarkdown('- ```js\n-const a = 1\n+const a = 2\n- ```')
  assert.ok(md.startsWith('````diff\n'))
  assert.ok(md.endsWith('\n````'))
  // 内容里更长的反引号串（如 5 个）同样能被包住
  assert.ok(fencedDiffMarkdown('x `````` y').startsWith('```````diff'))
  assert.equal(fencedDiffMarkdown(''), '```diff\n\n```')
})

test('拖拽文件接收：拖入两个文件或分两次拖入单个文件自动载入对比', async () => {
  const dropListeners = []
  const prevFeatures = globalThis.window.__ztoolsDeclarativeFeatures
  globalThis.window.__ztoolsDeclarativeFeatures = { fileInput: false }
  globalThis.window.ztools = {
    ...(globalThis.window.ztools || {}),
    events: {
      on(event, cb) {
        if (event === 'plugin_files_dropped') dropListeners.push(cb)
        return () => {}
      }
    }
  }
  host.ipc.filesystem_get_file_size = async () => ({ success: true, size: 16 })
  host.ipc.filesystem_read_file = async (params) => ({
    success: true,
    content: params.path.endsWith('old.txt') ? 'line1\nold\nline3' : 'line1\nnew\nline3'
  })

  try {
    const view = await mount(FileCompareCommand)
    assert.equal(dropListeners.length, 1)

    dropListeners[0]({ payload: { files: ['/tmp/old.txt', '/tmp/new.txt'] } })
    await tick()
    await tick()

    const hunk = view.item('hunk-0')
    assert.match(hunk.props.subtitle, /删除 1 行，新增 1 行/)
    assert.match(String(host.lastToast().title), /已载入两个文件进行对比/)
    view.unmount()
  } finally {
    globalThis.window.__ztoolsDeclarativeFeatures = prevFeatures
  }
})

test('粘贴文件与文本对比：支持双文件粘贴、targetFieldId 槽位投递与 onTextPaste 顺序填入', async () => {
  const fileMap = {
    '/tmp/a.txt': 'line1\nleft-a\nline3',
    '/tmp/b.txt': 'line1\nright-b\nline3',
    '/tmp/c.txt': 'line1\noverride-c\nline3'
  }
  host.ipc.filesystem_get_file_size = async () => ({ success: true, size: 24 })
  host.ipc.filesystem_read_file = async (params) => ({
    success: true,
    content: fileMap[params.path] || ''
  })

  const view = await mount(FileCompareCommand)
  try {
    // 1. 一次粘贴两个文件直接填入左右槽位并触发比对
    await view.pasteFiles(['/tmp/a.txt', '/tmp/b.txt'])
    await tick()
    assert.match(view.item('hunk-0').props.subtitle, /删除 1 行，新增 1 行/)
    assert.match(view.text(), /a\.txt ↔ b\.txt/)

    // 2. 指定 targetFieldId 指向右槽位替换右侧文件
    await view.pasteFiles(['/tmp/c.txt'], { targetFieldId: 'right-slot' })
    await tick()
    assert.match(view.text(), /a\.txt ↔ c\.txt/)

    // 3. 指定 targetFieldId 指向左槽位替换左侧文件
    await view.pasteFiles(['/tmp/b.txt'], { targetFieldId: 'fileA' })
    await tick()
    assert.match(view.text(), /b\.txt ↔ c\.txt/)

    // 4. 清空后通过 pasteText 依次填入左槽与右槽
    await view.run(null, '清空')
    await view.pasteText('hello\nworld')
    assert.equal(view.item('need-other').props.title, '还需要右侧（新文）才能对比')
    await view.pasteText('hello\nztools')
    assert.match(view.item('hunk-0').props.subtitle, /删除 1 行，新增 1 行/)
  } finally {
    view.unmount()
  }
})
