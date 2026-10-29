import test from 'node:test'
import assert from 'node:assert/strict'
import { createHost, mount, tick } from '../../shared/test-harness.mjs'
import SqlitePluginCommand from '../dist/index.js'

const APPDATA = 'C:\\Users\\Tester\\AppData\\Roaming'
const HOME = 'C:\\Users\\Tester'
const DB_PATH = `${APPDATA}\\SomeApp\\data.db`

function installHost(host, { queryError } = {}) {
  const dllCalls = []
  host.ipc.system_get_path = async ({ name }) => (name === 'appData' ? APPDATA : name === 'home' ? HOME : '')
  host.ipc.system_search_files = async ({ query }) => {
    if (String(query) === `dir:${APPDATA}`) {
      return { files: [{ name: 'data.db', path: DB_PATH, is_dir: false, size: 40960, mtime: 1 }], total_matches: 1 }
    }
    return { files: [], total_matches: 0 }
  }
  host.ipc.dllplugin_call = async ({ plugin, func, params }) => {
    assert.equal(plugin, 'SqlitePlugin')
    dllCalls.push({ func, params })
    if (func === 'inspectWorkspace') {
      return {
        ok: true,
        success: true,
        tables: [
          { name: 'accounts', type: 'table', rowCount: 2, columns: [{ name: 'id', type: 'INTEGER', pk: true }, { name: 'name', type: 'TEXT', pk: false }] },
          { name: 'logs', type: 'table', rowCount: 1, columns: [{ name: 'msg', type: 'TEXT', pk: false }] }
        ],
        rows: [{ id: 1, name: 'alice' }, { id: 2, name: 'bob' }]
      }
    }
    if (func === 'executeQuery') {
      if (queryError) return { ok: false, success: false, error: queryError }
      return { ok: true, success: true, rows: [{ msg: 'hello' }] }
    }
    throw new Error(`unexpected ${func}`)
  }
  return dllCalls
}

function rowItems(view) {
  return view.items().filter((it) => String(it.props.id).startsWith('sql-row-'))
}

test('sqlite-plugin UI: 打开后显示第一张表的真实记录，不默认勾选，没有 VACUUM 等写入动作', async () => {
  const host = createHost()
  const dllCalls = installHost(host)
  const view = await mount(SqlitePluginCommand, host)

  const rows = rowItems(view)
  assert.equal(rows.length, 2)
  assert.ok(rows.every((r) => r.props.checked === false))
  assert.match(rows[0].props.title, /id=1 · name=alice/)
  assert.match(view.tree().props.filterBar.summaryText, /data\.db/)
  assert.match(view.tree().props.filterBar.summaryText, /已勾选 0 行/)

  const text = view.text()
  assert.doesNotMatch(text, /VACUUM|Checkpoint|WAL/i)
  const allActionTitles = view.items().flatMap((it) => view.actions(it).map((a) => a.props.title))
  assert.ok(!allActionTitles.some((t) => /VACUUM|整理|压缩/.test(t)))
  assert.deepEqual(dllCalls.map((c) => c.func), ['inspectWorkspace'])

  // 未勾选时导出当前列表，内容是真实字段值
  await view.run(rows[0], '导出当前列表的 2 行为 JSON')
  assert.deepEqual(JSON.parse(host.clipboard.text), [{ id: 1, name: 'alice' }, { id: 2, name: 'bob' }])
  assert.equal(host.lastToast().style, 'SUCCESS')

  // 勾选一行后只导出勾选的行
  rows[1].props.onCheckChange(true)
  await new Promise((r) => setTimeout(r, 0))
  await view.run(rowItems(view)[1], '导出已勾选的 1 行为 SQL INSERT 语句')
  assert.equal(host.clipboard.text, `INSERT INTO "accounts" ("id", "name") VALUES (2, 'bob');`)
  view.unmount()
})

test('sqlite-plugin UI: 选中其他表时只读读取该表记录，失败时如实显示原因', async () => {
  const host = createHost()
  const dllCalls = installHost(host)
  const view = await mount(SqlitePluginCommand, host)

  view.item('nav-sql-logs').props.onSelect()
  await new Promise((r) => setTimeout(r, 10))
  const query = dllCalls.find((c) => c.func === 'executeQuery')
  assert.ok(query, '选中表后应读取该表')
  assert.equal(query.params.tableName, 'logs')
  assert.equal('sql' in query.params, false)
  assert.deepEqual(rowItems(view).map((r) => r.props.title), ['msg=hello'])

  // 再次选中同一张表不重复读取
  view.item('nav-sql-logs').props.onSelect()
  await new Promise((r) => setTimeout(r, 10))
  assert.equal(dllCalls.filter((c) => c.func === 'executeQuery').length, 1)
  view.unmount()

  const failHost = createHost()
  installHost(failHost, { queryError: 'database is locked' })
  const failView = await mount(SqlitePluginCommand, failHost)
  failView.item('nav-sql-logs').props.onSelect()
  await new Promise((r) => setTimeout(r, 10))
  assert.equal(rowItems(failView).length, 0)
  assert.match(failView.tree().props.subList.emptyText, /读取失败：database is locked/)
  assert.match(failView.tree().props.filterBar.summaryText, /读取表「logs」失败/)
  failView.unmount()
})

test('sqlite-plugin UI: 读取数据库失败时显示原因，不显示示例表', async () => {
  const host = createHost()
  installHost(host)
  host.ipc.dllplugin_call = async () => ({ ok: false, success: false, error: 'file is not a database' })
  const view = await mount(SqlitePluginCommand, host)
  assert.equal(rowItems(view).length, 0)
  assert.equal(view.items().filter((it) => String(it.props.id).startsWith('nav-sql-')).length, 0)
  assert.match(view.tree().props.filterBar.summaryText, /file is not a database/)
  assert.match(view.tree().props.subList.emptyText, /file is not a database/)
  view.unmount()
})


test('打开数据库：原生对话框取消或失败不改当前库，选中扫描范围外文件后读取并加入列表', async () => {
  const host = createHost(), calls = installHost(host)
  const view = await mount(SqlitePluginCommand)
  try {
    const open = () => view.tree().props.filterBar.actions.find(action => action.id === 'open-database').onAction()
    const initial = calls.length
    host.ipc.window_show_open_dialog = async () => ({ canceled: true })
    await open(); await tick()
    assert.equal(calls.length, initial)
    host.ipc.window_show_open_dialog = async () => { throw new Error('对话框不可用') }
    await open(); await tick()
    assert.equal(host.lastToast().style, 'FAILURE')
    assert.equal(calls.length, initial)
    const selected = 'D:/fixture/selected.sqlite'
    host.ipc.window_show_open_dialog = async params => {
      assert.equal(params.filters, 'SQLite 数据库|*.db;*.sqlite;*.sqlite3')
      assert.deepEqual(params.properties, ['openFile'])
      return { canceled: false, filePath: selected }
    }
    await open(); await tick()
    assert.equal(calls.at(-1).params.dbPath, selected)
    assert.equal(view.tree().props.searchBarAccessory.props.value, selected)
    assert.match(view.tree().props.filterBar.summaryText, /selected\.sqlite/)
  } finally { view.unmount() }
})

test('读取错误不再经旧 SDK 无会话重试，保留宿主原始错误', async () => {
  const host = createHost(); installHost(host)
  const previous = globalThis.ztools
  let legacyCalls = 0
  globalThis.ztools = { dllplugin: { call: async () => { legacyCalls++; throw new Error('旧 SDK 错误') } } }
  host.ipc.dllplugin_call = async () => ({ success: false, error: '原始读取错误' })
  const view = await mount(SqlitePluginCommand)
  try {
    assert.match(view.text(), /原始读取错误/)
    assert.equal(legacyCalls, 0)
  } finally { view.unmount(); globalThis.ztools = previous }
})
