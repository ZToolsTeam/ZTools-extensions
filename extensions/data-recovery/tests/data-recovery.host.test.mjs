// 本插件现行代码的宿主集成测试（从 packages/declarative-ui/tests/real-layout2-plugins.test.mjs 按插件拆出，导入改为本插件的 dist/）
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as dataRecovery from '../dist/logic.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
function createRealHostStub(handlers = {}) {
  const calls = []
  const dispatch = async (method, params) => {
    calls.push({ channel: method, payload: params })
    if (typeof handlers[method] === 'function') {
      return await handlers[method](params)
    }
    if (method in handlers) {
      return handlers[method]
    }
    throw new Error(`CHANNEL_NOT_IMPLEMENTED: ${method}`)
  }

  const stub = {
    __isRealHost: true,
    calls,
    transport: {
      call: dispatch
    }
  }

  for (const key of Object.keys(handlers)) {
    stub[key] = (params) => dispatch(key, params)
  }

  return stub
}

const DESKTOP = 'C:\\Users\\RealUser\\Desktop'
const BIN = 'C:\\$Recycle.Bin\\S-1-5-21-1000'

const SCAN_RESULT = {
  ok: true,
  success: true,
  items: [
    {
      id: 'a1',
      name: '$RABC123.docx',
      path: `${BIN}\\$RABC123.docx`,
      cachePath: `${BIN}\\$RABC123.docx`,
      originalPath: `${BIN}\\$RABC123.docx`,
      sizeBytes: 20480,
      deletedAtMs: Date.UTC(2026, 0, 2, 3, 4, 5),
      modifiedAt: new Date(Date.UTC(2026, 0, 2, 3, 4, 5)).toISOString(),
      integrity: '回收站/备份可恢复'
    },
    {
      id: 'b2',
      name: '$RXYZ999.bin',
      path: `${BIN}\\$RXYZ999.bin`,
      cachePath: `${BIN}\\$RXYZ999.bin`,
      sizeBytes: 100
    }
  ]
}

function pathHandler({ name }) {
  return name === 'desktop' ? DESKTOP : ''
}

test('data-recovery: 不在客户端里运行时不显示示例文件', async () => {
  const snap = await dataRecovery.fetchRecoverableFiles()
  assert.equal(snap.items.length, 0)
  assert.equal(snap.error, dataRecovery.NOT_IN_CLIENT_MESSAGE)
  assert.equal(typeof dataRecovery.createInitialRecoverySnapshot, 'undefined')
  assert.equal(typeof dataRecovery.SCAN_DEPTH_MODES, 'undefined', '不再提供客户端做不到的扫描模式')
})

test('data-recovery: 读取回收站失败时如实报错，不改列临时文件冒充可恢复文件', async () => {
  const host = createRealHostStub({
    system_get_path: pathHandler,
    dllplugin_call: () => ({ ok: false, success: false, error: '拒绝访问' }),
    system_search_files: () => ({
      files: [{ name: '~WRL0001.tmp', path: 'C:\\Users\\RealUser\\AppData\\Local\\Temp\\~WRL0001.tmp', is_dir: false, size: 51200, mtime: 1 }],
      total_matches: 1
    })
  })
  const snap = await dataRecovery.fetchRecoverableFiles(host)
  assert.equal(snap.items.length, 0)
  assert.match(snap.error, /读取回收站失败：拒绝访问/)
  assert.equal(host.calls.some((c) => c.channel === 'system_search_files'), false)
})

test('data-recovery: 列表只用客户端返回的字段，不编造原路径、完整度与删除时间', async () => {
  const host = createRealHostStub({
    system_get_path: pathHandler,
    dllplugin_call: (payload) => {
      assert.equal(payload.plugin, 'DataRecoveryPlugin')
      assert.equal(payload.func, 'scanDeletedFiles')
      return SCAN_RESULT
    }
  })
  const snap = await dataRecovery.fetchRecoverableFiles(host)
  assert.equal(snap.error, undefined)
  assert.equal(snap.restoreTargetDir, `${DESKTOP}\\ZToolsRecovered`)
  assert.deepEqual(snap.items.map((i) => [i.name, i.category]), [['$RABC123.docx', 'documents'], ['$RXYZ999.bin', 'other']])
  assert.ok(snap.items[0].modifiedText.length > 0)
  assert.equal(snap.items[1].modifiedText, '')
  const text = JSON.stringify(snap)
  assert.doesNotMatch(text, /完整度|integrity|originalPath|Documents/)
})

test('data-recovery: 拿不到桌面路径时不使用猜测的目录，恢复直接拒绝', async () => {
  const host = createRealHostStub({
    system_get_path: () => {
      throw new Error('PATH_UNAVAILABLE')
    },
    dllplugin_call: () => SCAN_RESULT
  })
  const snap = await dataRecovery.fetchRecoverableFiles(host)
  assert.equal(snap.restoreTargetDir, '')
  assert.match(snap.error, /无法获取桌面路径/)
  const res = await dataRecovery.restoreSelectedFiles(snap.items, snap.restoreTargetDir, host)
  assert.equal(res.ok, false)
  assert.equal(host.calls.filter((c) => c.channel === 'dllplugin_call').length, 1)
})

test('data-recovery: 恢复到新建的时间子文件夹，重名自动编号，部分失败如实列出', async () => {
  const restoreCalls = []
  const host = createRealHostStub({
    dllplugin_call: (payload) => {
      assert.equal(payload.func, 'restoreFile')
      restoreCalls.push(payload.params)
      if (payload.params.sourcePath.endsWith('bad.txt')) return { ok: false, success: false, error: '待恢复的源文件不存在' }
      return { ok: true, success: true, recoveredCount: 1, targetPath: payload.params.targetPath }
    },
    filesystem_copy_file: () => {
      throw new Error('不能改用其他复制方式')
    }
  })
  const items = [
    { id: '1', name: 'same.docx', cachePath: 'C:\\$Recycle.Bin\\S-1\\same.docx', category: 'documents', categoryName: '文档', sizeBytes: 10, modifiedText: '' },
    { id: '2', name: 'same.docx', cachePath: 'D:\\$Recycle.Bin\\S-1\\same.docx', category: 'documents', categoryName: '文档', sizeBytes: 20, modifiedText: '' },
    { id: '3', name: 'bad.txt', cachePath: 'C:\\$Recycle.Bin\\S-1\\bad.txt', category: 'documents', categoryName: '文档', sizeBytes: 5, modifiedText: '' }
  ]
  const now = new Date(2026, 9, 28, 15, 30, 12, 45)
  const res = await dataRecovery.restoreSelectedFiles(items, `${DESKTOP}\\ZToolsRecovered`, host, now)
  const outDir = `${DESKTOP}\\ZToolsRecovered\\20261028-153012-045`
  assert.deepEqual(restoreCalls.map((c) => c.targetPath), [`${outDir}\\same.docx`, `${outDir}\\same (2).docx`, `${outDir}\\bad.txt`])
  assert.ok(restoreCalls.every((c) => !('targetDir' in c)))
  assert.equal(res.ok, false)
  assert.equal(res.restoredCount, 2)
  assert.equal(res.restoredBytes, 30)
  assert.equal(res.outputDir, outDir)
  assert.deepEqual(res.failed, [{ name: 'bad.txt', error: '待恢复的源文件不存在' }])
  assert.match(res.message, /1 个失败/)
  assert.match(res.message, /待恢复的源文件不存在/)
  assert.equal(host.calls.some((c) => c.channel === 'filesystem_copy_file'), false)

  const none = await dataRecovery.restoreSelectedFiles([], `${DESKTOP}\\ZToolsRecovered`, host)
  assert.equal(none.ok, false)
  assert.equal(none.message, '请先勾选要恢复的文件')
  const sys = await dataRecovery.restoreSelectedFiles(items, 'C:\\Windows\\Temp', host)
  assert.equal(sys.ok, false)
})
