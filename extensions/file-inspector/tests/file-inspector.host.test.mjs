import test from 'node:test'
import assert from 'node:assert/strict'
import { createHost } from '../../shared/test-harness.mjs'
import { pickAndReadLocalFile, saveConvertedTextFile, fixFileExtension, inspectFileFromBuffer, convertTextBufferEncoding, detectTextEncodingAndBom, detectMagicSignature } from '../dist/inspector-service.js'

const host = createHost()
test.beforeEach(() => host.reset())
const pickedPath = '/tmp/文件透视 audit.csv'
const loaded = bytes => {
  host.ipc.window_show_open_dialog = () => ({ canceled: false, filePath: pickedPath })
  host.ipc.filesystem_read_file = params => {
    assert.deepEqual(params, { path: pickedPath, encoding: 'base64' })
    return { success: true, content: Buffer.from(bytes).toString('base64'), size: bytes.length }
  }
}

test('按宿主单选 filePath 契约完整读取非 UTF-8 字节和空文件', async () => {
  for (const bytes of [Buffer.from('d6d0cec4', 'hex'), Buffer.alloc(0)]) {
    loaded(bytes)
    const res = await pickAndReadLocalFile()
    assert.equal(res.ok, true)
    assert.equal(res.filePath, pickedPath)
    assert.deepEqual(Buffer.from(res.bytes), bytes)
  }
  assert.ok(host.ipcCalls.every(([method]) => method !== 'dllplugin_call'))
})

test('取消、对话框异常、读取失败和截断响应均不冒充载入成功', async () => {
  host.ipc.window_show_open_dialog = () => ({ canceled: true })
  assert.deepEqual(await pickAndReadLocalFile(), { ok: false, canceled: true })
  assert.equal(host.ipcCalls.length, 1)
  host.ipc.window_show_open_dialog = () => { throw new Error('窗口不可用') }
  assert.match((await pickAndReadLocalFile()).error, /窗口不可用/)
  loaded(Buffer.from('abc'))
  host.ipc.filesystem_read_file = () => { throw new Error('无读取权限') }
  assert.match((await pickAndReadLocalFile()).error, /无读取权限/)
  host.ipc.filesystem_read_file = () => ({ content: 'YWJj', size: 10 })
  assert.match((await pickAndReadLocalFile()).error, /不完整/)
  host.ipc.filesystem_read_file = () => ({ content: '@@@', size: 3 })
  assert.equal((await pickAndReadLocalFile()).ok, false)
})

test('自动探测 GBK 和 UTF-8 采样边界；转码保留所有行、中文、BOM 和换行符', () => {
  const text = Array.from({ length: 125 }, (_, i) => `第${i}行`).join('\n')
  const utf8 = Buffer.from('a'.repeat(4095) + text)
  assert.equal(detectTextEncodingAndBom(utf8).detectedEncoding, 'UTF-8')
  const gbk = Buffer.from('d6d0cec40d0a3132330a', 'hex')
  const info = inspectFileFromBuffer(gbk, pickedPath)
  assert.equal(info.detectedEncoding, 'GBK')
  assert.equal(info.previewLines[0].text, '中文')
  assert.equal(Buffer.from(convertTextBufferEncoding(gbk, 'GBK', 'utf-8-bom', 'LF')).toString(), '\ufeff中文\n123\n')
  assert.equal(inspectFileFromBuffer(Buffer.from(text), pickedPath).previewLines.length, 100)
  assert.equal(Buffer.from(convertTextBufferEncoding(Buffer.from(text), 'UTF-8', 'utf-8-bom', 'CRLF')).toString(), '\ufeff' + text.replaceAll('\n', '\r\n'))
  assert.throws(() => convertTextBufferEncoding(gbk, 'UTF-8', 'utf-8-bom'), /encoded data|valid/i)
  assert.throws(() => convertTextBufferEncoding(gbk, 'GBK', 'gbk'), /不支持/)
})

test('较大转换结果通过另存为写入完整字节，不覆盖原路径', async () => {
  const bytes = new Uint8Array(300_003).fill(97)
  bytes.set([239, 187, 191])
  host.ipc.window_show_save_dialog = params => {
    assert.equal(params.defaultName, '文件透视 audit_utf8bom.csv')
    return { canceled: false, filePath: '/tmp/converted.csv' }
  }
  host.ipc.filesystem_write_file = params => {
    assert.equal(params.path, '/tmp/converted.csv')
    assert.equal(params.encoding, 'base64')
    assert.deepEqual(Buffer.from(params.content, 'base64'), Buffer.from(bytes))
    return { success: true, size: bytes.length }
  }
  assert.deepEqual(await saveConvertedTextFile(pickedPath, bytes), { ok: true, outputPath: '/tmp/converted.csv' })
})

test('另存为取消不写文件；权限、写入字节不符与超限均返回失败', async () => {
  const bytes = new Uint8Array([1, 2])
  host.ipc.window_show_save_dialog = () => ({ canceled: true })
  assert.equal((await saveConvertedTextFile(pickedPath, bytes)).canceled, true)
  assert.equal(host.ipcCalls.length, 1)
  host.ipc.window_show_save_dialog = () => ({ filePath: '/tmp/result.txt', canceled: false })
  host.ipc.filesystem_write_file = () => { throw new Error('磁盘已满') }
  assert.match((await saveConvertedTextFile(pickedPath, bytes)).error, /磁盘已满/)
  host.ipc.filesystem_write_file = () => ({ success: true, size: 1 })
  assert.equal((await saveConvertedTextFile(pickedPath, bytes)).ok, false)
  const count = host.ipcCalls.length
  assert.equal((await saveConvertedTextFile(pickedPath, new Uint8Array(16 * 1024 * 1024 + 1))).ok, false)
  assert.equal(host.ipcCalls.length, count)
})

test('修正后缀使用宿主原子不覆盖移动，保留同目录和 Windows 路径', async () => {
  for (const [source, dest] of [['/tmp/image.fake', '/tmp/image.png'], ['C:\\temp\\图片.jpg', 'C:\\temp\\图片.png'], ['/tmp/.picture', '/tmp/.picture.png']]) {
    host.ipc.window_show_select_folder_dialog = params => ({ canceled: false, folderPath: params.defaultPath })
    host.ipc.filesystem_move_file_no_replace = params => {
      assert.deepEqual(params, { sourcePath: source, destPath: dest })
      return { success: true }
    }
    assert.deepEqual(await fixFileExtension(source, 'png'), { ok: true, newPath: dest })
  }
  host.ipc.filesystem_move_file_no_replace = () => { throw new Error('输出已存在，未覆盖') }
  assert.match((await fixFileExtension('/tmp/a.jpg', 'png')).error, /未覆盖/)
  const count = host.ipcCalls.length
  assert.equal((await fixFileExtension('/tmp/a.jpg', '../png')).ok, false)
  assert.equal((await fixFileExtension('/tmp/../a.jpg', 'png')).ok, false)
  assert.equal(host.ipcCalls.length, count)
})

 test('修正后缀取消授权或选择其他文件夹时不移动文件', async () => {
  host.ipc.window_show_select_folder_dialog = () => ({ canceled: true })
  assert.equal((await fixFileExtension('/tmp/photo.jpg', 'png')).canceled, true)
  host.ipc.window_show_select_folder_dialog = () => ({ canceled: false, folderPath: '/other' })
  assert.match((await fixFileExtension('/tmp/photo.jpg', 'png')).error, /请选择/)
  assert.ok(host.ipcCalls.every(([method]) => method === 'window_show_select_folder_dialog'))
})

const ftyp = (major, compatible = []) => {
  const size = 16 + compatible.length * 4
  const buf = Buffer.alloc(size + 8)
  buf.writeUInt32BE(size, 0)
  buf.write('ftyp', 4, 'ascii')
  buf.write(major, 8, 'ascii')
  compatible.forEach((brand, i) => buf.write(brand, 16 + i * 4, 'ascii'))
  return buf
}

test('AVIF 按 ftyp 主品牌或兼容品牌识别；HEIC 与其他 ftyp 文件不误判为 AVIF', () => {
  assert.equal(detectMagicSignature(ftyp('avif'), 'jpg').realExtension, 'avif')
  assert.equal(detectMagicSignature(ftyp('avis'), 'jpg').realMimeType, 'image/avif')
  assert.equal(detectMagicSignature(ftyp('mif1', ['mif1', 'miaf', 'avif']), 'png').realExtension, 'avif')
  const info = inspectFileFromBuffer(ftyp('avif', ['mif1']), '/tmp/photo.jpg')
  assert.equal(info.extensionMismatch, true)
  assert.equal(info.realExtension, 'avif')
  assert.equal(info.isText, false)
  assert.match(info.detectionBasis, /image\/avif/)
  // HEIC（mif1 + heic）、MP4（isom）不是 AVIF
  assert.notEqual(detectMagicSignature(ftyp('mif1', ['mif1', 'heic']), 'jpg').realExtension, 'avif')
  assert.notEqual(detectMagicSignature(ftyp('isom', ['isom', 'mp41']), 'mp4').realExtension, 'avif')
  // 截断的文件头不越界、不误判
  assert.notEqual(detectMagicSignature(ftyp('avif').subarray(0, 10), 'jpg').realExtension, 'avif')
})

test('编码判断依据如实描述：BOM、合法 UTF-8、GBK 推测与二进制', () => {
  assert.match(detectTextEncodingAndBom(Buffer.from('efbbbf61', 'hex')).detectionBasis, /BOM/)
  assert.match(detectTextEncodingAndBom(Buffer.from('abc')).detectionBasis, /合法的 UTF-8/)
  assert.match(detectTextEncodingAndBom(Buffer.from('d6d0cec4', 'hex')).detectionBasis, /推测/)
  assert.match(detectTextEncodingAndBom(Buffer.from('610062', 'hex')).detectionBasis, /二进制/)
  assert.equal('confidence' in inspectFileFromBuffer(Buffer.from('abc'), '/tmp/a.txt'), false)
})
