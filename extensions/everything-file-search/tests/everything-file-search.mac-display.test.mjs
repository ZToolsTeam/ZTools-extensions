import test from 'node:test'
import assert from 'node:assert/strict'
import { truncatePath, getFileCategory, sortAndFilterFiles, moveToTrash } from '../dist/index.js'

test('macOS 长路径缩写保持 / 分隔，不显示成 Windows 的反斜杠；Windows 路径仍用反斜杠', () => {
  const mac = '/Users/tester/Library/Mobile Documents/com~apple~CloudDocs/项目/2026/季度报告/最终版.pdf'
  const short = truncatePath(mac)
  assert.equal(short, '/Users/tester/.../季度报告/最终版.pdf')
  assert.ok(!short.includes('\\'))
  assert.equal(truncatePath('/Volumes/外置盘/a/b/c/d/e/f/g/h/i/j/k/l/m/n/o/p/q/r/s/file.mov'), '/Volumes/.../s/file.mov')
  assert.equal(truncatePath('C:\\Users\\tester\\AppData\\Local\\Some Vendor\\Cache\\deep\\file.bin'), 'C:\\...\\deep\\file.bin')
})

test('认不出的扩展名归为“其他”，不混进文档筛选；HEIC / DMG / PKG 归入对应类型', () => {
  assert.equal(getFileCategory('Makefile', false), 'other')
  assert.equal(getFileCategory('backup.vmdk', false), 'other')
  assert.equal(getFileCategory('IMG_0001.HEIC', false), 'image')
  assert.equal(getFileCategory('Installer.dmg', false), 'archive')
  assert.equal(getFileCategory('Setup.pkg', false), 'app')
  const files = [
    { name: 'a.pdf', path: '/x/a.pdf', isDir: false, size: 1, mtime: 0 },
    { name: 'b.vmdk', path: '/x/b.vmdk', isDir: false, size: 1, mtime: 0 }
  ]
  assert.deepEqual(sortAndFilterFiles(files, 'name-asc', 'document').map(f => f.name), ['a.pdf'])
})

test('回收与文件夹提示按平台使用废纸篓 / 访达或回收站 / 资源管理器', async () => {
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  try {
    for (const [platform, trash, manager] of [['MacIntel', '废纸篓', '访达'], ['Win32', '回收站', '资源管理器']]) {
      Object.defineProperty(globalThis, 'navigator', { value: { platform }, configurable: true, writable: true })
      const res = await moveToTrash('/x/dir', {}, true)
      assert.equal(res.success, false)
      assert.equal(res.message, `文件夹不能在这里移入${trash}，请在${manager}中操作`)
    }
  } finally {
    if (saved) Object.defineProperty(globalThis, 'navigator', saved); else delete globalThis.navigator
  }
})
