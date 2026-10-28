import test from 'node:test'
import assert from 'node:assert/strict'
import {
  splitFileName,
  applyRenameRule,
  batchApplyRename,
  getSampleFiles
} from '../dist/logic.js'

test('BatchRename 文件名分离边界测试', () => {
  assert.deepEqual(splitFileName('test.txt'), { baseName: 'test', extension: '.txt' })
  assert.deepEqual(splitFileName('archive.tar.gz'), { baseName: 'archive.tar', extension: '.gz' })
  assert.deepEqual(splitFileName('no_ext'), { baseName: 'no_ext', extension: '' })
  assert.deepEqual(splitFileName('.gitignore'), { baseName: '.gitignore', extension: '' })
})

test('BatchRename 规则引擎全功能测试', () => {
  // 1. 前缀规则
  assert.equal(applyRenameRule('file.png', { type: 'prefix', prefix: 'pre_' }, 0), 'pre_file.png')

  // 2. 后缀规则
  assert.equal(applyRenameRule('file.png', { type: 'suffix', suffix: '_v2' }, 0), 'file_v2.png')

  // 3. 查找替换
  assert.equal(applyRenameRule('old_name.jpg', { type: 'replace', find: 'old', replace: 'new' }, 0), 'new_name.jpg')

  // 4. 大小写模式
  assert.equal(applyRenameRule('photo.JPG', { type: 'case', caseMode: 'lower' }, 0), 'photo.jpg')
  assert.equal(applyRenameRule('photo.jpg', { type: 'case', caseMode: 'upper' }, 0), 'PHOTO.JPG')

  // 5. 序号编号
  assert.equal(applyRenameRule('clip.mp4', { type: 'number', startNumber: 1, padDigits: 3 }, 0), 'clip_001.mp4')
  assert.equal(applyRenameRule('clip.mp4', { type: 'number', startNumber: 1, padDigits: 3 }, 5), 'clip_006.mp4')
})

test('BatchRename 批量应用与变更状态测试', () => {
  const files = ['a.txt', 'b.txt']
  const results = batchApplyRename(files, { type: 'prefix', prefix: 'test_' })

  assert.equal(results.length, 2)
  assert.equal(results[0].newName, 'test_a.txt')
  assert.equal(results[0].changed, true)

  // 无变更规则
  const noChange = batchApplyRename(files, { type: 'replace', find: 'non-existent', replace: 'xxx' })
  assert.equal(noChange[0].changed, false)
})
