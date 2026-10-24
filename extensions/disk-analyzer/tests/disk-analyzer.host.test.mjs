// 本插件现行代码的宿主集成测试（从 packages/declarative-ui/tests/real-layout2-plugins.test.mjs 按插件拆出，导入改为本插件的 dist/）
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as diskAnalyzer from '../dist/logic.js'

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

test("P21 ~ P25 boost, software-manager, disk-analyzer, cleaner, batch-rename: 真实传输层与异常边界验证（disk-analyzer 部分）", async () => {
  const failHost = createRealHostStub({})
  const dllKillHost = createRealHostStub({
    dllplugin_call: (payload) => {
      assert.equal(payload.plugin, 'ProcessMonitorPlugin')
      assert.equal(payload.func, 'TerminateProcessByPID')
      return { success: true }
    }
  })
  const diskCapFail = await diskAnalyzer.invokeNativeCapability('StartScan', { rootPath: 'C:\\' }, failHost)
  assert.equal(diskCapFail.ok, false)
  assert.equal(diskCapFail.data?.simulated, undefined)
  const dllOkHost = createRealHostStub({
    dllplugin_call: (payload) => ({
      executed: true,
      plugin: payload.plugin,
      func: payload.func
    })
  })
})

// ---- 宿主 dir: 扫描截断：如实标注抽样，不把抽样当全盘结果；macOS 额外扫描 ~/Library/Caches ----
function dirPayload(dir, { truncated = false, approximate = false, visited = 0 } = {}) {
  return {
    success: true,
    data: {
      query: `dir:${dir}`,
      files: [{ name: 'big.bin', path: `${dir}/big.bin`, size: 10 * 1024 * 1024, is_dir: false, mtime: 1 }],
      count: 1,
      total_matches: 1,
      total_bytes: 10 * 1024 * 1024,
      subdirs: [{ name: 'deep', path: `${dir}/deep`, file_count: 3, total_bytes: 40 * 1024 * 1024, ...(approximate ? { approximate: true } : {}) }],
      truncated,
      approximate,
      visited_entries: visited,
      max_entries: 2000
    }
  }
}

function macHost(scanned, options) {
  return createRealHostStub({
    system_get_path: ({ name }) => ({ success: true, data: name === 'home' ? '/Users/tester' : name === 'temp' ? '' : `/Users/tester/${name[0].toUpperCase()}${name.slice(1)}` }),
    system_search_files: ({ query }) => {
      const dir = query.slice(4)
      scanned.push(dir)
      return dirPayload(dir, options(dir))
    }
  })
}

test('disk-analyzer: 宿主扫描截断时快照标记 sampled 与已扫描条目数，子目录近似体积透传', async () => {
  const scanned = []
  const snap = await diskAnalyzer.fetchDiskAnalysisSnapshot(macHost(scanned, (dir) =>
    dir.endsWith('/Downloads') ? { truncated: true, approximate: true, visited: 2000 } : { visited: 12 }))
  assert.ok(scanned.includes('/Users/tester/Library/Caches'), `scanned: ${scanned.join(', ')}`)
  assert.equal(snap.sampled, true)
  assert.equal(snap.scannedEntries, 2000 + 12 * (scanned.length - 1))
  const downloadsDeep = snap.topDirectories.find((dir) => dir.path === '/Users/tester/Downloads/deep')
  assert.equal(downloadsDeep.approximate, true)
  const docsDeep = snap.topDirectories.find((dir) => dir.path === '/Users/tester/Documents/deep')
  assert.equal(docsDeep.approximate, undefined)
})

test('disk-analyzer: 宿主完整扫描（未截断）时不标抽样；畸形截断字段不被当成 true', async () => {
  const scanned = []
  const snap = await diskAnalyzer.fetchDiskAnalysisSnapshot(macHost(scanned, () => ({ visited: 5 })))
  assert.equal(snap.sampled, undefined)
  assert.equal(snap.scannedEntries, undefined)
  const garbage = createRealHostStub({
    system_get_path: () => ({ success: true, data: '/Users/tester/Downloads' }),
    system_search_files: ({ query }) => {
      const payload = dirPayload(query.slice(4))
      payload.data.truncated = 'yes'
      payload.data.visited_entries = 'many'
      return payload
    }
  })
  const garbageSnap = await diskAnalyzer.fetchDiskAnalysisSnapshot(garbage)
  assert.equal(garbageSnap.sampled, undefined)
})
