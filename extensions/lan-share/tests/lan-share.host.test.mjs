// 本插件与客户端局域网共享服务的对接测试（导入本插件的 dist/，用注入的客户端替身）
// 覆盖：参数名与客户端一致（id / paths）；下载地址与客户端共享网页一致；服务未运行时不给地址；
// 客户端失败、部分文件读不到、状态没有变化时如实报错；不在客户端里运行时不显示示例数据
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  HOST_REQUIRED_MESSAGE,
  addFilesToShare,
  buildDownloadUrl,
  fetchLanShareStatus,
  filterSharedFiles,
  generateQrCodeSvgDataUri,
  parseLanShareStatus,
  pickFilesToShare,
  removeSharedFile,
  setFileShared,
  startLanShare,
  stopLanShare
} from '../dist/logic.js'

const IFACES = [
  { name: 'WLAN', address: '192.168.1.20', family: 'IPv4', internal: false },
  { name: 'Loopback', address: '127.0.0.1', family: 'IPv4', internal: true }
]
const FILE = { id: 'a1b2c3', name: '报告 v2.pdf', path: 'D:\\Share\\报告 v2.pdf', size: 1048576, sizeBytes: 1048576, shared: true, isDirectory: false }

/** 模拟客户端 LanSharePlugin：按函数名返回结果，记录调用 */
function lanHost(handlers) {
  const calls = []
  return {
    calls,
    dllplugin_call: async ({ plugin, func, params }) => {
      assert.equal(plugin, 'LanSharePlugin')
      calls.push([func, params])
      const handler = handlers[func]
      if (!handler) return { ok: false, success: false, error: `Unsupported LanSharePlugin function: ${func}` }
      return handler(params)
    }
  }
}

const status = (extra = {}) => ({
  ok: true, success: true, interfaces: IFACES, lanIp: '192.168.1.20', primaryIp: '192.168.1.20', port: 8765, running: true, files: [FILE], ...extra
})

test('解析共享状态：运行中时地址与客户端共享网页的下载链接一致', () => {
  const s = parseLanShareStatus(status())
  assert.equal(s.ok, true)
  assert.equal(s.portalUrl, 'http://192.168.1.20:8765')
  assert.deepEqual(s.interfaces, [{ name: 'WLAN', address: '192.168.1.20' }])
  assert.equal(s.files.length, 1)
  assert.equal(s.files[0].downloadUrl, 'http://192.168.1.20:8765/download/a1b2c3/%E6%8A%A5%E5%91%8A%20v2.pdf')
  assert.equal(s.files[0].downloadUrl, buildDownloadUrl(s.portalUrl, FILE.id, FILE.name))
  assert.equal(s.files[0].downloadUrl.includes('/dl/'), false, '不能用按序号的旧地址（会下载到别的文件）')
  assert.equal('downloadCount' in s.files[0], false, '客户端不统计单个文件的下载次数，不能显示')
})

test('[边界] 服务未运行、文件已暂停、文件夹时不给下载地址', () => {
  const stopped = parseLanShareStatus(status({ running: false }))
  assert.equal(stopped.portalUrl, '')
  assert.equal(stopped.files[0].downloadUrl, '')

  const paused = parseLanShareStatus(status({ files: [{ ...FILE, shared: false }, { ...FILE, id: 'dir1', isDirectory: true }] }))
  assert.equal(paused.files[0].shared, false)
  assert.equal(paused.files[0].downloadUrl, '')
  assert.equal(paused.files[1].downloadUrl, '')

  const noLan = parseLanShareStatus(status({ interfaces: [IFACES[1]], lanIp: '127.0.0.1' }))
  assert.deepEqual(noLan.interfaces, [])
})

test('[边界] 不在客户端里运行时读取状态、启动服务、加文件都如实失败，不返回示例文件', async () => {
  const s = await fetchLanShareStatus()
  assert.equal(s.ok, false)
  assert.equal(s.error, HOST_REQUIRED_MESSAGE)
  assert.deepEqual(s.files, [])
  assert.equal((await startLanShare()).ok, false)
  assert.equal((await addFilesToShare(['D:\\a.txt'])).ok, false)
  assert.equal((await pickFilesToShare()).ok, false)
})

test('[故障] 客户端读取失败、启动失败、启动后仍未运行时如实报错', async () => {
  const thrown = await fetchLanShareStatus({ dllplugin_call: async () => { throw new Error('IPC 通道已关闭') } })
  assert.equal(thrown.ok, false)
  assert.equal(thrown.error, 'IPC 通道已关闭')

  const portBusy = await startLanShare(lanHost({ startShareServer: () => ({ success: false, error: { message: 'listen EADDRINUSE' } }) }))
  assert.equal(portBusy.ok, false)
  assert.match(portBusy.message, /EADDRINUSE/)

  const notRunning = await startLanShare(lanHost({ startShareServer: () => status({ running: false }) }))
  assert.equal(notRunning.ok, false)

  const started = await startLanShare(lanHost({ startShareServer: () => status() }))
  assert.equal(started.ok, true)
  assert.equal(started.status.portalUrl, 'http://192.168.1.20:8765')

  const stopped = await stopLanShare(lanHost({ stopShareServer: () => status({ running: false }) }))
  assert.equal(stopped.ok, true)
  const stillRunning = await stopLanShare(lanHost({ stopShareServer: () => status() }))
  assert.equal(stillRunning.ok, false)
})

test('加入共享：用 addFiles 和 paths 调用客户端，读不到的文件如实列为跳过', async () => {
  const host = lanHost({
    addFiles: (params) => status({ added: [{ ...FILE, path: params.paths[0] }] })
  })
  const res = await addFilesToShare(['D:\\Share\\报告 v2.pdf', 'D:\\Share\\已删除.txt'], host)
  assert.deepEqual(host.calls, [['addFiles', { paths: ['D:\\Share\\报告 v2.pdf', 'D:\\Share\\已删除.txt'] }]])
  assert.equal(res.ok, true)
  assert.equal(res.addedCount, 1)
  assert.deepEqual(res.skipped, ['D:\\Share\\已删除.txt'])
  assert.match(res.message, /1 个文件无法读取已跳过/)

  const none = await addFilesToShare(['D:\\missing.txt'], lanHost({ addFiles: () => status({ added: [] }) }))
  assert.equal(none.ok, false)
  assert.equal(none.addedCount, 0)

  const empty = lanHost({})
  assert.equal((await addFilesToShare(['  '], empty)).ok, false)
  assert.equal(empty.calls.length, 0)
})

test('暂停 / 恢复共享：参数名是 id（客户端不认 itemId），以客户端返回的状态为准', async () => {
  const host = lanHost({ toggleFileShare: (p) => status({ files: [{ ...FILE, shared: p.shared }] }) })
  const res = await setFileShared('a1b2c3', false, host)
  assert.equal(res.ok, true)
  assert.deepEqual(host.calls[0], ['toggleFileShare', { id: 'a1b2c3', shared: false }])
  assert.equal('itemId' in host.calls[0][1], false)

  const notFound = await setFileShared('zzz', false, lanHost({
    toggleFileShare: (p) => ({ ok: false, success: false, error: `未找到待切换共享状态的文件: ${p.id}` })
  }))
  assert.equal(notFound.ok, false)
  assert.match(notFound.message, /未找到待切换共享状态的文件/)

  const unchanged = await setFileShared('a1b2c3', false, lanHost({ toggleFileShare: () => status() }))
  assert.equal(unchanged.ok, false)
})

test('移出共享列表：只移出列表，客户端仍列出时报失败', async () => {
  const ok = await removeSharedFile('a1b2c3', lanHost({ removeSharedFile: () => status({ files: [] }) }))
  assert.equal(ok.ok, true)
  assert.match(ok.message, /文件本身没有删除/)
  const still = await removeSharedFile('a1b2c3', lanHost({ removeSharedFile: () => status() }))
  assert.equal(still.ok, false)
})

test('选择文件：取消、单选、多选与选择框报错', async () => {
  const canceled = await pickFilesToShare({ window_show_open_dialog: async () => ({ canceled: true }) })
  assert.equal(canceled.canceled, true)
  assert.deepEqual(canceled.paths, [])

  let dialogParams = null
  const single = await pickFilesToShare({
    window_show_open_dialog: async (p) => { dialogParams = p; return { canceled: false, filePath: 'D:\\a.txt' } }
  })
  assert.deepEqual(single.paths, ['D:\\a.txt'])
  assert.deepEqual(dialogParams.properties, ['openFile', 'multiSelections'])

  const multi = await pickFilesToShare({
    window_show_open_dialog: async () => ({ canceled: false, filePaths: [{ path: 'D:\\a.txt' }, 'D:\\b.txt'] })
  })
  assert.deepEqual(multi.paths, ['D:\\a.txt', 'D:\\b.txt'])

  const failed = await pickFilesToShare({ window_show_open_dialog: async () => { throw new Error('对话框已打开') } })
  assert.equal(failed.ok, false)
  assert.equal(failed.error, '对话框已打开')
})

test('二维码：长地址完整编码，不截断', () => {
  const base = `http://192.168.1.20:8765/download/abc/${'%E6%96%87'.repeat(40)}`
  const a = generateQrCodeSvgDataUri(`${base}-a.pdf`)
  const b = generateQrCodeSvgDataUri(`${base}-b.pdf`)
  assert.ok(a.startsWith('data:image/svg+xml;utf8,'))
  assert.ok(`${base}-a.pdf`.length > 134)
  assert.notEqual(a, b, '只有末尾不同的长地址必须生成不同的二维码')
  assert.equal(generateQrCodeSvgDataUri(''), '')
  assert.equal(generateQrCodeSvgDataUri('x'.repeat(5000)), '', '超出二维码容量时返回空，由界面提示复制地址')
})

test('按文件名或路径搜索', () => {
  const files = parseLanShareStatus(status({ files: [FILE, { ...FILE, id: 'b', name: 'notes.txt', path: 'E:\\docs\\notes.txt' }] })).files
  assert.deepEqual(filterSharedFiles(files, 'notes').map((f) => f.id), ['b'])
  assert.deepEqual(filterSharedFiles(files, 'd:\\share').map((f) => f.id), ['a1b2c3'])
  assert.equal(filterSharedFiles(files, '').length, 2)
})
