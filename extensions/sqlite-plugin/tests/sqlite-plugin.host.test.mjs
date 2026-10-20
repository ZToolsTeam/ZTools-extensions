// 本插件现行代码的宿主集成测试（从 packages/declarative-ui/tests/real-layout2-plugins.test.mjs 按插件拆出，导入改为本插件的 dist/）
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as sqlitePlugin from '../dist/logic.js'

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

test('P18 sqlite-plugin: 真实宿主下连接与执行 SQL 校验及危险 SQL 拦截验证', async () => {
  const host = createRealHostStub({
    system_get_path: () => 'C:\\Users\\RealUser\\AppData\\Roaming',
    system_search_files: () => ({ files: [], total_matches: 0, total_bytes: 0 })
  })

  // 未挂载 sqlite 原生服务时在真实宿主下返回空表结构而非假表
  const ws = await sqlitePlugin.fetchSqliteWorkspace(undefined, host)
  assert.equal(ws.tables.length, 0)

  // 危险 SQL 拦截
  const dropRes = await sqlitePlugin.executeSqliteQuery('C:\\test.db', 'DROP TABLE kv_storage;', host)
  assert.equal(dropRes.ok, false)

  // 未挂载 sqlite.execute 时真实宿主下返回 ok: false，绝不伪造 SELECT 结果行
  const selectFail = await sqlitePlugin.executeSqliteQuery('C:\\test.db', 'SELECT * FROM kv_storage LIMIT 5;', host)
  assert.equal(selectFail.ok, false)
  assert.equal(selectFail.rows.length, 0)

  // 挂载 sqlite.execute (dllplugin_call) 时返回真实行数据
  const okHost = createRealHostStub({
    dllplugin_call: (payload) => {
      assert.equal(payload.plugin, 'SqlitePlugin')
      assert.equal(payload.func, 'executeQuery')
      return {
        rows: [{ key: 'theme', value: 'dark' }],
        affectedRows: 0,
        message: '查询成功 (1 行)'
      }
    }
  })
  const selectOk = await sqlitePlugin.executeSqliteQuery('C:\\test.db', 'SELECT * FROM kv_storage;', okHost)
  assert.equal(selectOk.ok, true)
  assert.equal(selectOk.rows.length, 1)
  assert.equal(selectOk.rows[0].key, 'theme')
})
