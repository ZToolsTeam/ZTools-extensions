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

test('差异最小且可逆：与系统 diff 改动行数一致，报告能被 patch 正确应用', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ztools-diff-'))
  const rnd = (n) => Array.from({ length: n }, () => 'abcde'[Math.floor(Math.random() * 5)]).join('\n')
  try {
    for (let t = 0; t < 120; t++) {
      const A = rnd(Math.floor(Math.random() * 30))
      const B = rnd(Math.floor(Math.random() * 30))
      const r = diffText(A, B)
      assert.equal(r.lines.filter((l) => l.op !== 'remove').map((l) => l.text).join('\n'), splitLines(B).join('\n'))
      fs.writeFileSync(path.join(dir, 'a'), A ? A + '\n' : '')
      fs.writeFileSync(path.join(dir, 'b'), B ? B + '\n' : '')
      let out = ''
      try { execFileSync(gitTestTool('diff'), [path.join(dir, 'a'), path.join(dir, 'b')]) } catch (e) { if (e.status !== 1) throw e; out = String(e.stdout) }
      assert.equal(r.added + r.removed, out.split('\n').filter((l) => /^[<>] /.test(l)).length)
      if (!r.identical) {
        fs.writeFileSync(path.join(dir, 'p'), formatUnifiedDiff(r, 'a', 'b') + '\n')
        execFileSync(gitTestTool('patch'), ['-s', '-o', path.join(dir, 'o'), path.join(dir, 'a'), path.join(dir, 'p')])
        assert.equal(fs.readFileSync(path.join(dir, 'o'), 'utf8'), fs.readFileSync(path.join(dir, 'b'), 'utf8'))
      }
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('[边界] 换行符差异、忽略空白、空文本、超大文本', () => {
  assert.equal(diffText('x\r\ny', 'x\ny').identical, true)
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
  assert.equal(host.clipboard.text, '--- 左侧\n+++ 右侧\n@@ -1,3 +1,3 @@\n a\n-b\n+B\n c')
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
