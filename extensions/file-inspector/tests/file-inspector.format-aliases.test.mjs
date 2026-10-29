import test from 'node:test'
import assert from 'node:assert/strict'
import { inspectFileFromBuffer } from '../dist/inspector-service.js'

const zip = Buffer.from('504b030414000000', 'hex')
const pdf = Buffer.from('%PDF-1.7\n')
const html = Buffer.from('<!DOCTYPE html><html><body>404</body></html>')

test('ZIP 容器格式（含 macOS iWork 文稿）不提示改成 .zip，真正的错误扩展名仍提示', () => {
  for (const name of ['报告.pages', '表格.numbers', '演示.key', 'a.epub', 'b.odt', 'c.xlsm', 'd.whl']) {
    const info = inspectFileFromBuffer(zip, `/Users/u/${name}`)
    assert.equal(info.extensionMismatch, false, name)
    assert.equal(info.realExtension, name.split('.').pop())
  }
  const wrong = inspectFileFromBuffer(zip, '/Users/u/photo.png')
  assert.equal(wrong.extensionMismatch, true)
  assert.equal(wrong.realExtension, 'zip')
})

test('Illustrator .ai 与 JPEG 别名不误报；PDF 改成 .jpg 仍提示', () => {
  assert.equal(inspectFileFromBuffer(pdf, '/x/logo.ai').extensionMismatch, false)
  assert.equal(inspectFileFromBuffer(pdf, '/x/logo.jpg').realExtension, 'pdf')
  const jpeg = Buffer.from('ffd8ffe000104a464946', 'hex')
  for (const ext of ['jpg', 'jpeg', 'jpe', 'jfif']) {
    assert.equal(inspectFileFromBuffer(jpeg, `/x/a.${ext}`).extensionMismatch, false, ext)
  }
  assert.equal(inspectFileFromBuffer(jpeg, '/x/a.webp').extensionMismatch, true)
})

test('HTML 开头的模板文件不提示改名，二进制扩展名的报错网页仍提示改为 .html', () => {
  for (const name of ['index.php', 'page.htm', 'view.ejs', 'notes.txt']) {
    const info = inspectFileFromBuffer(html, `/x/${name}`)
    assert.equal(info.extensionMismatch, false, name)
    assert.equal(info.realMimeType, 'text/html')
  }
  for (const name of ['report.pdf', 'image.jpg', 'setup.dmg', 'doc.pages']) {
    const info = inspectFileFromBuffer(html, `/x/${name}`)
    assert.equal(info.extensionMismatch, true, name)
    assert.equal(info.realExtension, 'html')
  }
})
