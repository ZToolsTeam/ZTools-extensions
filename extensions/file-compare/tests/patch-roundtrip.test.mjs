import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHost, mount, mountPushed } from '../../shared/test-harness.mjs'
import Command from '../dist/index.js'
import { diffText, formatUnifiedDiff } from '../dist/logic.js'

function applyPatch(left, right, patch) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ztools-patch-eof-'))
  try {
    fs.writeFileSync(path.join(dir, 'text.txt'), left)
    fs.writeFileSync(path.join(dir, 'change.patch'), patch)
    execFileSync('git', ['apply', '--check', '--no-index', '-p0', 'change.patch'], { cwd: dir })
    execFileSync('git', ['apply', '--no-index', '-p0', 'change.patch'], { cwd: dir })
    assert.equal(fs.readFileSync(path.join(dir, 'text.txt'), 'utf8'), right)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
}

test('报告原样交给 git apply：空文件、末尾换行增删、无换行上下文和近似结果均可还原', () => {
  const texts = ['', 'same', 'same\n', '\n', '\n\n', 'a\nb', 'a\nb\n', 'a\na\nb', 'b\na\na', '中文\n末行']
  for (const left of texts) for (const right of texts) for (const maxCost of [1, 100000]) {
    const result = diffText(left, right, { maxCost })
    assert.equal(result.identical, left === right)
    const patch = formatUnifiedDiff(result, 'text.txt', 'text.txt')
    if (left === right) assert.equal(patch, '')
    else applyPatch(left, right, patch)
  }
})

test('真实复制动作保留结尾换行与 EOF 标记，不由测试补写报告内容', async () => {
  const host = createHost(), view = await mount(Command)
  try {
    await view.run(null, '编辑两段文本…')
    const form = await mountPushed(host)
    try {
      await form.fill('left', 'same'); await form.fill('right', 'same\n')
      await form.run(null, '开始对比')
    } finally { form.unmount() }
    assert.ok(view.item('hunk-0'))
    await view.run(view.item('hunk-0'), '复制差异报告')
    assert.ok(host.clipboard.text.endsWith('\n'))
    assert.match(host.clipboard.text, /\\ No newline at end of file/)
    // 文件名来自界面标签，仅为临时文件测试统一名称，正文保持真实复制输出。
    applyPatch('same', 'same\n', host.clipboard.text.replace('--- 左侧\n+++ 右侧\n', '--- text.txt\n+++ text.txt\n'))
  } finally { view.unmount() }
})

test('Windows CRLF、混合换行和末尾 CR 的补丁原样应用后逐字节还原', () => {
  const cases = [
    ['before\r\n', 'after\r\n'], ['same\r\n', 'same\n'], ['same\n', 'same\r\n'],
    ['first\r\nbefore\nlast\r\n', 'first\r\nafter\nlast\r\n'],
    ['a\rb\r', 'a\rc\r'], ['', '\r\n'], ['\r\n', ''],
    ['same\r', 'same\r\n'], ['same\r\n', 'same\r']
  ]
  for (const [left, right] of cases) for (const maxCost of [1, 100000]) {
    const result = diffText(left, right, { maxCost })
    assert.equal(result.identical, false)
    applyPatch(left, right, formatUnifiedDiff(result, 'text.txt', 'text.txt'))
  }
})
