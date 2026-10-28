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

const APPDATA = 'C:\\Users\\RealUser\\AppData\\Roaming'
const HOME = 'C:\\Users\\RealUser'
const DB_PATH = `${APPDATA}\\SomeApp\\data.db`

function pathHandler({ name }) {
  if (name === 'appData') return APPDATA
  if (name === 'home') return HOME
  return ''
}

function searchWithDb({ query }) {
  if (String(query) === `dir:${APPDATA}`) {
    return {
      files: [
        { name: 'data.db', path: DB_PATH, is_dir: false, size: 40960, mtime: 1 },
        { name: 'notes.txt', path: `${APPDATA}\\SomeApp\\notes.txt`, is_dir: false, size: 10, mtime: 1 }
      ],
      total_matches: 2
    }
  }
  return { files: [], total_matches: 0, total_bytes: 0 }
}

const INSPECT_RESULT = {
  ok: true,
  success: true,
  dbPath: DB_PATH,
  sizeBytes: 40960,
  tables: [
    {
      name: 'accounts',
      type: 'table',
      rowCount: 2,
      columns: [
        { cid: 0, name: 'id', type: 'INTEGER', pk: true },
        { cid: 1, name: 'name', type: 'TEXT', pk: false }
      ],
      ddl: 'CREATE TABLE accounts (id INTEGER PRIMARY KEY, name TEXT)'
    },
    { name: 'logs', type: 'view', rowCount: 7, columns: [{ cid: 0, name: 'msg', type: 'TEXT', pk: false }], ddl: '' }
  ],
  rows: [
    { id: 1, name: 'alice' },
    { id: 2, name: "o'neil, \"bob\"" }
  ]
}

test('sqlite-plugin: 不在客户端里运行时不显示示例数据库与示例表', async () => {
  const ws = await sqlitePlugin.fetchSqliteWorkspace()
  assert.equal(ws.databases.length, 0)
  assert.equal(ws.tables.length, 0)
  assert.equal(ws.rows.length, 0)
  assert.equal(ws.error, sqlitePlugin.NOT_IN_CLIENT_MESSAGE)
  assert.equal(typeof sqlitePlugin.createInitialSqliteWorkspace, 'undefined')
  assert.equal(typeof sqlitePlugin.executeSqliteQuery, 'undefined', '不再提供执行任意 SQL（含 VACUUM）的入口')
})

test('sqlite-plugin: 找不到数据库文件时如实提示，不用猜测的路径去读取', async () => {
  const host = createRealHostStub({
    system_get_path: pathHandler,
    system_search_files: () => ({ files: [], total_matches: 0, total_bytes: 0 }),
    dllplugin_call: () => {
      throw new Error('不应读取任何数据库')
    }
  })
  const ws = await sqlitePlugin.fetchSqliteWorkspace(undefined, host)
  assert.equal(ws.tables.length, 0)
  assert.equal(ws.error, sqlitePlugin.NO_DATABASE_MESSAGE)
  assert.equal(host.calls.some((c) => c.channel === 'dllplugin_call'), false)
})

test('sqlite-plugin: 表结构与记录来自客户端返回，不编造体积、索引与日志模式', async () => {
  const host = createRealHostStub({
    system_get_path: pathHandler,
    system_search_files: searchWithDb,
    dllplugin_call: (payload) => {
      assert.equal(payload.plugin, 'SqlitePlugin')
      assert.equal(payload.func, 'inspectWorkspace')
      assert.equal(payload.params.dbPath, DB_PATH)
      return INSPECT_RESULT
    }
  })
  const ws = await sqlitePlugin.fetchSqliteWorkspace(undefined, host)
  assert.equal(ws.error, undefined)
  assert.deepEqual(ws.databases.map((d) => d.name), ['data.db'])
  assert.equal(ws.activeDbPath, DB_PATH)
  assert.deepEqual(ws.tables.map((t) => [t.tableName, t.type, t.rowCount]), [['accounts', 'table', 2], ['logs', 'view', 7]])
  assert.equal(ws.tables[0].schemaSummary, 'id INTEGER PK, name TEXT')
  assert.equal(ws.rowsTableName, 'accounts')
  assert.equal(ws.rows.length, 2)
  assert.deepEqual(ws.rows[1].data, { id: 2, name: "o'neil, \"bob\"" })
  const text = JSON.stringify(ws)
  assert.doesNotMatch(text, /WAL/)
  assert.equal('sizeBytes' in ws.tables[0], false)
  assert.equal('indexes' in ws.tables[0], false)
})

test('sqlite-plugin: 读取数据库失败时返回原因并保留数据库列表', async () => {
  const host = createRealHostStub({
    system_get_path: pathHandler,
    system_search_files: searchWithDb,
    dllplugin_call: () => ({ ok: false, success: false, error: 'file is not a database' })
  })
  const ws = await sqlitePlugin.fetchSqliteWorkspace(undefined, host)
  assert.equal(ws.tables.length, 0)
  assert.equal(ws.databases.length, 1)
  assert.match(ws.error, /读取 data\.db 失败/)
  assert.match(ws.error, /file is not a database/)
})

test('sqlite-plugin: 按表名只读读取记录，不传 SQL 语句；失败时如实返回', async () => {
  const okHost = createRealHostStub({
    dllplugin_call: (payload) => {
      assert.equal(payload.func, 'executeQuery')
      assert.equal(payload.params.tableName, 'logs')
      assert.equal(payload.params.limit, sqlitePlugin.PREVIEW_LIMIT)
      assert.equal('sql' in payload.params, false)
      return { ok: true, success: true, rows: [{ msg: 'hello' }], columns: ['msg'] }
    }
  })
  const ok = await sqlitePlugin.fetchTableRows(DB_PATH, 'logs', okHost)
  assert.equal(ok.ok, true)
  assert.deepEqual(ok.rows.map((r) => r.data), [{ msg: 'hello' }])
  assert.equal(ok.rows[0].tableName, 'logs')

  const badHost = createRealHostStub({
    dllplugin_call: () => ({ ok: false, success: false, error: 'no such table: logs' })
  })
  const bad = await sqlitePlugin.fetchTableRows(DB_PATH, 'logs', badHost)
  assert.equal(bad.ok, false)
  assert.equal(bad.rows.length, 0)
  assert.match(bad.error, /no such table/)
})

test('sqlite-plugin: 导出文本使用真实字段值并正确转义', () => {
  const rows = sqlitePlugin.mapRowRecords('accounts', [
    { id: 1, name: 'alice', avatar: new Uint8Array([0xde, 0xad]), note: null },
    { id: 2, name: "o'neil, \"bob\"\nline2", avatar: null, note: 'x' }
  ])
  const table = {
    id: 'accounts',
    tableName: 'accounts',
    type: 'table',
    rowCount: 2,
    columns: [{ name: 'id', type: 'INTEGER', pk: true }, { name: 'name', type: 'TEXT', pk: false }],
    schemaSummary: ''
  }

  const json = JSON.parse(sqlitePlugin.formatExportText(rows, 'json', table))
  assert.deepEqual(json[0], { id: 1, name: 'alice', avatar: 'dead', note: null })

  const csv = sqlitePlugin.formatExportText(rows, 'csv', table).split('\r\n')
  assert.equal(csv[0], 'id,name,avatar,note')
  assert.equal(csv[1], '1,alice,dead,')
  assert.equal(csv.slice(2).join('\r\n'), '2,"o\'neil, ""bob""\nline2",,x')

  const sql = sqlitePlugin.formatExportText(rows, 'sql_insert', table).split('\n')
  assert.equal(sql[0], `INSERT INTO "accounts" ("id", "name", "avatar", "note") VALUES (1, 'alice', X'dead', NULL);`)
  assert.ok(sql[1].startsWith(`INSERT INTO "accounts" ("id", "name", "avatar", "note") VALUES (2, 'o''neil, "bob"`))
  assert.doesNotMatch(sql.join('\n'), /payload_json/)
})

test('sqlite-plugin: 复制到剪贴板失败时不提示已复制', async () => {
  const rows = sqlitePlugin.mapRowRecords('t', [{ a: 1 }])
  const failed = await sqlitePlugin.exportTableRecords(rows, 'json', async () => {
    throw new Error('剪贴板被占用')
  })
  assert.equal(failed.ok, false)
  assert.match(failed.message, /复制到剪贴板失败：剪贴板被占用/)

  let copied = ''
  const ok = await sqlitePlugin.exportTableRecords(rows, 'csv', async (text) => {
    copied = text
  })
  assert.equal(ok.ok, true)
  assert.equal(copied, 'a\r\n1')

  const empty = await sqlitePlugin.exportTableRecords([], 'json', async () => {})
  assert.equal(empty.ok, false)
})
