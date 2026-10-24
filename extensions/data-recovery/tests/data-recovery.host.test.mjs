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

test('P15 data-recovery: 真实宿主下彻底移除 5 个虚构恢复文件并校验恢复结果', async () => {
  const host = createRealHostStub({
    system_get_path: () => 'C:\\Users\\RealUser\\AppData\\Local\\Temp',
    system_search_files: () => ({
      files: [
        {
          name: 'real_temp_doc.docx',
          path: 'C:\\Users\\RealUser\\AppData\\Local\\Temp\\real_temp_doc.docx',
          is_dir: false,
          size: 51200,
          mtime: Math.floor(Date.now() / 1000)
        }
      ],
      total_matches: 1,
      total_bytes: 51200
    })
  })

  const snap = await dataRecovery.fetchRecoverableFiles('all', host)
  assert.equal(snap.items.length, 1)
  assert.equal(snap.items[0].name, 'real_temp_doc.docx')
  // 严禁出现虚构的财务预测模型假文件
  assert.equal(snap.items.some(f => f.name.includes('季度财务预测模型')), false)

  // 异常边界：当底层恢复与复制均失败时，严禁返回伪成功
  const restoreFail = await dataRecovery.restoreSelectedFiles(snap.items, 'D:\\Recovered', host)
  assert.equal(restoreFail.ok, false)
  assert.equal(restoreFail.restoredCount, 0)
})
