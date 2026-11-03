import test from 'node:test'
import assert from 'node:assert/strict'
import { applyRenameRule, buildRenamePreview, executeRealFileRename } from '../dist/logic.js'

const entry = (dir, name, sep = '/') => ({ name, fullPath: `${dir}${sep}${name}`, parentDir: dir, extension: '', sizeBytes: 1, lastModifiedMs: 0 })

test('macOS 分解写法（NFD）的文件名也能被组合写法（NFC）的查找词替换', () => {
  const nfd = 'がっこう_写真.jpg'.normalize('NFD')
  assert.notEqual(nfd, nfd.normalize('NFC'))
  assert.equal(applyRenameRule(nfd, { type: 'replace', find: 'が', replace: 'ga' }, 0), 'gaっこう_写真.jpg')
  // 原样能匹配时保持原写法，不顺手改变其他字符的规范化形式
  assert.equal(applyRenameRule(`${nfd}`, { type: 'replace', find: '写真', replace: 'photo' }, 0), `${'がっこう_'.normalize('NFD')}photo.jpg`)
  // 匹配不到时不改名
  assert.equal(applyRenameRule(nfd, { type: 'replace', find: 'ぱ', replace: 'x' }, 0), nfd)
})

test('同名冲突按 NFC 与大小写比较：新名与已有文件只差 Unicode 写法时标为冲突', () => {
  const existing = 'café.txt'.normalize('NFD')
  const files = [entry('/Users/u/Downloads', 'cafe.txt')]
  const items = buildRenamePreview(files, { type: 'replace', find: 'cafe', replace: 'café'.normalize('NFC') }, ['cafe.txt', existing])
  assert.equal(items[0].conflict, true)
  assert.equal(items[0].conflictReason, 'exists')
})

test('Windows 路径下新名含 <>"|?*、结尾点或保留名时标为非法；macOS 允许这些字符', () => {
  const winFiles = [entry('C:\\Users\\u\\Downloads', 'a.txt', '\\')]
  for (const prefix of ['what?', 'a|b', 'x*', '<y>']) {
    const [item] = buildRenamePreview(winFiles, { type: 'prefix', prefix }, ['a.txt'])
    assert.equal(item.conflictReason, 'invalid-name', prefix)
  }
  const [reserved] = buildRenamePreview(winFiles, { type: 'replace', find: 'a', replace: 'CON' }, ['a.txt'])
  assert.equal(reserved.newName, 'CON.txt')
  assert.equal(reserved.conflictReason, 'invalid-name')
  const [trailing] = buildRenamePreview([entry('C:\\d', 'noext', '\\')], { type: 'suffix', suffix: '.' }, ['noext'])
  assert.equal(trailing.conflictReason, 'invalid-name')
  const [mac] = buildRenamePreview([entry('/Users/u/Downloads', 'a.txt')], { type: 'prefix', prefix: 'what?' }, ['a.txt'])
  assert.equal(mac.conflict, false)
  assert.equal(mac.newName, 'what?a.txt')
})

test('执行改名时 Windows 非法名在调用宿主前就拒绝', async () => {
  const res = await executeRealFileRename('C:\\d\\a.txt', 'a?.txt')
  assert.equal(res.ok, false)
  assert.match(res.error, /非法/)
})
